import { customModelProvider } from "@/lib/ai/models";
import { getSession } from "lib/auth/server";
import { getCreditsWarnings } from "lib/billing/limit-check";
import { getScheduledDowngrade, getSubscription } from "lib/billing/stripe";
import { type SubscriptionTier, TIER_LIMITS } from "lib/billing/types";
import { subscriptionRepository, userRepository } from "lib/db/repository";

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session?.user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if only warnings are requested (lightweight response for banners)
    const url = new URL(request.url);
    const warningsOnly = url.searchParams.get("warnings") === "true";

    if (warningsOnly) {
      const warningsResult = await getCreditsWarnings(session.user.id);
      return Response.json(warningsResult, {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      });
    }

    const subscription = await subscriptionRepository.getByUserId(
      session.user.id,
    );
    const tier: SubscriptionTier =
      (subscription?.tier as SubscriptionTier) || "free";
    const tierLimits = TIER_LIMITS[tier];

    // Get current billing period (start of current month)
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    // Get usage from UsageEventTable (if billing events are being tracked)
    const usageSummary = await subscriptionRepository.getUsageSummary(
      session.user.id,
      periodStart,
      periodEnd,
    );

    // Also get actual token usage from message metadata (same as user stats)
    // This ensures consistency between billing and user settings
    const userStats = await userRepository.getUserStats(session.user.id);

    // Get actual counts from message metadata for non-token usage
    // This provides accurate counts even if UsageEventTable wasn't populated
    const actualUsageCounts = await userRepository.getUsageCounts(
      session.user.id,
      periodStart,
      periodEnd,
    );

    // Use actual message token data as the primary source for LLM tokens
    // Fall back to usageSummary if userStats returns 0 (e.g., if metadata isn't saved)
    const actualTokenUsage =
      userStats.totalTokens || usageSummary.llm_tokens || 0;

    // Get purchased tokens (one-time token pack purchases)
    const purchasedTokens = Number(subscription?.purchasedTokens || "0");

    // Get credits warnings which includes usage breakdown
    const creditsWarnings = await getCreditsWarnings(session.user.id);

    // Return data in the format the billing dashboard expects
    // Now using unified CREDITS system
    return new Response(
      JSON.stringify({
        // UNIFIED CREDITS USAGE
        credits: {
          used: creditsWarnings.breakdown.totalCredits,
          limit: tierLimits.monthlyCredits + purchasedTokens,
          // Breakdown by service type
          breakdown: creditsWarnings.breakdown,
        },
        // Monthly credit limit
        limits: {
          monthlyCredits: tierLimits.monthlyCredits + purchasedTokens,
        },
        // Legacy usage counts (for backwards compatibility / analytics)
        usage: {
          llm_tokens: actualTokenUsage,
          image_generation:
            actualUsageCounts.image_generation ||
            usageSummary.image_generation ||
            0,
          local_execution:
            actualUsageCounts.local_execution ||
            usageSummary.local_execution ||
            0,
          voice_minutes:
            actualUsageCounts.voice_minutes || usageSummary.voice_minutes || 0,
          mcp_tool_call:
            actualUsageCounts.mcp_tool_call || usageSummary.mcp_tool_call || 0,
          workflow_execution:
            actualUsageCounts.workflow_execution ||
            usageSummary.workflow_execution ||
            0,
        },
        // Purchased credits info for display
        purchasedTokens,
        subscription: await (async () => {
          if (!subscription) {
            return {
              tier: "free",
              status: "active",
              periodEnd: null,
              cancelAtPeriodEnd: false,
              cancelAt: null,
              scheduledDowngrade: null,
              isPaused: false,
            };
          }

          // Check for scheduled downgrade and pause status if there's a Stripe subscription
          let scheduledDowngrade: {
            scheduledTier: string;
            effectiveDate: Date;
          } | null = null;
          let isPaused = false;
          if (subscription.stripeSubscriptionId) {
            try {
              scheduledDowngrade = await getScheduledDowngrade(
                subscription.stripeSubscriptionId,
              );
              // Check if subscription is paused
              const stripeSubscription = await getSubscription(
                subscription.stripeSubscriptionId,
              );
              isPaused =
                stripeSubscription?.pause_collection !== null &&
                stripeSubscription?.pause_collection !== undefined;
            } catch {
              // Subscription may be from test mode - ignore and continue
              // The subscription state in DB is still valid
              console.warn(
                `[Usage] Could not fetch Stripe subscription ${subscription.stripeSubscriptionId} - may be from different mode`,
              );
            }
          }

          return {
            tier: subscription.tier || "free",
            status: subscription.status || "active",
            periodEnd: subscription.currentPeriodEnd?.toISOString(),
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd || false,
            cancelAt: subscription.cancelAt?.toISOString() || null,
            scheduledDowngrade: scheduledDowngrade
              ? {
                  tier: scheduledDowngrade.scheduledTier,
                  effectiveDate: scheduledDowngrade.effectiveDate.toISOString(),
                }
              : null,
            isPaused,
          };
        })(),
        // Real daily usage data from UsageEventTable (for charts)
        dailyUsage: await subscriptionRepository.getDailyUsage(
          session.user.id,
          periodStart,
          periodEnd,
        ),
        // Real per-model usage from UsageEventTable (for charts)
        modelBreakdown: await (async () => {
          const modelUsage = await subscriptionRepository.getModelUsage(
            session.user.id,
            periodStart,
            periodEnd,
          );
          return modelUsage.map((stat) => ({
            model: stat.model,
            provider: customModelProvider.getProviderForModel(stat.model),
            tokens: stat.tokens,
            credits: stat.credits,
            count: stat.count,
          }));
        })(),
        // Include warnings in full response too (already computed above)
        warnings: creditsWarnings,
      }),
      {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      },
    );
  } catch (error: unknown) {
    const err = error as Error;
    console.error("Usage API Error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
