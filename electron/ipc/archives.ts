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

      // ArchiveItemTable entries are deleted automatically via CASCADE
      // Just delete the archive
      await db
        .delete(schema.ArchiveTable)
        .where(eq(schema.ArchiveTable.id, id));

      return { success: true };
    } catch (error) {
      console.error("[IPC] Error deleting archive:", error);
      throw error;
    }
  });

  // Archive a thread (add thread to archive via ArchiveItemTable)
  ipcMain.handle(
    "db:archives:archiveThread",
    async (_event, threadId: string, archiveId: string, userId: string) => {
      try {
        const { getDatabase, schema } = require("../services/database");
        const db = getDatabase();
        const { eq, and } = require("drizzle-orm");
        const { randomUUID } = require("crypto");

        // Check if already archived
        const [existing] = await db
          .select()
          .from(schema.ArchiveItemTable)
          .where(
            and(
              eq(schema.ArchiveItemTable.itemId, threadId),
              eq(schema.ArchiveItemTable.archiveId, archiveId),
            ),
          )
          .limit(1);

        if (existing) {
          return { success: true, alreadyArchived: true };
        }

        // Add to archive
        await db.insert(schema.ArchiveItemTable).values({
          id: randomUUID(),
          archiveId,
          itemId: threadId,
          userId,
          addedAt: new Date(),
        });

        return { success: true };
      } catch (error) {
        console.error("[IPC] Error archiving thread:", error);
        throw error;
      }
    },
  );

  // Unarchive a thread (remove from ArchiveItemTable)
  ipcMain.handle(
    "db:archives:unarchiveThread",
    async (_event, threadId: string, archiveId?: string) => {
      try {
        const { getDatabase, schema } = require("../services/database");
        const db = getDatabase();
        const { eq, and } = require("drizzle-orm");

        if (archiveId) {
          // Remove from specific archive
          await db
            .delete(schema.ArchiveItemTable)
            .where(
              and(
                eq(schema.ArchiveItemTable.itemId, threadId),
                eq(schema.ArchiveItemTable.archiveId, archiveId),
              ),
            );
        } else {
          // Remove from all archives
          await db
            .delete(schema.ArchiveItemTable)
            .where(eq(schema.ArchiveItemTable.itemId, threadId));
        }

        return { success: true };
      } catch (error) {
        console.error("[IPC] Error unarchiving thread:", error);
        throw error;
      }
    },
  );

  // Get archived items for an archive
  ipcMain.handle("db:archives:getItems", async (_event, archiveId: string) => {
    try {
      const { getDatabase, schema } = require("../services/database");
      const db = getDatabase();
      const { eq } = require("drizzle-orm");

      const items = await db
        .select()
        .from(schema.ArchiveItemTable)
        .where(eq(schema.ArchiveItemTable.archiveId, archiveId));

      return items;
    } catch (error) {
      console.error("[IPC] Error getting archive items:", error);
      return [];
    }
  });

  // Get archives containing an item (thread)
  ipcMain.handle(
    "db:archives:getItemArchives",
    async (_event, itemId: string) => {
      try {
        const { getDatabase, schema } = require("../services/database");
        const db = getDatabase();
        const { eq } = require("drizzle-orm");

        // Get all archive items for this item
        const items = await db
          .select()
          .from(schema.ArchiveItemTable)
          .where(eq(schema.ArchiveItemTable.itemId, itemId));

        // Get the archive details for each
        const archiveIds = items.map((item: any) => item.archiveId);
        if (archiveIds.length === 0) {
          return [];
        }

        const { inArray } = require("drizzle-orm");
        const archives = await db
          .select()
          .from(schema.ArchiveTable)
          .where(inArray(schema.ArchiveTable.id, archiveIds));

        return archives;
      } catch (error) {
        console.error("[IPC] Error getting item archives:", error);
        return [];
      }
    },
  );

  console.log("[IPC] Archive handlers registered");
}
