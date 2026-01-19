/**
 * Screenshot Storage Service - Local-First Implementation
 *
 * Stores screenshots locally instead of Vercel Blob storage.
 * Cloud storage (Vercel Blob) has been removed for local-first architecture.
 */

import { colorize } from "consola/utils";
import globalLogger from "logger";
import { serverFileStorage } from "lib/file-storage";
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
 * Upload a screenshot to local storage
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

    // Upload main screenshot using local file storage
    const uploadResult = await serverFileStorage.upload(imageBuffer, {
      filename: pathname,
      contentType,
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
        const thumbResult = await serverFileStorage.upload(thumbnailBuffer, {
          filename: thumbPath,
          contentType: "image/webp",
        });
        thumbnailUrl = thumbResult.sourceUrl;
        logger.info(`Uploaded thumbnail: ${thumbPath}`);
      }
    }

    return ok({
      url: uploadResult.sourceUrl,
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
    // Extract the key from the URL or use it directly
    await serverFileStorage.delete(url);
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
 * Note: This is a simplified implementation for local storage
 */
export async function deleteSessionScreenshots(
  sessionId: string,
  provider: "browser" | "desktop",
): Promise<Result<{ deleted: number }>> {
  const prefix = `screenshots/${provider}/${sessionId}/`;

  try {
    // For local storage, we'd need to implement directory listing
    // For now, just log and return success
    logger.info(`Would delete screenshots with prefix: ${prefix}`);
    logger.warn("Batch deletion not fully implemented for local storage");
    return ok({ deleted: 0 });
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
 * Note: This is a simplified implementation for local storage
 */
export async function listSessionScreenshots(
  sessionId: string,
  provider: "browser" | "desktop",
  _options?: {
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
    // For local storage, directory listing would need to be implemented
    logger.warn(
      `Listing screenshots with prefix ${prefix} - not fully implemented for local storage`,
    );
    return ok({
      screenshots: [],
      cursor: undefined,
      hasMore: false,
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
 * Note: This is a simplified implementation for local storage
 */
export async function getScreenshotStorageUsage(
  _provider?: "browser" | "desktop",
): Promise<
  Result<{
    totalSize: number;
    totalCount: number;
    bySession: Map<string, { size: number; count: number }>;
  }>
> {
  try {
    logger.warn(
      "Storage usage calculation not fully implemented for local storage",
    );
    return ok({
      totalSize: 0,
      totalCount: 0,
      bySession: new Map(),
    });
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
 * Note: This is a simplified implementation for local storage
 */
export async function cleanupOldScreenshots(
  provider?: "browser" | "desktop",
): Promise<Result<{ deleted: number; freedBytes: number }>> {
  const retentionPeriod =
    provider === "desktop"
      ? DesktopConfig.screenshot.retentionPeriod
      : BrowserConfig.screenshot.retentionPeriod;

  try {
    logger.warn(
      "Old screenshot cleanup not fully implemented for local storage",
    );
    logger.info(`Would clean up screenshots older than ${retentionPeriod}ms`);
    return ok({ deleted: 0, freedBytes: 0 });
  } catch (error) {
    logger.error("Failed to cleanup old screenshots:", error);
    return err(
      AutomationErrorCode.STORAGE_ERROR,
      "Failed to cleanup old screenshots",
      { cause: error instanceof Error ? error : undefined },
    );
  }
}
