import { and, eq, lte, sql } from "drizzle-orm";
import { pgDb as db } from "../db.pg";
import { WebhookRetryQueueTable } from "../schema.pg";

export type WebhookRetryStatus =
  | "pending"
  | "processing"
  | "succeeded"
  | "dead_letter";

export interface WebhookRetryQueueEntry {
  id: string;
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
  retryCount: number;
  maxRetries: number;
  nextRetryAt: Date;
  lastError: string | null;
  status: WebhookRetryStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface AddToRetryQueue {
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
  error: string;
  maxRetries?: number;
}

// Exponential backoff intervals in milliseconds
// 1min, 5min, 15min, 1hr, 4hr
const RETRY_INTERVALS = [
  1 * 60 * 1000, // 1 minute
  5 * 60 * 1000, // 5 minutes
  15 * 60 * 1000, // 15 minutes
  60 * 60 * 1000, // 1 hour
  4 * 60 * 60 * 1000, // 4 hours
];

function getNextRetryTime(retryCount: number): Date {
  const intervalIndex = Math.min(retryCount, RETRY_INTERVALS.length - 1);
  const interval = RETRY_INTERVALS[intervalIndex];
  return new Date(Date.now() + interval);
}

export interface WebhookRetryRepository {
  /**
   * Add a failed webhook event to the retry queue
   */
  addToQueue(data: AddToRetryQueue): Promise<WebhookRetryQueueEntry>;

  /**
   * Get pending entries ready for retry (nextRetryAt <= now)
   */
  getPendingForRetry(limit?: number): Promise<WebhookRetryQueueEntry[]>;

  /**
   * Mark an entry as processing (to prevent duplicate processing)
   */
  markAsProcessing(id: string): Promise<boolean>;

  /**
   * Mark an entry as succeeded and remove from queue
   */
  markAsSucceeded(id: string): Promise<void>;

  /**
   * Update entry after a failed retry attempt
   * Returns true if there are retries remaining, false if moved to dead_letter
   */
  recordFailedRetry(id: string, error: string): Promise<boolean>;

  /**
   * Move an entry to dead letter queue (max retries exceeded)
   */
  moveToDeadLetter(id: string, error: string): Promise<void>;

  /**
   * Get all dead letter entries for admin review
   */
  getDeadLetterEntries(limit?: number): Promise<WebhookRetryQueueEntry[]>;

  /**
   * Get entry by ID
   */
  getById(id: string): Promise<WebhookRetryQueueEntry | null>;

  /**
   * Get entry by event ID
   */
  getByEventId(eventId: string): Promise<WebhookRetryQueueEntry | null>;

  /**
   * Delete succeeded entries older than a certain age (cleanup)
   */
  cleanupOldEntries(olderThanDays: number): Promise<number>;

  /**
   * Get queue statistics
   */
  getStats(): Promise<{
    pending: number;
    processing: number;
    deadLetter: number;
    totalRetries: number;
  }>;

  /**
   * Retry a dead letter entry (admin action)
   */
  retryDeadLetter(id: string): Promise<boolean>;
}

export const pgWebhookRetryRepository: WebhookRetryRepository = {
  async addToQueue(data) {
    // Check if this event is already in the queue
    const existing = await this.getByEventId(data.eventId);
    if (existing) {
      console.log(
        `[WebhookRetry] Event ${data.eventId} already in queue, skipping`,
      );
      return existing;
    }

    const maxRetries = data.maxRetries ?? 5;
    const nextRetryAt = getNextRetryTime(0);

    const [result] = await db
      .insert(WebhookRetryQueueTable)
      .values({
        eventId: data.eventId,
        eventType: data.eventType,
        payload: data.payload,
        retryCount: "0",
        maxRetries: String(maxRetries),
        nextRetryAt,
        lastError: data.error,
        status: "pending",
      })
      .returning();

    console.log(
      `[WebhookRetry] Added event ${data.eventId} to retry queue, next retry at ${nextRetryAt.toISOString()}`,
    );

    return {
      ...result,
      retryCount: Number(result.retryCount),
      maxRetries: Number(result.maxRetries),
      payload: result.payload as Record<string, unknown>,
    } as WebhookRetryQueueEntry;
  },

  async getPendingForRetry(limit = 10) {
    const now = new Date();

    const results = await db
      .select()
      .from(WebhookRetryQueueTable)
      .where(
        and(
          eq(WebhookRetryQueueTable.status, "pending"),
          lte(WebhookRetryQueueTable.nextRetryAt, now),
        ),
      )
      .orderBy(WebhookRetryQueueTable.nextRetryAt)
      .limit(limit);

    return results.map((r) => ({
      ...r,
      retryCount: Number(r.retryCount),
      maxRetries: Number(r.maxRetries),
      payload: r.payload as Record<string, unknown>,
    })) as WebhookRetryQueueEntry[];
  },

  async markAsProcessing(id: string) {
    const result = await db
      .update(WebhookRetryQueueTable)
      .set({
        status: "processing",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(WebhookRetryQueueTable.id, id),
          eq(WebhookRetryQueueTable.status, "pending"),
        ),
      )
      .returning({ id: WebhookRetryQueueTable.id });

    return result.length > 0;
  },

  async markAsSucceeded(id: string) {
    await db
      .update(WebhookRetryQueueTable)
      .set({
        status: "succeeded",
        updatedAt: new Date(),
      })
      .where(eq(WebhookRetryQueueTable.id, id));

    console.log(`[WebhookRetry] Entry ${id} marked as succeeded`);
  },

  async recordFailedRetry(id: string, error: string) {
    const entry = await this.getById(id);
    if (!entry) {
      console.error(`[WebhookRetry] Entry ${id} not found`);
      return false;
    }

    const newRetryCount = entry.retryCount + 1;

    // Check if we've exceeded max retries
    if (newRetryCount >= entry.maxRetries) {
      await this.moveToDeadLetter(id, error);
      return false;
    }

    // Schedule next retry with exponential backoff
    const nextRetryAt = getNextRetryTime(newRetryCount);

    await db
      .update(WebhookRetryQueueTable)
      .set({
        retryCount: String(newRetryCount),
        nextRetryAt,
        lastError: error,
        status: "pending",
        updatedAt: new Date(),
      })
      .where(eq(WebhookRetryQueueTable.id, id));

    console.log(
      `[WebhookRetry] Entry ${id} failed retry ${newRetryCount}/${entry.maxRetries}, next retry at ${nextRetryAt.toISOString()}`,
    );

    return true;
  },

  async moveToDeadLetter(id: string, error: string) {
    await db
      .update(WebhookRetryQueueTable)
      .set({
        status: "dead_letter",
        lastError: error,
        updatedAt: new Date(),
      })
      .where(eq(WebhookRetryQueueTable.id, id));

    console.error(
      `[WebhookRetry] ALERT: Entry ${id} moved to dead letter queue after max retries`,
    );

    // TODO: Send admin notification (email, Slack, etc.)
  },

  async getDeadLetterEntries(limit = 50) {
    const results = await db
      .select()
      .from(WebhookRetryQueueTable)
      .where(eq(WebhookRetryQueueTable.status, "dead_letter"))
      .orderBy(WebhookRetryQueueTable.updatedAt)
      .limit(limit);

    return results.map((r) => ({
      ...r,
      retryCount: Number(r.retryCount),
      maxRetries: Number(r.maxRetries),
      payload: r.payload as Record<string, unknown>,
    })) as WebhookRetryQueueEntry[];
  },

  async getById(id: string) {
    const [result] = await db
      .select()
      .from(WebhookRetryQueueTable)
      .where(eq(WebhookRetryQueueTable.id, id));

    if (!result) return null;

    return {
      ...result,
      retryCount: Number(result.retryCount),
      maxRetries: Number(result.maxRetries),
      payload: result.payload as Record<string, unknown>,
    } as WebhookRetryQueueEntry;
  },

  async getByEventId(eventId: string) {
    const [result] = await db
      .select()
      .from(WebhookRetryQueueTable)
      .where(eq(WebhookRetryQueueTable.eventId, eventId));

    if (!result) return null;

    return {
      ...result,
      retryCount: Number(result.retryCount),
      maxRetries: Number(result.maxRetries),
      payload: result.payload as Record<string, unknown>,
    } as WebhookRetryQueueEntry;
  },

  async cleanupOldEntries(olderThanDays: number) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const result = await db
      .delete(WebhookRetryQueueTable)
      .where(
        and(
          eq(WebhookRetryQueueTable.status, "succeeded"),
          lte(WebhookRetryQueueTable.updatedAt, cutoffDate),
        ),
      )
      .returning({ id: WebhookRetryQueueTable.id });

    console.log(
      `[WebhookRetry] Cleaned up ${result.length} old succeeded entries`,
    );
    return result.length;
  },

  async getStats() {
    const [pending] = await db
      .select({ count: sql<number>`count(*)` })
      .from(WebhookRetryQueueTable)
      .where(eq(WebhookRetryQueueTable.status, "pending"));

    const [processing] = await db
      .select({ count: sql<number>`count(*)` })
      .from(WebhookRetryQueueTable)
      .where(eq(WebhookRetryQueueTable.status, "processing"));

    const [deadLetter] = await db
      .select({ count: sql<number>`count(*)` })
      .from(WebhookRetryQueueTable)
      .where(eq(WebhookRetryQueueTable.status, "dead_letter"));

    const [totalRetries] = await db
      .select({
        sum: sql<number>`COALESCE(SUM(${WebhookRetryQueueTable.retryCount}::integer), 0)`,
      })
      .from(WebhookRetryQueueTable);

    return {
      pending: Number(pending?.count) || 0,
      processing: Number(processing?.count) || 0,
      deadLetter: Number(deadLetter?.count) || 0,
      totalRetries: Number(totalRetries?.sum) || 0,
    };
  },

  async retryDeadLetter(id: string) {
    const entry = await this.getById(id);
    if (!entry || entry.status !== "dead_letter") {
      return false;
    }

    // Reset to pending with fresh retry count
    const nextRetryAt = getNextRetryTime(0);

    await db
      .update(WebhookRetryQueueTable)
      .set({
        retryCount: "0",
        nextRetryAt,
        status: "pending",
        updatedAt: new Date(),
      })
      .where(eq(WebhookRetryQueueTable.id, id));

    console.log(
      `[WebhookRetry] Dead letter entry ${id} reset for retry, next attempt at ${nextRetryAt.toISOString()}`,
    );
    return true;
  },
};
