import { and, eq } from "drizzle-orm";
import { sqliteDb as db } from "../db.sqlite";
import { AgentTable, BookmarkTable } from "../schema.sqlite";

export interface BookmarkRepository {
  createBookmark(
    userId: string,
    itemId: string,
    itemType: "agent" | "workflow" | "mcp",
  ): Promise<void>;

  removeBookmark(
    userId: string,
    itemId: string,
    itemType: "agent" | "workflow" | "mcp",
  ): Promise<void>;

  toggleBookmark(
    userId: string,
    itemId: string,
    itemType: "agent" | "workflow" | "mcp",
    isCurrentlyBookmarked: boolean,
  ): Promise<boolean>;

  checkItemAccess(
    itemId: string,
    itemType: "agent" | "workflow" | "mcp",
    userId: string,
  ): Promise<boolean>;
}

export const sqliteBookmarkRepository: BookmarkRepository = {
  async createBookmark(userId, itemId, itemType) {
    await db
      .insert(BookmarkTable)
      .values({
        userId,
        itemId,
        itemType,
      })
      .onConflictDoNothing();
  },

  async removeBookmark(userId, itemId, itemType) {
    await db
      .delete(BookmarkTable)
      .where(
        and(
          eq(BookmarkTable.userId, userId),
          eq(BookmarkTable.itemId, itemId),
          eq(BookmarkTable.itemType, itemType),
        ),
      );
  },

  async toggleBookmark(userId, itemId, itemType, isCurrentlyBookmarked) {
    if (isCurrentlyBookmarked) {
      await this.removeBookmark(userId, itemId, itemType);
      return false;
    } else {
      await this.createBookmark(userId, itemId, itemType);
      return true;
    }
  },

  async checkItemAccess(itemId, itemType, userId) {
    if (itemType === "agent") {
      const agent = await db
        .select()
        .from(AgentTable)
        .where(eq(AgentTable.id, itemId))
        .limit(1);

      if (!agent[0]) return false;

      return (
        agent[0].visibility === "public" ||
        agent[0].visibility === "readonly" ||
        agent[0].userId === userId
      );
    }

    // For local-first, allow access to own items
    return true;
  },
};
