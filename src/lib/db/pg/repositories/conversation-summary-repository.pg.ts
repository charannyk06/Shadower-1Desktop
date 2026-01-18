import { desc, eq } from "drizzle-orm";
import { pgDb as db } from "../db.pg";
import {
  type ConversationSummaryEntity,
  ConversationSummaryTable,
} from "../schema.pg";

/**
 * Repository for managing conversation summaries
 * Used by the context compaction system to persist long-term memory
 */
export const conversationSummaryRepository = {
  /**
   * Create a new conversation summary
   */
  async create(data: {
    threadId: string;
    userId: string;
    summary: string;
    messagesCompacted: number;
    tokensSaved: number;
    summaryTokens?: number;
    parentSummaryId?: string;
    modelProvider?: string;
    modelName?: string;
  }): Promise<ConversationSummaryEntity> {
    // Get the next sequence number for this thread
    const existingSummaries = await db
      .select({ sequenceNumber: ConversationSummaryTable.sequenceNumber })
      .from(ConversationSummaryTable)
      .where(eq(ConversationSummaryTable.threadId, data.threadId))
      .orderBy(desc(ConversationSummaryTable.sequenceNumber))
      .limit(1);

    const nextSequence =
      existingSummaries.length > 0
        ? existingSummaries[0].sequenceNumber + 1
        : 1;

    const [result] = await db
      .insert(ConversationSummaryTable)
      .values({
        threadId: data.threadId,
        userId: data.userId,
        summary: data.summary,
        messagesCompacted: data.messagesCompacted,
        tokensSaved: data.tokensSaved,
        summaryTokens: data.summaryTokens ?? 0,
        parentSummaryId: data.parentSummaryId,
        sequenceNumber: nextSequence,
        modelProvider: data.modelProvider,
        modelName: data.modelName,
      })
      .returning();

    return result;
  },

  /**
   * Get all summaries for a thread, ordered by sequence
   */
  async getByThreadId(threadId: string): Promise<ConversationSummaryEntity[]> {
    return db
      .select()
      .from(ConversationSummaryTable)
      .where(eq(ConversationSummaryTable.threadId, threadId))
      .orderBy(desc(ConversationSummaryTable.sequenceNumber));
  },

  /**
   * Get the latest summary for a thread
   */
  async getLatestByThreadId(
    threadId: string,
  ): Promise<ConversationSummaryEntity | null> {
    const results = await db
      .select()
      .from(ConversationSummaryTable)
      .where(eq(ConversationSummaryTable.threadId, threadId))
      .orderBy(desc(ConversationSummaryTable.sequenceNumber))
      .limit(1);

    return results[0] ?? null;
  },

  /**
   * Get a summary by ID
   */
  async getById(id: string): Promise<ConversationSummaryEntity | null> {
    const results = await db
      .select()
      .from(ConversationSummaryTable)
      .where(eq(ConversationSummaryTable.id, id))
      .limit(1);

    return results[0] ?? null;
  },

  /**
   * Get total tokens saved for a thread
   */
  async getTotalTokensSaved(threadId: string): Promise<number> {
    const summaries = await db
      .select({ tokensSaved: ConversationSummaryTable.tokensSaved })
      .from(ConversationSummaryTable)
      .where(eq(ConversationSummaryTable.threadId, threadId));

    return summaries.reduce((total, s) => total + s.tokensSaved, 0);
  },

  /**
   * Get total messages compacted for a thread
   */
  async getTotalMessagesCompacted(threadId: string): Promise<number> {
    const summaries = await db
      .select({ messagesCompacted: ConversationSummaryTable.messagesCompacted })
      .from(ConversationSummaryTable)
      .where(eq(ConversationSummaryTable.threadId, threadId));

    return summaries.reduce((total, s) => total + s.messagesCompacted, 0);
  },

  /**
   * Delete all summaries for a thread
   */
  async deleteByThreadId(threadId: string): Promise<void> {
    await db
      .delete(ConversationSummaryTable)
      .where(eq(ConversationSummaryTable.threadId, threadId));
  },

  /**
   * Get summaries for a user across all threads
   */
  async getByUserId(
    userId: string,
    limit = 50,
  ): Promise<ConversationSummaryEntity[]> {
    return db
      .select()
      .from(ConversationSummaryTable)
      .where(eq(ConversationSummaryTable.userId, userId))
      .orderBy(desc(ConversationSummaryTable.createdAt))
      .limit(limit);
  },
};
