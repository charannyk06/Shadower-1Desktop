import { ipcMain } from "electron";
import { getDatabase, schema } from "../services/database";
import { eq, desc, and, notInArray, gt, gte, sql } from "drizzle-orm";

export function registerChatHandlers() {
  const db = getDatabase();

  // Get all threads for a user
  ipcMain.handle("db:chat:getThreads", async (_event, userId: string) => {
    try {
      const threads = await db
        .select()
        .from(schema.ChatThreadTable)
        .where(eq(schema.ChatThreadTable.userId, userId))
        .orderBy(desc(schema.ChatThreadTable.createdAt));

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

      return messages;
    } catch (error) {
      console.error("[IPC] Error getting chat messages:", error);
      throw error;
    }
  });

  // Create a new thread
  ipcMain.handle("db:chat:createThread", async (_event, data: any) => {
    try {
      const [thread] = await db
        .insert(schema.ChatThreadTable)
        .values({
          title: data.title,
          userId: data.userId,
        } as typeof schema.ChatThreadTable.$inferInsert)
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
        await db
          .update(schema.ChatThreadTable)
          .set({
            title: data.title,
          })
          .where(eq(schema.ChatThreadTable.id, id));

        return { success: true };
      } catch (error) {
        console.error("[IPC] Error updating chat thread:", error);
        throw error;
      }
    },
  );

  // Delete a thread (cascade will delete messages)
  ipcMain.handle("db:chat:deleteThread", async (_event, id: string) => {
    try {
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
        const messages = await db
          .select()
          .from(schema.ChatMessageTable)
          .where(eq(schema.ChatMessageTable.threadId, threadId))
          .orderBy(schema.ChatMessageTable.createdAt);

        return { ...thread, messages: messages || [] };
      } catch (error) {
        console.error("[IPC] Error getting thread with messages:", error);
        throw error;
      }
    },
  );

  // Delete all threads for a user
  ipcMain.handle("db:chat:deleteAllThreads", async (_event, userId: string) => {
    try {
      await db
        .delete(schema.ChatThreadTable)
        .where(eq(schema.ChatThreadTable.userId, userId));

      console.log(`[IPC] Deleted all threads for user: ${userId}`);
      return { success: true };
    } catch (error) {
      console.error("[IPC] Error deleting all chat threads:", error);
      throw error;
    }
  });

  // Delete all unarchived threads for a user
  ipcMain.handle(
    "db:chat:deleteUnarchivedThreads",
    async (_event, userId: string) => {
      try {
        // Get archived thread IDs from archive items
        const archivedItems = await db
          .select({ itemId: schema.ArchiveItemTable.itemId })
          .from(schema.ArchiveItemTable)
          .where(eq(schema.ArchiveItemTable.userId, userId));

        const archivedThreadIds = archivedItems.map((item) => item.itemId);

        // Delete threads that are NOT in the archive
        if (archivedThreadIds.length > 0) {
          await db
            .delete(schema.ChatThreadTable)
            .where(
              and(
                eq(schema.ChatThreadTable.userId, userId),
                notInArray(schema.ChatThreadTable.id, archivedThreadIds),
              ),
            );
        } else {
          // No archived threads, delete all threads for user
          await db
            .delete(schema.ChatThreadTable)
            .where(eq(schema.ChatThreadTable.userId, userId));
        }

        console.log(`[IPC] Deleted unarchived threads for user: ${userId}`);
        return { success: true };
      } catch (error) {
        console.error("[IPC] Error deleting unarchived chat threads:", error);
        throw error;
      }
    },
  );

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
  ipcMain.handle("db:chat:deleteMessage", async (_event, messageId: string) => {
    try {
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
        await db
          .delete(schema.ChatMessageTable)
          .where(
            and(
              eq(schema.ChatMessageTable.threadId, threadId),
              gt(schema.ChatMessageTable.createdAt, targetMessage.createdAt),
            ),
          );

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
