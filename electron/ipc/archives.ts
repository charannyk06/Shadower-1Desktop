import { ipcMain } from "electron";

/**
 * Register IPC handlers for archive operations
 */
export function registerArchiveHandlers() {
  // Get all archives for a user
  ipcMain.handle("db:archives:getAll", async (_event, userId: string) => {
    try {
      const { getDatabase, schema } = require("../services/database");
      const db = getDatabase();
      const { eq, desc } = require("drizzle-orm");

      const archives = await db
        .select()
        .from(schema.ArchiveTable)
        .where(eq(schema.ArchiveTable.userId, userId))
        .orderBy(desc(schema.ArchiveTable.createdAt));

      return archives;
    } catch (error) {
      console.error("[IPC] Error getting archives:", error);
      return [];
    }
  });

  // Get archive by ID
  ipcMain.handle("db:archives:getById", async (_event, id: string) => {
    try {
      const { getDatabase, schema } = require("../services/database");
      const db = getDatabase();
      const { eq } = require("drizzle-orm");

      const [archive] = await db
        .select()
        .from(schema.ArchiveTable)
        .where(eq(schema.ArchiveTable.id, id))
        .limit(1);

      return archive || null;
    } catch (error) {
      console.error("[IPC] Error getting archive by ID:", error);
      return null;
    }
  });

  // Create archive
  ipcMain.handle("db:archives:create", async (_event, data: any) => {
    try {
      const { getDatabase, schema } = require("../services/database");
      const db = getDatabase();
      const { randomUUID } = require("crypto");

      const id = data.id || randomUUID();

      const [archive] = await db
        .insert(schema.ArchiveTable)
        .values({
          id,
          name: data.name,
          userId: data.userId,
          description: data.description || null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      return archive;
    } catch (error) {
      console.error("[IPC] Error creating archive:", error);
      throw error;
    }
  });

  // Update archive
  ipcMain.handle(
    "db:archives:update",
    async (_event, id: string, data: any) => {
      try {
        const { getDatabase, schema } = require("../services/database");
        const db = getDatabase();
        const { eq } = require("drizzle-orm");

        const [archive] = await db
          .update(schema.ArchiveTable)
          .set({
            name: data.name,
            description: data.description,
            updatedAt: new Date(),
          })
          .where(eq(schema.ArchiveTable.id, id))
          .returning();

        return archive;
      } catch (error) {
        console.error("[IPC] Error updating archive:", error);
        throw error;
      }
    },
  );

  // Delete archive
  ipcMain.handle("db:archives:delete", async (_event, id: string) => {
    try {
      const { getDatabase, schema } = require("../services/database");
      const db = getDatabase();
      const { eq } = require("drizzle-orm");

      // First, unarchive all threads in this archive
      await db
        .update(schema.ThreadTable)
        .set({ archiveId: null })
        .where(eq(schema.ThreadTable.archiveId, id));

      // Then delete the archive
      await db
        .delete(schema.ArchiveTable)
        .where(eq(schema.ArchiveTable.id, id));

      return { success: true };
    } catch (error) {
      console.error("[IPC] Error deleting archive:", error);
      throw error;
    }
  });

  // Archive a thread (move thread to archive)
  ipcMain.handle(
    "db:archives:archiveThread",
    async (_event, threadId: string, archiveId: string) => {
      try {
        const { getDatabase, schema } = require("../services/database");
        const db = getDatabase();
        const { eq } = require("drizzle-orm");

        await db
          .update(schema.ThreadTable)
          .set({ archiveId })
          .where(eq(schema.ThreadTable.id, threadId));

        return { success: true };
      } catch (error) {
        console.error("[IPC] Error archiving thread:", error);
        throw error;
      }
    },
  );

  // Unarchive a thread
  ipcMain.handle(
    "db:archives:unarchiveThread",
    async (_event, threadId: string) => {
      try {
        const { getDatabase, schema } = require("../services/database");
        const db = getDatabase();
        const { eq } = require("drizzle-orm");

        await db
          .update(schema.ThreadTable)
          .set({ archiveId: null })
          .where(eq(schema.ThreadTable.id, threadId));

        return { success: true };
      } catch (error) {
        console.error("[IPC] Error unarchiving thread:", error);
        throw error;
      }
    },
  );

  console.log("[IPC] Archive handlers registered");
}
