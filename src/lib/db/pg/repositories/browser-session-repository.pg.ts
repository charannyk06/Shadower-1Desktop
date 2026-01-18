import { and, eq, lt, desc, sql } from "drizzle-orm";
import { pgDb as db } from "../db.pg";
import { BrowserSessionTable, type BrowserSessionEntity } from "../schema.pg";

/**
 * Browser Session Repository - Manages browser and E2B sandbox sessions
 * Used by the persistence manager for reconnecting to existing sandboxes
 */
export class PgBrowserSessionRepository {
  /**
   * Create a new browser session
   */
  async createSession(data: {
    threadId?: string;
    userId: string;
    provider: "browserbase" | "e2b-desktop";
    sessionId: string;
    persistenceEnabled?: boolean;
    currentUrl?: string;
    metadata?: Record<string, unknown>;
  }): Promise<BrowserSessionEntity> {
    const [session] = await db
      .insert(BrowserSessionTable)
      .values({
        threadId: data.threadId,
        userId: data.userId,
        provider: data.provider,
        sessionId: data.sessionId,
        status: "active",
        currentUrl: data.currentUrl,
        metadata: data.metadata,
      })
      .returning();

    return session;
  }

  /**
   * Get session by thread ID and provider
   */
  async getSessionForThread(
    threadId: string,
    provider: "browserbase" | "e2b-desktop",
  ): Promise<BrowserSessionEntity | null> {
    const [session] = await db
      .select()
      .from(BrowserSessionTable)
      .where(
        and(
          eq(BrowserSessionTable.threadId, threadId),
          eq(BrowserSessionTable.provider, provider),
          eq(BrowserSessionTable.status, "active"),
        ),
      )
      .orderBy(desc(BrowserSessionTable.createdAt))
      .limit(1);

    return session || null;
  }

  /**
   * Get session by session ID
   */
  async getBySessionId(
    sessionId: string,
  ): Promise<BrowserSessionEntity | null> {
    const [session] = await db
      .select()
      .from(BrowserSessionTable)
      .where(eq(BrowserSessionTable.sessionId, sessionId))
      .limit(1);

    return session || null;
  }

  /**
   * Update session
   */
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
      metadata: {
        browserType?: string;
        viewport?: { width: number; height: number };
        stealth?: boolean;
        proxy?: boolean;
        error?: string;
        closeReason?: string;
      };
      lastAccessedAt: Date;
      closedAt: Date;
    }>,
  ): Promise<void> {
    const updateData: Record<string, unknown> = {
      lastActivityAt: new Date(),
    };

    if (data.status !== undefined) updateData.status = data.status;
    if (data.currentUrl !== undefined) updateData.currentUrl = data.currentUrl;
    if (data.replayUrl !== undefined) updateData.replayUrl = data.replayUrl;
    if (data.screenshots !== undefined)
      updateData.screenshots = data.screenshots;
    if (data.metadata !== undefined) updateData.metadata = data.metadata;
    if (data.lastAccessedAt !== undefined)
      updateData.lastActivityAt = data.lastAccessedAt;
    if (data.closedAt !== undefined) updateData.closedAt = data.closedAt;

    await db
      .update(BrowserSessionTable)
      .set(updateData)
      .where(eq(BrowserSessionTable.sessionId, sessionId));
  }

  /**
   * Delete session by session ID
   */
  async deleteSession(sessionId: string): Promise<void> {
    await db
      .delete(BrowserSessionTable)
      .where(eq(BrowserSessionTable.sessionId, sessionId));
  }

  /**
   * Get expired sessions for cleanup
   */
  async getExpiredSessions(cutoffDate: Date): Promise<BrowserSessionEntity[]> {
    return await db
      .select()
      .from(BrowserSessionTable)
      .where(
        and(
          eq(BrowserSessionTable.status, "active"),
          lt(BrowserSessionTable.lastActivityAt, cutoffDate),
        ),
      );
  }

  /**
   * Get all active sessions for a user
   */
  async getActiveSessionsForUser(
    userId: string,
  ): Promise<BrowserSessionEntity[]> {
    return await db
      .select()
      .from(BrowserSessionTable)
      .where(
        and(
          eq(BrowserSessionTable.userId, userId),
          eq(BrowserSessionTable.status, "active"),
        ),
      )
      .orderBy(desc(BrowserSessionTable.createdAt));
  }

  /**
   * Mark all sessions for a thread as closed
   */
  async closeSessionsForThread(threadId: string): Promise<void> {
    await db
      .update(BrowserSessionTable)
      .set({
        status: "closed",
        closedAt: new Date(),
      })
      .where(
        and(
          eq(BrowserSessionTable.threadId, threadId),
          eq(BrowserSessionTable.status, "active"),
        ),
      );
  }

  /**
   * Add screenshot to session
   */
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
    const session = await this.getBySessionId(sessionId);
    if (!session) return;

    const screenshots = session.screenshots || [];
    screenshots.push(screenshot);

    await db
      .update(BrowserSessionTable)
      .set({
        screenshots,
        lastActivityAt: new Date(),
      })
      .where(eq(BrowserSessionTable.sessionId, sessionId));
  }

  /**
   * Get session count for a user (for quota purposes)
   */
  async getActiveSessionCount(userId: string): Promise<number> {
    const result = await db
      .select({
        count: sql<string>`COUNT(*)`,
      })
      .from(BrowserSessionTable)
      .where(
        and(
          eq(BrowserSessionTable.userId, userId),
          eq(BrowserSessionTable.status, "active"),
        ),
      );

    return parseInt(result[0]?.count || "0", 10);
  }
}

// Singleton instance
export const pgBrowserSessionRepository = new PgBrowserSessionRepository();
