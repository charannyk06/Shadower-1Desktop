import { constructWebhookEvent, getTierFromPriceId } from "lib/billing/stripe";
import type { SubscriptionTier } from "lib/billing/types";
import {
  promoCodeRepository,
  subscriptionRepository,
  webhookEventRepository,
  webhookRetryRepository,
} from "lib/db/repository";
import { completeReferral, hasPendingReferral } from "lib/referral/service";
import type Stripe from "stripe";

// Events that are critical and should be retried on failure
const RETRIABLE_EVENTS = new Set([
  "checkout.session.completed",
  "checkout.session.expired",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
  "invoice.paid",
  "charge.refunded",
]);

// Helper to extract customer ID from various Stripe objects
function extractCustomerId(
  customer:
    | string
    | Stripe.Customer
    | Stripe.DeletedCustomer
    | null
    | undefined,
): string | undefined {
  if (!customer) return undefined;
  return typeof customer === "string" ? customer : customer.id;
}

// Helper to extract subscription ID from various Stripe objects
function extractSubscriptionId(
  subscription: string | Stripe.Subscription | null | undefined,
): string | undefined {
  if (!subscription) return undefined;
  return typeof subscription === "string" ? subscription : subscription.id;
}

// Helper to record promo redemption from checkout session
async function recordPromoRedemption(
  session: Stripe.Checkout.Session,
  purchaseType: "subscription" | "token_pack",
): Promise<void> {
  const promoCodeId = session.metadata?.promoCodeId;
  const customerId = extractCustomerId(session.customer);

  if (!promoCodeId || !customerId) return;

  const subscription =
    await subscriptionRepository.getByStripeCustomerId(customerId);
  if (!subscription) {
    console.warn(
      `[Webhook] PROMO_REDEMPTION_FAILED: Could not find subscription for customer ${customerId} to record promo redemption. PromoCodeId: ${promoCodeId}, SessionId: ${session.id}`,
    );
    return;
  }

  const userId = subscription.userId;
  const amountTotal = session.amount_total || 0;
  const amountSubtotal = session.amount_subtotal || amountTotal;
  const discountAmount = amountSubtotal - amountTotal;

  await promoCodeRepository.recordRedemption({
    promoCodeId,
    userId,
    purchaseType,
    originalAmount: amountSubtotal,
    discountAmount: Math.max(0, discountAmount),
    finalAmount: amountTotal,
    stripeCheckoutSessionId: session.id,
  });

  console.log(
    `[Webhook] Recorded promo redemption for user ${userId}, code ${promoCodeId}`,
  );
}

// Handle subscription link from checkout session
async function handleCheckoutSubscriptionLink(
  session: Stripe.Checkout.Session,
): Promise<void> {
  const subscriptionId = extractSubscriptionId(
    session.subscription as string | Stripe.Subscription | null,
  );
  const customerId = extractCustomerId(session.customer);

  if (!customerId || !subscriptionId) return;

  const existingSub =
    await subscriptionRepository.getByStripeCustomerId(customerId);
  if (existingSub) {
    await subscriptionRepository.upsert({
      userId: existingSub.userId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
    });
    console.log(
      `[Webhook] Saved subscriptionId ${subscriptionId} for customer ${customerId}`,
    );
  } else {
    console.error(
      `[Webhook] Could not find subscription record for customer ${customerId}`,
    );
  }
}

// Handle token pack purchase from checkout session
async function handleTokenPackPurchase(
  session: Stripe.Checkout.Session,
): Promise<void> {
  const tokenCount = session.metadata?.tokenCount;
  const customerId = extractCustomerId(session.customer);

  if (!tokenCount || !customerId) return;

  const subscription =
    await subscriptionRepository.getByStripeCustomerId(customerId);

  if (subscription) {
    await subscriptionRepository.addPurchasedTokens(
      subscription.userId,
      tokenCount,
    );
    console.log(
      `[Webhook] Added ${tokenCount} tokens to user ${subscription.userId}`,
    );
  } else {
    console.error(
      `[Webhook] Could not find subscription for customer ${customerId} to credit tokens`,
    );
  }
}

// Handle referral completion after purchase
async function handleReferralCompletion(
  session: Stripe.Checkout.Session,
): Promise<void> {
  const customerId = extractCustomerId(session.customer);
  if (!customerId) return;

  const subscription =
    await subscriptionRepository.getByStripeCustomerId(customerId);
  if (!subscription) return;

  const hasPending = await hasPendingReferral(subscription.userId);
  if (!hasPending) return;

  const result = await completeReferral(subscription.userId);
  if (result.success) {
    console.log(
      `[Webhook] Completed referral for user ${subscription.userId}: referrer got ${result.referrerBonusAwarded}, referee got ${result.refereeBonusAwarded}`,
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.text();
    const signature = req.headers.get("stripe-signature");

    if (!signature) {
      return Response.json({ error: "Missing signature" }, { status: 400 });
    }

    const event = constructWebhookEvent(body, signature);
    if (!event) {
      return Response.json({ error: "Invalid signature" }, { status: 400 });
    }

    // Extract metadata for logging
    const eventMetadata = {
      customerId: (event.data.object as any)?.customer,
      subscriptionId:
        (event.data.object as any)?.subscription ||
        (event.data.object as any)?.id,
    };

    // Database-level idempotency check with atomic insert
    // This uses INSERT ... ON CONFLICT DO NOTHING for race condition safety
    const isNewEvent = await webhookEventRepository.markEventProcessed(
      event.id,
      event.type,
      eventMetadata,
    );

    if (!isNewEvent) {
      console.log(
        `[Webhook] Skipping duplicate event: ${event.id} (${event.type})`,
      );
      return Response.json({ received: true, duplicate: true });
    }

    console.log(`[Webhook] Processing event: ${event.id} (${event.type})`);

    // Wrap event processing in try-catch for retry queue support
    try {
      await processWebhookEvent(event);
    } catch (processingError: unknown) {
      console.error(
        `[Webhook] Error processing event ${event.id}:`,
        processingError,
      );

      // Queue for retry if this is a retriable event type
      if (RETRIABLE_EVENTS.has(event.type)) {
        try {
          await webhookRetryRepository.addToQueue({
            eventId: event.id,
            eventType: event.type,
            payload: event.data.object as unknown as Record<string, unknown>,
            error: (processingError as Error).message || "Unknown error",
          });
          console.log(`[Webhook] Event ${event.id} queued for retry`);
        } catch (queueError) {
          console.error(
            `[Webhook] Failed to queue event for retry:`,
            queueError,
          );
        }
      }

      // Still return 200 to Stripe to prevent immediate retries
      // Our own retry queue will handle it
      return Response.json({ received: true, queued_for_retry: true });
    }

    return Response.json({ received: true });
  } catch (error: unknown) {
    const err = error as Error;
    console.error("Webhook Error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}

// Handle checkout.session.expired event - release promo reservation
async function handleCheckoutSessionExpired(
  session: Stripe.Checkout.Session,
): Promise<void> {
  const promoCodeId = session.metadata?.promoCodeId;

  if (!promoCodeId) {
    // No promo code was used, nothing to release
    return;
  }

  try {
    // Release the promo reservation with the session ID for idempotency
    const released = await promoCodeRepository.releaseReservation(
      promoCodeId,
      session.id,
    );

    if (released) {
      console.log(
        `[Webhook] Released promo reservation for expired checkout session ${session.id}, promoCodeId: ${promoCodeId}`,
      );
    } else {
      console.warn(
        `[Webhook] Failed to release promo reservation for expired checkout session ${session.id}, promoCodeId: ${promoCodeId}`,
      );
    }
  } catch (error) {
    console.error(
      `[Webhook] Error releasing promo reservation for expired session ${session.id}:`,
      error,
    );
  }
}

// Handle checkout.session.completed event
async function handleCheckoutSessionCompleted(
  session: Stripe.Checkout.Session,
): Promise<void> {
  const customerId = extractCustomerId(session.customer);
  const subscriptionId = extractSubscriptionId(
    session.subscription as string | Stripe.Subscription | null,
  );

  console.log(`[Webhook] checkout.session.completed:`, {
    sessionId: session.id,
    customerId,
    subscriptionId,
    mode: session.mode,
    status: session.status,
    paymentStatus: session.payment_status,
  });

  // Record promo code redemption if applicable
  if (session.metadata?.promoCodeId) {
    const purchaseType =
      session.mode === "subscription" ? "subscription" : "token_pack";
    await recordPromoRedemption(session, purchaseType).catch((error) => {
      console.error("[Webhook] Failed to record promo redemption:", error);
    });
  }

  // CRITICAL: For subscription purchases, immediately sync the subscription state
  // Don't rely solely on customer.subscription.created - it may arrive later or fail
  if (session.mode === "subscription" && subscriptionId && customerId) {
    try {
      // Fetch the full subscription from Stripe to get all details
      const { getSubscription } = await import("lib/billing/stripe");
      const stripeSubscription = await getSubscription(subscriptionId);

      if (stripeSubscription) {
        const updateData = buildSubscriptionUpdateData(stripeSubscription);
        const existingSub =
          await subscriptionRepository.getByStripeCustomerId(customerId);

        if (existingSub) {
          await subscriptionRepository.upsert({
            userId: existingSub.userId,
            stripeCustomerId: customerId,
            ...updateData,
          });
          console.log(
            `[Webhook] checkout.session.completed: Synced subscription for user ${existingSub.userId}, tier=${updateData.tier}, status=${updateData.status}`,
          );
        } else {
          console.error(
            `[Webhook] checkout.session.completed: Could not find user for customer ${customerId}`,
          );
        }
      }
    } catch (error) {
      console.error(
        `[Webhook] checkout.session.completed: Failed to sync subscription:`,
        error,
      );
      // Re-throw to trigger retry queue
      throw error;
    }
  } else if (session.mode === "subscription" && session.subscription) {
    // Fallback: at minimum link the subscription ID
    await handleCheckoutSubscriptionLink(session);
  }

  // Handle token pack purchases (one-time payments)
  if (session.mode === "payment" && session.metadata?.type === "token_pack") {
    await handleTokenPackPurchase(session).catch((error) => {
      console.error("[Webhook] Failed to credit token pack:", error);
    });
  }

  // Complete any pending referral after first purchase
  await handleReferralCompletion(session).catch((error) => {
    console.error("[Webhook] Error completing referral:", error);
  });
}

// Build update data for subscription events
function buildSubscriptionUpdateData(stripeSubscription: any): {
  tier: SubscriptionTier;
  status: any;
  stripePriceId: string;
  stripeSubscriptionId: string;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  cancelAtPeriodEnd: boolean;
  cancelAt: Date | null;
} {
  const priceId = stripeSubscription.items?.data?.[0]?.price?.id;
  const tier = getTierFromPriceId(priceId || "");

  return {
    tier,
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

// Handle customer.subscription.created/updated events
async function handleSubscriptionUpdate(
  stripeSubscription: any,
  eventType: string,
): Promise<void> {
  const customerId = extractCustomerId(stripeSubscription.customer);
  const updateData = buildSubscriptionUpdateData(stripeSubscription);

  console.log(`[Webhook] ${eventType} received:`, {
    subscriptionId: stripeSubscription.id,
    customerId,
    status: stripeSubscription.status,
    cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
    cancelAt: stripeSubscription.cancel_at,
    priceId: updateData.stripePriceId,
  });

  // Try to update by subscription ID first
  const updatedBySubId =
    await subscriptionRepository.updateByStripeSubscriptionId(
      stripeSubscription.id,
      updateData,
    );

  if (updatedBySubId) {
    console.log(
      `[Webhook] Subscription ${eventType} for ${customerId}: tier=${updateData.tier}, status=${stripeSubscription.status}`,
    );
    return;
  }

  // If not found by subscription ID, try to find by customer ID and update
  if (!customerId) return;

  const existingSub =
    await subscriptionRepository.getByStripeCustomerId(customerId);
  if (existingSub) {
    await subscriptionRepository.upsert({
      userId: existingSub.userId,
      stripeCustomerId: customerId,
      ...updateData,
    });
    console.log(
      `[Webhook] Updated subscription by customerId ${customerId}: tier=${updateData.tier}`,
    );
  } else {
    console.error(
      `[Webhook] Could not find subscription for customer ${customerId} or subscription ${stripeSubscription.id}`,
    );
  }
}

// Handle invoice.payment_failed event
async function handleInvoicePaymentFailed(invoice: any): Promise<void> {
  const subscriptionId = extractSubscriptionId(invoice.subscription);
  if (!subscriptionId) return;

  await subscriptionRepository.updateByStripeSubscriptionId(subscriptionId, {
    status: "past_due",
  });
  console.log(`Payment failed for subscription: ${subscriptionId}`);
}

// Handle charge.refunded event
async function handleChargeRefunded(charge: any): Promise<void> {
  const customerId = extractCustomerId(charge.customer);

  if (!customerId) {
    console.log(`[Webhook] charge.refunded: No customer ID found`);
    return;
  }

  const subscription =
    await subscriptionRepository.getByStripeCustomerId(customerId);

  if (!subscription) {
    console.log(
      `[Webhook] charge.refunded: No subscription for customer ${customerId}`,
    );
    return;
  }

  // Check if this was a token pack refund
  if (charge.metadata?.type === "token_pack" && charge.metadata?.tokenCount) {
    await subscriptionRepository.deductPurchasedTokens(
      subscription.userId,
      charge.metadata.tokenCount,
    );
    console.log(
      `[Webhook] Refunded token pack: deducted ${charge.metadata.tokenCount} tokens from user ${subscription.userId}`,
    );
    return;
  }

  // If it's a subscription payment refund, downgrade to free
  if (charge.invoice) {
    await subscriptionRepository.upsert({
      userId: subscription.userId,
      stripeCustomerId: customerId,
      tier: "free",
      status: "canceled",
    });
    console.log(
      `[Webhook] Subscription refunded: downgraded user ${subscription.userId} to free tier`,
    );
  }
}

// Handle invoice.paid event
async function handleInvoicePaid(invoice: any): Promise<void> {
  const customerId = extractCustomerId(invoice.customer);
  const subscriptionId = extractSubscriptionId(invoice.subscription);

  console.log(`[Webhook] Invoice paid:`, {
    invoiceId: invoice.id,
    customerId,
    amountPaid: invoice.amount_paid,
    currency: invoice.currency,
    billingReason: invoice.billing_reason,
    subscriptionId,
  });

  // If this is a subscription renewal, mark subscription as active
  if (subscriptionId && invoice.billing_reason === "subscription_cycle") {
    await subscriptionRepository.updateByStripeSubscriptionId(subscriptionId, {
      status: "active",
    });
    console.log(
      `[Webhook] Subscription ${subscriptionId} renewed, marked active`,
    );
  }
}

/**
 * Process a webhook event - extracted for retry support
 */
async function processWebhookEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutSessionCompleted(
        event.data.object as Stripe.Checkout.Session,
      );
      break;

    case "checkout.session.expired":
      await handleCheckoutSessionExpired(
        event.data.object as Stripe.Checkout.Session,
      );
      break;

    case "customer.subscription.created":
    case "customer.subscription.updated":
      await handleSubscriptionUpdate(event.data.object, event.type);
      break;

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      await subscriptionRepository.updateByStripeSubscriptionId(
        subscription.id,
        { tier: "free", status: "canceled", cancelAtPeriodEnd: false },
      );
      console.log(`Subscription canceled: ${subscription.id}`);
      break;
    }

    case "invoice.payment_failed":
      await handleInvoicePaymentFailed(event.data.object);
      break;

    case "subscription_schedule.completed": {
      const schedule = event.data.object as Stripe.SubscriptionSchedule;
      const subscriptionId = extractSubscriptionId(schedule.subscription);
      if (subscriptionId) {
        console.log(
          `[Webhook] Subscription schedule completed for ${subscriptionId}`,
        );
      }
      break;
    }

    case "subscription_schedule.released": {
      const schedule = event.data.object as Stripe.SubscriptionSchedule;
      console.log(`[Webhook] Subscription schedule released: ${schedule.id}`);
      break;
    }

    case "charge.refunded":
      await handleChargeRefunded(event.data.object);
      break;

    case "invoice.paid":
      await handleInvoicePaid(event.data.object);
      break;

    default:
      console.log(`Unhandled event type: ${event.type}`);
  }
}
