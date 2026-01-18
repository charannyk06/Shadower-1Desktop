import { ipcMain } from 'electron';
import { getDatabase, schema } from '../services/database';
import { eq, desc } from 'drizzle-orm';

export function registerChatHandlers() {
  const db = getDatabase();

  // Get all threads for a user
  ipcMain.handle('db:chat:getThreads', async (event, userId: string) => {
    try {
      const threads = await db
        .select()
        .from(schema.ChatThreadTable)
        .where(eq(schema.ChatThreadTable.userId, userId))
        .orderBy(desc(schema.ChatThreadTable.createdAt));

      return threads;
    } catch (error) {
      console.error('[IPC] Error getting chat threads:', error);
      throw error;
    }
  });

  // Get messages for a thread
  ipcMain.handle('db:chat:getMessages', async (event, threadId: string) => {
    try {
      const messages = await db
        .select()
        .from(schema.ChatMessageTable)
        .where(eq(schema.ChatMessageTable.threadId, threadId))
        .orderBy(schema.ChatMessageTable.createdAt);

      return messages;
    } catch (error) {
      console.error('[IPC] Error getting chat messages:', error);
      throw error;
    }
  });

  // Create a new thread
  ipcMain.handle('db:chat:createThread', async (event, data: any) => {
    try {
      const [thread] = await db
        .insert(schema.ChatThreadTable)
        .values({
          title: data.title,
          userId: data.userId,
        })
        .returning();

      return thread;
    } catch (error) {
      console.error('[IPC] Error creating chat thread:', error);
      throw error;
    }
  });

  // Create a new message
  ipcMain.handle('db:chat:createMessage', async (event, data: any) => {
    try {
      const [message] = await db
        .insert(schema.ChatMessageTable)
        .values({
          id: data.id,
          threadId: data.threadId,
          role: data.role,
          parts: data.parts,
          metadata: data.metadata,
        })
        .returning();

      return message;
    } catch (error) {
      console.error('[IPC] Error creating chat message:', error);
      throw error;
    }
  });

  // Update a thread
  ipcMain.handle('db:chat:updateThread', async (event, id: string, data: any) => {
    try {
      await db
        .update(schema.ChatThreadTable)
        .set({
          title: data.title,
        })
        .where(eq(schema.ChatThreadTable.id, id));

      return { success: true };
    } catch (error) {
      console.error('[IPC] Error updating chat thread:', error);
      throw error;
    }
  });

  // Delete a thread (cascade will delete messages)
  ipcMain.handle('db:chat:deleteThread', async (event, id: string) => {
    try {
      await db
        .delete(schema.ChatThreadTable)
        .where(eq(schema.ChatThreadTable.id, id));

      return { success: true };
    } catch (error) {
      console.error('[IPC] Error deleting chat thread:', error);
      throw error;
    }
  });

  // Get a specific thread by ID
  ipcMain.handle('db:chat:getThread', async (event, id: string) => {
    try {
      const thread = await db.query.ChatThreadTable.findFirst({
        where: eq(schema.ChatThreadTable.id, id),
      });

      return thread;
    } catch (error) {
      console.error('[IPC] Error getting chat thread:', error);
      throw error;
    }
  });

  console.log('[IPC] Chat handlers registered');
}
