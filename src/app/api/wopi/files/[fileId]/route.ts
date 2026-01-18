/**
 * WOPI CheckFileInfo Endpoint
 *
 * GET /api/wopi/files/{fileId}
 *
 * Returns file metadata for Collabora to understand file properties
 * and user permissions. This is the first call Collabora makes when
 * loading a document.
 *
 * @see https://learn.microsoft.com/en-us/microsoft-365/cloud-storage-partner-program/rest/files/checkfileinfo
 */

import {
  buildCheckFileInfo,
  getAppBaseUrl,
  parseWopiFileId,
  validateWopiRequest,
} from "@/lib/collabora";
import { threadSandboxContextRepository } from "@/lib/db/repository";
import { NextRequest } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  try {
    // Validate WOPI access token
    const validation = await validateWopiRequest(request);
    if (!validation.valid) {
      console.error("WOPI validation failed:", validation.error);
      return new Response(validation.error, { status: 401 });
    }

    const { payload } = validation;
    const { fileId: rawFileId } = await params;

    // Parse the combined fileId (format: threadId__fileId)
    const parsed = parseWopiFileId(rawFileId);
    const fileId = parsed?.fileId || rawFileId;

    // Verify fileId matches token (compare against the parsed fileId)
    if (payload.fileId !== fileId) {
      console.error("File ID mismatch:", {
        tokenFileId: payload.fileId,
        requestFileId: fileId,
      });
      return new Response("File ID mismatch", { status: 403 });
    }

    // Get file metadata from thread context
    const context = await threadSandboxContextRepository.getByThreadId(
      payload.threadId,
    );
    if (!context) {
      console.error("Thread context not found:", payload.threadId);
      return new Response("File not found", { status: 404 });
    }

    // Find the file in the thread's files
    const files = context.fileMetadata || [];
    const file = files.find(
      (f) => f.storageKey === fileId || f.name === fileId,
    );

    if (!file) {
      console.error("File not found in thread:", {
        fileId,
        threadId: payload.threadId,
      });
      return new Response("File not found", { status: 404 });
    }

    // Build CheckFileInfo response
    const appUrl = getAppBaseUrl();
    const fileInfo = buildCheckFileInfo(
      {
        id: file.storageKey || file.name,
        name: file.name,
        size: file.size,
        ownerId: payload.odisId,
        updatedAt: new Date(file.uploadedAt || Date.now()),
      },
      {
        id: payload.odisId,
        name: "User", // Could fetch actual user name if needed
        canWrite: payload.canWrite,
      },
      appUrl,
    );

    // Log for debugging
    console.log("WOPI CheckFileInfo:", {
      fileId,
      fileName: file.name,
      size: file.size,
      canWrite: payload.canWrite,
    });

    return Response.json(fileInfo);
  } catch (error) {
    console.error("WOPI CheckFileInfo error:", error);
    return new Response("Internal server error", { status: 500 });
  }
}

/**
 * POST /api/wopi/files/{fileId}
 *
 * Handles WOPI operations via X-WOPI-Override header.
 * Currently supports:
 * - LOCK (optional, we don't implement locking)
 * - UNLOCK (optional)
 * - REFRESH_LOCK (optional)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  try {
    const validation = await validateWopiRequest(request);
    if (!validation.valid) {
      return new Response(validation.error, { status: 401 });
    }

    const override = request.headers.get("X-WOPI-Override");
    const { fileId } = await params;

    console.log("WOPI POST operation:", { fileId, override });

    // Handle different WOPI operations
    switch (override) {
      case "LOCK":
      case "UNLOCK":
      case "REFRESH_LOCK":
      case "GET_LOCK":
        // We don't implement locking - just acknowledge
        return new Response(null, {
          status: 200,
          headers: {
            "X-WOPI-Lock": "",
          },
        });

      case "PUT_RELATIVE":
        // Save as new file - not implemented
        return new Response("Not implemented", { status: 501 });

      case "RENAME_FILE":
        // Rename - not implemented
        return new Response("Not implemented", { status: 501 });

      case "DELETE":
        // Delete - not implemented via WOPI
        return new Response("Not implemented", { status: 501 });

      default:
        return new Response(`Unknown operation: ${override}`, { status: 400 });
    }
  } catch (error) {
    console.error("WOPI POST error:", error);
    return new Response("Internal server error", { status: 500 });
  }
}
