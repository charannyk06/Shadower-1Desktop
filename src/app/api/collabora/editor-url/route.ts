/**
 * Collabora Editor URL API
 *
 * POST /api/collabora/editor-url
 *
 * Generates the Collabora editor URL with proper WOPI parameters
 * and access token for a given file.
 */

import {
  generateEditorConfig,
  isCollaboraConfigured,
  isCollaboraSupported,
} from "@/lib/collabora";
import {
  chatRepository,
  threadSandboxContextRepository,
} from "@/lib/db/repository";
import { getSession } from "auth/server";
import { NextRequest } from "next/server";
import { z } from "zod";

const requestSchema = z.object({
  fileId: z.string().min(1, "File ID is required"),
  fileName: z.string().min(1, "File name is required"),
  mimeType: z.string().min(1, "MIME type is required"),
  threadId: z.string().min(1, "Thread ID is required"),
});

export async function POST(request: NextRequest) {
  try {
    // Check if Collabora is configured
    if (!isCollaboraConfigured()) {
      return Response.json(
        { error: "Document editing is not configured" },
        { status: 503 },
      );
    }

    // Authenticate user
    const session = await getSession();
    if (!session?.user?.id) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Parse and validate request
    const body = await request.json();
    const result = requestSchema.safeParse(body);

    if (!result.success) {
      return Response.json(
        { error: "Invalid request", details: result.error.format() },
        { status: 400 },
      );
    }

    const { fileId, fileName, mimeType, threadId } = result.data;

    // Check if file type is supported
    if (!isCollaboraSupported(mimeType)) {
      return Response.json(
        { error: `File type not supported for editing: ${mimeType}` },
        { status: 400 },
      );
    }

    // Verify user has access to the thread
    const hasAccess = await chatRepository.checkAccess(
      threadId,
      session.user.id,
    );
    if (!hasAccess) {
      return Response.json({ error: "Access denied" }, { status: 403 });
    }

    // Verify file exists in thread
    const context =
      await threadSandboxContextRepository.getByThreadId(threadId);
    if (!context) {
      return Response.json({ error: "Thread not found" }, { status: 404 });
    }

    const files = context.fileMetadata || [];
    const file = files.find(
      (f) =>
        f.storageKey === fileId || f.name === fileId || f.name === fileName,
    );

    if (!file) {
      return Response.json({ error: "File not found" }, { status: 404 });
    }

    // Generate editor configuration
    const config = await generateEditorConfig(
      file.storageKey || file.name,
      file.name,
      file.type || mimeType,
      session.user.id,
      threadId,
      true, // canWrite
    );

    return Response.json({
      editorUrl: config.collaboraUrl,
      accessToken: config.accessToken,
      accessTokenTtl: config.accessTokenTtl,
      fileType: config.fileType,
      fileName: config.fileName,
    });
  } catch (error) {
    console.error("Failed to generate Collabora editor URL:", error);
    return Response.json(
      { error: "Failed to generate editor URL" },
      { status: 500 },
    );
  }
}
