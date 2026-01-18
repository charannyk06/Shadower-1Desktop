import { eq, lt, sql } from "drizzle-orm";
import { pgDb as db } from "../db.pg";
import { WebhookEventTable } from "../schema.pg";

export interface WebhookEventRepository {
  /**
   * Check if an event has already been processed.
   * Returns true if the event exists (already processed), false otherwise.
   */
  isEventProcessed(eventId: string): Promise<boolean>;

  /**
   * Mark an event as processed. Uses INSERT with ON CONFLICT DO NOTHING
   * to handle race conditions atomically.
   * Returns true if the event was newly inserted, false if it already existed.
   */
  markEventProcessed(
    eventId: string,
    eventType: string,
    metadata?: {
      customerId?: string;
      subscriptionId?: string;
      error?: string;
    },
  ): Promise<boolean>;

  /**
   * Clean up old webhook events older than the specified number of days.
   * Returns the number of deleted records.
   */
  cleanupOldEvents(olderThanDays: number): Promise<number>;
}

export const pgWebhookEventRepository: WebhookEventRepository = {
  async isEventProcessed(eventId: string): Promise<boolean> {
    const [result] = await db
      .select({ id: WebhookEventTable.id })
      .from(WebhookEventTable)
      .where(eq(WebhookEventTable.eventId, eventId))
      .limit(1);

    return !!result;
  },

  async markEventProcessed(
    eventId: string,
    eventType: string,
    metadata?: {
      customerId?: string;
      subscriptionId?: string;
      error?: string;
    },
  ): Promise<boolean> {
    try {
      // Use raw SQL for INSERT ... ON CONFLICT DO NOTHING
      // This is atomic and handles race conditions properly
      const result = await db.execute(sql`
        INSERT INTO webhook_event (id, event_id, event_type, metadata, processed_at)
        VALUES (gen_random_uuid(), ${eventId}, ${eventType}, ${JSON.stringify(metadata || {})}::jsonb, NOW())
        ON CONFLICT (event_id) DO NOTHING
        RETURNING id
      `);

      // If a row was returned, the insert succeeded (event was new)
      // If no rows returned, the event already existed
      return result.rows.length > 0;
    } catch (error) {
      console.error(
        "[WebhookEventRepository] Error marking event processed:",
        error,
      );
      // On error, assume event might be duplicate to be safe
      return false;
    }
  },

  async cleanupOldEvents(olderThanDays: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const result = await db
      .delete(WebhookEventTable)
      .where(lt(WebhookEventTable.processedAt, cutoffDate))
      .returning({ id: WebhookEventTable.id });

    return result.length;
  },
};
