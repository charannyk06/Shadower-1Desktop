import { getSession } from "auth/server";
import { ThreadFileMetadata } from "lib/db/sqlite/schema.sqlite";
import {
  chatRepository,
  threadSandboxContextRepository,
} from "lib/db/repository";
import { serverFileStorage } from "lib/file-storage";
import { z } from "zod";

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25MB
const MAX_CONTEXT_SIZE_BYTES = 100 * 1024 * 1024; // 100MB

type AuthResult =
  | { success: true; userId: string; threadId: string }
  | { success: false; response: Response };

/**
 * Helper to validate auth and thread access - reduces duplication across handlers
 */
async function validateThreadAccess(
  params: Promise<{ threadId: string }>,
): Promise<AuthResult> {
  const session = await getSession();
  if (!session?.user?.id) {
    return {
      success: false,
      response: new Response("Unauthorized", { status: 401 }),
    };
  }

  const { threadId } = await params;
  const hasAccess = await chatRepository.checkAccess(threadId, session.user.id);
  if (!hasAccess) {
    return {
      success: false,
      response: Response.json({ error: "Thread not found" }, { status: 404 }),
    };
  }

  return { success: true, userId: session.user.id, threadId };
}

/**
 * GET /api/thread/[threadId]/files
 * List all files in the thread's sandbox context
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const auth = await validateThreadAccess(params);
  if (!auth.success) return auth.response;

  const context = await threadSandboxContextRepository.getByThreadId(
    auth.threadId,
  );

  if (!context) {
    return Response.json({
      files: [],
      totalFilesCount: 0,
      contextSizeBytes: "0",
    });
  }

  return Response.json({
    files: context.fileMetadata || [],
    totalFilesCount: context.totalFilesCount,
    contextSizeBytes: context.contextSizeBytes,
    lastExecutionAt: context.lastExecutionAt,
  });
}

/**
 * POST /api/thread/[threadId]/files
 * Upload a file to the thread's sandbox context
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const auth = await validateThreadAccess(params);
  if (!auth.success) return auth.response;

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return Response.json({ error: "No file provided" }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return Response.json(
        {
          error: `File too large. Maximum size is ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB`,
        },
        { status: 400 },
      );
    }

    const context = await threadSandboxContextRepository.getOrCreate(
      auth.threadId,
      auth.userId,
    );

    const currentSize = Number.parseInt(context.contextSizeBytes || "0", 10);
    if (currentSize + file.size > MAX_CONTEXT_SIZE_BYTES) {
      return Response.json(
        {
          error: `Context size limit exceeded. Maximum is ${MAX_CONTEXT_SIZE_BYTES / 1024 / 1024}MB`,
        },
        { status: 400 },
      );
    }

    const storageKey = `thread-uploads/${auth.threadId}/${file.name}`;
    const fileBuffer = Buffer.from(await file.arrayBuffer());

    const uploadResult = await serverFileStorage.upload(fileBuffer, {
      filename: storageKey,
      contentType: file.type || "application/octet-stream",
    });

    const fileMetadata: ThreadFileMetadata = {
      name: file.name,
      size: file.size,
      type: file.type || "application/octet-stream",
      source: "user",
      storageKey,
      url: uploadResult.sourceUrl,
      uploadedAt: new Date().toISOString(),
    };

    await threadSandboxContextRepository.addFile(auth.threadId, fileMetadata);

    const newSize = currentSize + file.size;
    await threadSandboxContextRepository.updateArchive(
      auth.threadId,
      context.contextStorageKey || "",
      newSize,
    );

    return Response.json({ success: true, file: fileMetadata });
  } catch (error) {
    console.error("Failed to upload file:", error);
    return Response.json({ error: "Failed to upload file" }, { status: 500 });
  }
}

/**
 * DELETE /api/thread/[threadId]/files
 * Delete all files in the thread's sandbox context
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const auth = await validateThreadAccess(params);
  if (!auth.success) return auth.response;

  try {
    const body = await request.json().catch(() => ({}));
    const schema = z.object({ filename: z.string().optional() });
    const { filename } = schema.parse(body);

    const context = await threadSandboxContextRepository.getByThreadId(
      auth.threadId,
    );

    if (!context) {
      return Response.json({ success: true, message: "No context to clear" });
    }

    if (filename) {
      const file = context.fileMetadata?.find((f) => f.name === filename);
      if (!file) {
        return Response.json({ error: "File not found" }, { status: 404 });
      }

      if (file.storageKey) {
        try {
          await serverFileStorage.delete(file.storageKey);
        } catch (e) {
          console.warn("Failed to delete file from storage:", e);
        }
      }

      await threadSandboxContextRepository.removeFile(auth.threadId, filename);

      const currentSize = Number.parseInt(context.contextSizeBytes || "0", 10);
      const newSize = Math.max(0, currentSize - (file.size || 0));
      await threadSandboxContextRepository.updateArchive(
        auth.threadId,
        context.contextStorageKey || "",
        newSize,
      );

      return Response.json({ success: true, deletedFile: filename });
    }

    // Delete all files
    const files = context.fileMetadata || [];
    for (const file of files) {
      if (file.storageKey) {
        try {
          await serverFileStorage.delete(file.storageKey);
        } catch (e) {
          console.warn("Failed to delete file from storage:", e);
        }
      }
    }

    if (context.contextStorageKey) {
      try {
        await serverFileStorage.delete(context.contextStorageKey);
      } catch (e) {
        console.warn("Failed to delete archive from storage:", e);
      }
    }

    await threadSandboxContextRepository.updateFileMetadata(auth.threadId, []);
    await threadSandboxContextRepository.updateArchive(auth.threadId, "", 0);

    return Response.json({ success: true, message: "All files cleared" });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: "Invalid input", details: error.message },
        { status: 400 },
      );
    }

    console.error("Failed to delete files:", error);
    return Response.json({ error: "Failed to delete files" }, { status: 500 });
  }
}
