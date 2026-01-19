import {
  BasicUserWithLastLogin,
  User,
  UserPreferences,
  UserRepository,
} from "app-types/user";
import { and, count, eq, gte, lt, sql } from "drizzle-orm";
import { sqliteDb as db } from "../db.sqlite";
import {
  AccountTable,
  ChatMessageTable,
  ChatThreadTable,
  SessionTable,
  UsageEventTable,
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
      referralCode: null,
      referredById: null,
      totalReferrals: 0,
      totalReferralBonus: "0",
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
      referralCode: null,
      referredById: null,
      totalReferrals: 0,
      totalReferralBonus: "0",
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
        role: UserTable.role,
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

  getUsageCounts: async (userId: string, from: Date, to: Date) => {
    const defaultCounts = {
      image_generation: 0,
      sandbox_execution: 0,
      voice_minutes: 0,
      mcp_tool_call: 0,
      workflow_execution: 0,
    };

    try {
      // Query usage events from the usage_event table
      const usageResults = await db
        .select({
          eventType: UsageEventTable.eventType,
          total: sql<number>`COALESCE(SUM(CAST(${UsageEventTable.amount} AS INTEGER)), 0)`,
        })
        .from(UsageEventTable)
        .where(
          and(
            eq(UsageEventTable.userId, userId),
            gte(UsageEventTable.createdAt, from),
            lt(UsageEventTable.createdAt, to),
          ),
        )
        .groupBy(UsageEventTable.eventType);

      const eventCounts: Record<string, number> = {};
      for (const row of usageResults) {
        eventCounts[row.eventType] = Number(row.total) || 0;
      }

      return {
        image_generation: eventCounts.image_generation || 0,
        sandbox_execution: eventCounts.sandbox_execution || 0,
        voice_minutes: eventCounts.voice_minutes || 0,
        mcp_tool_call: eventCounts.mcp_tool_call || 0,
        workflow_execution: eventCounts.workflow_execution || 0,
      };
    } catch (error) {
      console.error("[SQLite] getUsageCounts error:", error);
      return defaultCounts;
    }
  },
};
