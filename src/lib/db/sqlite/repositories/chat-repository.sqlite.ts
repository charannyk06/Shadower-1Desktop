import { ChatMessage, ChatRepository, ChatThread } from "app-types/chat";
import { sqliteDb as db } from "../db.sqlite";
import {
  ArchiveItemTable,
  ChatMessageTable,
  ChatThreadTable,
  UserTable,
} from "../schema.sqlite";
import { and, desc, eq, gte, sql } from "drizzle-orm";

export const sqliteChatRepository: ChatRepository = {
  insertThread: async (
    thread: Omit<ChatThread, "createdAt">,
  ): Promise<ChatThread> => {
    const [result] = await db
      .insert(ChatThreadTable)
      .values({
        title: thread.title,
        userId: thread.userId,
        id: thread.id,
        createdAt: new Date(),
      })
      .returning();
    return {
      ...result,
      createdAt: result.createdAt ?? new Date(),
    };
  },

  deleteChatMessage: async (id: string): Promise<void> => {
    await db.delete(ChatMessageTable).where(eq(ChatMessageTable.id, id));
  },

  selectThread: async (id: string): Promise<ChatThread | null> => {
    const [result] = await db
      .select()
      .from(ChatThreadTable)
      .where(eq(ChatThreadTable.id, id));
    if (!result) return null;
    return {
      ...result,
      createdAt: result.createdAt ?? new Date(),
    };
  },

  selectThreadDetails: async (id: string) => {
    if (!id) {
      return null;
    }
    const [thread] = await db
      .select()
      .from(ChatThreadTable)
      .leftJoin(UserTable, eq(ChatThreadTable.userId, UserTable.id))
      .where(eq(ChatThreadTable.id, id));

    if (!thread) {
      return null;
    }

    const messages = await sqliteChatRepository.selectMessagesByThreadId(id);
    return {
      id: thread.chat_thread.id,
      title: thread.chat_thread.title,
      userId: thread.chat_thread.userId,
      createdAt: thread.chat_thread.createdAt ?? new Date(),
      userPreferences: thread.user?.preferences ?? undefined,
      messages,
    };
  },

  selectMessagesByThreadId: async (
    threadId: string,
  ): Promise<ChatMessage[]> => {
    const result = await db
      .select()
      .from(ChatMessageTable)
      .where(eq(ChatMessageTable.threadId, threadId))
      .orderBy(ChatMessageTable.createdAt);
    return result as ChatMessage[];
  },

  selectThreadsByUserId: async (
    userId: string,
  ): Promise<(ChatThread & { lastMessageAt: number })[]> => {
    const threadWithLatestMessage = await db
      .select({
        threadId: ChatThreadTable.id,
        title: ChatThreadTable.title,
        createdAt: ChatThreadTable.createdAt,
        userId: ChatThreadTable.userId,
        lastMessageAt: sql<string>`MAX(${ChatMessageTable.createdAt})`.as(
          "last_message_at",
        ),
      })
      .from(ChatThreadTable)
      .leftJoin(
        ChatMessageTable,
        eq(ChatThreadTable.id, ChatMessageTable.threadId),
      )
      .where(eq(ChatThreadTable.userId, userId))
      .groupBy(ChatThreadTable.id)
      .orderBy(desc(sql`last_message_at`));

    return threadWithLatestMessage.map((row) => {
      return {
        id: row.threadId,
        title: row.title,
        userId: row.userId,
        createdAt: row.createdAt ?? new Date(),
        lastMessageAt: row.lastMessageAt
          ? new Date(row.lastMessageAt).getTime()
          : 0,
      };
    });
  },

  updateThread: async (
    id: string,
    thread: Partial<Omit<ChatThread, "id" | "createdAt">>,
  ): Promise<ChatThread> => {
    const [result] = await db
      .update(ChatThreadTable)
      .set({
        title: thread.title,
      })
      .where(eq(ChatThreadTable.id, id))
      .returning();
    return {
      ...result,
      createdAt: result.createdAt ?? new Date(),
    };
  },

  upsertThread: async (
    thread: Omit<ChatThread, "createdAt">,
  ): Promise<ChatThread> => {
    // SQLite uses INSERT OR REPLACE for upsert
    const [result] = await db
      .insert(ChatThreadTable)
      .values({
        ...thread,
        createdAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [ChatThreadTable.id],
        set: {
          title: thread.title,
        },
      })
      .returning();
    return {
      ...result,
      createdAt: result.createdAt ?? new Date(),
    };
  },

  deleteThread: async (id: string): Promise<void> => {
    // 1. Delete all messages in the thread
    await db.delete(ChatMessageTable).where(eq(ChatMessageTable.threadId, id));

    // 2. Remove thread from all archives
    await db.delete(ArchiveItemTable).where(eq(ArchiveItemTable.itemId, id));

    // 3. Delete the thread itself
    await db.delete(ChatThreadTable).where(eq(ChatThreadTable.id, id));
  },

  insertMessage: async (
    message: Omit<ChatMessage, "createdAt">,
    _userId?: string,
  ): Promise<ChatMessage> => {
    const entity = {
      ...message,
      id: message.id,
    };
    const [result] = await db
      .insert(ChatMessageTable)
      .values(entity)
      .returning();

    // For local SQLite, skip Qdrant indexing (uses local DuckDB vector store instead)
    return result as ChatMessage;
  },

  upsertMessage: async (
    message: Omit<ChatMessage, "createdAt">,
    _userId?: string,
  ): Promise<ChatMessage> => {
    const result = await db
      .insert(ChatMessageTable)
      .values(message)
      .onConflictDoUpdate({
        target: [ChatMessageTable.id],
        set: {
          parts: message.parts,
          metadata: message.metadata,
        },
      })
      .returning();

    // For local SQLite, skip Qdrant indexing (uses local DuckDB vector store instead)
    return result[0] as ChatMessage;
  },

  deleteMessagesByChatIdAfterTimestamp: async (
    messageId: string,
  ): Promise<void> => {
    const [message] = await db
      .select()
      .from(ChatMessageTable)
      .where(eq(ChatMessageTable.id, messageId));
    if (!message || !message.createdAt) {
      return;
    }
    // Delete messages that are in the same thread AND created at or after the target message
    await db
      .delete(ChatMessageTable)
      .where(
        and(
          eq(ChatMessageTable.threadId, message.threadId),
          gte(ChatMessageTable.createdAt, message.createdAt),
        ),
      );
  },

  deleteAllThreads: async (userId: string): Promise<void> => {
    const threadIds = await db
      .select({ id: ChatThreadTable.id })
      .from(ChatThreadTable)
      .where(eq(ChatThreadTable.userId, userId));
    await Promise.all(
      threadIds.map((threadId) =>
        sqliteChatRepository.deleteThread(threadId.id),
      ),
    );
  },

  deleteUnarchivedThreads: async (userId: string): Promise<void> => {
    const unarchivedThreadIds = await db
      .select({ id: ChatThreadTable.id })
      .from(ChatThreadTable)
      .leftJoin(
        ArchiveItemTable,
        eq(ChatThreadTable.id, ArchiveItemTable.itemId),
      )
      .where(
        and(
          eq(ChatThreadTable.userId, userId),
          sql`${ArchiveItemTable.id} IS NULL`,
        ),
      );

    await Promise.all(
      unarchivedThreadIds.map((threadId) =>
        sqliteChatRepository.deleteThread(threadId.id),
      ),
    );
  },

  insertMessages: async (
    messages: PartialBy<ChatMessage, "createdAt">[],
  ): Promise<ChatMessage[]> => {
    const result = await db
      .insert(ChatMessageTable)
      .values(messages)
      .returning();
    return result as ChatMessage[];
  },

  checkAccess: async (id: string, userId: string): Promise<boolean> => {
    const [result] = await db
      .select({
        userId: ChatThreadTable.userId,
      })
      .from(ChatThreadTable)
      .where(
        and(eq(ChatThreadTable.id, id), eq(ChatThreadTable.userId, userId)),
      );
    return Boolean(result);
  },
};
