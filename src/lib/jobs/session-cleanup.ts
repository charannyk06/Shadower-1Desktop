/**
 * Session Cleanup Job
 *
 * Handles automatic cleanup of expired and inactive browser/desktop sessions.
 * Should be called via a cron job or scheduled task.
 */

import { and, eq, lt } from "drizzle-orm";
import { BrowserConfig } from "../config/browser-config";
import { DesktopConfig } from "../config/desktop-config";
import { BrowserSessionTable } from "../db/pg/schema.pg";
import {
  incrementCounter,
  logSessionClosed,
  timeOperation,
} from "../observability/automation-metrics";
import { deleteSessionScreenshots } from "../storage/screenshot-storage";
import { AutomationErrorCode, Result, err, ok } from "../utils/result";

// Lazy database import to avoid initialization during tests
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _db: any = null;
async function getDb() {
  if (!_db) {
    const { pgDb } = await import("../db/pg/db.pg");
    _db = pgDb;
  }
  return _db;
}

/**
 * Session cleanup result
 */
export interface CleanupResult {
  expiredSessions: number;
  inactiveSessions: number;
  errorSessions: number;
  screenshotsDeleted: number;
  errors: Array<{ sessionId: string; error: string }>;
  durationMs: number;
}

/**
 * Close a session with the provider
 */
async function closeProviderSession(
  provider: "browserbase" | "e2b-desktop",
  sessionId: string,
): Promise<Result<void>> {
  try {
    if (provider === "browserbase") {
      // Import dynamically to avoid circular deps
      const { BrowserbaseService } = await import(
        "../ai/browser/browserbase-service"
      );
      const service = BrowserbaseService.getInstance();
      await service.closeSession(sessionId);
    } else {
      // E2B Desktop
      const { E2BDesktopService } = await import(
        "../ai/sandbox/e2b-desktop-service"
      );
      const service = E2BDesktopService.getInstance();
      await service.closeDesktop(sessionId);
    }
    return ok(undefined);
  } catch (error) {
    // Session might already be closed on provider side
    console.warn(`Failed to close ${provider} session ${sessionId}:`, error);
    return ok(undefined); // Don't fail cleanup for this
  }
}

/**
 * Clean up a single session
 */
async function cleanupSession(
  session: {
    id: string;
    sessionId: string;
    provider: "browserbase" | "e2b-desktop";
    userId: string;
  },
  reason: string,
): Promise<Result<{ screenshotsDeleted: number }>> {
  try {
    // 1. Close session with provider
    await closeProviderSession(session.provider, session.sessionId);

    // 2. Delete screenshots from storage
    const screenshotResult = await deleteSessionScreenshots(
      session.sessionId,
      session.provider === "browserbase" ? "browser" : "desktop",
    );

    const screenshotsDeleted = screenshotResult.ok
      ? screenshotResult.value.deleted
      : 0;

    // 3. Update database record
    await (await getDb())
      .update(BrowserSessionTable)
      .set({
        status: "closed",
        closedAt: new Date(),
        metadata: {
          closeReason: reason,
        },
      })
      .where(eq(BrowserSessionTable.id, session.id));

    // 4. Log the cleanup
    logSessionClosed(session.sessionId, session.provider, {
      userId: session.userId,
      reason,
    });

    incrementCounter("sessions_cleaned_up", 1, {
      provider: session.provider,
      sessionId: session.sessionId,
    });

    return ok({ screenshotsDeleted });
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
  errors: Array<{ sessionId: string; error: string }>;
}> {
  const now = new Date();
  const errors: Array<{ sessionId: string; error: string }> = [];
  let screenshotsDeleted = 0;

  // Find sessions that have exceeded their expiration time
  const expiredSessions = await (await getDb())
    .select({
      id: BrowserSessionTable.id,
      sessionId: BrowserSessionTable.sessionId,
      provider: BrowserSessionTable.provider,
      userId: BrowserSessionTable.userId,
    })
    .from(BrowserSessionTable)
    .where(
      and(
        eq(BrowserSessionTable.status, "active"),
        lt(BrowserSessionTable.expiresAt, now),
      ),
    )
    .limit(100); // Process in batches

  for (const session of expiredSessions) {
    const result = await cleanupSession(session, "expired");
    if (result.ok) {
      screenshotsDeleted += result.value.screenshotsDeleted;
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
    errors,
  };
}

/**
 * Find and cleanup inactive sessions (no activity for too long)
 */
async function cleanupInactiveSessions(): Promise<{
  count: number;
  screenshotsDeleted: number;
  errors: Array<{ sessionId: string; error: string }>;
}> {
  const errors: Array<{ sessionId: string; error: string }> = [];
  let screenshotsDeleted = 0;

  // Calculate inactivity thresholds
  const browserInactiveThreshold = new Date(
    Date.now() - BrowserConfig.session.idleTimeout,
  );
  const desktopInactiveThreshold = new Date(
    Date.now() - DesktopConfig.session.idleTimeout,
  );

  // Find browser sessions with no recent activity
  const inactiveBrowserSessions = await (await getDb())
    .select({
      id: BrowserSessionTable.id,
      sessionId: BrowserSessionTable.sessionId,
      provider: BrowserSessionTable.provider,
      userId: BrowserSessionTable.userId,
    })
    .from(BrowserSessionTable)
    .where(
      and(
        eq(BrowserSessionTable.status, "active"),
        eq(BrowserSessionTable.provider, "browserbase"),
        lt(BrowserSessionTable.lastActivityAt, browserInactiveThreshold),
      ),
    )
    .limit(50);

  // Find desktop sessions with no recent activity
  const inactiveDesktopSessions = await (await getDb())
    .select({
      id: BrowserSessionTable.id,
      sessionId: BrowserSessionTable.sessionId,
      provider: BrowserSessionTable.provider,
      userId: BrowserSessionTable.userId,
    })
    .from(BrowserSessionTable)
    .where(
      and(
        eq(BrowserSessionTable.status, "active"),
        eq(BrowserSessionTable.provider, "e2b-desktop"),
        lt(BrowserSessionTable.lastActivityAt, desktopInactiveThreshold),
      ),
    )
    .limit(50);

  const inactiveSessions = [
    ...inactiveBrowserSessions,
    ...inactiveDesktopSessions,
  ];

  for (const session of inactiveSessions) {
    const result = await cleanupSession(session, "inactive");
    if (result.ok) {
      screenshotsDeleted += result.value.screenshotsDeleted;
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
    errors,
  };
}

/**
 * Find and cleanup sessions stuck in error state
 */
async function cleanupErrorSessions(): Promise<{
  count: number;
  screenshotsDeleted: number;
  errors: Array<{ sessionId: string; error: string }>;
}> {
  const errors: Array<{ sessionId: string; error: string }> = [];
  let screenshotsDeleted = 0;

  // Clean up sessions that have been in error state for more than 1 hour
  const errorThreshold = new Date(Date.now() - 60 * 60 * 1000);

  const errorSessions = await (await getDb())
    .select({
      id: BrowserSessionTable.id,
      sessionId: BrowserSessionTable.sessionId,
      provider: BrowserSessionTable.provider,
      userId: BrowserSessionTable.userId,
    })
    .from(BrowserSessionTable)
    .where(
      and(
        eq(BrowserSessionTable.status, "error"),
        lt(BrowserSessionTable.lastActivityAt, errorThreshold),
      ),
    )
    .limit(50);

  for (const session of errorSessions) {
    const result = await cleanupSession(session, "error_cleanup");
    if (result.ok) {
      screenshotsDeleted += result.value.screenshotsDeleted;
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
    errors,
  };
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
        const [expired, inactive, errors] = await Promise.all([
          cleanupExpiredSessions(),
          cleanupInactiveSessions(),
          cleanupErrorSessions(),
        ]);

        return {
          expiredSessions: expired.count,
          inactiveSessions: inactive.count,
          errorSessions: errors.count,
          screenshotsDeleted:
            expired.screenshotsDeleted +
            inactive.screenshotsDeleted +
            errors.screenshotsDeleted,
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
    await (await getDb())
      .update(BrowserSessionTable)
      .set({
        lastActivityAt: new Date(),
      })
      .where(eq(BrowserSessionTable.sessionId, sessionId));

    return ok(undefined);
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

    // Count sessions by status
    const sessions = await (await getDb())
      .select({
        status: BrowserSessionTable.status,
        expiresAt: BrowserSessionTable.expiresAt,
        lastActivityAt: BrowserSessionTable.lastActivityAt,
      })
      .from(BrowserSessionTable)
      .where(eq(BrowserSessionTable.status, "active"));

    let activeSessions = 0;
    let expiredSessions = 0;
    let inactiveSessions = 0;

    for (const session of sessions) {
      if (session.expiresAt && session.expiresAt < now) {
        expiredSessions++;
      } else if (session.lastActivityAt < browserInactiveThreshold) {
        inactiveSessions++;
      } else {
        activeSessions++;
      }
    }

    // Count error sessions
    const errorSessions = await (await getDb())
      .select({ id: BrowserSessionTable.id })
      .from(BrowserSessionTable)
      .where(eq(BrowserSessionTable.status, "error"));

    return ok({
      activeSessions,
      expiredSessions,
      inactiveSessions,
      errorSessions: errorSessions.length,
    });
  } catch (error) {
    return err(
      AutomationErrorCode.PROVIDER_ERROR,
      `Failed to get cleanup stats: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}
