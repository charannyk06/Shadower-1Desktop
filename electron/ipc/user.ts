import { ipcMain } from "electron";
import { getDatabase, schema } from "../services/database";
import { eq, count } from "drizzle-orm";

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

  // Get user stats (thread count, message count, model usage, tokens, etc.)
  ipcMain.handle("db:user:getStats", async (_event, userId: string) => {
    try {
      // Get thread count
      const threadCountResult = await db
        .select({ count: count() })
        .from(schema.ChatThreadTable)
        .where(eq(schema.ChatThreadTable.userId, userId));

      const threadCount = threadCountResult[0]?.count || 0;

      // Get all messages for this user's threads with metadata
      const messages = await db
        .select({
          metadata: schema.ChatMessageTable.metadata,
          role: schema.ChatMessageTable.role,
        })
        .from(schema.ChatMessageTable)
        .innerJoin(
          schema.ChatThreadTable,
          eq(schema.ChatMessageTable.threadId, schema.ChatThreadTable.id),
        )
        .where(eq(schema.ChatThreadTable.userId, userId));

      const messageCount = messages.length;

      // Aggregate model stats from message metadata
      const modelStatsMap = new Map<
        string,
        {
          model: string;
          provider: string;
          messageCount: number;
          totalTokens: number;
        }
      >();

      let totalTokens = 0;

      for (const msg of messages) {
        const metadata = msg.metadata as {
          usage?: {
            promptTokens?: number;
            completionTokens?: number;
            totalTokens?: number;
          };
          chatModel?: { provider: string; model: string };
        } | null;

        if (!metadata) continue;

        // Get token counts from usage
        const usage = metadata.usage;
        if (usage) {
          const msgTokens =
            usage.totalTokens ||
            (usage.promptTokens || 0) + (usage.completionTokens || 0);
          totalTokens += msgTokens;

          // Get model info
          const chatModel = metadata.chatModel;
          if (chatModel?.model) {
            const key = `${chatModel.provider || "unknown"}:${chatModel.model}`;
            const existing = modelStatsMap.get(key);

            if (existing) {
              existing.messageCount += 1;
              existing.totalTokens += msgTokens;
            } else {
              modelStatsMap.set(key, {
                model: chatModel.model,
                provider: chatModel.provider || "unknown",
                messageCount: 1,
                totalTokens: msgTokens,
              });
            }
          }
        }
      }

      // Convert map to sorted array (by totalTokens descending)
      const modelStats = Array.from(modelStatsMap.values()).sort(
        (a, b) => b.totalTokens - a.totalTokens,
      );

      return {
        threadCount,
        messageCount,
        modelStats,
        totalTokens,
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

  // Update user image/avatar
  ipcMain.handle("db:user:updateImage", async (_event, imageUrl: string) => {
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
          image: imageUrl,
          updatedAt: new Date(),
        } as Partial<typeof schema.UserTable.$inferInsert>)
        .where(eq(schema.UserTable.id, user.id))
        .returning();

      return updatedUser;
    } catch (error) {
      console.error("[IPC] Error updating user image:", error);
      throw error;
    }
  });

  // Update user details (name, etc.)
  ipcMain.handle(
    "db:user:updateDetails",
    async (_event, data: { name?: string }) => {
      try {
        const [user] = await db
          .select()
          .from(schema.UserTable)
          .where(eq(schema.UserTable.email, "local@shadower.app"))
          .limit(1);

        if (!user) {
          throw new Error("Default user not found");
        }

        const updateData: any = { updatedAt: new Date() };
        if (data.name !== undefined) {
          updateData.name = data.name;
        }

        const [updatedUser] = await db
          .update(schema.UserTable)
          .set(updateData)
          .where(eq(schema.UserTable.id, user.id))
          .returning();

        return updatedUser;
      } catch (error) {
        console.error("[IPC] Error updating user details:", error);
        throw error;
      }
    },
  );

  console.log("[IPC] User handlers registered");
}
