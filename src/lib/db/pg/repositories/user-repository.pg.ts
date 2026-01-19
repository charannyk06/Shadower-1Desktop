import {
  BasicUserWithLastLogin,
  User,
  UserPreferences,
  UserRepository,
} from "app-types/user";
import { and, count, eq, getTableColumns, gte, lt, sql } from "drizzle-orm";
import { pgDb as db, pgDb } from "../db.pg";
import {
  AccountTable,
  ChatMessageTable,
  ChatThreadTable,
  SessionTable,
  UsageEventTable,
  UserTable,
} from "../schema.pg";

// Helper function to get user columns without password
const getUserColumnsWithoutPassword = () => {
  const { password, ...userColumns } = getTableColumns(UserTable);
  return userColumns;
};

export const pgUserRepository: UserRepository = {
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
      preferences: result.preferences,
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
    const [result] = await pgDb
      .select({
        ...getUserColumnsWithoutPassword(),
        lastLogin: sql<Date | null>`(
          SELECT MAX(${SessionTable.updatedAt}) 
          FROM ${SessionTable} 
          WHERE ${SessionTable.userId} = ${UserTable.id}
        )`.as("lastLogin"),
      })
      .from(UserTable)
      .where(eq(UserTable.id, userId));

    return result || null;
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

    // Get thread and message counts for the same 30-day period
    const [result] = await db
      .select({
        threadCount: sql<number>`COALESCE(COUNT(DISTINCT ${ChatThreadTable.id}), 0)`,
        messageCount: sql<number>`COALESCE(COUNT(${ChatMessageTable.id}), 0)`,
      })
      .from(ChatThreadTable)
      .leftJoin(
        ChatMessageTable,
        eq(ChatThreadTable.id, ChatMessageTable.threadId),
      )
      .where(
        sql`${ChatThreadTable.userId} = ${userId} AND ${ChatThreadTable.createdAt} >= ${thirtyDaysAgo}`,
      );

    const modelStats = await db
      .select({
        model: sql<string>`${ChatMessageTable.metadata}->'chatModel'->>'model'`,
        messageCount: count(ChatMessageTable.id),
        // Extract usage tokens from metadata
        totalTokens: sql<number>`COALESCE(SUM((${ChatMessageTable.metadata}->'usage'->>'totalTokens')::numeric), 0)`,
      })
      .from(ChatMessageTable)
      .leftJoin(
        ChatThreadTable,
        eq(ChatMessageTable.threadId, ChatThreadTable.id),
      )
      .where(
        sql`${ChatThreadTable.userId} = ${userId} 
            AND ${ChatMessageTable.createdAt} >= ${thirtyDaysAgo}
            AND ${ChatMessageTable.metadata} IS NOT NULL
            AND ${ChatMessageTable.metadata}->'chatModel'->>'model' IS NOT NULL`,
      )
      .groupBy(sql`${ChatMessageTable.metadata}->'chatModel'->>'model'`)
      .orderBy(
        sql`SUM((${ChatMessageTable.metadata}->'usage'->>'totalTokens')::numeric) DESC`,
      )
      .limit(10); // Get top 10 models by token usage

    const totalTokens = modelStats.reduce(
      (acc, curr) => acc + Number(curr.totalTokens || 0),
      0,
    );

    return {
      threadCount: result?.threadCount || 0,
      messageCount: result?.messageCount || 0,
      modelStats: modelStats.map((stat) => ({
        ...stat,
        totalTokens: Number(stat.totalTokens || 0),
      })),
      totalTokens,
      period: "Last 30 Days",
    };
  },
  getUserAuthMethods: async (userId: string) => {
    const accounts = await pgDb
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
      // Query tool invocations from message history
      // This counts actual tool usage from message parts
      // Note: parts is a json[] (PostgreSQL array of json elements)
      // The tool name is embedded in the type field as "tool-{toolname}"

      const toolUsageQuery = await db.execute(sql`
        SELECT
          SUBSTRING(part ->> 'type' FROM 6) as tool_name,
          COUNT(*) as count
        FROM chat_message cm
        JOIN chat_thread ct ON cm.thread_id = ct.id
        CROSS JOIN LATERAL unnest(cm.parts) AS part
        WHERE ct.user_id = ${userId}
          AND cm.created_at >= ${from}
          AND cm.created_at < ${to}
          AND cm.role = 'assistant'
          AND (part ->> 'type') LIKE 'tool-%'
        GROUP BY tool_name
      `);

      // Debug: console.log("[getUsageCounts] Tool names found:", toolUsageQuery.rows);

      // Map tool names to usage types
      let sandboxCount = 0;
      let imageCount = 0;
      let workflowCount = 0;
      let mcpToolCount = 0;

      const rows = toolUsageQuery.rows as Array<{
        tool_name: string;
        count: string;
      }>;

      for (const row of rows) {
        const toolName = row.tool_name;
        const count = Number.parseInt(row.count, 10) || 0;

        // Sandbox execution tools
        if (
          toolName === "python-execution" ||
          toolName === "mini-javascript-execution"
        ) {
          sandboxCount += count;
        }
        // Image generation
        else if (toolName === "image-manager") {
          imageCount += count;
        }
        // Workflow executions (workflow tools start with "workflow_")
        else if (toolName.startsWith("workflow_")) {
          workflowCount += count;
        }
        // MCP tools (contain "::" which is the MCP tool ID separator)
        else if (toolName.includes("::")) {
          mcpToolCount += count;
        }
      }

      console.log("[getUsageCounts] Tool usage from messages:", {
        sandbox: sandboxCount,
        image: imageCount,
        workflow: workflowCount,
        mcp: mcpToolCount,
      });

      // Also check UsageEventTable for any events recorded there
      const usageResults = await db
        .select({
          eventType: UsageEventTable.eventType,
          total: sql<string>`COALESCE(SUM(${UsageEventTable.amount}::numeric), 0)`,
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

      // Use the higher of message-based or event-based counts
      return {
        image_generation: Math.max(
          imageCount,
          eventCounts.image_generation || 0,
        ),
        sandbox_execution: Math.max(
          sandboxCount,
          eventCounts.sandbox_execution || 0,
        ),
        voice_minutes: eventCounts.voice_minutes || 0, // Voice is only tracked via events
        mcp_tool_call: Math.max(mcpToolCount, eventCounts.mcp_tool_call || 0),
        workflow_execution: Math.max(
          workflowCount,
          eventCounts.workflow_execution || 0,
        ),
      };
    } catch (error) {
      console.error("[getUsageCounts] Error querying usage:", error);
      return defaultCounts;
    }
  },
};
