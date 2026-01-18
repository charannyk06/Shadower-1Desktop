import { ChatMessage, ChatRepository, ChatThread } from "app-types/chat";

import { pgDb as db } from "../db.pg";
import {
  ArchiveItemTable,
  ChatMessageTable,
  ChatThreadTable,
  UserTable,
} from "../schema.pg";

import { and, desc, eq, gte, sql } from "drizzle-orm";

export const pgChatRepository: ChatRepository = {
  insertThread: async (
    thread: Omit<ChatThread, "createdAt">,
  ): Promise<ChatThread> => {
    const [result] = await db
      .insert(ChatThreadTable)
      .values({
        title: thread.title,
        userId: thread.userId,
        id: thread.id,
      })
      .returning();
    return result;
  },

  deleteChatMessage: async (id: string): Promise<void> => {
    await db.delete(ChatMessageTable).where(eq(ChatMessageTable.id, id));
  },

  selectThread: async (id: string): Promise<ChatThread | null> => {
    const [result] = await db
      .select()
      .from(ChatThreadTable)
      .where(eq(ChatThreadTable.id, id));
    return result;
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

    const messages = await pgChatRepository.selectMessagesByThreadId(id);
    return {
      id: thread.chat_thread.id,
      title: thread.chat_thread.title,
      userId: thread.chat_thread.userId,
      createdAt: thread.chat_thread.createdAt,
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
  ): Promise<
    (ChatThread & {
      lastMessageAt: number;
    })[]
  > => {
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
        createdAt: row.createdAt,
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
    return result;
  },
  upsertThread: async (
    thread: Omit<ChatThread, "createdAt">,
  ): Promise<ChatThread> => {
    const [result] = await db
      .insert(ChatThreadTable)
      .values(thread)
      .onConflictDoUpdate({
        target: [ChatThreadTable.id],
        set: {
          title: thread.title,
        },
      })
      .returning();
    return result;
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
    userId?: string, // Optional userId for vector indexing
  ): Promise<ChatMessage> => {
    const entity = {
      ...message,
      id: message.id,
    };
    const [result] = await db
      .insert(ChatMessageTable)
      .values(entity)
      .returning();

    // Auto-index message to Qdrant (non-blocking)
    // API key is optional (only needed for cloud, not local Qdrant)
    if (process.env.QDRANT_URL) {
      // Get userId from thread if not provided
      const effectiveUserId =
        userId ||
        (await (async () => {
          try {
            const [thread] = await db
              .select({ userId: ChatThreadTable.userId })
              .from(ChatThreadTable)
              .where(eq(ChatThreadTable.id, message.threadId));
            return thread?.userId;
          } catch {
            return undefined;
          }
        })());

      Promise.all([
        import("lib/vector-search/vector-search-service"),
        import("lib/vector-search/text-chunking"),
      ])
        .then(
          ([{ indexContent }, { chunkTextWithMetadata, estimateTokens }]) => {
            const textParts = message.parts
              .filter((part: any) => part.type === "text")
              .map((part: any) => part.text)
              .join(" ");

            if (textParts.trim().length > 0) {
              const basePayload = {
                userId: effectiveUserId, // Include userId for security filtering
                messageId: message.id,
                threadId: message.threadId,
                role: message.role,
                createdAt: new Date().toISOString(),
              };

              // Use chunking for long messages (> 500 tokens)
              const tokenCount = estimateTokens(textParts);
              if (tokenCount > 500) {
                const chunks = chunkTextWithMetadata(textParts, {
                  documentId: message.id,
                  maxTokens: 500,
                  overlap: 50,
                  metadata: basePayload,
                });
                indexContent("messages", chunks, { userId: effectiveUserId });
              } else {
                indexContent(
                  "messages",
                  [
                    {
                      id: message.id,
                      content: textParts,
                      payload: basePayload,
                    },
                  ],
                  { userId: effectiveUserId },
                );
              }
            }
          },
        )
        .catch((err) => {
          // Silently fail - indexing shouldn't block message creation
          console.warn("[Chat] Failed to index message to Qdrant:", err);
        });
    }

    return result as ChatMessage;
  },

  upsertMessage: async (
    message: Omit<ChatMessage, "createdAt">,
    userId?: string, // Optional userId for vector indexing
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

    // Auto-index message to Qdrant (non-blocking)
    // API key is optional (only needed for cloud, not local Qdrant)
    if (process.env.QDRANT_URL) {
      // Get userId from thread if not provided
      const effectiveUserId =
        userId ||
        (await (async () => {
          try {
            const [thread] = await db
              .select({ userId: ChatThreadTable.userId })
              .from(ChatThreadTable)
              .where(eq(ChatThreadTable.id, message.threadId));
            return thread?.userId;
          } catch {
            return undefined;
          }
        })());

      Promise.all([
        import("lib/vector-search/vector-search-service"),
        import("lib/vector-search/text-chunking"),
      ])
        .then(
          ([{ indexContent }, { chunkTextWithMetadata, estimateTokens }]) => {
            const textParts = message.parts
              .filter((part: any) => part.type === "text")
              .map((part: any) => part.text)
              .join(" ");

            if (textParts.trim().length > 0) {
              const basePayload = {
                userId: effectiveUserId, // Include userId for security filtering
                messageId: message.id,
                threadId: message.threadId,
                role: message.role,
                createdAt: new Date().toISOString(),
              };

              // Use chunking for long messages (> 500 tokens)
              const tokenCount = estimateTokens(textParts);
              if (tokenCount > 500) {
                const chunks = chunkTextWithMetadata(textParts, {
                  documentId: message.id,
                  maxTokens: 500,
                  overlap: 50,
                  metadata: basePayload,
                });
                indexContent("messages", chunks, { userId: effectiveUserId })
                  .then((result) => {
                    console.log(
                      `[Chat] Indexed ${result.indexed} chunks for message ${message.id.slice(0, 8)}`,
                    );
                  })
                  .catch((err) => {
                    console.error(
                      `[Chat] Failed to index chunks for message ${message.id.slice(0, 8)}:`,
                      err,
                    );
                  });
              } else {
                indexContent(
                  "messages",
                  [
                    {
                      id: message.id,
                      content: textParts,
                      payload: basePayload,
                    },
                  ],
                  { userId: effectiveUserId },
                )
                  .then(() => {
                    console.log(
                      `[Chat] Indexed message ${message.id.slice(0, 8)}`,
                    );
                  })
                  .catch((err) => {
                    console.error(
                      `[Chat] Failed to index message ${message.id.slice(0, 8)}:`,
                      err,
                    );
                  });
              }
            }
          },
        )
        .catch((err) => {
          // Log error but don't block message creation
          console.error("[Chat] Failed to load indexing modules:", err);
        });
    }

    return result[0] as ChatMessage;
  },

  deleteMessagesByChatIdAfterTimestamp: async (
    messageId: string,
  ): Promise<void> => {
    const [message] = await db
      .select()
      .from(ChatMessageTable)
      .where(eq(ChatMessageTable.id, messageId));
    if (!message) {
      return;
    }
    // Delete messages that are in the same thread AND created before or at the same time as the target message
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
      threadIds.map((threadId) => pgChatRepository.deleteThread(threadId.id)),
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
        pgChatRepository.deleteThread(threadId.id),
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
