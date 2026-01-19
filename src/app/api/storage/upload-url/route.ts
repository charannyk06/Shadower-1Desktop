/**
 * Upload URL API - Local-First Implementation
 *
 * Vercel Blob client upload has been removed for local-first architecture.
 * This endpoint now only supports local file storage fallback.
 */

import { getSession } from "auth/server";
import { colorize } from "consola/utils";
import { serverFileStorage, storageDriver } from "lib/file-storage";
import globalLogger from "lib/logger";
import { NextResponse } from "next/server";
import { checkStorageAction } from "../actions";

const logger = globalLogger.withDefaults({
  message: colorize("blackBright", `[${storageDriver} Upload URL API]`),
});

// Constants
const DEFAULT_UPLOAD_EXPIRES_SECONDS = 3600; // 1 hour
const FALLBACK_UPLOAD_URL = "/api/storage/upload";

// Types
interface GenericUploadRequest {
  filename?: string;
  contentType?: string;
}

interface FallbackResponse {
  directUploadSupported: false;
  fallbackUrl: string;
  message: string;
}

// Helpers
function createFallbackResponse(): FallbackResponse {
  return {
    directUploadSupported: false,
    fallbackUrl: FALLBACK_UPLOAD_URL,
    message: "Use multipart/form-data upload to fallbackUrl",
  };
}

/**
 * Handles generic upload URL request (Local FS).
 * Returns presigned URL if supported, otherwise returns fallback response.
 */
async function handleGenericUpload(request: GenericUploadRequest) {
  // Check if storage backend supports direct upload
  if (typeof serverFileStorage.createUploadUrl !== "function") {
    logger.info("Storage doesn't support createUploadUrl, using fallback");
    return NextResponse.json(createFallbackResponse());
  }

  const uploadUrl = await serverFileStorage.createUploadUrl({
    filename: request.filename || "file",
    contentType: request.contentType || "application/octet-stream",
    expiresInSeconds: DEFAULT_UPLOAD_EXPIRES_SECONDS,
  });

  if (!uploadUrl) {
    logger.info("Storage returned null, using fallback");
    return NextResponse.json(createFallbackResponse());
  }

  // Provide a public source URL for clients to reference after successful PUT
  const sourceUrl =
    (await serverFileStorage.getSourceUrl?.(uploadUrl.key)) || uploadUrl.url;

  return NextResponse.json({
    directUploadSupported: true,
    ...uploadUrl,
    sourceUrl,
  });
}

/**
 * Upload URL endpoint.
 *
 * Provides optimal upload method based on storage backend:
 * - Local FS: Server upload (fallback)
 *
 * Note: Vercel Blob and S3 direct uploads have been removed for local-first architecture.
 */
export async function POST(request: Request) {
  // Authenticate
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check storage configuration first
  const storageCheck = await checkStorageAction();
  if (!storageCheck.isValid) {
    logger.error("Storage configuration error", {
      error: storageCheck.error,
      solution: storageCheck.solution,
    });

    return NextResponse.json(
      {
        error: storageCheck.error,
        solution: storageCheck.solution,
        storageDriver,
      },
      { status: 500 },
    );
  }

  // Parse request body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    // For local-first mode, always use generic upload handler
    return await handleGenericUpload(body as GenericUploadRequest);
  } catch (error) {
    logger.error("Upload URL generation failed", error);
    return NextResponse.json(
      { error: "Failed to create upload URL" },
      { status: 500 },
    );
  }
}
