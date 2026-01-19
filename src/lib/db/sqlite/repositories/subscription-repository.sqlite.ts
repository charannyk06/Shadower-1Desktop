import { and, eq, gte, sql } from "drizzle-orm";
import { sqliteDb as db } from "../db.sqlite";
import { SubscriptionTable, UsageEventTable } from "../schema.sqlite";

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
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    stripePriceId?: string;
    tier?: "free" | "pro" | "ultra";
    status?: SubscriptionStatus;
    currentPeriodStart?: Date;
    currentPeriodEnd?: Date;
    cancelAtPeriodEnd?: boolean;
  }): Promise<typeof SubscriptionTable.$inferSelect>;
  updateByStripeSubscriptionId(
    stripeSubscriptionId: string,
    data: Partial<typeof SubscriptionTable.$inferInsert>,
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
  addPurchasedTokens(
    userId: string,
    tokenCount: string | number,
  ): Promise<void>;
  deductPurchasedTokens(
    userId: string,
    tokenCount: string | number,
  ): Promise<void>;
  consumeTokens(
    userId: string,
    amount: number,
  ): Promise<{
    fromPurchased: number;
    fromSubscription: number;
    purchasedRemaining: number;
  }>;
}

export const sqliteSubscriptionRepository: SubscriptionRepository = {
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
        stripeCustomerId: data.stripeCustomerId,
        stripeSubscriptionId: data.stripeSubscriptionId,
        stripePriceId: data.stripePriceId,
        tier: (data.tier as any) || "free",
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

  async recordUsageEvent(data) {
    await db.insert(UsageEventTable).values({
      userId: data.userId,
      eventType:
        data.eventType as (typeof UsageEventTable.$inferInsert)["eventType"],
      amount: data.amount || "1",
      metadata: data.metadata,
    });
  },

  async getUsageSummary(userId: string, from: Date, to: Date) {
    const results = await db
      .select({
        eventType: UsageEventTable.eventType,
        total: sql<number>`SUM(CAST(${UsageEventTable.amount} AS INTEGER))`,
      })
      .from(UsageEventTable)
      .where(
        and(
          eq(UsageEventTable.userId, userId),
          gte(UsageEventTable.createdAt, from),
          sql`${UsageEventTable.createdAt} < ${to.getTime()}`,
        ),
      )
      .groupBy(UsageEventTable.eventType);

    const summary: Record<string, number> = {};
    for (const row of results) {
      summary[row.eventType] = Number(row.total) || 0;
    }

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
    // SQLite date functions are different
    const results = await db
      .select({
        date: sql<string>`date(${UsageEventTable.createdAt})`,
        credits: sql<number>`SUM(CAST(${UsageEventTable.amount} AS INTEGER))`,
        tokens: sql<number>`SUM(CASE WHEN ${UsageEventTable.eventType} = 'llm_tokens' THEN CAST(${UsageEventTable.amount} AS INTEGER) ELSE 0 END)`,
      })
      .from(UsageEventTable)
      .where(
        and(
          eq(UsageEventTable.userId, userId),
          gte(UsageEventTable.createdAt, from),
          sql`${UsageEventTable.createdAt} < ${to.getTime()}`,
        ),
      )
      .groupBy(sql`date(${UsageEventTable.createdAt})`)
      .orderBy(sql`date(${UsageEventTable.createdAt})`);

    return results.map((row) => ({
      date: row.date,
      credits: Number(row.credits) || 0,
      tokens: Number(row.tokens) || 0,
    }));
  },

  async getModelUsage(userId: string, from: Date, to: Date) {
    // For SQLite, we need to use json_extract for JSON field access
    const results = await db
      .select({
        model: sql<string>`COALESCE(json_extract(${UsageEventTable.metadata}, '$.model'), 'unknown')`,
        credits: sql<number>`SUM(CAST(${UsageEventTable.amount} AS INTEGER))`,
        tokens: sql<number>`SUM(CAST(${UsageEventTable.amount} AS INTEGER))`,
        count: sql<number>`COUNT(*)`,
      })
      .from(UsageEventTable)
      .where(
        and(
          eq(UsageEventTable.userId, userId),
          eq(UsageEventTable.eventType, "llm_tokens"),
          gte(UsageEventTable.createdAt, from),
          sql`${UsageEventTable.createdAt} < ${to.getTime()}`,
        ),
      )
      .groupBy(sql`json_extract(${UsageEventTable.metadata}, '$.model')`)
      .orderBy(sql`SUM(CAST(${UsageEventTable.amount} AS INTEGER)) DESC`)
      .limit(10);

    return results.map((row) => ({
      model: row.model || "unknown",
      credits: Number(row.credits) || 0,
      tokens: Number(row.tokens) || 0,
      count: Number(row.count) || 0,
    }));
  },

  async addPurchasedTokens(userId: string, tokenCount: string | number) {
    const existing = await this.getByUserId(userId);
    if (existing) {
      const currentTokens = Number(existing.purchasedTokens || "0");
      const tokensToAdd =
        typeof tokenCount === "string" ? Number(tokenCount) : tokenCount;
      await db
        .update(SubscriptionTable)
        .set({
          purchasedTokens: String(currentTokens + tokensToAdd),
          updatedAt: new Date(),
        })
        .where(eq(SubscriptionTable.userId, userId));
    }
  },

  async deductPurchasedTokens(userId: string, tokenCount: string | number) {
    const existing = await this.getByUserId(userId);
    if (existing) {
      const currentTokens = Number(existing.purchasedTokens || "0");
      const tokensToDeduct =
        typeof tokenCount === "string" ? Number(tokenCount) : tokenCount;
      await db
        .update(SubscriptionTable)
        .set({
          purchasedTokens: String(Math.max(0, currentTokens - tokensToDeduct)),
          updatedAt: new Date(),
        })
        .where(eq(SubscriptionTable.userId, userId));
    }
  },

  async consumeTokens(userId: string, amount: number) {
    const existing = await this.getByUserId(userId);
    const purchasedTokens = Number(existing?.purchasedTokens || "0");
    const usedPurchased = Number(existing?.purchasedTokensUsed || "0");
    const purchasedRemaining = Math.max(0, purchasedTokens - usedPurchased);

    // In local-first mode, consume from purchased first, then subscription
    const fromPurchased = Math.min(amount, purchasedRemaining);
    const fromSubscription = amount - fromPurchased;

    if (fromPurchased > 0 && existing) {
      await db
        .update(SubscriptionTable)
        .set({
          purchasedTokensUsed: String(usedPurchased + fromPurchased),
          updatedAt: new Date(),
        })
        .where(eq(SubscriptionTable.userId, userId));
    }

    return {
      fromPurchased,
      fromSubscription,
      purchasedRemaining: purchasedRemaining - fromPurchased,
    };
  },
};
