import { getSession } from "lib/auth/server";
import {
  STRIPE_PRICE_IDS,
  cancelSubscription,
  getActiveSubscription,
  scheduleDowngrade,
  stripe,
  updateSubscription,
} from "lib/billing/stripe";
import type { SubscriptionTier } from "lib/billing/types";
import { csrfErrorResponse, validateCsrfRequest } from "lib/csrf";
import { subscriptionRepository } from "lib/db/repository";
import { NextResponse } from "next/server";

interface ProrationPreview {
  currentTier: SubscriptionTier;
  targetTier: SubscriptionTier;
  action: "upgrade" | "downgrade" | "cancel";
  effectiveDate: Date;
  proration: {
    amount: number; // Amount due/credited in cents
    creditForUnused: number; // Credit for remaining time on current plan
    chargeForNew: number; // Charge for new plan (prorated)
  } | null;
  amountDue: number; // Total amount due at change time
  immediateCharge: boolean;
  currentPeriodEnd: Date | null;
}

// Tier order for comparison
const TIER_ORDER: Record<SubscriptionTier, number> = {
  free: 0,
  pro: 1,
  ultra: 2,
};

// Determine action type based on tier change
function determineAction(
  currentTier: SubscriptionTier,
  targetTier: SubscriptionTier,
): "upgrade" | "downgrade" | "cancel" {
  if (targetTier === "free") return "cancel";
  if (TIER_ORDER[targetTier] > TIER_ORDER[currentTier]) return "upgrade";
  return "downgrade";
}

// Get price ID for tier and billing cycle
function getPriceId(
  tier: SubscriptionTier,
  cycle: "monthly" | "annual",
): string {
  if (tier === "pro") {
    return cycle === "annual"
      ? STRIPE_PRICE_IDS.pro_annual
      : STRIPE_PRICE_IDS.pro_monthly;
  }
  return cycle === "annual"
    ? STRIPE_PRICE_IDS.ultra_annual
    : STRIPE_PRICE_IDS.ultra_monthly;
}

// Validate target tier
function isValidTier(tier: string | null): tier is SubscriptionTier {
  return tier !== null && ["free", "pro", "ultra"].includes(tier);
}

/**
 * GET /api/billing/subscription/change
 *
 * Preview a subscription change (upgrade/downgrade)
 * Query params:
 * - targetTier: "pro" | "ultra" | "free"
 * - billingCycle: "monthly" | "annual" (optional, defaults to current)
 */
export async function GET(req: Request) {
  try {
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!stripe.isEnabled()) {
      return NextResponse.json(
        { error: "Billing is not enabled" },
        { status: 400 },
      );
    }

    const { searchParams } = new URL(req.url);
    const targetTier = searchParams.get(
      "targetTier",
    ) as SubscriptionTier | null;
    const billingCycle = searchParams.get("billingCycle") as
      | "monthly"
      | "annual"
      | null;

    if (!isValidTier(targetTier)) {
      return NextResponse.json(
        { error: "Invalid target tier" },
        { status: 400 },
      );
    }

    const subscription = await subscriptionRepository.getByUserId(
      session.user.id,
    );
    if (!subscription?.stripeCustomerId) {
      return NextResponse.json(
        { error: "No billing account found" },
        { status: 400 },
      );
    }

    const currentTier = (subscription.tier || "free") as SubscriptionTier;

    // If trying to change to same tier
    if (currentTier === targetTier) {
      return NextResponse.json(
        { error: "Already on this tier" },
        { status: 400 },
      );
    }

    // Determine action type
    const action = determineAction(currentTier, targetTier);

    // Get current Stripe subscription
    const stripeSubscription = await getActiveSubscription(
      subscription.stripeCustomerId,
    );

    // Build proration preview
    // Use 'any' for Stripe subscription to access runtime properties
    const stripeSub = stripeSubscription as any;
    const preview: ProrationPreview = {
      currentTier,
      targetTier,
      action,
      effectiveDate: new Date(),
      proration: null,
      amountDue: 0,
      immediateCharge: false,
      currentPeriodEnd: stripeSub?.current_period_end
        ? new Date(stripeSub.current_period_end * 1000)
        : null,
    };

    // Handle cancel to free
    if (targetTier === "free") {
      if (!stripeSubscription) {
        return NextResponse.json(
          { error: "No active subscription to cancel" },
          { status: 400 },
        );
      }

      preview.effectiveDate = new Date(stripeSub.current_period_end * 1000);
      preview.immediateCharge = false;

      return NextResponse.json({ preview });
    }

    // Get target price ID
    const currentInterval =
      stripeSubscription?.items.data[0]?.price?.recurring?.interval;
    const cycle: "monthly" | "annual" =
      billingCycle || (currentInterval === "year" ? "annual" : "monthly");
    const targetPriceId = getPriceId(targetTier, cycle);

    if (!targetPriceId) {
      return NextResponse.json(
        { error: "Target pricing not configured" },
        { status: 400 },
      );
    }

    // If user has an active subscription, get proration preview
    if (stripeSubscription) {
      try {
        const client = stripe.getClient();
        if (!client) throw new Error("Stripe not configured");

        // Get upcoming invoice with proration preview
        // Use 'any' for invoices API as types may differ across SDK versions
        const upcomingInvoice = await (client.invoices as any).retrieveUpcoming(
          {
            customer: subscription.stripeCustomerId,
            subscription: stripeSubscription.id,
            subscription_items: [
              {
                id: stripeSubscription.items.data[0].id,
                price: targetPriceId,
              },
            ],
            subscription_proration_behavior:
              action === "upgrade" ? "create_prorations" : "none",
          },
        );

        // Extract proration details
        const prorationLines = upcomingInvoice.lines.data.filter(
          (line) => line.proration,
        );
        const creditForUnused = prorationLines
          .filter((line) => (line.amount || 0) < 0)
          .reduce((sum, line) => sum + Math.abs(line.amount || 0), 0);
        const chargeForNew = prorationLines
          .filter((line) => (line.amount || 0) > 0)
          .reduce((sum, line) => sum + (line.amount || 0), 0);

        preview.proration = {
          amount: upcomingInvoice.amount_due,
          creditForUnused,
          chargeForNew,
        };
        preview.amountDue = upcomingInvoice.amount_due;
        preview.immediateCharge =
          action === "upgrade" && upcomingInvoice.amount_due > 0;

        if (action === "downgrade") {
          preview.effectiveDate = new Date(stripeSub.current_period_end * 1000);
        }
      } catch (previewError: unknown) {
        console.error("[Subscription Change] Preview error:", previewError);
        // Continue with basic preview if proration fails
      }
    }

    return NextResponse.json({ preview });
  } catch (error: unknown) {
    const err = error as Error;
    console.error("[Subscription Change] Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * POST /api/billing/subscription/change
 *
 * Execute a subscription change (upgrade/downgrade/cancel)
 * Body:
 * - targetTier: "pro" | "ultra" | "free"
 * - billingCycle: "monthly" | "annual" (optional)
 * - confirmed: boolean (must be true to proceed)
 */
export async function POST(req: Request) {
  try {
    // SECURITY: Validate CSRF token
    const csrfValid = await validateCsrfRequest(req);
    if (!csrfValid) {
      console.warn("[Subscription Change] CSRF validation failed");
      return csrfErrorResponse();
    }

    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!stripe.isEnabled()) {
      return NextResponse.json(
        { error: "Billing is not enabled" },
        { status: 400 },
      );
    }

    const body = await req.json();
    const { targetTier, billingCycle, confirmed } = body;

    if (!confirmed) {
      return NextResponse.json(
        { error: "Please confirm the subscription change" },
        { status: 400 },
      );
    }

    if (!isValidTier(targetTier)) {
      return NextResponse.json(
        { error: "Invalid target tier" },
        { status: 400 },
      );
    }

    const subscription = await subscriptionRepository.getByUserId(
      session.user.id,
    );
    if (!subscription?.stripeCustomerId) {
      return NextResponse.json(
        { error: "No billing account found" },
        { status: 400 },
      );
    }

    const currentTier = (subscription.tier || "free") as SubscriptionTier;

    if (currentTier === targetTier) {
      return NextResponse.json(
        { error: "Already on this tier" },
        { status: 400 },
      );
    }

    const stripeSubscription = await getActiveSubscription(
      subscription.stripeCustomerId,
    );
    // Use 'any' for Stripe subscription to access runtime properties
    const stripeSubAny = stripeSubscription as any;

    // Determine action
    const action = determineAction(currentTier, targetTier);

    // Handle cancellation (downgrade to free)
    if (targetTier === "free") {
      if (!stripeSubscription) {
        return NextResponse.json(
          { error: "No active subscription to cancel" },
          { status: 400 },
        );
      }

      const canceled = await cancelSubscription(stripeSubscription.id, {
        atPeriodEnd: true,
      });
      if (!canceled) {
        return NextResponse.json(
          { error: "Failed to cancel subscription" },
          { status: 500 },
        );
      }

      console.log(
        `[Subscription Change] Scheduled cancellation for ${stripeSubscription.id} by user ${session.user.id}`,
      );

      return NextResponse.json({
        success: true,
        action: "cancel",
        effectiveDate: new Date(
          stripeSubAny.current_period_end * 1000,
        ).toISOString(),
        message:
          "Your subscription will be canceled at the end of your billing period.",
      });
    }

    // Get target price ID
    const cycle: "monthly" | "annual" = billingCycle || "monthly";
    const targetPriceId = getPriceId(targetTier, cycle);

    if (!targetPriceId) {
      return NextResponse.json(
        { error: "Target pricing not configured" },
        { status: 400 },
      );
    }

    // Handle upgrade (immediate with proration)
    if (action === "upgrade") {
      if (!stripeSubscription) {
        // No existing subscription - redirect to checkout
        return NextResponse.json({
          success: false,
          action: "redirect",
          redirectUrl: `/api/billing/checkout?tier=${targetTier}&cycle=${cycle}`,
          message: "Please complete checkout to subscribe.",
        });
      }

      const updated = await updateSubscription({
        subscriptionId: stripeSubscription.id,
        newPriceId: targetPriceId,
        prorate: true,
      });

      if (!updated) {
        return NextResponse.json(
          { error: "Failed to upgrade subscription" },
          { status: 500 },
        );
      }

      console.log(
        `[Subscription Change] Upgraded ${stripeSubscription.id} to ${targetTier} for user ${session.user.id}`,
      );

      return NextResponse.json({
        success: true,
        action: "upgrade",
        effectiveDate: new Date().toISOString(),
        message: `Your subscription has been upgraded to ${targetTier}. The change is effective immediately.`,
      });
    }

    // Handle downgrade (scheduled for end of period)
    if (action === "downgrade") {
      if (!stripeSubscription) {
        return NextResponse.json(
          { error: "No active subscription to downgrade" },
          { status: 400 },
        );
      }

      const scheduled = await scheduleDowngrade({
        subscriptionId: stripeSubscription.id,
        newPriceId: targetPriceId,
      });

      if (!scheduled) {
        return NextResponse.json(
          { error: "Failed to schedule downgrade" },
          { status: 500 },
        );
      }

      console.log(
        `[Subscription Change] Scheduled downgrade for ${stripeSubscription.id} to ${targetTier} for user ${session.user.id}`,
      );

      return NextResponse.json({
        success: true,
        action: "downgrade",
        effectiveDate: new Date(
          stripeSubAny.current_period_end * 1000,
        ).toISOString(),
        message: `Your subscription will be downgraded to ${targetTier} at the end of your billing period.`,
      });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error: unknown) {
    const err = error as Error;
    console.error("[Subscription Change] Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
