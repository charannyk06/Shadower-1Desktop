import { generateUUID } from "lib/utils";

// Define a simplified browser session type for SQLite
// Since the schema doesn't have a BrowserSessionTable, we'll create a minimal implementation
// that stores sessions in memory for the local desktop app

interface BrowserSession {
  id: string;
  threadId?: string;
  userId: string;
  provider: "chrome-devtools" | "local-terminal";
  sessionId: string;
  status: "active" | "closed" | "error" | "expired";
  currentUrl?: string;
  replayUrl?: string;
  screenshots?: Array<{
    id: string;
    timestamp: string;
    url?: string;
    storageKey?: string;
    thumbnail?: string;
  }>;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  lastActivityAt: Date;
  closedAt?: Date;
}

// In-memory session storage for local desktop app
const sessions = new Map<string, BrowserSession>();

export class SqliteBrowserSessionRepository {
  async createSession(data: {
    threadId?: string;
    userId: string;
    provider: "chrome-devtools" | "local-terminal";
    sessionId: string;
    currentUrl?: string;
    metadata?: Record<string, unknown>;
  }): Promise<BrowserSession> {
    const session: BrowserSession = {
      id: generateUUID(),
      threadId: data.threadId,
      userId: data.userId,
      provider: data.provider,
      sessionId: data.sessionId,
      status: "active",
      currentUrl: data.currentUrl,
      metadata: data.metadata,
      createdAt: new Date(),
      lastActivityAt: new Date(),
    };

    sessions.set(session.sessionId, session);
    return session;
  }

  async getSessionForThread(
    threadId: string,
    provider: "chrome-devtools" | "local-terminal",
  ): Promise<BrowserSession | null> {
    for (const session of sessions.values()) {
      if (
        session.threadId === threadId &&
        session.provider === provider &&
        session.status === "active"
      ) {
        return session;
      }
    }
    return null;
  }

  async getBySessionId(sessionId: string): Promise<BrowserSession | null> {
    return sessions.get(sessionId) || null;
  }

  async updateSession(
    sessionId: string,
    data: Partial<{
      status: "active" | "closed" | "error" | "expired";
      currentUrl: string;
      replayUrl: string;
      screenshots: Array<{
        id: string;
        timestamp: string;
        url?: string;
        storageKey?: string;
        thumbnail?: string;
      }>;
      metadata: Record<string, unknown>;
      lastAccessedAt: Date;
      closedAt: Date;
    }>,
  ): Promise<void> {
    const session = sessions.get(sessionId);
    if (!session) return;

    if (data.status !== undefined) session.status = data.status;
    if (data.currentUrl !== undefined) session.currentUrl = data.currentUrl;
    if (data.replayUrl !== undefined) session.replayUrl = data.replayUrl;
    if (data.screenshots !== undefined) session.screenshots = data.screenshots;
    if (data.metadata !== undefined) session.metadata = data.metadata;
    if (data.lastAccessedAt !== undefined)
      session.lastActivityAt = data.lastAccessedAt;
    if (data.closedAt !== undefined) session.closedAt = data.closedAt;

    session.lastActivityAt = new Date();
    sessions.set(sessionId, session);
  }

  async deleteSession(sessionId: string): Promise<void> {
    sessions.delete(sessionId);
  }

  async getExpiredSessions(cutoffDate: Date): Promise<BrowserSession[]> {
    const expired: BrowserSession[] = [];
    for (const session of sessions.values()) {
      if (session.status === "active" && session.lastActivityAt < cutoffDate) {
        expired.push(session);
      }
    }
    return expired;
  }

  async getActiveSessionsForUser(userId: string): Promise<BrowserSession[]> {
    const active: BrowserSession[] = [];
    for (const session of sessions.values()) {
      if (session.userId === userId && session.status === "active") {
        active.push(session);
      }
    }
    return active.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async closeSessionsForThread(threadId: string): Promise<void> {
    for (const session of sessions.values()) {
      if (session.threadId === threadId && session.status === "active") {
        session.status = "closed";
        session.closedAt = new Date();
      }
    }
  }

  async addScreenshot(
    sessionId: string,
    screenshot: {
      id: string;
      timestamp: string;
      url?: string;
      storageKey?: string;
      thumbnail?: string;
    },
  ): Promise<void> {
    const session = sessions.get(sessionId);
    if (!session) return;

    if (!session.screenshots) {
      session.screenshots = [];
    }
    session.screenshots.push(screenshot);
    session.lastActivityAt = new Date();
  }

  async getActiveSessionCount(userId: string): Promise<number> {
    let count = 0;
    for (const session of sessions.values()) {
      if (session.userId === userId && session.status === "active") {
        count++;
      }
    }
    return count;
  }
}

export const sqliteBrowserSessionRepository =
  new SqliteBrowserSessionRepository();
