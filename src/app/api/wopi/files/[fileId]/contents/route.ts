/**
 * WOPI GetFile / PutFile Endpoint
 *
 * GET  /api/wopi/files/{fileId}/contents - Download file content
 * POST /api/wopi/files/{fileId}/contents - Upload/save file content
 *
 * These endpoints handle the actual file transfer between Collabora
 * and our storage system. GetFile is called when loading a document,
 * PutFile is called when saving (including auto-save).
 *
 * @see https://learn.microsoft.com/en-us/microsoft-365/cloud-storage-partner-program/rest/files/getfile
 * @see https://learn.microsoft.com/en-us/microsoft-365/cloud-storage-partner-program/rest/files/putfile
 */

import { parseWopiFileId, validateWopiRequest } from "@/lib/collabora";
import { threadSandboxContextRepository } from "@/lib/db/repository";
import { serverFileStorage } from "@/lib/file-storage";
import { NextRequest } from "next/server";

/**
 * GET /api/wopi/files/{fileId}/contents
 *
 * Returns the binary content of the file. Collabora calls this
 * when loading a document for editing.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  try {
    const { fileId: rawFileId } = await params;

    // Parse the combined fileId to extract threadId and actual fileId
    // Format: threadId__fileId (we embed threadId because Collabora doesn't pass the token)
    const parsed = parseWopiFileId(rawFileId);
    const threadId = parsed?.threadId;
    const fileId = parsed?.fileId || rawFileId;

    // Try to validate WOPI access token (might fail because Collabora doesn't always pass it)
    const validation = await validateWopiRequest(request);

    // Get the threadId from either the parsed URL or the token
    const effectiveThreadId =
      threadId || (validation.valid ? validation.payload.threadId : null);

    if (!effectiveThreadId) {
      return new Response("File not found", { status: 404 });
    }

    // Look up the file in the thread context to get the actual storageKey
    const context =
      await threadSandboxContextRepository.getByThreadId(effectiveThreadId);
    if (!context) {
      return new Response("File not found", { status: 404 });
    }

    const files = context.fileMetadata || [];

    // Use STRICT matching only - no loose normalization (security fix)
    const file = files.find(
      (f) => f.storageKey === fileId || f.url === fileId || f.name === fileId,
    );

    // Get the actual storage URL - could be in storageKey or url field
    const storageUrl = file?.storageKey || file?.url;

    if (!file || !storageUrl) {
      return new Response("File not found", { status: 404 });
    }

    // Download using the actual storage URL
    let content: Buffer;
    try {
      content = await serverFileStorage.download(storageUrl);
    } catch (downloadError) {
      console.error(
        "[WOPI GetFile] Download failed:",
        downloadError instanceof Error ? downloadError.message : downloadError,
      );
      return new Response("File not found", { status: 404 });
    }

    // Return file content with appropriate headers
    // Convert Buffer to ArrayBuffer for Response compatibility
    const arrayBuffer = content.buffer.slice(
      content.byteOffset,
      content.byteOffset + content.byteLength,
    ) as ArrayBuffer;
    return new Response(arrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": content.length.toString(),
        "X-WOPI-ItemVersion": new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("WOPI GetFile error:", error);
    return new Response("Internal server error", { status: 500 });
  }
}

/**
 * POST /api/wopi/files/{fileId}/contents
 *
 * Saves the file content. Collabora calls this when the user saves
 * or when auto-save triggers. The entire file content is sent in
 * the request body.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  try {
    // Validate WOPI access token
    const validation = await validateWopiRequest(request);
    if (!validation.valid) {
      console.error("WOPI PutFile validation failed:", validation.error);
      return new Response(validation.error, { status: 401 });
    }

    const { payload } = validation;
    const { fileId } = await params;

    // Check write permission
    if (!payload.canWrite) {
      console.error("PutFile: User does not have write permission");
      return new Response("Write access denied", { status: 403 });
    }

    // Verify fileId matches token
    if (payload.fileId !== fileId) {
      console.error("PutFile: File ID mismatch");
      return new Response("File ID mismatch", { status: 403 });
    }

    // Get file metadata from thread context
    const context = await threadSandboxContextRepository.getByThreadId(
      payload.threadId,
    );
    if (!context) {
      console.error("PutFile: Thread context not found:", payload.threadId);
      return new Response("File not found", { status: 404 });
    }

    // Find the file
    const files = context.fileMetadata || [];
    const fileIndex = files.findIndex(
      (f) => f.storageKey === fileId || f.name === fileId,
    );

    if (fileIndex === -1) {
      console.error("PutFile: File not found:", {
        fileId,
        threadId: payload.threadId,
      });
      return new Response("File not found", { status: 404 });
    }

    const file = files[fileIndex];
    if (!file.storageKey) {
      console.error("PutFile: File has no storage key");
      return new Response("File storage error", { status: 500 });
    }

    // Get new content from request body
    const newContent = Buffer.from(await request.arrayBuffer());
    const newSize = newContent.length;

    console.log("WOPI PutFile:", {
      fileId,
      fileName: file.name,
      oldSize: file.size,
      newSize,
    });

    // Delete old file and upload new content
    // (Some storage backends don't support in-place updates)
    try {
      await serverFileStorage.delete(file.storageKey);
    } catch (e) {
      // File might not exist, continue anyway
      console.warn("Could not delete old file:", e);
    }

    // Upload new content with same key
    const uploadResult = await serverFileStorage.upload(newContent, {
      filename: file.storageKey,
      contentType: file.type || "application/octet-stream",
    });

    // Update file metadata in database
    const updatedAt = new Date().toISOString();
    const updatedFiles = [...files];
    updatedFiles[fileIndex] = {
      ...file,
      size: newSize,
      url: uploadResult.sourceUrl,
      uploadedAt: updatedAt,
    };

    await threadSandboxContextRepository.updateFileMetadata(
      payload.threadId,
      updatedFiles,
    );

    // Update total context size
    const sizeDiff = newSize - file.size;
    const currentSize = Number.parseInt(context.contextSizeBytes || "0", 10);
    await threadSandboxContextRepository.updateArchive(
      payload.threadId,
      context.contextStorageKey || "",
      Math.max(0, currentSize + sizeDiff),
    );

    // Return success with new version
    return Response.json(
      {
        LastModifiedTime: updatedAt,
        ItemVersion: updatedAt,
      },
      {
        status: 200,
        headers: {
          "X-WOPI-ItemVersion": updatedAt,
        },
      },
    );
  } catch (error) {
    console.error("WOPI PutFile error:", error);
    return new Response("Internal server error", { status: 500 });
  }
}
