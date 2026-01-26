import { ipcMain } from "electron";
import { getDatabase, schema } from "../services/database";
import { eq, desc, and, gt } from "drizzle-orm";
import { getVectorStore } from "../services/vector-store";
import { clearMemoryCaches } from "./memory";

export function registerChatHandlers() {
  const db = getDatabase();

  // Get all threads for a user
  ipcMain.handle("db:chat:getThreads", async (_event, userId: string) => {
    try {
      console.log(`[IPC Chat] getThreads called with userId: ${userId}`);

      const threads = await db
        .select()
        .from(schema.ChatThreadTable)
        .where(eq(schema.ChatThreadTable.userId, userId))
        .orderBy(desc(schema.ChatThreadTable.createdAt));

      console.log(
        `[IPC Chat] getThreads found ${threads.length} threads for user ${userId}`,
      );

      // Debug: also check total threads in database
      const allThreads = await db.select().from(schema.ChatThreadTable);
      console.log(`[IPC Chat] Total threads in database: ${allThreads.length}`);
      if (allThreads.length > 0) {
        console.log(
          `[IPC Chat] Thread userIds in DB: ${allThreads.map((t) => t.userId).join(", ")}`,
        );
      }

      return threads;
    } catch (error) {
      console.error("[IPC] Error getting chat threads:", error);
      throw error;
    }
  });

  // Get messages for a thread
  ipcMain.handle("db:chat:getMessages", async (_event, threadId: string) => {
    try {
      const messages = await db
        .select()
        .from(schema.ChatMessageTable)
        .where(eq(schema.ChatMessageTable.threadId, threadId))
        .orderBy(schema.ChatMessageTable.createdAt);

      // Convert stored tool parts to UIMessage format
      // AI SDK's convertToModelMessages() expects UIMessage format with 'dynamic-tool' type and 'state' field
      return messages.map((msg) => {
        const parts = (msg.parts as any[]) || [];

        // Build a map of tool results by toolCallId for merging
        const toolResultsMap = new Map<string, any>();
        for (const part of parts) {
          if (part.type === "tool-result") {
            const output = part.output ?? part.result; // Handle both field names
            toolResultsMap.set(part.toolCallId, {
              output,
              toolName: part.toolName,
            });
          }
        }

        // Convert parts to UIMessage format
        const convertedParts: any[] = [];
        for (const part of parts) {
          if (part.type === "tool-call") {
            // Convert old tool-call format to dynamic-tool UIMessage format
            const input = part.input ?? part.args; // Handle both field names
            const toolResult = toolResultsMap.get(part.toolCallId);

            if (toolResult) {
              // Tool has a result - use output-available state
              convertedParts.push({
                type: "dynamic-tool",
                toolName: part.toolName,
                toolCallId: part.toolCallId,
                state: "output-available",
                input,
                output: toolResult.output,
              });
            } else {
              // Tool has no result yet - use input-available state
              convertedParts.push({
                type: "dynamic-tool",
                toolName: part.toolName,
                toolCallId: part.toolCallId,
                state: "input-available",
                input,
              });
            }
          } else if (part.type === "tool-result") {
            // Skip tool-result parts - they're merged into dynamic-tool above
            continue;
          } else if (part.type === "dynamic-tool") {
            // Already in correct format - just ensure no extra fields that violate schema
            const cleanPart: any = {
              type: "dynamic-tool",
              toolName: part.toolName,
              toolCallId: part.toolCallId,
              state: part.state,
              input: part.input,
            };
            // Only include output for output-available state
            if (
              part.state === "output-available" &&
              part.output !== undefined
            ) {
              cleanPart.output = part.output;
            }
            // Include other valid optional fields if present
            if (part.providerExecuted !== undefined) {
              cleanPart.providerExecuted = part.providerExecuted;
            }
            if (part.callProviderMetadata !== undefined) {
              cleanPart.callProviderMetadata = part.callProviderMetadata;
            }
            if (
              part.state === "output-available" &&
              part.preliminary !== undefined
            ) {
              cleanPart.preliminary = part.preliminary;
            }
            if (part.state === "output-error" && part.errorText !== undefined) {
              cleanPart.errorText = part.errorText;
            }
            convertedParts.push(cleanPart);
          } else {
            // Keep other parts as-is (text, reasoning, etc.)
            convertedParts.push(part);
          }
        }

        return {
          ...msg,
          parts: convertedParts,
        };
      });
    } catch (error) {
      console.error("[IPC] Error getting chat messages:", error);
      throw error;
    }
  });

  // Create a new thread
  ipcMain.handle("db:chat:createThread", async (_event, data: any) => {
    try {
      // Build values object, including id if provided (for ACP chats that pre-generate threadId)
      const values: any = {
        title: data.title,
        userId: data.userId,
        provider: data.provider, // Store provider to identify ACP chats
        model: data.model, // Store model name for restoring on thread load
      };

      // If an explicit id is provided, use it (important for ACP threads)
      if (data.id) {
        values.id = data.id;
      }

      console.log("[IPC Chat] Creating thread with model:", data.model, "provider:", data.provider);

      const [thread] = await db
        .insert(schema.ChatThreadTable)
        .values(values as typeof schema.ChatThreadTable.$inferInsert)
        .returning();

      return thread;
    } catch (error) {
      console.error("[IPC] Error creating chat thread:", error);
      throw error;
    }
  });

  // Create a new message
  ipcMain.handle("db:chat:createMessage", async (_event, data: any) => {
    try {
      const [message] = await db
        .insert(schema.ChatMessageTable)
        .values({
          id: data.id,
          threadId: data.threadId,
          role: data.role,
          parts: data.parts,
          metadata: data.metadata,
        } as typeof schema.ChatMessageTable.$inferInsert)
        .returning();

      return message;
    } catch (error) {
      console.error("[IPC] Error creating chat message:", error);
      throw error;
    }
  });

  // Update a thread
  ipcMain.handle(
    "db:chat:updateThread",
    async (_event, id: string, data: any) => {
      try {
        const updateData: Record<string, any> = {};
        if (data.title !== undefined) updateData.title = data.title;
        if (data.provider !== undefined) updateData.provider = data.provider;
        if (data.model !== undefined) updateData.model = data.model;

        console.log("[IPC Chat] Updating thread", id, "with:", updateData);

        await db
          .update(schema.ChatThreadTable)
          .set(updateData)
          .where(eq(schema.ChatThreadTable.id, id));

        return { success: true };
      } catch (error) {
        console.error("[IPC] Error updating chat thread:", error);
        throw error;
      }
    },
  );

  // Delete a thread (cascade will delete messages)
  // IMPORTANT: Also deletes vector embeddings from DuckDB
  ipcMain.handle("db:chat:deleteThread", async (_event, id: string) => {
    try {
      // Delete vector embeddings FIRST (before SQLite cascade deletes messages)
      // Wrap in try-catch so DuckDB failures don't prevent SQLite deletion
      const vectorStore = getVectorStore();
      if (vectorStore.isAvailable()) {
        try {
          await vectorStore.deleteByThread(id);
          console.log(`[IPC] Deleted vector embeddings for thread: ${id}`);
        } catch (vectorError) {
          // Log but don't throw - DuckDB connection issues shouldn't block thread deletion
          console.warn(`[IPC] Failed to delete vector embeddings for thread ${id}:`, vectorError);
        }
      }

      // Clear caches to prevent stale data
      clearMemoryCaches();

      // Now delete from SQLite (cascades to messages)
      await db
        .delete(schema.ChatThreadTable)
        .where(eq(schema.ChatThreadTable.id, id));

      return { success: true };
    } catch (error) {
      console.error("[IPC] Error deleting chat thread:", error);
      throw error;
    }
  });

  // Get a specific thread by ID
  ipcMain.handle("db:chat:getThread", async (_event, id: string) => {
    try {
      const [thread] = await db
        .select()
        .from(schema.ChatThreadTable)
        .where(eq(schema.ChatThreadTable.id, id))
        .limit(1);

      return thread || null;
    } catch (error) {
      console.error("[IPC] Error getting chat thread:", error);
      throw error;
    }
  });

  // Get a thread with its messages
  ipcMain.handle(
    "db:chat:getThreadWithMessages",
    async (_event, threadId: string, userId: string) => {
      try {
        // Get thread
        const [thread] = await db
          .select()
          .from(schema.ChatThreadTable)
          .where(eq(schema.ChatThreadTable.id, threadId))
          .limit(1);

        if (!thread) {
          return null;
        }

        // Check access
        if (thread.userId !== userId) {
          return null;
        }

        // Get messages
        const rawMessages = await db
          .select()
          .from(schema.ChatMessageTable)
          .where(eq(schema.ChatMessageTable.threadId, threadId))
          .orderBy(schema.ChatMessageTable.createdAt);

        // Convert stored tool parts to UIMessage format (same logic as getMessages)
        const messages = rawMessages.map((msg) => {
          const parts = (msg.parts as any[]) || [];

          // Build a map of tool results by toolCallId for merging
          const toolResultsMap = new Map<string, any>();
          for (const part of parts) {
            if (part.type === "tool-result") {
              const output = part.output ?? part.result;
              toolResultsMap.set(part.toolCallId, {
                output,
                toolName: part.toolName,
              });
            }
          }

          // Convert parts to UIMessage format
          const convertedParts: any[] = [];
          for (const part of parts) {
            if (part.type === "tool-call") {
              // Convert old tool-call format to dynamic-tool UIMessage format
              const input = part.input ?? part.args;
              const toolResult = toolResultsMap.get(part.toolCallId);

              if (toolResult) {
                convertedParts.push({
                  type: "dynamic-tool",
                  toolName: part.toolName,
                  toolCallId: part.toolCallId,
                  state: "output-available",
                  input,
                  output: toolResult.output,
                });
              } else {
                convertedParts.push({
                  type: "dynamic-tool",
                  toolName: part.toolName,
                  toolCallId: part.toolCallId,
                  state: "input-available",
                  input,
                });
              }
            } else if (part.type === "tool-result") {
              // Skip tool-result parts - they're merged into dynamic-tool above
              continue;
            } else if (part.type === "dynamic-tool") {
              // Already in correct format
              const cleanPart: any = {
                type: "dynamic-tool",
                toolName: part.toolName,
                toolCallId: part.toolCallId,
                state: part.state,
                input: part.input,
              };
              if (
                part.state === "output-available" &&
                part.output !== undefined
              ) {
                cleanPart.output = part.output;
              }
              if (part.providerExecuted !== undefined) {
                cleanPart.providerExecuted = part.providerExecuted;
              }
              if (part.callProviderMetadata !== undefined) {
                cleanPart.callProviderMetadata = part.callProviderMetadata;
              }
              if (
                part.state === "output-available" &&
                part.preliminary !== undefined
              ) {
                cleanPart.preliminary = part.preliminary;
              }
              if (part.state === "output-error" && part.errorText !== undefined) {
                cleanPart.errorText = part.errorText;
              }
              convertedParts.push(cleanPart);
            } else {
              // Keep other parts as-is (text, reasoning, etc.)
              convertedParts.push(part);
            }
          }

          return {
            ...msg,
            parts: convertedParts,
          };
        });

        return { ...thread, messages: messages || [] };
      } catch (error) {
        console.error("[IPC] Error getting thread with messages:", error);
        throw error;
      }
    },
  );

  // Delete all threads for a user
  // IMPORTANT: Also deletes all vector embeddings from DuckDB
  ipcMain.handle("db:chat:deleteAllThreads", async (_event, userId: string) => {
    try {
      // Get all thread IDs first so we can delete their embeddings
      const threads = await db
        .select({ id: schema.ChatThreadTable.id })
        .from(schema.ChatThreadTable)
        .where(eq(schema.ChatThreadTable.userId, userId));

      // Delete vector embeddings for each thread
      // Wrap in try-catch so DuckDB failures don't prevent SQLite deletion
      const vectorStore = getVectorStore();
      if (vectorStore.isAvailable() && threads.length > 0) {
        for (const thread of threads) {
          try {
            await vectorStore.deleteByThread(thread.id);
          } catch (vectorError) {
            console.warn(`[IPC] Failed to delete vector embeddings for thread ${thread.id}:`, vectorError);
          }
        }
        console.log(`[IPC] Attempted to delete vector embeddings for ${threads.length} threads`);
      }

      // Clear caches to prevent stale data
      clearMemoryCaches();

      // Now delete from SQLite (cascades to messages)
      await db
        .delete(schema.ChatThreadTable)
        .where(eq(schema.ChatThreadTable.userId, userId));

      console.log(`[IPC] Deleted all threads for user: ${userId} (${threads.length} threads)`);
      return { success: true };
    } catch (error) {
      console.error("[IPC] Error deleting all chat threads:", error);
      throw error;
    }
  });

  // Upsert message (create or update)
  ipcMain.handle("db:chat:upsertMessage", async (_event, data: any) => {
    try {
      const { message, threadId } = data;

      // Check if message exists
      const [existing] = await db
        .select()
        .from(schema.ChatMessageTable)
        .where(eq(schema.ChatMessageTable.id, message.id))
        .limit(1);

      if (existing) {
        // Update existing message
        const [updated] = await db
          .update(schema.ChatMessageTable)
          .set({
            parts: message.parts,
            metadata: message.metadata,
          })
          .where(eq(schema.ChatMessageTable.id, message.id))
          .returning();
        return updated;
      } else {
        // Create new message
        const [created] = await db
          .insert(schema.ChatMessageTable)
          .values({
            id: message.id,
            threadId: threadId,
            role: message.role,
            parts: message.parts,
            metadata: message.metadata,
          } as typeof schema.ChatMessageTable.$inferInsert)
          .returning();
        return created;
      }
    } catch (error) {
      console.error("[IPC] Error upserting chat message:", error);
      throw error;
    }
  });

  // Delete a single message
  // IMPORTANT: Also deletes vector embedding from DuckDB
  ipcMain.handle("db:chat:deleteMessage", async (_event, messageId: string) => {
    try {
      // Delete from vector store first
      // Wrap in try-catch so DuckDB failures don't prevent SQLite deletion
      const vectorStore = getVectorStore();
      if (vectorStore.isAvailable()) {
        try {
          await vectorStore.delete("messages", [messageId]);
          console.log(`[IPC] Deleted vector embedding for message: ${messageId}`);
        } catch (vectorError) {
          console.warn(`[IPC] Failed to delete vector embedding for message ${messageId}:`, vectorError);
        }
      }

      // Clear caches to prevent stale data
      clearMemoryCaches();

      // Delete from SQLite
      await db
        .delete(schema.ChatMessageTable)
        .where(eq(schema.ChatMessageTable.id, messageId));

      return { success: true };
    } catch (error) {
      console.error("[IPC] Error deleting chat message:", error);
      throw error;
    }
  });

  // Delete messages after a specific message (by timestamp)
  // IMPORTANT: Also deletes vector embeddings from DuckDB
  ipcMain.handle(
    "db:chat:deleteMessagesAfterTimestamp",
    async (_event, data: { threadId: string; messageId: string }) => {
      try {
        const { threadId, messageId } = data;

        // Get the timestamp of the target message
        const [targetMessage] = await db
          .select()
          .from(schema.ChatMessageTable)
          .where(eq(schema.ChatMessageTable.id, messageId))
          .limit(1);

        if (!targetMessage) {
          return { success: false, error: "Message not found" };
        }

        // Delete all messages in the thread that are after this message
        if (targetMessage.createdAt) {
          // First, get the IDs of messages that will be deleted
          const messagesToDelete = await db
            .select({ id: schema.ChatMessageTable.id })
            .from(schema.ChatMessageTable)
            .where(
              and(
                eq(schema.ChatMessageTable.threadId, threadId),
                gt(schema.ChatMessageTable.createdAt, targetMessage.createdAt),
              ),
            );

          // Delete from vector store first
          // Wrap in try-catch so DuckDB failures don't prevent SQLite deletion
          if (messagesToDelete.length > 0) {
            const vectorStore = getVectorStore();
            if (vectorStore.isAvailable()) {
              try {
                const messageIds = messagesToDelete.map((m) => m.id);
                await vectorStore.delete("messages", messageIds);
                console.log(`[IPC] Deleted ${messageIds.length} vector embeddings for messages after timestamp`);
              } catch (vectorError) {
                console.warn(`[IPC] Failed to delete vector embeddings for messages after timestamp:`, vectorError);
              }
            }

            // Clear caches to prevent stale data
            clearMemoryCaches();
          }

          // Now delete from SQLite
          await db
            .delete(schema.ChatMessageTable)
            .where(
              and(
                eq(schema.ChatMessageTable.threadId, threadId),
                gt(schema.ChatMessageTable.createdAt, targetMessage.createdAt),
              ),
            );
        }

        return { success: true };
      } catch (error) {
        console.error("[IPC] Error deleting messages after timestamp:", error);
        throw error;
      }
    },
  );

  // Update message parts
  ipcMain.handle(
    "db:chat:updateMessageParts",
    async (_event, data: { messageId: string; parts: any[] }) => {
      try {
        const [updated] = await db
          .update(schema.ChatMessageTable)
          .set({ parts: data.parts })
          .where(eq(schema.ChatMessageTable.id, data.messageId))
          .returning();

        return updated;
      } catch (error) {
        console.error("[IPC] Error updating message parts:", error);
        throw error;
      }
    },
  );

  console.log("[IPC] Chat handlers registered");
}
