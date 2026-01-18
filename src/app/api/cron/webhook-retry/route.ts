import { validateCronAuth } from "@/lib/cron/auth";
import { webhookRetryRepository } from "lib/db/repository";
import { NextResponse } from "next/server";
import type Stripe from "stripe";

// Import the processWebhookEvent function from the webhook route
// We'll need to make it available or duplicate the logic here
// For now, we'll re-process using the same handlers

/**
 * Cron job endpoint for processing failed webhook retries
 * Should be called every 1-5 minutes by a cron service (e.g., Vercel Cron)
 *
 * Configure in vercel.json:
 * {
 *   "crons": [{
 *     "path": "/api/cron/webhook-retry",
 *     "schedule": "* * * * *"
 *   }]
 * }
 */
export async function GET(req: Request) {
  const authError = validateCronAuth(req, "WebhookRetry");
  if (authError) return authError;

  try {
    const stats = await webhookRetryRepository.getStats();
    console.log(
      `[WebhookRetry Cron] Starting - Pending: ${stats.pending}, Dead Letter: ${stats.deadLetter}`,
    );

    // Get pending entries ready for retry
    const pendingEntries = await webhookRetryRepository.getPendingForRetry(10);

    if (pendingEntries.length === 0) {
      return NextResponse.json({
        processed: 0,
        message: "No pending retries",
        stats,
      });
    }

    let succeeded = 0;
    let failed = 0;
    let deadLettered = 0;

    for (const entry of pendingEntries) {
      // Mark as processing to prevent duplicate processing
      const acquired = await webhookRetryRepository.markAsProcessing(entry.id);
      if (!acquired) {
        console.log(
          `[WebhookRetry Cron] Entry ${entry.id} already being processed, skipping`,
        );
        continue;
      }

      try {
        // Re-process the event
        await processRetryEvent(entry.eventType, entry.payload);

        // Mark as succeeded
        await webhookRetryRepository.markAsSucceeded(entry.id);
        succeeded++;
        console.log(
          `[WebhookRetry Cron] Successfully retried event ${entry.eventId}`,
        );
      } catch (retryError: unknown) {
        // Record the failed retry
        const hasRetriesLeft = await webhookRetryRepository.recordFailedRetry(
          entry.id,
          (retryError as Error).message || "Unknown error",
        );

        if (hasRetriesLeft) {
          failed++;
          console.log(
            `[WebhookRetry Cron] Event ${entry.eventId} failed, will retry later`,
          );
        } else {
          deadLettered++;
          console.error(
            `[WebhookRetry Cron] Event ${entry.eventId} moved to dead letter after max retries`,
          );
          // TODO: Send admin notification
        }
      }
    }

    const updatedStats = await webhookRetryRepository.getStats();

    return NextResponse.json({
      processed: pendingEntries.length,
      succeeded,
      failed,
      deadLettered,
      stats: updatedStats,
    });
  } catch (error: unknown) {
    const err = error as Error;
    console.error("[WebhookRetry Cron] Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// Helper to extract customer ID from Stripe object
function extractCustomerId(customer: unknown): string | undefined {
  if (!customer) return undefined;
  return typeof customer === "string" ? customer : (customer as any)?.id;
}

// Helper to extract subscription ID from Stripe object
function extractSubscriptionId(subscription: unknown): string | undefined {
  if (!subscription) return undefined;
  return typeof subscription === "string"
    ? subscription
    : (subscription as any)?.id;
}

// Handle checkout.session.completed retry
async function handleCheckoutSessionRetry(
  session: Stripe.Checkout.Session,
  subscriptionRepository: any,
): Promise<void> {
  // Handle subscription checkout
  if (session.mode === "subscription" && session.subscription) {
    const subscriptionId = extractSubscriptionId(session.subscription);
    const customerId = extractCustomerId(session.customer);

    if (customerId && subscriptionId) {
      const existingSub =
        await subscriptionRepository.getByStripeCustomerId(customerId);
      if (existingSub) {
        await subscriptionRepository.upsert({
          userId: existingSub.userId,
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
        });
        console.log(
          `[WebhookRetry] Saved subscriptionId ${subscriptionId} for customer ${customerId}`,
        );
      }
    }
  }

  // Handle token pack purchases
  if (session.mode === "payment" && session.metadata?.type === "token_pack") {
    const tokenCount = session.metadata?.tokenCount;
    const customerId = extractCustomerId(session.customer);

    if (tokenCount && customerId) {
      const subscription =
        await subscriptionRepository.getByStripeCustomerId(customerId);
      if (subscription) {
        await subscriptionRepository.addPurchasedTokens(
          subscription.userId,
          tokenCount,
        );
        console.log(
          `[WebhookRetry] Added ${tokenCount} tokens to user ${subscription.userId}`,
        );
      }
    }
  }
}

// Build subscription update data
function buildRetrySubscriptionUpdateData(
  stripeSubscription: any,
  getTierFromPriceId: (priceId: string) => string,
) {
  const priceId = stripeSubscription.items?.data?.[0]?.price?.id;
  return {
    tier: getTierFromPriceId(priceId || ""),
    status: stripeSubscription.status,
    stripePriceId: priceId,
    stripeSubscriptionId: stripeSubscription.id,
    currentPeriodStart: stripeSubscription.current_period_start
      ? new Date(stripeSubscription.current_period_start * 1000)
      : undefined,
    currentPeriodEnd: stripeSubscription.current_period_end
      ? new Date(stripeSubscription.current_period_end * 1000)
      : undefined,
    cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
    cancelAt: stripeSubscription.cancel_at
      ? new Date(stripeSubscription.cancel_at * 1000)
      : null,
  };
}

// Handle subscription update retry
async function handleSubscriptionUpdateRetry(
  stripeSubscription: any,
  subscriptionRepository: any,
  getTierFromPriceId: (priceId: string) => string,
): Promise<void> {
  const customerId = extractCustomerId(stripeSubscription.customer);
  const updateData = buildRetrySubscriptionUpdateData(
    stripeSubscription,
    getTierFromPriceId,
  );

  const updatedBySubId =
    await subscriptionRepository.updateByStripeSubscriptionId(
      stripeSubscription.id,
      updateData,
    );

  if (!updatedBySubId && customerId) {
    const existingSub =
      await subscriptionRepository.getByStripeCustomerId(customerId);
    if (existingSub) {
      await subscriptionRepository.upsert({
        userId: existingSub.userId,
        stripeCustomerId: customerId,
        ...updateData,
      });
    }
  }
}

// Handle invoice.payment_failed retry
async function handleInvoicePaymentFailedRetry(
  invoice: any,
  subscriptionRepository: any,
): Promise<void> {
  const subscriptionId = extractSubscriptionId(invoice.subscription);
  if (subscriptionId) {
    await subscriptionRepository.updateByStripeSubscriptionId(subscriptionId, {
      status: "past_due",
    });
  }
}

// Handle invoice.paid retry
async function handleInvoicePaidRetry(
  invoice: any,
  subscriptionRepository: any,
): Promise<void> {
  if (invoice.billing_reason !== "subscription_cycle") return;

  const subscriptionId = extractSubscriptionId(invoice.subscription);
  if (subscriptionId) {
    await subscriptionRepository.updateByStripeSubscriptionId(subscriptionId, {
      status: "active",
    });
  }
}

// Handle charge.refunded retry
async function handleChargeRefundedRetry(
  charge: any,
  subscriptionRepository: any,
): Promise<void> {
  const customerId = extractCustomerId(charge.customer);
  if (!customerId) return;

  const subscription =
    await subscriptionRepository.getByStripeCustomerId(customerId);
  if (!subscription) return;

  if (charge.metadata?.type === "token_pack" && charge.metadata?.tokenCount) {
    await subscriptionRepository.deductPurchasedTokens(
      subscription.userId,
      charge.metadata.tokenCount,
    );
    return;
  }

  if (charge.invoice) {
    await subscriptionRepository.upsert({
      userId: subscription.userId,
      stripeCustomerId: customerId,
      tier: "free",
      status: "canceled",
    });
  }
}

/**
 * Process a retry event - mirrors the main webhook handler logic
 */
async function processRetryEvent(
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  // Import repositories here to avoid circular dependencies
  const { subscriptionRepository } = await import("lib/db/repository");
  const { getTierFromPriceId } = await import("lib/billing/stripe");

  switch (eventType) {
    case "checkout.session.completed":
      await handleCheckoutSessionRetry(
        payload as unknown as Stripe.Checkout.Session,
        subscriptionRepository,
      );
      break;

    case "customer.subscription.created":
    case "customer.subscription.updated":
      await handleSubscriptionUpdateRetry(
        payload,
        subscriptionRepository,
        getTierFromPriceId,
      );
      break;

    case "customer.subscription.deleted": {
      const subscription = payload as unknown as Stripe.Subscription;
      await subscriptionRepository.updateByStripeSubscriptionId(
        subscription.id,
        {
          tier: "free",
          status: "canceled",
          cancelAtPeriodEnd: false,
        },
      );
      break;
    }

    case "invoice.payment_failed":
      await handleInvoicePaymentFailedRetry(payload, subscriptionRepository);
      break;

    case "invoice.paid":
      await handleInvoicePaidRetry(payload, subscriptionRepository);
      break;

    case "charge.refunded":
      await handleChargeRefundedRetry(payload, subscriptionRepository);
      break;

    default:
      console.log(`[WebhookRetry] Unhandled event type: ${eventType}`);
  }
}
