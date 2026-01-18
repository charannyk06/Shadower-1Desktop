import type { SubscriptionTier } from "@/lib/billing/types";
import { and, eq, gte, sql } from "drizzle-orm";
import { pgDb as db } from "../db.pg";
import { SubscriptionTable, UsageEventTable } from "../schema.pg";

type SubscriptionStatus =
  | "active"
  | "canceled"
  | "past_due"
  | "trialing"
  | "incomplete"
  | "incomplete_expired"
  | "unpaid"
  | "paused";

export interface TokenConsumptionResult {
  fromPurchased: number;
  fromSubscription: number;
  purchasedRemaining: number;
}

export interface RemainingTokensResult {
  purchasedTotal: number;
  purchasedUsed: number;
  purchasedRemaining: number;
}

export interface SubscriptionRepository {
  getByUserId(
    userId: string,
  ): Promise<typeof SubscriptionTable.$inferSelect | null>;
  getByStripeCustomerId(
    stripeCustomerId: string,
  ): Promise<typeof SubscriptionTable.$inferSelect | null>;
  upsert(data: {
    userId: string;
    tier?: SubscriptionTier;
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    stripePriceId?: string;
    status?: SubscriptionStatus;
    currentPeriodStart?: Date;
    currentPeriodEnd?: Date;
    cancelAtPeriodEnd?: boolean;
  }): Promise<typeof SubscriptionTable.$inferSelect>;
  updateByStripeSubscriptionId(
    stripeSubscriptionId: string,
    data: Partial<typeof SubscriptionTable.$inferInsert>,
  ): Promise<typeof SubscriptionTable.$inferSelect | null>;
  addPurchasedTokens(
    userId: string,
    tokenCount: string,
  ): Promise<typeof SubscriptionTable.$inferSelect | null>;
  consumeTokens(
    userId: string,
    amount: number,
  ): Promise<TokenConsumptionResult>;
  getRemainingPurchasedTokens(userId: string): Promise<RemainingTokensResult>;
  resetPurchasedTokensUsed(userId: string): Promise<void>;
  deductPurchasedTokens(
    userId: string,
    tokenCount: string,
  ): Promise<typeof SubscriptionTable.$inferSelect | null>;
  recordUsageEvent(data: {
    userId: string;
    eventType: string;
    amount: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
  getUsageSummary(
    userId: string,
    from: Date,
    to: Date,
  ): Promise<Record<string, number>>;
  getAllActive(): Promise<Array<typeof SubscriptionTable.$inferSelect>>;
  getActiveUserIds(): Promise<string[]>;
  getDailyUsage(
    userId: string,
    from: Date,
    to: Date,
  ): Promise<Array<{ date: string; credits: number; tokens: number }>>;
  getModelUsage(
    userId: string,
    from: Date,
    to: Date,
  ): Promise<
    Array<{ model: string; credits: number; tokens: number; count: number }>
  >;
}

export const pgSubscriptionRepository: SubscriptionRepository = {
  async getByUserId(userId: string) {
    const [result] = await db
      .select()
      .from(SubscriptionTable)
      .where(eq(SubscriptionTable.userId, userId));
    return result || null;
  },

  async getByStripeCustomerId(stripeCustomerId: string) {
    const [result] = await db
      .select()
      .from(SubscriptionTable)
      .where(eq(SubscriptionTable.stripeCustomerId, stripeCustomerId));
    return result || null;
  },

  async upsert(data) {
    const existing = await this.getByUserId(data.userId);

    if (existing) {
      const [result] = await db
        .update(SubscriptionTable)
        .set({
          ...data,
          updatedAt: new Date(),
        })
        .where(eq(SubscriptionTable.userId, data.userId))
        .returning();
      return result;
    }

    const [result] = await db
      .insert(SubscriptionTable)
      .values({
        userId: data.userId,
        tier: data.tier || "free",
        stripeCustomerId: data.stripeCustomerId,
        stripeSubscriptionId: data.stripeSubscriptionId,
        stripePriceId: data.stripePriceId,
        status: (data.status as any) || "active",
        currentPeriodStart: data.currentPeriodStart,
        currentPeriodEnd: data.currentPeriodEnd,
        cancelAtPeriodEnd: data.cancelAtPeriodEnd,
      })
      .returning();
    return result;
  },

  async updateByStripeSubscriptionId(stripeSubscriptionId, data) {
    const [result] = await db
      .update(SubscriptionTable)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(SubscriptionTable.stripeSubscriptionId, stripeSubscriptionId))
      .returning();
    return result || null;
  },

  async addPurchasedTokens(userId: string, tokenCount: string) {
    // First get current purchased tokens
    const existing = await this.getByUserId(userId);
    if (!existing) {
      // Create subscription record if it doesn't exist
      const [result] = await db
        .insert(SubscriptionTable)
        .values({
          userId,
          tier: "free",
          purchasedTokens: tokenCount,
        })
        .returning();
      return result;
    }

    // Add to existing purchased tokens
    const currentTokens = BigInt(existing.purchasedTokens || "0");
    const newTokens = currentTokens + BigInt(tokenCount);

    const [result] = await db
      .update(SubscriptionTable)
      .set({
        purchasedTokens: newTokens.toString(),
        updatedAt: new Date(),
      })
      .where(eq(SubscriptionTable.userId, userId))
      .returning();
    return result || null;
  },

  async consumeTokens(
    userId: string,
    amount: number,
  ): Promise<TokenConsumptionResult> {
    // Get current subscription state
    const subscription = await this.getByUserId(userId);

    if (!subscription) {
      // No subscription, all goes to subscription usage (which will hit limit)
      return {
        fromPurchased: 0,
        fromSubscription: amount,
        purchasedRemaining: 0,
      };
    }

    const purchasedTotal = Number(subscription.purchasedTokens || "0");
    const purchasedUsed = Number(subscription.purchasedTokensUsed || "0");
    const purchasedRemaining = Math.max(0, purchasedTotal - purchasedUsed);

    // Calculate how much comes from purchased vs subscription
    let fromPurchased = 0;
    let fromSubscription = 0;

    if (purchasedRemaining > 0) {
      // Consume from purchased tokens first
      fromPurchased = Math.min(amount, purchasedRemaining);
      fromSubscription = amount - fromPurchased;

      // Update purchased tokens used
      const newPurchasedUsed = purchasedUsed + fromPurchased;
      await db
        .update(SubscriptionTable)
        .set({
          purchasedTokensUsed: newPurchasedUsed.toString(),
          updatedAt: new Date(),
        })
        .where(eq(SubscriptionTable.userId, userId));
    } else {
      // No purchased tokens remaining, all goes to subscription
      fromSubscription = amount;
    }

    return {
      fromPurchased,
      fromSubscription,
      purchasedRemaining: purchasedRemaining - fromPurchased,
    };
  },

  async getRemainingPurchasedTokens(
    userId: string,
  ): Promise<RemainingTokensResult> {
    const subscription = await this.getByUserId(userId);

    if (!subscription) {
      return {
        purchasedTotal: 0,
        purchasedUsed: 0,
        purchasedRemaining: 0,
      };
    }

    const purchasedTotal = Number(subscription.purchasedTokens || "0");
    const purchasedUsed = Number(subscription.purchasedTokensUsed || "0");

    return {
      purchasedTotal,
      purchasedUsed,
      purchasedRemaining: Math.max(0, purchasedTotal - purchasedUsed),
    };
  },

  async resetPurchasedTokensUsed(userId: string): Promise<void> {
    await db
      .update(SubscriptionTable)
      .set({
        purchasedTokensUsed: "0",
        updatedAt: new Date(),
      })
      .where(eq(SubscriptionTable.userId, userId));
  },

  async deductPurchasedTokens(userId: string, tokenCount: string) {
    const existing = await this.getByUserId(userId);
    if (!existing) {
      return null;
    }

    // Deduct from purchased tokens (floor at 0)
    const currentTokens = BigInt(existing.purchasedTokens || "0");
    const deduction = BigInt(tokenCount);
    const newTokens =
      currentTokens > deduction ? currentTokens - deduction : BigInt(0);

    const [result] = await db
      .update(SubscriptionTable)
      .set({
        purchasedTokens: newTokens.toString(),
        updatedAt: new Date(),
      })
      .where(eq(SubscriptionTable.userId, userId))
      .returning();

    console.log(
      `[Billing] Deducted ${tokenCount} tokens from user ${userId}. New balance: ${newTokens}`,
    );
    return result || null;
  },

  async recordUsageEvent(data) {
    await db.insert(UsageEventTable).values({
      userId: data.userId,
      eventType: data.eventType as any,
      amount: data.amount,
      metadata: data.metadata,
    });
  },

  async getUsageSummary(userId: string, from: Date, to: Date) {
    // Get raw usage counts grouped by event type
    // When creditsConsumed is missing from metadata (old events), calculate fallback:
    // - llm_tokens: use amount as credits (assumes 1x multiplier as fallback)
    // - Fixed services: use the standard credit costs
    // Credit costs (verified Jan 2026): sandbox=425, mcp=250, workflow=1250, composio=75, voice=75000/min, image=10000, web_search=1500
    const results = await db
      .select({
        eventType: UsageEventTable.eventType,
        total: sql<string>`SUM(${UsageEventTable.amount}::numeric)`,
        // Sum credits from metadata.creditsConsumed field with fallback calculation
        totalCredits: sql<string>`
          SUM(
            COALESCE(
              (${UsageEventTable.metadata}->>'creditsConsumed')::numeric,
              CASE ${UsageEventTable.eventType}
                WHEN 'llm_tokens' THEN ${UsageEventTable.amount}::numeric
                WHEN 'sandbox_execution' THEN 425
                WHEN 'mcp_tool_call' THEN 250
                WHEN 'workflow_execution' THEN 1250
                WHEN 'composio_action' THEN 75
                WHEN 'voice_minutes' THEN ${UsageEventTable.amount}::numeric * 75000
                WHEN 'image_generation' THEN 10000
                WHEN 'web_search' THEN 1500
                ELSE 0
              END
            )
          )
        `,
        // Sum ONLY expensive model credits (multiplier >= 6)
        // This is used for daily expensive model limit checks
        expensiveCredits: sql<string>`
          SUM(
            CASE
              WHEN ${UsageEventTable.eventType} = 'llm_tokens'
                   AND COALESCE((${UsageEventTable.metadata}->>'multiplier')::numeric, 2) >= 6
              THEN COALESCE(
                (${UsageEventTable.metadata}->>'creditsConsumed')::numeric,
                ${UsageEventTable.amount}::numeric
              )
              ELSE 0
            END
          )
        `,
      })
      .from(UsageEventTable)
      .where(
        and(
          eq(UsageEventTable.userId, userId),
          gte(UsageEventTable.createdAt, from),
          sql`${UsageEventTable.createdAt} < ${to}`,
        ),
      )
      .groupBy(UsageEventTable.eventType);

    const summary: Record<string, number> = {};
    let totalCredits = 0;
    let totalExpensiveCredits = 0;

    for (const row of results) {
      // Raw amounts by event type
      summary[row.eventType] = Number(row.total) || 0;

      // Credits by service type (for breakdown display)
      const credits = Number(row.totalCredits) || 0;
      totalCredits += credits;

      // Track expensive model credits separately
      const expensiveCredits = Number(row.expensiveCredits) || 0;
      totalExpensiveCredits += expensiveCredits;

      // Map event types to credit breakdown keys
      switch (row.eventType) {
        case "llm_tokens":
          summary.token_credits = (summary.token_credits || 0) + credits;
          break;
        case "image_generation":
          summary.image_credits = (summary.image_credits || 0) + credits;
          break;
        case "voice_minutes":
          summary.voice_credits = (summary.voice_credits || 0) + credits;
          break;
        case "sandbox_execution":
          summary.sandbox_credits = (summary.sandbox_credits || 0) + credits;
          break;
        case "mcp_tool_call":
          summary.mcp_credits = (summary.mcp_credits || 0) + credits;
          break;
        case "workflow_execution":
          summary.workflow_credits = (summary.workflow_credits || 0) + credits;
          break;
        case "composio_action":
          summary.composio_credits = (summary.composio_credits || 0) + credits;
          break;
        case "web_search":
          summary.web_search_credits =
            (summary.web_search_credits || 0) + credits;
          break;
      }
    }

    // Add total credits to summary
    summary.total_credits = totalCredits;
    // Add expensive model credits (for daily expensive limit checks)
    summary.expensive_credits = totalExpensiveCredits;

    return summary;
  },

  async getAllActive() {
    const results = await db
      .select()
      .from(SubscriptionTable)
      .where(eq(SubscriptionTable.status, "active"));
    return results;
  },

  async getActiveUserIds(): Promise<string[]> {
    // Get users who have either:
    // 1. An active subscription
    // 2. Any usage events in the current billing period
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const results = await db
      .selectDistinct({ userId: UsageEventTable.userId })
      .from(UsageEventTable)
      .where(gte(UsageEventTable.createdAt, startOfMonth));

    return results.map((r) => r.userId);
  },

  async getDailyUsage(userId: string, from: Date, to: Date) {
    // Get daily breakdown of credits and tokens used
    const results = await db
      .select({
        date: sql<string>`DATE(${UsageEventTable.createdAt})::text`,
        credits: sql<string>`SUM(
          COALESCE(
            (${UsageEventTable.metadata}->>'creditsConsumed')::numeric,
            CASE ${UsageEventTable.eventType}
              WHEN 'llm_tokens' THEN ${UsageEventTable.amount}::numeric
              WHEN 'sandbox_execution' THEN 425
              WHEN 'mcp_tool_call' THEN 250
              WHEN 'workflow_execution' THEN 1250
              WHEN 'composio_action' THEN 75
              WHEN 'voice_minutes' THEN ${UsageEventTable.amount}::numeric * 75000
              WHEN 'image_generation' THEN 10000
              WHEN 'web_search' THEN 1500
              ELSE 0
            END
          )
        )`,
        tokens: sql<string>`SUM(
          CASE WHEN ${UsageEventTable.eventType} = 'llm_tokens'
            THEN ${UsageEventTable.amount}::numeric
            ELSE 0
          END
        )`,
      })
      .from(UsageEventTable)
      .where(
        and(
          eq(UsageEventTable.userId, userId),
          gte(UsageEventTable.createdAt, from),
          sql`${UsageEventTable.createdAt} < ${to}`,
        ),
      )
      .groupBy(sql`DATE(${UsageEventTable.createdAt})`)
      .orderBy(sql`DATE(${UsageEventTable.createdAt})`);

    return results.map((row) => ({
      date: row.date,
      credits: Number(row.credits) || 0,
      tokens: Number(row.tokens) || 0,
    }));
  },

  async getModelUsage(userId: string, from: Date, to: Date) {
    // Get per-model breakdown of usage from LLM token events
    const results = await db
      .select({
        model: sql<string>`COALESCE(${UsageEventTable.metadata}->>'model', 'unknown')`,
        credits: sql<string>`SUM(
          COALESCE(
            (${UsageEventTable.metadata}->>'creditsConsumed')::numeric,
            ${UsageEventTable.amount}::numeric
          )
        )`,
        tokens: sql<string>`SUM(${UsageEventTable.amount}::numeric)`,
        count: sql<string>`COUNT(*)`,
      })
      .from(UsageEventTable)
      .where(
        and(
          eq(UsageEventTable.userId, userId),
          eq(UsageEventTable.eventType, "llm_tokens"),
          gte(UsageEventTable.createdAt, from),
          sql`${UsageEventTable.createdAt} < ${to}`,
        ),
      )
      .groupBy(sql`${UsageEventTable.metadata}->>'model'`)
      .orderBy(sql`SUM(${UsageEventTable.amount}::numeric) DESC`)
      .limit(10);

    return results.map((row) => ({
      model: row.model || "unknown",
      credits: Number(row.credits) || 0,
      tokens: Number(row.tokens) || 0,
      count: Number(row.count) || 0,
    }));
  },
};
