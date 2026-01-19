import { ipcMain } from "electron";
import { getDatabase, schema } from "../services/database";
import { eq, sql, count, and, gte } from "drizzle-orm";

export function registerUserHandlers() {
  const db = getDatabase();

  // Get user preferences
  ipcMain.handle("db:user:getPreferences", async () => {
    try {
      // Get the default local user
      const [user] = await db
        .select()
        .from(schema.UserTable)
        .where(eq(schema.UserTable.email, "local@shadower.app"))
        .limit(1);

      return user?.preferences || {};
    } catch (error) {
      console.error("[IPC] Error getting user preferences:", error);
      throw error;
    }
  });

  // Update user preferences
  ipcMain.handle("db:user:updatePreferences", async (_event, data: any) => {
    try {
      // Get the default local user
      const [user] = await db
        .select()
        .from(schema.UserTable)
        .where(eq(schema.UserTable.email, "local@shadower.app"))
        .limit(1);

      if (!user) {
        throw new Error("Default user not found");
      }

      await db
        .update(schema.UserTable)
        .set({
          preferences: {
            ...user.preferences,
            ...data,
          },
          updatedAt: new Date(),
        } as Partial<typeof schema.UserTable.$inferInsert>)
        .where(eq(schema.UserTable.id, user.id));

      return { success: true };
    } catch (error) {
      console.error("[IPC] Error updating user preferences:", error);
      throw error;
    }
  });

  // Get current user
  ipcMain.handle("db:user:getCurrent", async () => {
    try {
      const [user] = await db
        .select()
        .from(schema.UserTable)
        .where(eq(schema.UserTable.email, "local@shadower.app"))
        .limit(1);

      return user || null;
    } catch (error) {
      console.error("[IPC] Error getting current user:", error);
      throw error;
    }
  });

  // Update user profile
  ipcMain.handle("db:user:updateProfile", async (_event, data: any) => {
    try {
      const [user] = await db
        .select()
        .from(schema.UserTable)
        .where(eq(schema.UserTable.email, "local@shadower.app"))
        .limit(1);

      if (!user) {
        throw new Error("Default user not found");
      }

      const [updatedUser] = await db
        .update(schema.UserTable)
        .set({
          name: data.name || user.name,
          image: data.image !== undefined ? data.image : user.image,
          updatedAt: new Date(),
        } as Partial<typeof schema.UserTable.$inferInsert>)
        .where(eq(schema.UserTable.id, user.id))
        .returning();

      return updatedUser;
    } catch (error) {
      console.error("[IPC] Error updating user profile:", error);
      throw error;
    }
  });

  // Get user by ID (for admin or self-view)
  ipcMain.handle("db:user:getById", async (_event, userId: string) => {
    try {
      const [user] = await db
        .select()
        .from(schema.UserTable)
        .where(eq(schema.UserTable.id, userId))
        .limit(1);

      return user || null;
    } catch (error) {
      console.error("[IPC] Error getting user by ID:", error);
      throw error;
    }
  });

  // Get user stats (thread count, message count, etc.)
  ipcMain.handle("db:user:getStats", async (_event, userId: string) => {
    try {
      // Get thread count
      const threadCountResult = await db
        .select({ count: count() })
        .from(schema.ChatThreadTable)
        .where(eq(schema.ChatThreadTable.userId, userId));

      const threadCount = threadCountResult[0]?.count || 0;

      // Get message count - join with threads to filter by user
      const messageCountResult = await db
        .select({ count: count() })
        .from(schema.ChatMessageTable)
        .innerJoin(
          schema.ChatThreadTable,
          eq(schema.ChatMessageTable.threadId, schema.ChatThreadTable.id),
        )
        .where(eq(schema.ChatThreadTable.userId, userId));

      const messageCount = messageCountResult[0]?.count || 0;

      // For desktop app, we don't track model stats or tokens in the same way
      // Return simplified stats
      return {
        threadCount,
        messageCount,
        modelStats: [],
        totalTokens: 0,
        period: "All Time",
      };
    } catch (error) {
      console.error("[IPC] Error getting user stats:", error);
      // Return default stats on error
      return {
        threadCount: 0,
        messageCount: 0,
        modelStats: [],
        totalTokens: 0,
        period: "All Time",
      };
    }
  });

  console.log("[IPC] User handlers registered");
}
