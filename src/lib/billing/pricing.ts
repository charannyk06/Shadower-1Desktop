/**
 * CENTRALIZED PRICING CONFIGURATION
 *
 * This is the SINGLE SOURCE OF TRUTH for all subscription and token pack prices.
 * All prices are stored in CENTS to avoid floating point issues.
 *
 * When updating prices:
 * 1. Update this file ONLY
 * 2. All other files import from here
 * 3. Stripe product prices must match these values
 */

import type { SubscriptionTier } from "./types";

export type BillingCycle = "monthly" | "annual";

// =============================================================================
// SUBSCRIPTION PRICES (in cents)
// =============================================================================

export const SUBSCRIPTION_PRICES = {
  free: {
    monthly: 0,
    annual: 0,
  },
  pro: {
    monthly: 1999, // $19.99
    annual: 19200, // $192.00 (Stripe rounds to clean number, ~20% off)
  },
  ultra: {
    monthly: 4999, // $49.99
    annual: 48000, // $480.00 (Stripe rounds to clean number, ~20% off)
  },
} as const satisfies Record<
  SubscriptionTier,
  { monthly: number; annual: number }
>;

// =============================================================================
// TOKEN PACK PRICES (in cents)
// =============================================================================

export type TokenPackId = "500k" | "2m" | "5m";

export interface TokenPackConfig {
  id: TokenPackId;
  credits: number;
  priceCents: number;
  label: string;
  description: string;
}

export const TOKEN_PACKS: Record<TokenPackId, TokenPackConfig> = {
  "500k": {
    id: "500k",
    credits: 500_000,
    priceCents: 199, // $1.99
    label: "500K Credits",
    description: "Great for trying out premium features",
  },
  "2m": {
    id: "2m",
    credits: 2_000_000,
    priceCents: 599, // $5.99
    label: "2M Credits",
    description: "Best value for regular users",
  },
  "5m": {
    id: "5m",
    credits: 5_000_000,
    priceCents: 1499, // $14.99
    label: "5M Credits",
    description: "For power users and teams",
  },
} as const;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get subscription price in cents
 */
export function getPrice(tier: SubscriptionTier, cycle: BillingCycle): number {
  return SUBSCRIPTION_PRICES[tier][cycle];
}

/**
 * Get subscription price in dollars
 */
export function getPriceDollars(
  tier: SubscriptionTier,
  cycle: BillingCycle,
): number {
  return SUBSCRIPTION_PRICES[tier][cycle] / 100;
}

/**
 * Get monthly price in cents (for a given tier)
 */
export function getMonthlyPrice(tier: SubscriptionTier): number {
  return SUBSCRIPTION_PRICES[tier].monthly;
}

/**
 * Get annual price in cents (for a given tier)
 */
export function getAnnualPrice(tier: SubscriptionTier): number {
  return SUBSCRIPTION_PRICES[tier].annual;
}

/**
 * Calculate annual savings percentage compared to monthly billing
 * Returns the percentage off (e.g., 20 for 20% off)
 */
export function getAnnualSavingsPercent(tier: "pro" | "ultra"): number {
  const monthlyTotal = SUBSCRIPTION_PRICES[tier].monthly * 12;
  const annualPrice = SUBSCRIPTION_PRICES[tier].annual;
  const savings = ((monthlyTotal - annualPrice) / monthlyTotal) * 100;
  return Math.round(savings);
}

/**
 * Get formatted price string (e.g., "$19.99")
 */
export function formatPrice(cents: number): string {
  const dollars = cents / 100;
  // Use toFixed(2) but remove trailing zeros for clean numbers
  const formatted = dollars.toFixed(2);
  // Remove .00 for round dollar amounts
  if (formatted.endsWith(".00")) {
    return `$${dollars.toFixed(0)}`;
  }
  return `$${formatted}`;
}

/**
 * Get token pack by ID
 */
export function getTokenPack(id: TokenPackId): TokenPackConfig {
  return TOKEN_PACKS[id];
}

/**
 * Get all token packs as array
 */
export function getAllTokenPacks(): TokenPackConfig[] {
  return Object.values(TOKEN_PACKS);
}
