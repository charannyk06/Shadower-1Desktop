/**
 * Local Session Quota Middleware
 *
 * Manages local browser and terminal sessions for the desktop app.
 * Uses in-memory tracking instead of database for simplicity.
 */

import crypto from "node:crypto";
import { BrowserConfig } from "../config/browser-config";
import { DesktopConfig } from "../config/desktop-config";
import { AutomationErrorCode, Result, err, ok } from "../utils/result";

// Local provider types
export type LocalProvider = "chrome-devtools" | "local-terminal";

// Legacy provider type mapping for backwards compatibility
type LegacyProvider = "browserbase" | "e2b-desktop";
function normalizeProvider(
  provider: LocalProvider | LegacyProvider,
): LocalProvider {
  if (provider === "browserbase") return "chrome-devtools";
  if (provider === "e2b-desktop") return "local-terminal";
  return provider;
}

/**
 * Local session record
 */
interface LocalSession {
  id: string;
  sessionId: string;
  threadId: string | null;
  userId: string;
  provider: LocalProvider;
  status: "active" | "closed" | "error" | "expired";
  replayUrl?: string | null;
  screenshots: string[];
  createdAt: Date;
  lastActivityAt: Date;
  closedAt?: Date;
}

// In-memory session store
const sessions = new Map<string, LocalSession>();

/**
 * Session creation parameters
 */
export interface CreateSessionParams {
  threadId: string | null;
  userId: string;
  provider: LocalProvider | LegacyProvider;
  sessionId: string;
  replayUrl?: string;
}

/**
 * Create a new local session record
 */
export async function createBrowserSession(
  params: CreateSessionParams,
): Promise<Result<{ id: string; sessionId: string }>> {
  const { threadId, userId, sessionId, replayUrl } = params;
  const provider = normalizeProvider(params.provider);

  try {
    const id = crypto.randomUUID();
    const session: LocalSession = {
      id,
      sessionId,
      threadId: threadId || null,
      userId,
      provider,
      status: "active",
      replayUrl: replayUrl || null,
      screenshots: [],
      createdAt: new Date(),
      lastActivityAt: new Date(),
    };

    sessions.set(id, session);

    console.log(
      `[Session] Created ${provider} session: ${sessionId} for user ${userId}`,
    );

    return ok({ id, sessionId });
  } catch (error) {
    console.error("Error creating session:", error);
    return err(
      AutomationErrorCode.DATABASE_ERROR,
      "Failed to create session record",
      { details: { provider, sessionId } },
    );
  }
}

/**
 * Create a session with quota check
 */
export async function createSessionWithQuotaCheck(
  params: CreateSessionParams,
): Promise<Result<{ id: string; sessionId: string }>> {
  const { threadId, userId, sessionId, replayUrl } = params;
  const provider = normalizeProvider(params.provider);

  const maxAllowed =
    provider === "chrome-devtools"
      ? BrowserConfig.session.maxConcurrentPerUser
      : DesktopConfig.session.maxConcurrentPerUser;

  try {
    // Count active sessions for this user and provider
    const activeSessions = Array.from(sessions.values()).filter(
      (s) =>
        s.userId === userId && s.provider === provider && s.status === "active",
    );

    const currentCount = activeSessions.length;

    // Check quota
    if (currentCount >= maxAllowed) {
      return err(
        AutomationErrorCode.SESSION_LIMIT_EXCEEDED,
        `Maximum concurrent ${provider} sessions reached (${maxAllowed})`,
        {
          details: {
            currentCount,
            maxAllowed,
          },
        },
      );
    }

    // Create session
    const id = crypto.randomUUID();
    const session: LocalSession = {
      id,
      sessionId,
      threadId: threadId && threadId.trim() !== "" ? threadId : null,
      userId,
      provider,
      status: "active",
      replayUrl: replayUrl || null,
      screenshots: [],
      createdAt: new Date(),
      lastActivityAt: new Date(),
    };

    sessions.set(id, session);

    console.log(
      `[Session] Created ${provider} session: ${sessionId} for user ${userId}`,
    );

    return ok({ id, sessionId });
  } catch (error) {
    console.error("Error creating session:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);

    return err(
      AutomationErrorCode.DATABASE_ERROR,
      `Failed to create session record: ${errorMessage}`,
      { details: { provider, sessionId } },
    );
  }
}

/**
 * Update session status
 */
export async function updateSessionStatus(
  sessionId: string,
  status: "active" | "closed" | "error" | "expired",
): Promise<Result<boolean>> {
  try {
    // Find session by sessionId
    for (const session of sessions.values()) {
      if (session.sessionId === sessionId) {
        session.status = status;
        session.lastActivityAt = new Date();

        if (status === "closed" || status === "error" || status === "expired") {
          session.closedAt = new Date();
        }

        console.log(
          `[Session] Updated session ${sessionId} status to ${status}`,
        );
        return ok(true);
      }
    }

    return err(AutomationErrorCode.SESSION_NOT_FOUND, "Session not found", {
      details: { sessionId },
    });
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
    return Array.from(sessions.values())
      .filter(
        (s) =>
          s.userId === userId &&
          s.provider === "chrome-devtools" &&
          s.status === "active",
      )
      .map((s) => ({
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
    return Array.from(sessions.values())
      .filter(
        (s) =>
          s.userId === userId &&
          s.provider === "local-terminal" &&
          s.status === "active",
      )
      .map((s) => ({
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
 * Get the oldest active session for a user
 */
export async function getOldestActiveSession(
  userId: string,
  provider: LocalProvider | LegacyProvider,
): Promise<{
  id: string;
  sessionId: string;
  createdAt: Date;
} | null> {
  const normalizedProvider = normalizeProvider(provider);
  const sessionList =
    normalizedProvider === "chrome-devtools"
      ? await getActiveBrowserSessions(userId)
      : await getActiveDesktopSessions(userId);

  if (sessionList.length === 0) {
    return null;
  }

  // Sort by creation time and return oldest
  sessionList.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return sessionList[0];
}

/**
 * Check if a user owns a specific session
 */
export async function checkSessionOwnership(
  sessionId: string,
  userId: string,
): Promise<Result<boolean>> {
  try {
    for (const session of sessions.values()) {
      if (session.sessionId === sessionId) {
        if (session.userId !== userId) {
          return err(
            AutomationErrorCode.FORBIDDEN,
            "You do not have access to this session",
            { details: { sessionId } },
          );
        }
        return ok(true);
      }
    }

    return err(AutomationErrorCode.SESSION_NOT_FOUND, "Session not found", {
      details: { sessionId },
    });
  } catch (error) {
    console.error("Error checking session ownership:", error);
    return err(
      AutomationErrorCode.DATABASE_ERROR,
      "Failed to verify session ownership",
    );
  }
}

/**
 * Get session for a thread
 */
export async function getSessionForThread(
  threadId: string,
  provider?: LocalProvider | LegacyProvider,
): Promise<{
  id: string;
  sessionId: string;
  provider: string;
  status: string;
} | null> {
  try {
    const normalizedProvider = provider ? normalizeProvider(provider) : null;

    for (const session of sessions.values()) {
      if (session.threadId === threadId && session.status === "active") {
        if (normalizedProvider && session.provider !== normalizedProvider) {
          continue;
        }
        return {
          id: session.id,
          sessionId: session.sessionId,
          provider: session.provider,
          status: session.status,
        };
      }
    }

    return null;
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
    return Array.from(sessions.values())
      .filter((s) => s.threadId === threadId)
      .map((s) => ({
        id: s.id,
        sessionId: s.sessionId,
        provider: s.provider,
        status: s.status,
        createdAt: s.createdAt,
      }))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
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
    const userSessions = Array.from(sessions.values()).filter(
      (s) => s.userId === userId,
    );

    const browserActive = userSessions.filter(
      (s) => s.provider === "chrome-devtools" && s.status === "active",
    ).length;

    const browserTotal = userSessions.filter(
      (s) => s.provider === "chrome-devtools",
    ).length;

    const desktopActive = userSessions.filter(
      (s) => s.provider === "local-terminal" && s.status === "active",
    ).length;

    const desktopTotal = userSessions.filter(
      (s) => s.provider === "local-terminal",
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

/**
 * Clear all sessions (for testing or app restart)
 */
export function clearAllSessions(): void {
  sessions.clear();
  console.log("[Session] Cleared all sessions");
}

/**
 * Get all sessions (for debugging)
 */
export function getAllSessions(): LocalSession[] {
  return Array.from(sessions.values());
}
