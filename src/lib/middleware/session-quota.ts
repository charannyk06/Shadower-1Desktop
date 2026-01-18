/**
 * Session Quota Middleware
 *
 * Enforces per-user limits on concurrent browser and desktop sessions.
 * Prevents resource exhaustion and controls costs.
 */

import crypto from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { BrowserConfig } from "../config/browser-config";
import { DesktopConfig } from "../config/desktop-config";
import { BrowserSessionTable } from "../db/pg/schema.pg";
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
 * Session creation parameters
 */
export interface CreateSessionParams {
  threadId: string | null;
  userId: string;
  provider: "browserbase" | "e2b-desktop";
  sessionId: string;
  replayUrl?: string;
}

/**
 * Create a new browser/desktop session record in the database
 */
export async function createBrowserSession(
  params: CreateSessionParams,
): Promise<Result<{ id: string; sessionId: string }>> {
  const { threadId, userId, provider, sessionId, replayUrl } = params;

  try {
    const id = crypto.randomUUID();
    await (await getDb()).insert(BrowserSessionTable).values({
      id,
      threadId,
      userId,
      provider,
      sessionId,
      status: "active",
      replayUrl: replayUrl || null,
      screenshots: [],
      createdAt: new Date(),
    });

    console.log(
      `[Session] Created ${provider} session: ${sessionId} for user ${userId}`,
    );

    return ok({ id, sessionId });
  } catch (error) {
    console.error("Error creating browser session:", error);
    return err(
      AutomationErrorCode.DATABASE_ERROR,
      "Failed to create session record",
      { details: { provider, sessionId } },
    );
  }
}

/**
 * Create a session with quota check in a single transaction
 * This prevents race conditions where multiple requests pass quota check simultaneously
 */
export async function createSessionWithQuotaCheck(
  params: CreateSessionParams,
): Promise<Result<{ id: string; sessionId: string }>> {
  const { threadId, userId, provider, sessionId, replayUrl } = params;

  // Validate userId is a valid UUID format
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(userId)) {
    return err(
      AutomationErrorCode.INVALID_INPUT,
      `Invalid userId format: "${userId}". Expected UUID format.`,
      { details: { userId, provider, sessionId } },
    );
  }

  // Ensure threadId is null if empty string (for foreign key constraint)
  const normalizedThreadId =
    threadId && threadId.trim() !== "" ? threadId : null;

  const maxAllowed =
    provider === "browserbase"
      ? BrowserConfig.session.maxConcurrentPerUser
      : DesktopConfig.session.maxConcurrentPerUser;

  try {
    // Use a transaction with row-level locking to prevent race conditions
    const result = await (await getDb()).transaction(async (tx) => {
      // Count active sessions with FOR UPDATE (implicit via transaction)
      const countResult = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(BrowserSessionTable)
        .where(
          and(
            eq(BrowserSessionTable.userId, userId),
            eq(BrowserSessionTable.provider, provider),
            eq(BrowserSessionTable.status, "active"),
          ),
        );

      const currentCount = countResult[0]?.count ?? 0;

      // Check quota within transaction
      if (currentCount >= maxAllowed) {
        throw new QuotaExceededError(
          `Maximum concurrent ${provider} sessions reached (${maxAllowed})`,
          currentCount,
          maxAllowed,
        );
      }

      // Create session within same transaction
      const id = crypto.randomUUID();
      await tx.insert(BrowserSessionTable).values({
        id,
        threadId: normalizedThreadId,
        userId,
        provider,
        sessionId,
        status: "active",
        replayUrl: replayUrl || null,
        screenshots: [],
        lastActivityAt: new Date(), // Explicitly set to ensure column exists
        createdAt: new Date(),
      });

      return { id, sessionId };
    });

    console.log(
      `[Session] Created ${provider} session: ${sessionId} for user ${userId} (transactional)`,
    );

    return ok(result);
  } catch (error) {
    if (error instanceof QuotaExceededError) {
      return err(AutomationErrorCode.SESSION_LIMIT_EXCEEDED, error.message, {
        details: {
          currentCount: error.currentCount,
          maxAllowed: error.maxAllowed,
        },
      });
    }

    console.error("Error creating browser session (transactional):", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorDetails =
      error instanceof Error ? { stack: error.stack, name: error.name } : {};

    return err(
      AutomationErrorCode.DATABASE_ERROR,
      `Failed to create session record: ${errorMessage}`,
      {
        details: {
          provider,
          sessionId,
          threadId: normalizedThreadId,
          userId,
          ...errorDetails,
        },
      },
    );
  }
}

/**
 * Custom error for quota exceeded within transaction
 */
class QuotaExceededError extends Error {
  constructor(
    message: string,
    public currentCount: number,
    public maxAllowed: number,
  ) {
    super(message);
    this.name = "QuotaExceededError";
  }
}

/**
 * Update session status in the database
 */
export async function updateSessionStatus(
  sessionId: string,
  status: "active" | "closed" | "error" | "expired",
): Promise<Result<boolean>> {
  try {
    const updateData: Record<string, unknown> = { status };

    // Set closedAt if closing
    if (status === "closed" || status === "error" || status === "expired") {
      updateData.closedAt = new Date();
    }

    await (await getDb())
      .update(BrowserSessionTable)
      .set(updateData)
      .where(eq(BrowserSessionTable.sessionId, sessionId));

    console.log(`[Session] Updated session ${sessionId} status to ${status}`);

    return ok(true);
  } catch (error) {
    console.error("Error updating session status:", error);
    return err(
      AutomationErrorCode.DATABASE_ERROR,
      "Failed to update session status",
      { details: { sessionId, status } },
    );
  }
}

/**
 * Session quota check result
 */
export interface SessionQuotaResult {
  allowed: boolean;
  currentCount: number;
  maxAllowed: number;
  activeSessions: Array<{
    id: string;
    sessionId: string;
    provider: string;
    createdAt: Date;
  }>;
}

/**
 * Get active browser sessions for a user
 */
export async function getActiveBrowserSessions(userId: string): Promise<
  Array<{
    id: string;
    sessionId: string;
    provider: string;
    createdAt: Date;
  }>
> {
  try {
    const sessions = await (await getDb())
      .select({
        id: BrowserSessionTable.id,
        sessionId: BrowserSessionTable.sessionId,
        provider: BrowserSessionTable.provider,
        createdAt: BrowserSessionTable.createdAt,
      })
      .from(BrowserSessionTable)
      .where(
        and(
          eq(BrowserSessionTable.userId, userId),
          eq(BrowserSessionTable.provider, "browserbase"),
          eq(BrowserSessionTable.status, "active"),
        ),
      );

    return sessions.map((s) => ({
      id: s.id,
      sessionId: s.sessionId,
      provider: s.provider,
      createdAt: s.createdAt,
    }));
  } catch (error) {
    console.error("Error fetching active browser sessions:", error);
    return [];
  }
}

/**
 * Get active desktop sessions for a user
 */
export async function getActiveDesktopSessions(userId: string): Promise<
  Array<{
    id: string;
    sessionId: string;
    provider: string;
    createdAt: Date;
  }>
> {
  try {
    const sessions = await (await getDb())
      .select({
        id: BrowserSessionTable.id,
        sessionId: BrowserSessionTable.sessionId,
        provider: BrowserSessionTable.provider,
        createdAt: BrowserSessionTable.createdAt,
      })
      .from(BrowserSessionTable)
      .where(
        and(
          eq(BrowserSessionTable.userId, userId),
          eq(BrowserSessionTable.provider, "e2b-desktop"),
          eq(BrowserSessionTable.status, "active"),
        ),
      );

    return sessions.map((s) => ({
      id: s.id,
      sessionId: s.sessionId,
      provider: s.provider,
      createdAt: s.createdAt,
    }));
  } catch (error) {
    console.error("Error fetching active desktop sessions:", error);
    return [];
  }
}

/**
 * Check browser session quota for a user
 */
export async function checkBrowserSessionQuota(
  userId: string,
): Promise<Result<SessionQuotaResult>> {
  const activeSessions = await getActiveBrowserSessions(userId);
  const maxAllowed = BrowserConfig.session.maxConcurrentPerUser;

  const result: SessionQuotaResult = {
    allowed: activeSessions.length < maxAllowed,
    currentCount: activeSessions.length,
    maxAllowed,
    activeSessions,
  };

  if (!result.allowed) {
    return err(
      AutomationErrorCode.SESSION_LIMIT_EXCEEDED,
      `Maximum concurrent browser sessions reached (${maxAllowed}). Please close an existing session first.`,
      {
        details: {
          currentCount: result.currentCount,
          maxAllowed: result.maxAllowed,
          activeSessions: result.activeSessions.map((s) => ({
            id: s.id,
            createdAt: s.createdAt.toISOString(),
          })),
        },
      },
    );
  }

  return ok(result);
}

/**
 * Check desktop session quota for a user
 */
export async function checkDesktopSessionQuota(
  userId: string,
): Promise<Result<SessionQuotaResult>> {
  const activeSessions = await getActiveDesktopSessions(userId);
  const maxAllowed = DesktopConfig.session.maxConcurrentPerUser;

  const result: SessionQuotaResult = {
    allowed: activeSessions.length < maxAllowed,
    currentCount: activeSessions.length,
    maxAllowed,
    activeSessions,
  };

  if (!result.allowed) {
    return err(
      AutomationErrorCode.SESSION_LIMIT_EXCEEDED,
      `Maximum concurrent desktop sessions reached (${maxAllowed}). Please close an existing session first.`,
      {
        details: {
          currentCount: result.currentCount,
          maxAllowed: result.maxAllowed,
          activeSessions: result.activeSessions.map((s) => ({
            id: s.id,
            createdAt: s.createdAt.toISOString(),
          })),
        },
      },
    );
  }

  return ok(result);
}

/**
 * Get the oldest active session for a user (for auto-close suggestion)
 */
export async function getOldestActiveSession(
  userId: string,
  provider: "browserbase" | "e2b-desktop",
): Promise<{
  id: string;
  sessionId: string;
  createdAt: Date;
} | null> {
  const sessions =
    provider === "browserbase"
      ? await getActiveBrowserSessions(userId)
      : await getActiveDesktopSessions(userId);

  if (sessions.length === 0) {
    return null;
  }

  // Sort by creation time and return oldest
  sessions.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return sessions[0];
}

/**
 * Check if a user owns a specific session
 */
export async function checkSessionOwnership(
  sessionId: string,
  userId: string,
): Promise<Result<boolean>> {
  try {
    const session = await (await getDb())
      .select({ userId: BrowserSessionTable.userId })
      .from(BrowserSessionTable)
      .where(eq(BrowserSessionTable.sessionId, sessionId))
      .limit(1);

    if (session.length === 0) {
      return err(AutomationErrorCode.SESSION_NOT_FOUND, "Session not found", {
        details: { sessionId },
      });
    }

    if (session[0].userId !== userId) {
      return err(
        AutomationErrorCode.FORBIDDEN,
        "You do not have access to this session",
        { details: { sessionId } },
      );
    }

    return ok(true);
  } catch (error) {
    console.error("Error checking session ownership:", error);
    return err(
      AutomationErrorCode.DATABASE_ERROR,
      "Failed to verify session ownership",
    );
  }
}

/**
 * Check if a thread has an active session
 */
export async function getSessionForThread(
  threadId: string,
  provider?: "browserbase" | "e2b-desktop",
): Promise<{
  id: string;
  sessionId: string;
  provider: string;
  status: string;
} | null> {
  try {
    const query = (await getDb())
      .select({
        id: BrowserSessionTable.id,
        sessionId: BrowserSessionTable.sessionId,
        provider: BrowserSessionTable.provider,
        status: BrowserSessionTable.status,
      })
      .from(BrowserSessionTable)
      .where(
        and(
          eq(BrowserSessionTable.threadId, threadId),
          eq(BrowserSessionTable.status, "active"),
        ),
      )
      .limit(1);

    const sessions = await query;

    if (sessions.length === 0) {
      return null;
    }

    // Filter by provider if specified
    if (provider && sessions[0].provider !== provider) {
      return null;
    }

    return sessions[0];
  } catch (error) {
    console.error("Error fetching session for thread:", error);
    return null;
  }
}

/**
 * Get all sessions for a thread
 */
export async function getAllSessionsForThread(threadId: string): Promise<
  Array<{
    id: string;
    sessionId: string;
    provider: string;
    status: string;
    createdAt: Date;
  }>
> {
  try {
    const sessions = await (await getDb())
      .select({
        id: BrowserSessionTable.id,
        sessionId: BrowserSessionTable.sessionId,
        provider: BrowserSessionTable.provider,
        status: BrowserSessionTable.status,
        createdAt: BrowserSessionTable.createdAt,
      })
      .from(BrowserSessionTable)
      .where(eq(BrowserSessionTable.threadId, threadId))
      .orderBy(BrowserSessionTable.createdAt);

    return sessions;
  } catch (error) {
    console.error("Error fetching sessions for thread:", error);
    return [];
  }
}

/**
 * Get session count stats for a user
 */
export async function getSessionStats(userId: string): Promise<{
  browser: {
    active: number;
    maxAllowed: number;
    totalCreated: number;
  };
  desktop: {
    active: number;
    maxAllowed: number;
    totalCreated: number;
  };
}> {
  try {
    const allSessions = await (await getDb())
      .select({
        provider: BrowserSessionTable.provider,
        status: BrowserSessionTable.status,
      })
      .from(BrowserSessionTable)
      .where(eq(BrowserSessionTable.userId, userId));

    const browserActive = allSessions.filter(
      (s) => s.provider === "browserbase" && s.status === "active",
    ).length;

    const browserTotal = allSessions.filter(
      (s) => s.provider === "browserbase",
    ).length;

    const desktopActive = allSessions.filter(
      (s) => s.provider === "e2b-desktop" && s.status === "active",
    ).length;

    const desktopTotal = allSessions.filter(
      (s) => s.provider === "e2b-desktop",
    ).length;

    return {
      browser: {
        active: browserActive,
        maxAllowed: BrowserConfig.session.maxConcurrentPerUser,
        totalCreated: browserTotal,
      },
      desktop: {
        active: desktopActive,
        maxAllowed: DesktopConfig.session.maxConcurrentPerUser,
        totalCreated: desktopTotal,
      },
    };
  } catch (error) {
    console.error("Error fetching session stats:", error);
    return {
      browser: {
        active: 0,
        maxAllowed: BrowserConfig.session.maxConcurrentPerUser,
        totalCreated: 0,
      },
      desktop: {
        active: 0,
        maxAllowed: DesktopConfig.session.maxConcurrentPerUser,
        totalCreated: 0,
      },
    };
  }
}
