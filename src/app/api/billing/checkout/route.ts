import * as crypto from "node:crypto";
import { checkoutRateLimiter } from "lib/api/rate-limiter";
import { getSession } from "lib/auth/server";
import { ensureBillingConfigValidated, getTokenPack } from "lib/billing/config";
import { getMonthlyPrice } from "lib/billing/pricing";
import {
  STRIPE_PRICE_IDS,
  createCheckoutSession,
  createCustomer,
  createTokenPackCheckout,
  getActiveSubscription,
  getOrCreateCoupon,
  getTierFromPriceId,
  scheduleDowngrade,
  stripe,
  updateSubscription,
} from "lib/billing/stripe";
import type { SubscriptionTier } from "lib/billing/types";
import { csrfErrorResponse, validateCsrfRequest } from "lib/csrf";
import {
  promoCodeRepository,
  subscriptionRepository,
  userRepository,
} from "lib/db/repository";
import { NextRequest } from "next/server";

/**
 * Generate a deterministic idempotency key for Stripe requests.
 * Uses 5-minute time buckets to allow retries within a window while
 * preventing duplicate charges from rapid double-clicks.
 */
function generateIdempotencyKey(
  userId: string,
  tier: string | null,
  tokenAmount: string | null,
  billingCycle?: string,
): string {
  // 5-minute time buckets - allows retries within window but prevents duplicates
  const timeBucket = Math.floor(Date.now() / (5 * 60 * 1000));
  const payload = `checkout-${userId}-${tier || "token"}-${tokenAmount || "sub"}-${billingCycle || "none"}-${timeBucket}`;
  return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 32);
}

// Token pack configurations are now centralized in lib/billing/config.ts
// Use getTokenPack() or getTokenPackPriceMap() to access them

interface CheckoutResult {
  url?: string;
  error?: string;
  status?: number;
}

interface PromoCodeResult {
  couponId?: string;
  promoCodeId?: string;
  discountAmount: number;
  reservedPromoCodeId?: string;
  error?: string;
}

// Calculate subscription price for promo code validation
// Uses centralized pricing config to ensure consistency
function getSubscriptionPriceForTier(tier: string | undefined): number {
  if (tier === "pro" || tier === "ultra") {
    return getMonthlyPrice(tier as SubscriptionTier);
  }
  return 0;
}

// Validate and process promo code
async function processPromoCode(
  promoCode: string,
  userId: string,
  tier: string | undefined,
  tokenPackAmount: string | undefined,
): Promise<PromoCodeResult> {
  const purchaseType = tokenPackAmount ? "token_pack" : "subscription";
  const tokenPack = tokenPackAmount ? getTokenPack(tokenPackAmount) : undefined;
  const amount = tokenPackAmount
    ? tokenPack?.price || 0
    : getSubscriptionPriceForTier(tier);

  const promoResult = await promoCodeRepository.validateCode(
    promoCode,
    userId,
    purchaseType,
    amount,
    tier as SubscriptionTier | undefined,
    tokenPackAmount,
  );

  if (!promoResult.valid) {
    return {
      discountAmount: 0,
      error: promoResult.error || "Invalid promo code",
    };
  }

  if (!promoResult.promoCode || !promoResult.discount) {
    return { discountAmount: 0 };
  }

  // Atomic reservation to prevent race conditions
  const reservationResult = await promoCodeRepository.atomicReserveRedemption(
    promoResult.promoCode.id,
    userId,
    promoResult.promoCode.maxRedemptions
      ? Number(promoResult.promoCode.maxRedemptions)
      : null,
    Number(promoResult.promoCode.maxPerUser),
  );

  if (!reservationResult.success) {
    return {
      discountAmount: 0,
      error: reservationResult.error || "Promo code limit reached",
    };
  }

  const result: PromoCodeResult = {
    reservedPromoCodeId: promoResult.promoCode.id,
    discountAmount: promoResult.discount.discountAmount,
    promoCodeId: promoResult.promoCode.id,
  };

  // Get or create Stripe coupon for both subscriptions and token packs
  // Token packs can use coupons for better Stripe integration
  const stripeCoupon = await getOrCreateCoupon({
    promoCodeId: promoResult.promoCode.id,
    discountType: promoResult.promoCode.discountType,
    discountValue: Number(promoResult.promoCode.discountValue),
    maxRedemptions: promoResult.promoCode.maxRedemptions
      ? Number(promoResult.promoCode.maxRedemptions)
      : undefined,
    expiresAt: promoResult.promoCode.expiresAt || undefined,
  });

  if (stripeCoupon) {
    result.couponId = stripeCoupon.id;
    if (!promoResult.promoCode.stripeCouponId) {
      await promoCodeRepository.updateStripeCouponId(
        promoResult.promoCode.id,
        stripeCoupon.id,
      );
    }
  }

  return result;
}

// Release promo reservation on failure
// Uses sessionId for idempotency to prevent double-releases
async function releasePromoReservation(
  promoCodeId: string | undefined,
  sessionId?: string,
): Promise<void> {
  if (!promoCodeId) return;
  try {
    await promoCodeRepository.releaseReservation(promoCodeId, sessionId);
    console.log(`[Checkout] Released promo reservation for ${promoCodeId}`);
  } catch (e) {
    console.error(`[Checkout] Failed to release promo reservation:`, e);
  }
}

// Validate token pack tier requirement
function validateTokenPackTier(
  tier: string | undefined,
  userId: string,
): CheckoutResult | null {
  const actualTier = tier || "free";
  if (actualTier === "free") {
    console.warn(
      `[Checkout] SECURITY: Free user ${userId} attempted token pack purchase`,
    );
    return {
      error:
        "Token packs are only available for Pro and Ultra subscribers. Please upgrade your plan first.",
      status: 403,
    };
  }
  return null;
}

// Handle token pack checkout
async function handleTokenPackCheckout(
  userId: string,
  customerId: string,
  tokenPackAmount: string,
  discountAmount: number,
  promoCodeId: string | undefined,
  couponId: string | undefined,
  reservedPromoCodeId: string | undefined,
  baseUrl: string,
): Promise<CheckoutResult> {
  const pack = getTokenPack(tokenPackAmount);
  if (!pack) {
    await releasePromoReservation(reservedPromoCodeId);
    return { error: "Invalid token pack", status: 400 };
  }

  // Defense-in-depth: Re-fetch subscription
  const currentSubscription = await subscriptionRepository.getByUserId(userId);
  const currentTier = currentSubscription?.tier || "free";
  if (currentTier === "free") {
    await releasePromoReservation(reservedPromoCodeId);
    console.error(
      `[Checkout] SECURITY VIOLATION: Free user ${userId} bypassed initial tier check`,
    );
    return {
      error: "Token packs are only available for Pro and Ultra subscribers.",
      status: 403,
    };
  }

  // Calculate final amount - if coupon is used, pass original amount and let Stripe apply discount
  // Otherwise, apply discount manually
  const finalAmount = couponId
    ? pack.price // Stripe will apply coupon discount
    : Math.max(pack.price - discountAmount, 0);

  // Ensure minimum amount is at least 50 cents (Stripe minimum)
  if (finalAmount < 50) {
    await releasePromoReservation(reservedPromoCodeId);
    console.error(
      `[Checkout] Token pack final amount too low: ${finalAmount} cents`,
    );
    return {
      error: "Discount amount exceeds token pack price",
      status: 400,
    };
  }

  const idempotencyKey = generateIdempotencyKey(userId, null, tokenPackAmount);

  console.log(`[Checkout] Creating token pack checkout:`, {
    userId,
    customerId,
    amount: finalAmount,
    tokenCount: pack.tokens,
    couponId,
    promoCodeId,
  });

  let checkoutSession: Awaited<
    ReturnType<typeof createTokenPackCheckout>
  > | null = null;

  try {
    checkoutSession = await createTokenPackCheckout({
      customerId,
      amount: finalAmount,
      originalAmount: discountAmount > 0 ? pack.price : undefined,
      tokenCount: pack.tokens,
      successUrl: `${baseUrl}/?success=true&type=tokens`,
      cancelUrl: `${baseUrl}/?canceled=true`,
      couponId,
      promoCodeId,
      idempotencyKey,
    });
  } catch (error) {
    // Handle customer not found (test mode customer with live key)
    if (error instanceof Error && error.message === "CUSTOMER_NOT_FOUND") {
      console.warn(
        `[Checkout] Customer ${customerId} not found in live mode - recreating customer for user ${userId}`,
      );
      // Get user info to recreate customer
      const user = await userRepository.getUserById(userId);
      if (!user) {
        await releasePromoReservation(reservedPromoCodeId);
        return { error: "User not found", status: 404 };
      }

      // Create new customer in live mode
      const newCustomer = await createCustomer({
        email: user.email,
        name: user.name || "",
        userId,
      });

      if (!newCustomer) {
        await releasePromoReservation(reservedPromoCodeId);
        return {
          error: "Failed to create customer. Please try again.",
          status: 500,
        };
      }

      // Update subscription with new customer ID
      await subscriptionRepository.upsert({
        userId,
        stripeCustomerId: newCustomer.id,
      });

      // Retry checkout with new customer
      checkoutSession = await createTokenPackCheckout({
        customerId: newCustomer.id,
        amount: finalAmount,
        originalAmount: discountAmount > 0 ? pack.price : undefined,
        tokenCount: pack.tokens,
        successUrl: `${baseUrl}/?success=true&type=tokens`,
        cancelUrl: `${baseUrl}/?canceled=true`,
        couponId,
        promoCodeId,
        idempotencyKey,
      });
    } else {
      // Re-throw other errors
      throw error;
    }
  }

  if (!checkoutSession) {
    console.error(
      `[Checkout] Failed to create token pack checkout for user ${userId}, customerId: ${customerId}, amount: ${finalAmount}, tokenCount: ${pack.tokens}, couponId: ${couponId || "none"}. Check Stripe logs above for detailed error.`,
    );
    await releasePromoReservation(reservedPromoCodeId);
    return {
      error:
        "Failed to create checkout session. Please check your Stripe configuration and try again.",
      status: 500,
    };
  }

  return { url: checkoutSession.url ?? undefined };
}

// Handle downgrade to free tier
async function handleFreeDowngrade(
  customerId: string,
  baseUrl: string,
): Promise<CheckoutResult> {
  const existingSubscription = await getActiveSubscription(customerId);

  if (!existingSubscription) {
    return { error: "No active subscription to downgrade", status: 400 };
  }

  const { cancelSubscription } = await import("lib/billing/stripe");
  const canceled = await cancelSubscription(existingSubscription.id, {
    atPeriodEnd: true,
  });

  if (!canceled) {
    return { error: "Failed to cancel subscription", status: 500 };
  }

  console.log(
    `[Checkout] Scheduled cancellation for subscription ${existingSubscription.id}`,
  );
  return { url: `${baseUrl}/?success=true&downgraded=true` };
}

// Select price ID based on tier and billing cycle
function selectPriceId(
  tier: string,
  billingCycle: "monthly" | "annual",
): string {
  if (tier === "pro") {
    return billingCycle === "annual"
      ? STRIPE_PRICE_IDS.pro_annual
      : STRIPE_PRICE_IDS.pro_monthly;
  }
  return billingCycle === "annual"
    ? STRIPE_PRICE_IDS.ultra_annual
    : STRIPE_PRICE_IDS.ultra_monthly;
}

// Handle existing subscription upgrade/downgrade
async function handleExistingSubscriptionChange(
  existingSubscription: Awaited<ReturnType<typeof getActiveSubscription>>,
  tier: string,
  priceId: string,
  reservedPromoCodeId: string | undefined,
  baseUrl: string,
): Promise<CheckoutResult | null> {
  if (!existingSubscription) return null;

  const currentPriceId = existingSubscription.items.data[0]?.price?.id;

  console.log(`[Checkout] Comparing subscription plans:`, {
    currentPriceId,
    requestedPriceId: priceId,
    areEqual: currentPriceId === priceId,
    subscriptionId: existingSubscription.id,
  });

  if (currentPriceId === priceId) {
    console.log(`[Checkout] Blocking: user already on requested plan`);
    await releasePromoReservation(reservedPromoCodeId);
    return { error: "You are already on this plan", status: 400 };
  }

  const currentTier = getTierFromPriceId(currentPriceId || "");
  const isDowngrade =
    (currentTier === "ultra" && tier === "pro") ||
    (currentTier === "pro" && tier === "free");

  if (isDowngrade) {
    const scheduledSubscription = await scheduleDowngrade({
      subscriptionId: existingSubscription.id,
      newPriceId: priceId,
    });

    if (!scheduledSubscription) {
      await releasePromoReservation(reservedPromoCodeId);
      return { error: "Failed to schedule downgrade", status: 500 };
    }

    console.log(
      `[Checkout] Scheduled downgrade for ${existingSubscription.id} to ${tier}`,
    );
    return { url: `${baseUrl}/?success=true&downgraded=true` };
  }

  // Upgrade immediately
  const updatedSubscription = await updateSubscription({
    subscriptionId: existingSubscription.id,
    newPriceId: priceId,
    prorate: true,
  });

  if (!updatedSubscription) {
    await releasePromoReservation(reservedPromoCodeId);
    return { error: "Failed to update subscription", status: 500 };
  }

  console.log(
    `[Checkout] Upgraded subscription ${existingSubscription.id} to ${tier}`,
  );
  return { url: `${baseUrl}/?success=true&upgraded=true` };
}

async function handleCheckout(
  userId: string,
  userEmail: string,
  userName: string,
  tier?: string,
  tokenPackAmount?: string,
  promoCode?: string,
  billingCycle: "monthly" | "annual" = "monthly",
): Promise<CheckoutResult> {
  // Validate billing configuration
  const configResult = ensureBillingConfigValidated();
  if (!configResult.valid) {
    console.error(
      "[Checkout] Billing configuration is invalid:",
      configResult.errors,
    );
    return { error: "Billing is not properly configured", status: 500 };
  }

  if (!stripe.isEnabled()) {
    return { error: "Billing is not enabled", status: 400 };
  }

  // Check rate limit
  const rateLimitResult = checkoutRateLimiter.check(userId);
  if (!rateLimitResult.allowed) {
    const retryAfterSec = Math.ceil(
      (rateLimitResult.retryAfterMs || 60000) / 1000,
    );
    return {
      error: `Too many checkout attempts. Please try again in ${retryAfterSec} seconds.`,
      status: 429,
    };
  }

  // Get or create Stripe customer
  let subscription = await subscriptionRepository.getByUserId(userId);
  let customerId = subscription?.stripeCustomerId;

  // Validate token pack tier requirement
  if (tokenPackAmount) {
    const tierError = validateTokenPackTier(subscription?.tier, userId);
    if (tierError) return tierError;
  }

  if (!customerId) {
    const customer = await createCustomer({
      email: userEmail,
      name: userName,
      userId,
    });
    if (!customer) return { error: "Failed to create customer", status: 500 };
    customerId = customer.id;
    await subscriptionRepository.upsert({
      userId,
      stripeCustomerId: customerId,
      tier: "free",
    });
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

  // Process promo code if provided
  let promoResult: PromoCodeResult = { discountAmount: 0 };
  if (promoCode) {
    console.log(`[Checkout] Processing promo code for user ${userId}`);
    promoResult = await processPromoCode(
      promoCode,
      userId,
      tier,
      tokenPackAmount,
    );
    if (promoResult.error) {
      console.log(`[Checkout] Promo code error: ${promoResult.error}`);
      return { error: promoResult.error, status: 400 };
    }
    console.log(
      `[Checkout] Promo code processed successfully, reservedPromoCodeId: ${promoResult.reservedPromoCodeId}, couponId: ${promoResult.couponId}`,
    );
  }

  // Handle token pack purchase
  if (tokenPackAmount) {
    return handleTokenPackCheckout(
      userId,
      customerId,
      tokenPackAmount,
      promoResult.discountAmount,
      promoResult.promoCodeId,
      promoResult.couponId,
      promoResult.reservedPromoCodeId,
      baseUrl,
    );
  }

  // Validate tier
  if (!tier || !["free", "pro", "ultra"].includes(tier)) {
    await releasePromoReservation(promoResult.reservedPromoCodeId);
    return { error: "Invalid tier", status: 400 };
  }

  // Handle downgrade to free
  if (tier === "free") {
    await releasePromoReservation(promoResult.reservedPromoCodeId);
    return handleFreeDowngrade(customerId, baseUrl);
  }

  // Select price ID
  const priceId = selectPriceId(tier, billingCycle);
  if (!priceId) {
    await releasePromoReservation(promoResult.reservedPromoCodeId);
    const cycleLabel = billingCycle === "annual" ? "Annual" : "Monthly";
    console.error(
      `[Checkout] Missing price ID for tier: ${tier}, cycle: ${billingCycle}`,
    );
    return {
      error: `${cycleLabel} pricing not configured for ${tier} tier`,
      status: 400,
    };
  }

  // Validate price ID is not empty
  if (priceId.trim() === "") {
    await releasePromoReservation(promoResult.reservedPromoCodeId);
    console.error(
      `[Checkout] Empty price ID for tier: ${tier}, cycle: ${billingCycle}`,
    );
    return {
      error: `Pricing configuration error for ${tier} tier. Please contact support.`,
      status: 500,
    };
  }

  // Handle existing subscription changes
  const existingSubscription = await getActiveSubscription(customerId);

  // Debug: Log subscription state to diagnose mismatches
  console.log(`[Checkout] Subscription state check:`, {
    userId,
    customerId,
    dbTier: subscription?.tier,
    hasActiveStripeSubscription: !!existingSubscription,
    stripeSubscriptionId: existingSubscription?.id,
    stripeSubscriptionStatus: existingSubscription?.status,
    stripePriceId: existingSubscription?.items?.data?.[0]?.price?.id,
    requestedTier: tier,
    requestedPriceId: priceId,
  });

  // CRITICAL: Detect and fix Stripe/DB mismatch
  // If Stripe has an active subscription but DB shows "free", sync the DB
  if (existingSubscription && subscription?.tier === "free") {
    const stripePriceId = existingSubscription.items?.data?.[0]?.price?.id;
    const stripeTier = getTierFromPriceId(stripePriceId || "");

    if (stripeTier !== "free") {
      console.warn(
        `[Checkout] STATE MISMATCH DETECTED: DB shows free but Stripe has active ${stripeTier} subscription. Syncing...`,
      );

      // Sync the database with Stripe's state
      // Get period dates from subscription item (Stripe SDK v20+ moved these from Subscription to SubscriptionItem)
      const subscriptionItem = existingSubscription.items.data[0];
      await subscriptionRepository.upsert({
        userId,
        stripeCustomerId: customerId,
        stripeSubscriptionId: existingSubscription.id,
        stripePriceId: stripePriceId,
        tier: stripeTier,
        status: existingSubscription.status,
        currentPeriodStart: subscriptionItem?.current_period_start
          ? new Date(subscriptionItem.current_period_start * 1000)
          : undefined,
        currentPeriodEnd: subscriptionItem?.current_period_end
          ? new Date(subscriptionItem.current_period_end * 1000)
          : undefined,
        cancelAtPeriodEnd: existingSubscription.cancel_at_period_end,
      });

      console.log(
        `[Checkout] STATE MISMATCH FIXED: Synced user ${userId} to tier=${stripeTier}`,
      );

      // Update local subscription reference for subsequent logic
      subscription = await subscriptionRepository.getByUserId(userId);
    }
  }

  const changeResult = await handleExistingSubscriptionChange(
    existingSubscription,
    tier,
    priceId,
    promoResult.reservedPromoCodeId,
    baseUrl,
  );
  if (changeResult) return changeResult;

  // Create new subscription checkout
  const idempotencyKey = generateIdempotencyKey(
    userId,
    tier,
    null,
    billingCycle,
  );
  console.log(
    `[Checkout] Creating checkout session for user ${userId}, tier: ${tier}, priceId: ${priceId}, couponId: ${promoResult.couponId}`,
  );
  const checkoutSession = await createCheckoutSession({
    customerId,
    priceId,
    successUrl: `${baseUrl}/?success=true`,
    cancelUrl: `${baseUrl}/?canceled=true`,
    couponId: promoResult.couponId,
    promoCodeId: promoResult.promoCodeId,
    idempotencyKey,
  });

  if (!checkoutSession) {
    console.error(
      `[Checkout] Failed to create checkout session for user ${userId}, tier: ${tier}, priceId: ${priceId}. Check Stripe logs for details.`,
    );
    await releasePromoReservation(promoResult.reservedPromoCodeId);
    return {
      error:
        "Failed to create checkout session. Please check your Stripe configuration and try again.",
      status: 500,
    };
  }

  console.log(
    `[Checkout] Checkout session created successfully: ${checkoutSession.id}, url: ${checkoutSession.url?.substring(0, 50)}...`,
  );
  return { url: checkoutSession.url ?? undefined };
}

// GET handler - redirect to Stripe checkout
export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.user) {
      const baseUrl =
        process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
      return Response.redirect(`${baseUrl}/auth/signin?callbackUrl=/`);
    }

    const { searchParams } = new URL(req.url);
    const tier = searchParams.get("tier") || undefined;
    const tokenPackType = searchParams.get("type");
    const tokenPackAmount = searchParams.get("amount") || undefined;
    const promoCode = searchParams.get("promo") || undefined;
    const billingCycle = (
      searchParams.get("cycle") === "annual" ? "annual" : "monthly"
    ) as "monthly" | "annual";

    const result = await handleCheckout(
      session.user.id,
      session.user.email,
      session.user.name,
      tier,
      tokenPackType === "token_pack" ? tokenPackAmount : undefined,
      promoCode,
      billingCycle,
    );

    if (result.error) {
      const baseUrl =
        process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
      return Response.redirect(
        `${baseUrl}/?error=${encodeURIComponent(result.error)}`,
      );
    }

    if (result.url) {
      return Response.redirect(result.url);
    }

    return Response.json({ error: "Unknown error" }, { status: 500 });
  } catch (error: unknown) {
    const err = error as Error;
    console.error("Checkout API Error:", err);
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
    return Response.redirect(
      `${baseUrl}/?error=${encodeURIComponent(err.message)}`,
    );
  }
}

// POST handler - return JSON with URL
export async function POST(req: Request) {
  try {
    // SECURITY: Validate CSRF token for POST requests
    const csrfValid = await validateCsrfRequest(req);
    if (!csrfValid) {
      console.warn("[Checkout] CSRF validation failed");
      return csrfErrorResponse();
    }

    const session = await getSession();
    if (!session?.user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const {
      tier,
      type,
      amount,
      promoCode,
      billingCycle: requestedCycle,
    } = body;
    const billingCycle = (requestedCycle === "annual" ? "annual" : "monthly") as
      | "monthly"
      | "annual";

    const result = await handleCheckout(
      session.user.id,
      session.user.email,
      session.user.name,
      tier,
      type === "token_pack" ? amount?.toString() : undefined,
      promoCode,
      billingCycle,
    );

    if (result.error) {
      return Response.json({ error: result.error }, { status: result.status });
    }

    return Response.json({ url: result.url });
  } catch (error: unknown) {
    const err = error as Error;
    console.error("Checkout API Error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
