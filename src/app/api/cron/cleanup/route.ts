/**
 * Cleanup API Route
 *
 * Performs periodic cleanup tasks for local sessions and resources.
 * In Electron environment, this is called via IPC or scheduled interval.
 * In server environment, this can be triggered via API call.
 *
 * Cleanup tasks:
 * - Clean up expired local sessions
 * - Clean up temporary files from sandbox execution
 * - Clean up old screenshots
 * - Clean up memory store for rate limiting
 */

import { validateSession } from "lib/api/auth-helpers";
import { runSessionCleanup } from "lib/jobs/session-cleanup";
import { cleanupMemoryStore } from "lib/middleware/rate-limit";

// Temp file timeout - files older than this are cleaned up
const TEMP_FILE_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CleanupResults {
  expiredSessions: number;
  inactiveSessions: number;
  errorSessions: number;
  screenshotsDeleted: number;
  tempFilesDeleted: number;
  memoryStoreCleanup: boolean;
  errors: string[];
  durationMs: number;
}

/** Clean up old temporary files from sandbox execution */
async function cleanupTempFiles(): Promise<number> {
  try {
    const { join } = await import("path");
    const { readdir, stat, unlink } = await import("fs/promises");
    const { tmpdir } = await import("os");

    let deletedCount = 0;
    const tempDir = tmpdir();
    const threshold = Date.now() - TEMP_FILE_TIMEOUT_MS;

    const files = await readdir(tempDir);
    for (const file of files) {
      if (file.startsWith("sandbox_") || file.startsWith("screenshot_")) {
        try {
          const filePath = join(tempDir, file);
          const stats = await stat(filePath);

          if (stats.mtime.getTime() < threshold) {
            await unlink(filePath);
            deletedCount++;
          }
        } catch {
          // File might have been deleted already
        }
      }
    }

    return deletedCount;
  } catch (error) {
    console.warn("[Cleanup] Failed to clean temp files:", error);
    return 0;
  }
}

/** Run a cleanup task and capture errors */
async function runCleanupTask<T>(
  taskName: string,
  task: () => Promise<T>,
  errors: string[],
): Promise<T | null> {
  try {
    return await task();
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    errors.push(`${taskName}: ${errorMessage}`);
    return null;
  }
}

export async function GET(_req: Request) {
  // Validate that user is authenticated
  const auth = await validateSession();
  if (!auth.success) return auth.response;

  try {
    const startTime = Date.now();
    const errors: string[] = [];

    // Run session cleanup
    const sessionCleanupResult = await runSessionCleanup();

    const results: CleanupResults = {
      expiredSessions: 0,
      inactiveSessions: 0,
      errorSessions: 0,
      screenshotsDeleted: 0,
      tempFilesDeleted: 0,
      memoryStoreCleanup: false,
      errors: [],
      durationMs: 0,
    };

    if (sessionCleanupResult.ok) {
      results.expiredSessions = sessionCleanupResult.value.expiredSessions;
      results.inactiveSessions = sessionCleanupResult.value.inactiveSessions;
      results.errorSessions = sessionCleanupResult.value.errorSessions;
      results.screenshotsDeleted =
        sessionCleanupResult.value.screenshotsDeleted;
      results.tempFilesDeleted = sessionCleanupResult.value.tempFilesDeleted;
      results.errors.push(
        ...sessionCleanupResult.value.errors.map((e) => e.error),
      );
    } else {
      results.errors.push(
        `Session cleanup: ${sessionCleanupResult.error.message}`,
      );
    }

    // Additional temp file cleanup
    const additionalTempFiles = await runCleanupTask(
      "Additional temp file cleanup",
      cleanupTempFiles,
      errors,
    );
    if (additionalTempFiles !== null) {
      results.tempFilesDeleted += additionalTempFiles;
    }

    // Memory store cleanup
    try {
      cleanupMemoryStore();
      results.memoryStoreCleanup = true;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      results.errors.push(`Memory store cleanup: ${errorMessage}`);
    }

    results.errors.push(...errors);
    results.durationMs = Date.now() - startTime;

    const success = results.errors.length === 0;
    console.log("[Cleanup] Completed:", results);

    return Response.json(
      {
        success,
        message: success
          ? "Cleanup completed successfully"
          : "Cleanup completed with errors",
        results,
        timestamp: new Date().toISOString(),
      },
      { status: success ? 200 : 207 },
    );
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error("[Cleanup] Failed:", error);
    return Response.json(
      {
        success: false,
        error: errorMessage,
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  // POST method for manual trigger with options
  const auth = await validateSession();
  if (!auth.success) return auth.response;

  // Just call the GET handler
  return GET(req);
}
