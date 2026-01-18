import { getSession } from "auth/server";
import {
  getSubscription,
  pauseSubscription,
  resumeSubscription,
} from "lib/billing/stripe";
import { csrfErrorResponse, validateCsrfRequest } from "lib/csrf";
import { subscriptionRepository } from "lib/db/repository";

export async function POST(req: Request) {
  try {
    // SECURITY: Validate CSRF token
    const csrfValid = await validateCsrfRequest(req);
    if (!csrfValid) {
      console.warn("[Subscription/Pause] CSRF validation failed");
      return csrfErrorResponse();
    }

    const session = await getSession();
    if (!session?.user?.id) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { action } = (await req.json()) as { action: "pause" | "resume" };

    if (!action || !["pause", "resume"].includes(action)) {
      return Response.json(
        { error: "Invalid action. Must be 'pause' or 'resume'" },
        { status: 400 },
      );
    }

    // Get user's subscription
    const subscription = await subscriptionRepository.getByUserId(
      session.user.id,
    );

    if (!subscription?.stripeSubscriptionId) {
      return Response.json(
        { error: "No active subscription found" },
        { status: 404 },
      );
    }

    // Check if subscription is in a state that allows pause/resume
    if (subscription.tier === "free") {
      return Response.json(
        { error: "Free tier subscriptions cannot be paused" },
        { status: 400 },
      );
    }

    let result;
    if (action === "pause") {
      result = await pauseSubscription(subscription.stripeSubscriptionId);
    } else {
      result = await resumeSubscription(subscription.stripeSubscriptionId);
    }

    if (!result) {
      return Response.json(
        { error: `Failed to ${action} subscription` },
        { status: 500 },
      );
    }

    // Check the pause status from Stripe
    const isPaused = result.pause_collection !== null;

    console.log(
      `[Billing] User ${session.user.id} ${action}d subscription ${subscription.stripeSubscriptionId}`,
    );

    return Response.json({
      success: true,
      action,
      isPaused,
      message:
        action === "pause"
          ? "Subscription paused. You will not be charged until you resume."
          : "Subscription resumed. Billing will continue as normal.",
    });
  } catch (error: unknown) {
    const err = error as Error;
    console.error("[Billing] Pause/Resume error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function GET(_req: Request) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const subscription = await subscriptionRepository.getByUserId(
      session.user.id,
    );

    if (!subscription?.stripeSubscriptionId) {
      return Response.json({ isPaused: false, canPause: false });
    }

    // Get current pause status from Stripe
    const stripeSubscription = await getSubscription(
      subscription.stripeSubscriptionId,
    );

    if (!stripeSubscription) {
      return Response.json({ isPaused: false, canPause: false });
    }

    const isPaused = stripeSubscription.pause_collection !== null;
    const canPause =
      subscription.tier !== "free" && subscription.status === "active";

    return Response.json({
      isPaused,
      canPause,
      pauseDetails: stripeSubscription.pause_collection,
    });
  } catch (error: unknown) {
    const err = error as Error;
    console.error("[Billing] Get pause status error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
