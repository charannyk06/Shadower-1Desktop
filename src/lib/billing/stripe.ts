import "server-only";

import Stripe from "stripe";
import { SubscriptionTier } from "./types";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

let stripeClient: Stripe | null = null;

function getClient(): Stripe | null {
  if (!STRIPE_SECRET_KEY) {
    return null;
  }
  if (!stripeClient) {
    stripeClient = new Stripe(STRIPE_SECRET_KEY);
  }
  return stripeClient;
}

export function isStripeEnabled(): boolean {
  return !!STRIPE_SECRET_KEY && process.env.BILLING_ENABLED === "1";
}

export const STRIPE_PRICE_IDS = {
  pro_monthly: process.env.STRIPE_PRICE_PRO_MONTHLY || "",
  pro_annual: process.env.STRIPE_PRICE_PRO_ANNUAL || "",
  ultra_monthly: process.env.STRIPE_PRICE_ULTRA_MONTHLY || "",
  ultra_annual: process.env.STRIPE_PRICE_ULTRA_ANNUAL || "",
} as const;

export async function createCustomer(params: {
  email: string;
  name: string;
  userId: string;
}): Promise<Stripe.Customer | null> {
  const client = getClient();
  if (!client) return null;

  try {
    const customer = await client.customers.create({
      email: params.email,
      name: params.name,
      metadata: {
        userId: params.userId,
      },
    });
    return customer;
  } catch (error) {
    console.error("[Stripe] Failed to create customer:", error);
    return null;
  }
}

export async function getCustomerByUserId(
  userId: string,
): Promise<Stripe.Customer | null> {
  const client = getClient();
  if (!client) return null;

  try {
    const customers = await client.customers.search({
      query: `metadata['userId']:'${userId}'`,
    });
    return customers.data[0] || null;
  } catch (error) {
    console.error("[Stripe] Failed to get customer:", error);
    return null;
  }
}

export async function createCheckoutSession(params: {
  customerId: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  couponId?: string;
  promoCodeId?: string;
  idempotencyKey?: string;
}): Promise<Stripe.Checkout.Session | null> {
  const client = getClient();
  if (!client) return null;

  try {
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      customer: params.customerId,
      mode: "subscription",
      line_items: [
        {
          price: params.priceId,
          quantity: 1,
        },
      ],
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
    };

    // Add discount if coupon is provided
    if (params.couponId) {
      sessionParams.discounts = [{ coupon: params.couponId }];
    }

    // Store promo code ID in metadata for tracking
    if (params.promoCodeId) {
      sessionParams.metadata = {
        ...sessionParams.metadata,
        promoCodeId: params.promoCodeId,
      };
    }

    // Use idempotency key if provided to prevent duplicate charges
    const options: Stripe.RequestOptions = {};
    if (params.idempotencyKey) {
      options.idempotencyKey = params.idempotencyKey;
    }

    const session = await client.checkout.sessions.create(
      sessionParams,
      options,
    );
    return session;
  } catch (error) {
    const stripeError = error as Stripe.errors.StripeError;
    console.error("[Stripe] Failed to create checkout session:", {
      error: stripeError.message,
      type: stripeError.type,
      code: stripeError.code,
      statusCode: stripeError.statusCode,
      params: {
        customerId: params.customerId,
        priceId: params.priceId,
        couponId: params.couponId,
      },
    });
    return null;
  }
}

export async function createTokenPackCheckout(params: {
  customerId: string;
  amount: number; // in cents (after discount if any)
  originalAmount?: number; // original amount before discount
  tokenCount: number;
  successUrl: string;
  cancelUrl: string;
  couponId?: string;
  promoCodeId?: string;
  idempotencyKey?: string;
}): Promise<Stripe.Checkout.Session | null> {
  const client = getClient();
  if (!client) {
    console.error(
      "[Stripe] Cannot create token pack checkout: Stripe client not initialized. Check STRIPE_SECRET_KEY and BILLING_ENABLED.",
    );
    return null;
  }

  try {
    // Validate customer ID format
    if (!params.customerId || !params.customerId.startsWith("cus_")) {
      console.error("[Stripe] Invalid customer ID format:", params.customerId);
      return null;
    }

    // Validate amount (must be at least 50 cents for Stripe)
    if (params.amount < 50) {
      console.error("[Stripe] Amount too low:", params.amount);
      return null;
    }

    console.log("[Stripe] Creating token pack checkout session:", {
      customerId: params.customerId,
      amount: params.amount,
      tokenCount: params.tokenCount,
      couponId: params.couponId || "none",
      hasCoupon: !!params.couponId,
    });

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      customer: params.customerId,
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: params.amount,
            product_data: {
              name: `${(params.tokenCount / 1000).toFixed(0)}K Token Pack`,
              description: `${params.tokenCount.toLocaleString()} additional tokens for your account`,
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        type: "token_pack",
        tokenCount: params.tokenCount.toString(),
        ...(params.promoCodeId && { promoCodeId: params.promoCodeId }),
        ...(params.originalAmount && {
          originalAmount: params.originalAmount.toString(),
        }),
      },
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
    };

    // Add discount if coupon is provided (and not empty string)
    if (params.couponId && params.couponId.trim() !== "") {
      sessionParams.discounts = [{ coupon: params.couponId }];
    }

    // Use idempotency key if provided to prevent duplicate charges
    const options: Stripe.RequestOptions = {};
    if (params.idempotencyKey) {
      options.idempotencyKey = params.idempotencyKey;
    }

    console.log("[Stripe] Calling Stripe API with params:", {
      customer: sessionParams.customer,
      mode: sessionParams.mode,
      lineItemsCount: sessionParams.line_items?.length,
      hasDiscounts: !!sessionParams.discounts,
      idempotencyKey: options.idempotencyKey || "none",
    });

    const session = await client.checkout.sessions.create(
      sessionParams,
      options,
    );

    console.log("[Stripe] Checkout session created successfully:", session.id);
    return session;
  } catch (error) {
    const stripeError = error as Stripe.errors.StripeError;

    // Check if customer doesn't exist (test mode customer with live key)
    if (
      stripeError.code === "resource_missing" &&
      stripeError.param === "customer"
    ) {
      console.error(
        "[Stripe] Customer not found - may be from test mode:",
        params.customerId,
      );
      // Return a special error code so caller can handle it
      throw new Error("CUSTOMER_NOT_FOUND");
    }

    console.error("[Stripe] Failed to create token pack checkout:", {
      error: stripeError.message,
      type: stripeError.type,
      code: stripeError.code,
      statusCode: stripeError.statusCode,
      param: stripeError.param,
      requestId: stripeError.requestId,
      params: {
        customerId: params.customerId,
        amount: params.amount,
        tokenCount: params.tokenCount,
        couponId: params.couponId || "none",
      },
    });
    return null;
  }
}

export async function createBillingPortalSession(params: {
  customerId: string;
  returnUrl: string;
}): Promise<Stripe.BillingPortal.Session | null> {
  const client = getClient();
  if (!client) return null;

  try {
    const session = await client.billingPortal.sessions.create({
      customer: params.customerId,
      return_url: params.returnUrl,
    });
    return session;
  } catch (error) {
    console.error("[Stripe] Failed to create portal session:", error);
    return null;
  }
}

export async function getSubscription(
  subscriptionId: string,
): Promise<Stripe.Subscription | null> {
  const client = getClient();
  if (!client) return null;

  try {
    const subscription = await client.subscriptions.retrieve(subscriptionId);
    return subscription;
  } catch (error) {
    const stripeError = error as Stripe.errors.StripeError;
    // If subscription doesn't exist (e.g., test mode ID with live key), log and return null
    // This can happen when migrating from test to live mode
    if (stripeError.code === "resource_missing") {
      console.warn(
        `[Stripe] Subscription ${subscriptionId} not found - may be from different Stripe mode (test vs live)`,
      );
    } else {
      console.error("[Stripe] Failed to get subscription:", {
        error: stripeError.message,
        type: stripeError.type,
        code: stripeError.code,
        subscriptionId,
      });
    }
    return null;
  }
}

export async function cancelSubscription(
  subscriptionId: string,
  options?: { atPeriodEnd?: boolean },
): Promise<Stripe.Subscription | null> {
  const client = getClient();
  if (!client) return null;

  try {
    if (options?.atPeriodEnd) {
      // Schedule cancellation at period end instead of immediate cancel
      const subscription = await client.subscriptions.update(subscriptionId, {
        cancel_at_period_end: true,
      });
      return subscription;
    }
    const subscription = await client.subscriptions.cancel(subscriptionId);
    return subscription;
  } catch (error) {
    console.error("[Stripe] Failed to cancel subscription:", error);
    return null;
  }
}

export async function updateSubscription(params: {
  subscriptionId: string;
  newPriceId: string;
  prorate?: boolean;
}): Promise<Stripe.Subscription | null> {
  const client = getClient();
  if (!client) return null;

  try {
    // Get the current subscription to find the item ID
    const subscription = await client.subscriptions.retrieve(
      params.subscriptionId,
    );
    const itemId = subscription.items.data[0]?.id;

    if (!itemId) {
      console.error("[Stripe] No subscription item found");
      return null;
    }

    // Update the subscription with the new price
    const updatedSubscription = await client.subscriptions.update(
      params.subscriptionId,
      {
        items: [
          {
            id: itemId,
            price: params.newPriceId,
          },
        ],
        proration_behavior:
          params.prorate !== false ? "create_prorations" : "none",
        // Clear any scheduled cancellation when upgrading
        cancel_at: null,
        cancel_at_period_end: false,
      },
    );

    return updatedSubscription;
  } catch (error) {
    console.error("[Stripe] Failed to update subscription:", error);
    return null;
  }
}

export async function getActiveSubscription(
  customerId: string,
): Promise<Stripe.Subscription | null> {
  const client = getClient();
  if (!client) return null;

  try {
    const subscriptions = await client.subscriptions.list({
      customer: customerId,
      status: "active",
      limit: 1,
    });
    return subscriptions.data[0] || null;
  } catch (error) {
    console.error("[Stripe] Failed to get active subscription:", error);
    return null;
  }
}

export async function scheduleDowngrade(params: {
  subscriptionId: string;
  newPriceId: string;
}): Promise<Stripe.SubscriptionSchedule | null> {
  const client = getClient();
  if (!client) return null;

  try {
    // Get the current subscription
    const subscription = await client.subscriptions.retrieve(
      params.subscriptionId,
    );
    const subscriptionItem = subscription.items.data[0];
    const currentPriceId = subscriptionItem?.price?.id;
    const currentPeriodEnd = subscriptionItem?.current_period_end;

    if (!currentPriceId || !currentPeriodEnd) {
      console.error("[Stripe] No subscription price or period found");
      return null;
    }

    let schedule: Stripe.SubscriptionSchedule;

    // Check if subscription already has a schedule
    if (subscription.schedule) {
      const scheduleId =
        typeof subscription.schedule === "string"
          ? subscription.schedule
          : subscription.schedule.id;

      // Retrieve existing schedule
      schedule = await client.subscriptionSchedules.retrieve(scheduleId);
      console.log(
        `[Stripe] Found existing schedule ${scheduleId}, updating it`,
      );
    } else {
      // Create a subscription schedule from the existing subscription
      schedule = await client.subscriptionSchedules.create({
        from_subscription: params.subscriptionId,
      });
      console.log(`[Stripe] Created new schedule ${schedule.id}`);
    }

    // Update the schedule with two phases:
    // 1. Current phase (keeps current price until period end)
    // 2. New phase (switches to new price after period end)
    const updatedSchedule = await client.subscriptionSchedules.update(
      schedule.id,
      {
        phases: [
          {
            items: [{ price: currentPriceId, quantity: 1 }],
            start_date: schedule.phases[0].start_date,
            end_date: currentPeriodEnd,
          },
          {
            items: [{ price: params.newPriceId, quantity: 1 }],
            start_date: currentPeriodEnd,
          },
        ],
        end_behavior: "release", // Convert back to regular subscription after phases complete
      },
    );

    return updatedSchedule;
  } catch (error) {
    console.error("[Stripe] Failed to schedule downgrade:", error);
    return null;
  }
}

export async function cancelScheduledDowngrade(
  subscriptionId: string,
): Promise<Stripe.Subscription | null> {
  const client = getClient();
  if (!client) return null;

  try {
    // Get the subscription to find its schedule
    const subscription = await client.subscriptions.retrieve(subscriptionId);

    if (subscription.schedule) {
      const scheduleId =
        typeof subscription.schedule === "string"
          ? subscription.schedule
          : subscription.schedule.id;

      // Release the schedule - this removes the scheduled changes and keeps current plan
      await client.subscriptionSchedules.release(scheduleId);
      console.log(`[Stripe] Released subscription schedule ${scheduleId}`);
    }

    // Return the updated subscription
    return await client.subscriptions.retrieve(subscriptionId);
  } catch (error) {
    console.error("[Stripe] Failed to cancel scheduled downgrade:", error);
    return null;
  }
}

export async function pauseSubscription(
  subscriptionId: string,
): Promise<Stripe.Subscription | null> {
  const client = getClient();
  if (!client) return null;

  try {
    const subscription = await client.subscriptions.update(subscriptionId, {
      pause_collection: { behavior: "mark_uncollectible" },
    });
    console.log(`[Stripe] Paused subscription: ${subscriptionId}`);
    return subscription;
  } catch (error) {
    console.error("[Stripe] Failed to pause subscription:", error);
    return null;
  }
}

export async function resumeSubscription(
  subscriptionId: string,
): Promise<Stripe.Subscription | null> {
  const client = getClient();
  if (!client) return null;

  try {
    const subscription = await client.subscriptions.update(subscriptionId, {
      pause_collection: null,
    });
    console.log(`[Stripe] Resumed subscription: ${subscriptionId}`);
    return subscription;
  } catch (error) {
    console.error("[Stripe] Failed to resume subscription:", error);
    return null;
  }
}

export async function getScheduledDowngrade(subscriptionId: string): Promise<{
  scheduledTier: SubscriptionTier;
  effectiveDate: Date;
} | null> {
  const client = getClient();
  if (!client) return null;

  try {
    const subscription = await client.subscriptions.retrieve(subscriptionId);

    if (!subscription.schedule) return null;

    const scheduleId =
      typeof subscription.schedule === "string"
        ? subscription.schedule
        : subscription.schedule.id;

    const schedule = await client.subscriptionSchedules.retrieve(scheduleId);

    // Check if there's a future phase with a different price
    if (schedule.phases && schedule.phases.length > 1) {
      const nextPhase = schedule.phases[1];
      const nextPriceId = nextPhase.items[0]?.price;

      if (nextPriceId && typeof nextPriceId === "string") {
        return {
          scheduledTier: getTierFromPriceId(nextPriceId),
          effectiveDate: new Date(nextPhase.start_date * 1000),
        };
      }
    }

    return null;
  } catch (error) {
    console.error("[Stripe] Failed to get scheduled downgrade:", error);
    return null;
  }
}

export function getTierFromPriceId(priceId: string): SubscriptionTier {
  if (
    priceId === STRIPE_PRICE_IDS.pro_monthly ||
    priceId === STRIPE_PRICE_IDS.pro_annual
  )
    return "pro";
  if (
    priceId === STRIPE_PRICE_IDS.ultra_monthly ||
    priceId === STRIPE_PRICE_IDS.ultra_annual
  )
    return "ultra";
  return "free";
}

export function getBillingCycleFromPriceId(
  priceId: string,
): "monthly" | "annual" | null {
  if (
    priceId === STRIPE_PRICE_IDS.pro_monthly ||
    priceId === STRIPE_PRICE_IDS.ultra_monthly
  ) {
    return "monthly";
  }
  if (
    priceId === STRIPE_PRICE_IDS.pro_annual ||
    priceId === STRIPE_PRICE_IDS.ultra_annual
  ) {
    return "annual";
  }
  return null;
}

export function constructWebhookEvent(
  payload: string | Buffer,
  signature: string,
): Stripe.Event | null {
  const client = getClient();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!client || !webhookSecret) return null;

  try {
    return client.webhooks.constructEvent(payload, signature, webhookSecret);
  } catch (error) {
    console.error("[Stripe] Webhook signature verification failed:", error);
    return null;
  }
}

// Coupon functions for promo codes
export async function createCoupon(params: {
  id: string; // Deterministic ID based on promo code
  discountType: "percentage" | "fixed_amount";
  discountValue: number;
  maxRedemptions?: number;
  expiresAt?: Date;
}): Promise<Stripe.Coupon | null> {
  const client = getClient();
  if (!client) return null;

  try {
    const couponParams: Stripe.CouponCreateParams = {
      id: params.id,
      duration: "once", // Apply to first invoice/payment only
    };

    if (params.discountType === "percentage") {
      couponParams.percent_off = params.discountValue;
    } else {
      couponParams.amount_off = params.discountValue;
      couponParams.currency = "usd";
    }

    if (params.maxRedemptions) {
      couponParams.max_redemptions = params.maxRedemptions;
    }

    if (params.expiresAt) {
      couponParams.redeem_by = Math.floor(params.expiresAt.getTime() / 1000);
    }

    const coupon = await client.coupons.create(couponParams);
    return coupon;
  } catch (error) {
    console.error("[Stripe] Failed to create coupon:", error);
    return null;
  }
}

export async function getCoupon(
  couponId: string,
): Promise<Stripe.Coupon | null> {
  const client = getClient();
  if (!client) return null;

  try {
    const coupon = await client.coupons.retrieve(couponId);
    return coupon;
  } catch {
    // Coupon not found is expected
    return null;
  }
}

export async function getOrCreateCoupon(params: {
  promoCodeId: string;
  discountType: "percentage" | "fixed_amount";
  discountValue: number;
  maxRedemptions?: number;
  expiresAt?: Date;
}): Promise<Stripe.Coupon | null> {
  const couponId = `promo_${params.promoCodeId}`;

  // Try to get existing coupon first
  const existingCoupon = await getCoupon(couponId);
  if (existingCoupon) {
    return existingCoupon;
  }

  // Create new coupon
  return createCoupon({
    id: couponId,
    discountType: params.discountType,
    discountValue: params.discountValue,
    maxRedemptions: params.maxRedemptions,
    expiresAt: params.expiresAt,
  });
}

export async function deleteCoupon(couponId: string): Promise<boolean> {
  const client = getClient();
  if (!client) return false;

  try {
    await client.coupons.del(couponId);
    return true;
  } catch (error) {
    console.error("[Stripe] Failed to delete coupon:", error);
    return false;
  }
}

export const stripe = {
  isEnabled: isStripeEnabled,
  getClient,
  createCustomer,
  getCustomerByUserId,
  createCheckoutSession,
  createTokenPackCheckout,
  createBillingPortalSession,
  getSubscription,
  cancelSubscription,
  updateSubscription,
  scheduleDowngrade,
  cancelScheduledDowngrade,
  getScheduledDowngrade,
  pauseSubscription,
  resumeSubscription,
  getActiveSubscription,
  getTierFromPriceId,
  getBillingCycleFromPriceId,
  constructWebhookEvent,
  createCoupon,
  getCoupon,
  getOrCreateCoupon,
  deleteCoupon,
  PRICE_IDS: STRIPE_PRICE_IDS,
};
