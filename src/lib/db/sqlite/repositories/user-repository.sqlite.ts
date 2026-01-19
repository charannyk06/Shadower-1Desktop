import {
  BasicUserWithLastLogin,
  User,
  UserPreferences,
  UserRepository,
} from "app-types/user";
import { and, count, eq, gte, sql } from "drizzle-orm";
import { sqliteDb as db } from "../db.sqlite";
import {
  AccountTable,
  ChatMessageTable,
  ChatThreadTable,
  SessionTable,
  UserTable,
} from "../schema.sqlite";

export const sqliteUserRepository: UserRepository = {
  existsByEmail: async (email: string): Promise<boolean> => {
    const result = await db
      .select()
      .from(UserTable)
      .where(eq(UserTable.email, email));
    return result.length > 0;
  },

  updateUserDetails: async ({
    userId,
    name,
    image,
    email,
  }: {
    userId: string;
    name?: string;
    image?: string;
    email?: string;
  }): Promise<User> => {
    const [result] = await db
      .update(UserTable)
      .set({
        ...(name && { name }),
        ...(image && { image }),
        ...(email && { email }),
        updatedAt: new Date(),
      })
      .where(eq(UserTable.id, userId))
      .returning();
    return {
      ...result,
      preferences: result.preferences ?? null,
      createdAt: result.createdAt ?? new Date(),
      updatedAt: result.updatedAt ?? new Date(),
      banExpires: result.banExpires ?? null,
    };
  },

  updatePreferences: async (
    userId: string,
    preferences: UserPreferences,
  ): Promise<User> => {
    const [result] = await db
      .update(UserTable)
      .set({
        preferences,
        updatedAt: new Date(),
      })
      .where(eq(UserTable.id, userId))
      .returning();
    return {
      ...result,
      preferences: result.preferences ?? null,
      createdAt: result.createdAt ?? new Date(),
      updatedAt: result.updatedAt ?? new Date(),
      banExpires: result.banExpires ?? null,
    };
  },

  getPreferences: async (userId: string) => {
    const [result] = await db
      .select({ preferences: UserTable.preferences })
      .from(UserTable)
      .where(eq(UserTable.id, userId));
    return result?.preferences ?? null;
  },

  getUserById: async (
    userId: string,
  ): Promise<BasicUserWithLastLogin | null> => {
    // SQLite doesn't support subqueries in select the same way, so we do two queries
    const [user] = await db
      .select({
        id: UserTable.id,
        name: UserTable.name,
        email: UserTable.email,
        emailVerified: UserTable.emailVerified,
        image: UserTable.image,
        createdAt: UserTable.createdAt,
        updatedAt: UserTable.updatedAt,
        banned: UserTable.banned,
        banReason: UserTable.banReason,
        banExpires: UserTable.banExpires,
      })
      .from(UserTable)
      .where(eq(UserTable.id, userId));

    if (!user) return null;

    // Get last login from sessions
    const [lastLoginResult] = await db
      .select({
        lastLogin: sql<Date | null>`MAX(${SessionTable.expiresAt})`.as(
          "lastLogin",
        ),
      })
      .from(SessionTable)
      .where(eq(SessionTable.userId, userId));

    return {
      ...user,
      createdAt: user.createdAt ?? new Date(),
      updatedAt: user.updatedAt ?? new Date(),
      lastLogin: lastLoginResult?.lastLogin ?? null,
    };
  },

  getUserCount: async () => {
    const [result] = await db.select({ count: count() }).from(UserTable);
    return result?.count ?? 0;
  },

  getUserStats: async (userId: string) => {
    // Calculate last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    thirtyDaysAgo.setHours(0, 0, 0, 0);

    // Get thread and message counts
    const threads = await db
      .select({ id: ChatThreadTable.id })
      .from(ChatThreadTable)
      .where(
        and(
          eq(ChatThreadTable.userId, userId),
          gte(ChatThreadTable.createdAt, thirtyDaysAgo),
        ),
      );

    const threadIds = threads.map((t) => t.id);
    let messageCount = 0;

    if (threadIds.length > 0) {
      const messages = await db
        .select({ count: count() })
        .from(ChatMessageTable)
        .where(
          sql`${ChatMessageTable.threadId} IN (${sql.join(
            threadIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        );
      messageCount = messages[0]?.count ?? 0;
    }

    // For SQLite, we'll return simplified model stats
    // Complex JSON operations would need different handling
    return {
      threadCount: threads.length,
      messageCount,
      modelStats: [],
      totalTokens: 0,
      period: "Last 30 Days",
    };
  },

  getUserAuthMethods: async (userId: string) => {
    const accounts = await db
      .select({
        providerId: AccountTable.providerId,
      })
      .from(AccountTable)
      .where(eq(AccountTable.userId, userId));

    return {
      hasPassword: accounts.some((a) => a.providerId === "credential"),
      oauthProviders: accounts
        .filter((a) => a.providerId !== "credential")
        .map((a) => a.providerId),
    };
  },

  // No-op: Usage tracking removed for local-only desktop app
  getUsageCounts: async (_userId: string, _from: Date, _to: Date) => {
    // Return zeros - no usage tracking in local-only mode
    return {
      image_generation: 0,
      local_execution: 0,
      voice_minutes: 0,
      mcp_tool_call: 0,
      workflow_execution: 0,
    };
  },
};
