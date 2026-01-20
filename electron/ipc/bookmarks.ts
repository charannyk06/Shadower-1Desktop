import { ipcMain } from "electron";
import { getDatabase, schema } from "../services/database";
import { and, eq } from "drizzle-orm";

/**
 * Register bookmark-related IPC handlers
 */
export function registerBookmarkHandlers(): void {
  const db = getDatabase();

  if (!db) {
    console.warn(
      "[bookmarks] Database not initialized, handlers not registered",
    );
    return;
  }

  // Toggle bookmark (create or delete)
  // Matches the signature in preload.ts: toggle(userId, itemId, itemType, isCurrentlyBookmarked)
  ipcMain.handle(
    "db:bookmark:toggle",
    async (
      _event,
      userId: string,
      itemId: string,
      itemType: "agent" | "workflow" | "mcp",
      isCurrentlyBookmarked: boolean,
    ) => {
      try {
        if (isCurrentlyBookmarked) {
          // Delete bookmark
          await db
            .delete(schema.BookmarkTable)
            .where(
              and(
                eq(schema.BookmarkTable.userId, userId),
                eq(schema.BookmarkTable.itemId, itemId),
                eq(schema.BookmarkTable.itemType, itemType),
              ),
            );
          return { success: true, isBookmarked: false };
        } else {
          // Create bookmark
          await db.insert(schema.BookmarkTable).values({
            userId,
            itemId,
            itemType,
          });
          return { success: true, isBookmarked: true };
        }
      } catch (error: any) {
        console.error("[bookmarks] Error toggling bookmark:", error);
        return { success: false, error: error.message };
      }
    },
  );

  // Check if item is bookmarked
  ipcMain.handle(
    "db:bookmark:isBookmarked",
    async (
      _event,
      userId: string,
      itemId: string,
      itemType: "agent" | "workflow" | "mcp",
    ) => {
      try {
        const existing = await db
          .select()
          .from(schema.BookmarkTable)
          .where(
            and(
              eq(schema.BookmarkTable.userId, userId),
              eq(schema.BookmarkTable.itemId, itemId),
              eq(schema.BookmarkTable.itemType, itemType),
            ),
          )
          .limit(1);

        return { success: true, isBookmarked: existing.length > 0 };
      } catch (error: any) {
        console.error("[bookmarks] Error checking bookmark:", error);
        return { success: false, error: error.message };
      }
    },
  );

  // Get all bookmarks for a user by type
  ipcMain.handle(
    "db:bookmark:getByType",
    async (_event, userId: string, itemType: "agent" | "workflow" | "mcp") => {
      try {
        const bookmarks = await db
          .select()
          .from(schema.BookmarkTable)
          .where(
            and(
              eq(schema.BookmarkTable.userId, userId),
              eq(schema.BookmarkTable.itemType, itemType),
            ),
          );

        return { success: true, bookmarks };
      } catch (error: any) {
        console.error("[bookmarks] Error getting bookmarks:", error);
        return { success: false, error: error.message, bookmarks: [] };
      }
    },
  );

  console.log("[bookmarks] IPC handlers registered");
}
