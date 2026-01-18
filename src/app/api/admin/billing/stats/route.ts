import { requireAdminPermission } from "auth/permissions";
import { and, count, eq, gte, sql } from "drizzle-orm";
import { getSession } from "lib/auth/server";
import { getMonthlyPrice } from "lib/billing/pricing";
import type { SubscriptionTier } from "lib/billing/types";
import { pgDb as db } from "lib/db/pg/db.pg";
import { SubscriptionTable, UsageEventTable } from "lib/db/pg/schema.pg";
import { promoCodeRepository } from "lib/db/repository";
import { NextResponse } from "next/server";

/**
 * GET /api/admin/billing/stats
 *
 * Returns billing statistics for the admin dashboard.
 */
export async function GET() {
  try {
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      await requireAdminPermission();
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Get current date info
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Get subscription counts by tier
    const subscriptionsByTier = await db
      .select({
        tier: SubscriptionTable.tier,
        count: count(),
      })
      .from(SubscriptionTable)
      .where(eq(SubscriptionTable.status, "active"))
      .groupBy(SubscriptionTable.tier);

    const tierCounts: Record<SubscriptionTier, number> = {
      free: 0,
      pro: 0,
      ultra: 0,
    };

    for (const row of subscriptionsByTier) {
      if (row.tier && row.tier in tierCounts) {
        tierCounts[row.tier as SubscriptionTier] = Number(row.count);
      }
    }

    // Calculate MRR (Monthly Recurring Revenue) using centralized pricing
    const mrr =
      tierCounts.pro * getMonthlyPrice("pro") +
      tierCounts.ultra * getMonthlyPrice("ultra");

    // Get total subscriptions
    const totalActiveSubscriptions = tierCounts.pro + tierCounts.ultra;

    // Get usage stats for current month
    const usageStats = await db
      .select({
        totalCredits: sql<string>`SUM(
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
        eventCount: count(),
      })
      .from(UsageEventTable)
      .where(gte(UsageEventTable.createdAt, startOfMonth));

    const totalCreditsThisMonth = Number(usageStats[0]?.totalCredits || 0);
    const totalEventsThisMonth = Number(usageStats[0]?.eventCount || 0);

    // Get promo code stats
    const allPromoCodes = await promoCodeRepository.getAll();
    const activePromoCodes = allPromoCodes.filter((code) => code.isActive);
    const totalRedemptions = allPromoCodes.reduce(
      (sum, code) => sum + Number(code.currentRedemptions || 0),
      0,
    );

    // Get canceled subscriptions this month (churn)
    const canceledThisMonth = await db
      .select({ count: count() })
      .from(SubscriptionTable)
      .where(
        and(
          eq(SubscriptionTable.status, "canceled"),
          gte(SubscriptionTable.updatedAt, startOfMonth),
        ),
      );

    const churnCount = Number(canceledThisMonth[0]?.count || 0);
    const churnRate =
      totalActiveSubscriptions > 0
        ? (churnCount / (totalActiveSubscriptions + churnCount)) * 100
        : 0;

    return NextResponse.json({
      stats: {
        // Revenue
        mrr,
        mrrFormatted: `$${(mrr / 100).toFixed(2)}`,
        arr: mrr * 12,
        arrFormatted: `$${((mrr * 12) / 100).toFixed(2)}`,

        // Subscriptions
        subscriptions: {
          total: totalActiveSubscriptions,
          free: tierCounts.free,
          pro: tierCounts.pro,
          ultra: tierCounts.ultra,
        },

        // Churn
        churn: {
          count: churnCount,
          rate: churnRate.toFixed(2),
        },

        // Usage
        usage: {
          totalCreditsThisMonth,
          totalEventsThisMonth,
          creditsFormatted: `${(totalCreditsThisMonth / 1_000_000).toFixed(2)}M`,
        },

        // Promo codes
        promoCodes: {
          total: allPromoCodes.length,
          active: activePromoCodes.length,
          totalRedemptions,
        },
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (error: unknown) {
    const err = error as Error;
    console.error("[Admin Billing Stats] Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
