/**
 * Screenshot Storage Service
 *
 * Stores screenshots in Vercel Blob storage instead of database.
 * Provides efficient storage, retrieval, and cleanup of screenshot images.
 */

import { del, list, put } from "@vercel/blob";
import { colorize } from "consola/utils";
import globalLogger from "logger";
import { BrowserConfig } from "../config/browser-config";
import { DesktopConfig } from "../config/desktop-config";
import { AutomationErrorCode, Result, err, ok } from "../utils/result";

const logger = globalLogger.withDefaults({
  message: colorize("cyan", "[Screenshot Storage] "),
});

/**
 * Screenshot metadata stored in database
 */
export interface ScreenshotMetadata {
  id: string;
  sessionId: string;
  blobUrl: string;
  thumbnailUrl?: string;
  width: number;
  height: number;
  format: "png" | "jpeg" | "webp";
  sizeBytes: number;
  capturedAt: Date;
  pageUrl?: string;
  title?: string;
}

/**
 * Upload result
 */
export interface ScreenshotUploadResult {
  url: string;
  thumbnailUrl?: string;
  pathname: string;
  sizeBytes: number;
}

/**
 * Generate a unique pathname for a screenshot
 */
function generateScreenshotPath(
  sessionId: string,
  provider: "browser" | "desktop",
  format: "png" | "jpeg" | "webp" = "png",
): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `screenshots/${provider}/${sessionId}/${timestamp}-${random}.${format}`;
}

/**
 * Generate a unique pathname for a thumbnail
 */
function generateThumbnailPath(
  sessionId: string,
  provider: "browser" | "desktop",
): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `screenshots/${provider}/${sessionId}/thumbs/${timestamp}-${random}.webp`;
}

/**
 * Create a thumbnail from image buffer
 * Note: This is a placeholder - in production, use sharp or similar
 */
async function createThumbnail(
  _imageBuffer: Buffer,
  _maxWidth: number,
): Promise<Buffer | null> {
  // For now, return null - thumbnail creation requires image processing library
  // In production, you would use sharp:
  // return await sharp(imageBuffer).resize(maxWidth).webp({ quality: 60 }).toBuffer();
  return null;
}

/**
 * Upload a screenshot to Vercel Blob storage
 */
export async function uploadScreenshot(
  imageBuffer: Buffer,
  sessionId: string,
  provider: "browser" | "desktop",
  options?: {
    format?: "png" | "jpeg" | "webp";
    createThumbnail?: boolean;
    pageUrl?: string;
    title?: string;
  },
): Promise<Result<ScreenshotUploadResult>> {
  const format = options?.format || "png";
  const pathname = generateScreenshotPath(sessionId, provider, format);

  try {
    // Determine content type
    const contentType =
      format === "png"
        ? "image/png"
        : format === "jpeg"
          ? "image/jpeg"
          : "image/webp";

    // Upload main screenshot
    const blob = await put(pathname, imageBuffer, {
      access: "public",
      contentType,
      addRandomSuffix: false,
    });

    logger.info(
      `Uploaded screenshot: ${pathname} (${imageBuffer.length} bytes)`,
    );

    let thumbnailUrl: string | undefined;

    // Create and upload thumbnail if requested
    if (options?.createThumbnail) {
      const thumbnailWidth =
        provider === "browser"
          ? BrowserConfig.screenshot.thumbnailWidth
          : DesktopConfig.screenshot.thumbnailWidth;

      const thumbnailBuffer = await createThumbnail(
        imageBuffer,
        thumbnailWidth,
      );

      if (thumbnailBuffer) {
        const thumbPath = generateThumbnailPath(sessionId, provider);
        const thumbBlob = await put(thumbPath, thumbnailBuffer, {
          access: "public",
          contentType: "image/webp",
          addRandomSuffix: false,
        });
        thumbnailUrl = thumbBlob.url;
        logger.info(`Uploaded thumbnail: ${thumbPath}`);
      }
    }

    return ok({
      url: blob.url,
      thumbnailUrl,
      pathname,
      sizeBytes: imageBuffer.length,
    });
  } catch (error) {
    logger.error("Failed to upload screenshot:", error);
    return err(
      AutomationErrorCode.STORAGE_ERROR,
      "Failed to upload screenshot to storage",
      { cause: error instanceof Error ? error : undefined },
    );
  }
}

/**
 * Upload a screenshot from base64 string
 */
export async function uploadScreenshotBase64(
  base64Data: string,
  sessionId: string,
  provider: "browser" | "desktop",
  options?: {
    format?: "png" | "jpeg" | "webp";
    createThumbnail?: boolean;
    pageUrl?: string;
    title?: string;
  },
): Promise<Result<ScreenshotUploadResult>> {
  try {
    // Remove data URL prefix if present
    const base64Clean = base64Data.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Clean, "base64");

    return uploadScreenshot(buffer, sessionId, provider, options);
  } catch (error) {
    logger.error("Failed to decode base64 screenshot:", error);
    return err(AutomationErrorCode.INVALID_INPUT, "Invalid base64 image data", {
      cause: error instanceof Error ? error : undefined,
    });
  }
}

/**
 * Delete a screenshot from storage
 */
export async function deleteScreenshot(url: string): Promise<Result<void>> {
  try {
    await del(url);
    logger.info(`Deleted screenshot: ${url}`);
    return ok(undefined);
  } catch (error) {
    logger.error("Failed to delete screenshot:", error);
    return err(
      AutomationErrorCode.STORAGE_ERROR,
      "Failed to delete screenshot from storage",
      { cause: error instanceof Error ? error : undefined },
    );
  }
}

/**
 * Delete all screenshots for a session
 */
export async function deleteSessionScreenshots(
  sessionId: string,
  provider: "browser" | "desktop",
): Promise<Result<{ deleted: number }>> {
  const prefix = `screenshots/${provider}/${sessionId}/`;

  try {
    let deleted = 0;
    let cursor: string | undefined;

    // List and delete in batches
    do {
      const { blobs, cursor: nextCursor } = await list({
        prefix,
        cursor,
        limit: 100,
      });

      if (blobs.length > 0) {
        await Promise.all(blobs.map((blob) => del(blob.url)));
        deleted += blobs.length;
      }

      cursor = nextCursor;
    } while (cursor);

    logger.info(`Deleted ${deleted} screenshots for session ${sessionId}`);
    return ok({ deleted });
  } catch (error) {
    logger.error("Failed to delete session screenshots:", error);
    return err(
      AutomationErrorCode.STORAGE_ERROR,
      "Failed to delete session screenshots",
      { cause: error instanceof Error ? error : undefined },
    );
  }
}

/**
 * List screenshots for a session
 */
export async function listSessionScreenshots(
  sessionId: string,
  provider: "browser" | "desktop",
  options?: {
    limit?: number;
    cursor?: string;
  },
): Promise<
  Result<{
    screenshots: Array<{ url: string; pathname: string; uploadedAt: Date }>;
    cursor?: string;
    hasMore: boolean;
  }>
> {
  const prefix = `screenshots/${provider}/${sessionId}/`;

  try {
    const { blobs, cursor } = await list({
      prefix,
      cursor: options?.cursor,
      limit: options?.limit || 50,
    });

    // Filter out thumbnails directory
    const screenshots = blobs
      .filter((blob) => !blob.pathname.includes("/thumbs/"))
      .map((blob) => ({
        url: blob.url,
        pathname: blob.pathname,
        uploadedAt: blob.uploadedAt,
      }));

    return ok({
      screenshots,
      cursor,
      hasMore: !!cursor,
    });
  } catch (error) {
    logger.error("Failed to list session screenshots:", error);
    return err(
      AutomationErrorCode.STORAGE_ERROR,
      "Failed to list session screenshots",
      { cause: error instanceof Error ? error : undefined },
    );
  }
}

/**
 * Get storage usage for screenshots
 */
export async function getScreenshotStorageUsage(
  provider?: "browser" | "desktop",
): Promise<
  Result<{
    totalSize: number;
    totalCount: number;
    bySession: Map<string, { size: number; count: number }>;
  }>
> {
  const prefix = provider ? `screenshots/${provider}/` : "screenshots/";

  try {
    let totalSize = 0;
    let totalCount = 0;
    const bySession = new Map<string, { size: number; count: number }>();
    let cursor: string | undefined;

    do {
      const { blobs, cursor: nextCursor } = await list({
        prefix,
        cursor,
        limit: 1000,
      });

      for (const blob of blobs) {
        totalSize += blob.size;
        totalCount++;

        // Extract session ID from pathname
        const parts = blob.pathname.split("/");
        if (parts.length >= 3) {
          const sessionId = parts[2];
          const existing = bySession.get(sessionId) || { size: 0, count: 0 };
          existing.size += blob.size;
          existing.count++;
          bySession.set(sessionId, existing);
        }
      }

      cursor = nextCursor;
    } while (cursor);

    return ok({ totalSize, totalCount, bySession });
  } catch (error) {
    logger.error("Failed to get storage usage:", error);
    return err(
      AutomationErrorCode.STORAGE_ERROR,
      "Failed to get storage usage",
      { cause: error instanceof Error ? error : undefined },
    );
  }
}

/**
 * Clean up old screenshots based on retention period
 */
export async function cleanupOldScreenshots(
  provider?: "browser" | "desktop",
): Promise<Result<{ deleted: number; freedBytes: number }>> {
  const prefix = provider ? `screenshots/${provider}/` : "screenshots/";
  const retentionPeriod =
    provider === "desktop"
      ? DesktopConfig.screenshot.retentionPeriod
      : BrowserConfig.screenshot.retentionPeriod;

  const cutoffDate = new Date(Date.now() - retentionPeriod);

  try {
    let deleted = 0;
    let freedBytes = 0;
    let cursor: string | undefined;

    do {
      const { blobs, cursor: nextCursor } = await list({
        prefix,
        cursor,
        limit: 100,
      });

      const oldBlobs = blobs.filter(
        (blob) => new Date(blob.uploadedAt) < cutoffDate,
      );

      if (oldBlobs.length > 0) {
        await Promise.all(oldBlobs.map((blob) => del(blob.url)));
        deleted += oldBlobs.length;
        freedBytes += oldBlobs.reduce((sum, blob) => sum + blob.size, 0);
      }

      cursor = nextCursor;
    } while (cursor);

    logger.info(
      `Cleaned up ${deleted} old screenshots, freed ${(freedBytes / 1024 / 1024).toFixed(2)} MB`,
    );

    return ok({ deleted, freedBytes });
  } catch (error) {
    logger.error("Failed to cleanup old screenshots:", error);
    return err(
      AutomationErrorCode.STORAGE_ERROR,
      "Failed to cleanup old screenshots",
      { cause: error instanceof Error ? error : undefined },
    );
  }
}
