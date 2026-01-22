/**
 * Local Session Cleanup Job
 *
 * Handles automatic cleanup of expired and inactive local sessions.
 * This replaces cloud-based session cleanup with local resource management.
 *
 * For local sessions:
 * - Browser sessions: Chrome DevTools Protocol connections
 * - Desktop sessions: Local terminal sessions
 */

import { BrowserConfig } from "../config/browser-config";
import { DesktopConfig } from "../config/desktop-config";
import {
  incrementCounter,
  logSessionClosed,
  timeOperation,
} from "../observability/automation-metrics";
import { deleteSessionScreenshots } from "../storage/screenshot-storage";
import { AutomationErrorCode, Result, err, ok } from "../utils/result";

// Session provider types for local execution
type LocalProvider = "chrome-devtools" | "local-terminal";

/**
 * In-memory session store for local sessions
 * In a real implementation, this would be backed by SQLite
 */
interface LocalSession {
  id: string;
  sessionId: string;
  provider: LocalProvider;
  userId: string;
  status: "active" | "closed" | "error";
  createdAt: Date;
  expiresAt: Date;
  lastActivityAt: Date;
  metadata?: Record<string, unknown>;
}

// Simple in-memory session store (replace with SQLite queries)
const localSessions = new Map<string, LocalSession>();

/**
 * Session cleanup result
 */
export interface CleanupResult {
  expiredSessions: number;
  inactiveSessions: number;
  errorSessions: number;
  screenshotsDeleted: number;
  tempFilesDeleted: number;
  errors: Array<{ sessionId: string; error: string }>;
  durationMs: number;
}

/**
 * Register a local session for tracking
 */
export function registerLocalSession(
  session: Omit<LocalSession, "id">,
): string {
  const id = `session-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  localSessions.set(id, { ...session, id });
  return id;
}

/**
 * Get a local session by ID
 */
export function getLocalSession(id: string): LocalSession | undefined {
  return localSessions.get(id);
}

/**
 * Close a local session
 */
async function closeLocalSession(
  provider: LocalProvider,
  _sessionId: string,
): Promise<Result<void>> {
  try {
    if (provider === "chrome-devtools") {
      // For Chrome DevTools, we don't actually close Chrome
      // We just disconnect and clean up resources
      // The user's Chrome browser should remain open
      console.log(`[SessionCleanup] Marking Chrome session as closed`);
    } else {
      // For local terminal, clean up any running processes
      console.log(`[SessionCleanup] Marking terminal session as closed`);
    }
    return ok(undefined);
  } catch (error) {
    console.warn(`Failed to close ${provider} session:`, error);
    return ok(undefined); // Don't fail cleanup for this
  }
}

/**
 * Clean up temporary files for a session
 */
async function cleanupTempFiles(sessionId: string): Promise<number> {
  try {
    const { join } = await import("path");
    const { readdir, unlink, stat } = await import("fs/promises");
    const { tmpdir } = await import("os");

    let deletedCount = 0;
    const tempDir = tmpdir();

    // Look for files matching the session pattern
    const files = await readdir(tempDir);
    for (const file of files) {
      if (file.includes(sessionId) || file.startsWith("workspace_")) {
        try {
          const filePath = join(tempDir, file);
          const stats = await stat(filePath);

          // Only delete files older than 1 hour
          if (Date.now() - stats.mtime.getTime() > 60 * 60 * 1000) {
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
    console.warn(`Failed to cleanup temp files for ${sessionId}:`, error);
    return 0;
  }
}

/**
 * Clean up workspace directory for a session
 */
async function cleanupWorkspaceDir(threadId: string): Promise<number> {
  try {
    const { join } = await import("path");
    const { readdir, unlink, rmdir, stat } = await import("fs/promises");

    // Get app data directory (works in both Electron and Node.js)
    let appDataDir: string;
    try {
      const { app } = await import("electron");
      appDataDir = app.getPath("userData");
    } catch {
      appDataDir = process.cwd();
    }

    const workspaceDir = join(appDataDir, "workspace", threadId);
    let deletedCount = 0;

    try {
      const files = await readdir(workspaceDir);
      for (const file of files) {
        try {
          const filePath = join(workspaceDir, file);
          const stats = await stat(filePath);

          // Only delete files older than 24 hours
          if (Date.now() - stats.mtime.getTime() > 24 * 60 * 60 * 1000) {
            await unlink(filePath);
            deletedCount++;
          }
        } catch {
          // File might have been deleted already
        }
      }

      // Remove empty directory
      const remainingFiles = await readdir(workspaceDir);
      if (remainingFiles.length === 0) {
        await rmdir(workspaceDir);
      }
    } catch {
      // Directory might not exist
    }

    return deletedCount;
  } catch (error) {
    console.warn(`Failed to cleanup workspace dir for ${threadId}:`, error);
    return 0;
  }
}

/**
 * Clean up a single session
 */
async function cleanupSession(
  session: LocalSession,
  reason: string,
): Promise<Result<{ screenshotsDeleted: number; tempFilesDeleted: number }>> {
  try {
    // 1. Close session resources
    await closeLocalSession(session.provider, session.sessionId);

    // 2. Delete screenshots from storage
    const screenshotResult = await deleteSessionScreenshots(
      session.sessionId,
      session.provider === "chrome-devtools" ? "browser" : "desktop",
    );

    const screenshotsDeleted = screenshotResult.ok
      ? screenshotResult.value.deleted
      : 0;

    // 3. Clean up temp files
    let tempFilesDeleted = await cleanupTempFiles(session.sessionId);

    // 4. Clean up workspace directory if applicable
    tempFilesDeleted += await cleanupWorkspaceDir(session.sessionId);

    // 5. Update session record
    session.status = "closed";
    session.metadata = {
      ...session.metadata,
      closeReason: reason,
      closedAt: new Date().toISOString(),
    };

    // 6. Log the cleanup
    logSessionClosed(session.sessionId, session.provider, {
      userId: session.userId,
      reason,
    });

    incrementCounter("sessions_cleaned_up", 1, {
      provider: session.provider,
      sessionId: session.sessionId,
    });

    return ok({ screenshotsDeleted, tempFilesDeleted });
  } catch (error) {
    return err(
      AutomationErrorCode.PROVIDER_ERROR,
      `Failed to cleanup session ${session.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * Find and cleanup expired sessions
 */
async function cleanupExpiredSessions(): Promise<{
  count: number;
  screenshotsDeleted: number;
  tempFilesDeleted: number;
  errors: Array<{ sessionId: string; error: string }>;
}> {
  const now = new Date();
  const errors: Array<{ sessionId: string; error: string }> = [];
  let screenshotsDeleted = 0;
  let tempFilesDeleted = 0;

  // Find sessions that have exceeded their expiration time
  const expiredSessions = Array.from(localSessions.values()).filter(
    (session) => session.status === "active" && session.expiresAt < now,
  );

  for (const session of expiredSessions.slice(0, 100)) {
    const result = await cleanupSession(session, "expired");
    if (result.ok) {
      screenshotsDeleted += result.value.screenshotsDeleted;
      tempFilesDeleted += result.value.tempFilesDeleted;
    } else {
      errors.push({
        sessionId: session.sessionId,
        error: result.error.message,
      });
    }
  }

  return {
    count: expiredSessions.length - errors.length,
    screenshotsDeleted,
    tempFilesDeleted,
    errors,
  };
}

/**
 * Find and cleanup inactive sessions (no activity for too long)
 */
async function cleanupInactiveSessions(): Promise<{
  count: number;
  screenshotsDeleted: number;
  tempFilesDeleted: number;
  errors: Array<{ sessionId: string; error: string }>;
}> {
  const errors: Array<{ sessionId: string; error: string }> = [];
  let screenshotsDeleted = 0;
  let tempFilesDeleted = 0;

  // Calculate inactivity thresholds
  const browserInactiveThreshold = new Date(
    Date.now() - BrowserConfig.session.idleTimeout,
  );
  const desktopInactiveThreshold = new Date(
    Date.now() - DesktopConfig.session.idleTimeout,
  );

  // Find inactive sessions
  const inactiveSessions = Array.from(localSessions.values()).filter(
    (session) => {
      if (session.status !== "active") return false;

      const threshold =
        session.provider === "chrome-devtools"
          ? browserInactiveThreshold
          : desktopInactiveThreshold;

      return session.lastActivityAt < threshold;
    },
  );

  for (const session of inactiveSessions.slice(0, 100)) {
    const result = await cleanupSession(session, "inactive");
    if (result.ok) {
      screenshotsDeleted += result.value.screenshotsDeleted;
      tempFilesDeleted += result.value.tempFilesDeleted;
    } else {
      errors.push({
        sessionId: session.sessionId,
        error: result.error.message,
      });
    }
  }

  return {
    count: inactiveSessions.length - errors.length,
    screenshotsDeleted,
    tempFilesDeleted,
    errors,
  };
}

/**
 * Find and cleanup sessions stuck in error state
 */
async function cleanupErrorSessions(): Promise<{
  count: number;
  screenshotsDeleted: number;
  tempFilesDeleted: number;
  errors: Array<{ sessionId: string; error: string }>;
}> {
  const errors: Array<{ sessionId: string; error: string }> = [];
  let screenshotsDeleted = 0;
  let tempFilesDeleted = 0;

  // Clean up sessions that have been in error state for more than 1 hour
  const errorThreshold = new Date(Date.now() - 60 * 60 * 1000);

  const errorSessions = Array.from(localSessions.values()).filter(
    (session) =>
      session.status === "error" && session.lastActivityAt < errorThreshold,
  );

  for (const session of errorSessions.slice(0, 50)) {
    const result = await cleanupSession(session, "error_cleanup");
    if (result.ok) {
      screenshotsDeleted += result.value.screenshotsDeleted;
      tempFilesDeleted += result.value.tempFilesDeleted;
    } else {
      errors.push({
        sessionId: session.sessionId,
        error: result.error.message,
      });
    }
  }

  return {
    count: errorSessions.length - errors.length,
    screenshotsDeleted,
    tempFilesDeleted,
    errors,
  };
}

/**
 * Cleanup old temp files and workspace directories
 */
async function cleanupOldFiles(): Promise<number> {
  let totalDeleted = 0;

  try {
    const { join } = await import("path");
    const { readdir, stat, unlink, rmdir } = await import("fs/promises");
    const { tmpdir } = await import("os");

    // Clean up old workspace files from temp directory
    const tempDir = tmpdir();
    const files = await readdir(tempDir);

    for (const file of files) {
      if (file.startsWith("workspace_")) {
        try {
          const filePath = join(tempDir, file);
          const stats = await stat(filePath);

          // Delete files older than 24 hours
          if (Date.now() - stats.mtime.getTime() > 24 * 60 * 60 * 1000) {
            await unlink(filePath);
            totalDeleted++;
          }
        } catch {
          // Ignore errors
        }
      }
    }

    // Clean up old workspace directories
    let appDataDir: string;
    try {
      const { app } = await import("electron");
      appDataDir = app.getPath("userData");
    } catch {
      appDataDir = process.cwd();
    }

    const workspaceBaseDir = join(appDataDir, "workspace");
    try {
      const workspaceDirs = await readdir(workspaceBaseDir);

      for (const dir of workspaceDirs) {
        try {
          const dirPath = join(workspaceBaseDir, dir);
          const stats = await stat(dirPath);

          // Delete directories older than 7 days
          if (Date.now() - stats.mtime.getTime() > 7 * 24 * 60 * 60 * 1000) {
            // Remove files in directory first
            const files = await readdir(dirPath);
            for (const file of files) {
              await unlink(join(dirPath, file));
              totalDeleted++;
            }
            await rmdir(dirPath);
          }
        } catch {
          // Ignore errors
        }
      }
    } catch {
      // Workspace directory might not exist
    }
  } catch (error) {
    console.warn("[SessionCleanup] Failed to cleanup old files:", error);
  }

  return totalDeleted;
}

/**
 * Main cleanup function - runs all cleanup tasks
 */
export async function runSessionCleanup(): Promise<Result<CleanupResult>> {
  const startTime = Date.now();

  try {
    const result = await timeOperation(
      "session_cleanup",
      async () => {
        // Run all cleanup tasks
        const [expired, inactive, errors, oldFilesDeleted] = await Promise.all([
          cleanupExpiredSessions(),
          cleanupInactiveSessions(),
          cleanupErrorSessions(),
          cleanupOldFiles(),
        ]);

        return {
          expiredSessions: expired.count,
          inactiveSessions: inactive.count,
          errorSessions: errors.count,
          screenshotsDeleted:
            expired.screenshotsDeleted +
            inactive.screenshotsDeleted +
            errors.screenshotsDeleted,
          tempFilesDeleted:
            expired.tempFilesDeleted +
            inactive.tempFilesDeleted +
            errors.tempFilesDeleted +
            oldFilesDeleted,
          errors: [...expired.errors, ...inactive.errors, ...errors.errors],
          durationMs: Date.now() - startTime,
        };
      },
      { jobType: "session_cleanup" },
    );

    // Log summary
    console.log("[SessionCleanup] Cleanup completed:", {
      expiredSessions: result.expiredSessions,
      inactiveSessions: result.inactiveSessions,
      errorSessions: result.errorSessions,
      screenshotsDeleted: result.screenshotsDeleted,
      tempFilesDeleted: result.tempFilesDeleted,
      errorCount: result.errors.length,
      durationMs: result.durationMs,
    });

    return ok(result);
  } catch (error) {
    console.error("[SessionCleanup] Cleanup failed:", error);
    return err(
      AutomationErrorCode.PROVIDER_ERROR,
      `Session cleanup failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * Update session activity timestamp
 * Call this whenever a session is used
 */
export async function updateSessionActivity(
  sessionId: string,
): Promise<Result<void>> {
  try {
    // Find session by sessionId
    for (const session of localSessions.values()) {
      if (session.sessionId === sessionId) {
        session.lastActivityAt = new Date();
        return ok(undefined);
      }
    }

    return err(
      AutomationErrorCode.SESSION_NOT_FOUND,
      `Session not found: ${sessionId}`,
    );
  } catch (error) {
    return err(
      AutomationErrorCode.PROVIDER_ERROR,
      `Failed to update session activity: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * Get cleanup statistics
 */
export async function getCleanupStats(): Promise<
  Result<{
    activeSessions: number;
    expiredSessions: number;
    inactiveSessions: number;
    errorSessions: number;
  }>
> {
  try {
    const now = new Date();
    const browserInactiveThreshold = new Date(
      Date.now() - BrowserConfig.session.idleTimeout,
    );

    let activeSessions = 0;
    let expiredSessions = 0;
    let inactiveSessions = 0;
    let errorSessions = 0;

    for (const session of localSessions.values()) {
      if (session.status === "error") {
        errorSessions++;
      } else if (session.status === "active") {
        if (session.expiresAt < now) {
          expiredSessions++;
        } else if (session.lastActivityAt < browserInactiveThreshold) {
          inactiveSessions++;
        } else {
          activeSessions++;
        }
      }
    }

    return ok({
      activeSessions,
      expiredSessions,
      inactiveSessions,
      errorSessions,
    });
  } catch (error) {
    return err(
      AutomationErrorCode.PROVIDER_ERROR,
      `Failed to get cleanup stats: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * Schedule periodic cleanup (call from main process)
 */
export function schedulePeriodicCleanup(intervalMs?: number): NodeJS.Timeout {
  const interval = intervalMs || BrowserConfig.session.cleanupInterval;

  console.log(
    `[SessionCleanup] Scheduling cleanup every ${interval / 1000 / 60} minutes`,
  );

  return setInterval(async () => {
    console.log("[SessionCleanup] Running scheduled cleanup...");
    await runSessionCleanup();
  }, interval);
}
