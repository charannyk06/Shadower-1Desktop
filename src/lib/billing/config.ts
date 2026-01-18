import "server-only";

import {
  TOKEN_PACKS as PRICING_TOKEN_PACKS,
  type TokenPackId,
} from "./pricing";
import type { TokenPack } from "./types";

export interface BillingConfig {
  stripeSecretKey: string | null;
  stripePublishableKey: string | null;
  stripeWebhookSecret: string | null;
  stripePriceProMonthly: string | null;
  stripePriceProAnnual: string | null;
  stripePriceUltraMonthly: string | null;
  stripePriceUltraAnnual: string | null;
  billingEnabled: boolean;
  openmeterApiKey: string | null;
  openmeterBaseUrl: string;
}

let configValidated = false;
let cachedConfig: BillingConfig | null = null;

export function getBillingConfig(): BillingConfig {
  if (cachedConfig) return cachedConfig;

  cachedConfig = {
    stripeSecretKey: process.env.STRIPE_SECRET_KEY || null,
    stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null,
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || null,
    stripePriceProMonthly: process.env.STRIPE_PRICE_PRO_MONTHLY || null,
    stripePriceProAnnual: process.env.STRIPE_PRICE_PRO_ANNUAL || null,
    stripePriceUltraMonthly: process.env.STRIPE_PRICE_ULTRA_MONTHLY || null,
    stripePriceUltraAnnual: process.env.STRIPE_PRICE_ULTRA_ANNUAL || null,
    billingEnabled: process.env.BILLING_ENABLED === "1",
    openmeterApiKey: process.env.OPENMETER_API_KEY || null,
    openmeterBaseUrl:
      process.env.OPENMETER_BASE_URL || "https://openmeter.cloud",
  };

  return cachedConfig;
}

export interface ValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
}

export function validateBillingConfig(): ValidationResult {
  const config = getBillingConfig();
  const warnings: string[] = [];
  const errors: string[] = [];

  // If billing is not enabled, just return valid with a note
  if (!config.billingEnabled) {
    return {
      valid: true,
      warnings: ["Billing is disabled (BILLING_ENABLED != 1)"],
      errors: [],
    };
  }

  // Billing is enabled - check required config

  // Stripe is required when billing is enabled
  if (!config.stripeSecretKey) {
    errors.push("STRIPE_SECRET_KEY is required when billing is enabled");
  }

  if (!config.stripeWebhookSecret) {
    errors.push("STRIPE_WEBHOOK_SECRET is required for payment processing");
  }

  // Price IDs - at least monthly prices are required
  if (!config.stripePriceProMonthly) {
    errors.push(
      "STRIPE_PRICE_PRO_MONTHLY is required for Pro subscription tier",
    );
  }

  if (!config.stripePriceUltraMonthly) {
    errors.push(
      "STRIPE_PRICE_ULTRA_MONTHLY is required for Ultra subscription tier",
    );
  }

  // Annual prices are optional but recommended
  if (!config.stripePriceProAnnual) {
    warnings.push(
      "STRIPE_PRICE_PRO_ANNUAL not set - annual Pro plans unavailable",
    );
  }

  if (!config.stripePriceUltraAnnual) {
    warnings.push(
      "STRIPE_PRICE_ULTRA_ANNUAL not set - annual Ultra plans unavailable",
    );
  }

  // Publishable key is optional but useful for client-side
  if (!config.stripePublishableKey) {
    warnings.push(
      "STRIPE_PUBLISHABLE_KEY not set - some client features may be limited",
    );
  }

  // OpenMeter is optional but recommended for usage tracking
  if (!config.openmeterApiKey) {
    warnings.push(
      "OPENMETER_API_KEY not set - using local usage tracking only",
    );
  }

  return {
    valid: errors.length === 0,
    warnings,
    errors,
  };
}

/**
 * Logs billing configuration status on first call.
 * Call this in billing-related API routes to ensure config is validated.
 */
export function ensureBillingConfigValidated(): ValidationResult {
  if (configValidated) {
    return validateBillingConfig();
  }

  const result = validateBillingConfig();
  configValidated = true;

  // Log validation results
  if (result.errors.length > 0) {
    console.error("[Billing Config] Configuration errors detected:");
    result.errors.forEach((err) => console.error(`  ❌ ${err}`));
  }

  if (result.warnings.length > 0 && getBillingConfig().billingEnabled) {
    console.warn("[Billing Config] Configuration warnings:");
    result.warnings.forEach((warn) => console.warn(`  ⚠️ ${warn}`));
  }

  if (result.valid && getBillingConfig().billingEnabled) {
    console.log("[Billing Config] ✅ Configuration validated successfully");
  }

  return result;
}

/**
 * Check if a specific pricing feature is available
 */
export function isPricingAvailable(
  tier: "pro" | "ultra",
  cycle: "monthly" | "annual",
): boolean {
  const config = getBillingConfig();

  if (!config.billingEnabled) return false;

  if (tier === "pro") {
    return cycle === "monthly"
      ? !!config.stripePriceProMonthly
      : !!config.stripePriceProAnnual;
  }

  if (tier === "ultra") {
    return cycle === "monthly"
      ? !!config.stripePriceUltraMonthly
      : !!config.stripePriceUltraAnnual;
  }

  return false;
}

export const billingConfig = {
  get: getBillingConfig,
  validate: validateBillingConfig,
  ensureValidated: ensureBillingConfigValidated,
  isPricingAvailable,
};

// ============================================================================
// Token Pack Configuration
// ============================================================================

/**
 * Token pack configurations derived from centralized pricing.
 * Pricing source of truth is in ./pricing.ts
 *
 * This provides runtime config (enabled flag) while pricing.ts provides prices.
 * IDs here use numeric strings ("500000") for Stripe compatibility.
 */

// Map from pricing.ts short IDs to numeric string IDs
const PACK_ID_MAP: Record<TokenPackId, string> = {
  "500k": "500000",
  "2m": "2000000",
  "5m": "5000000",
};

// Reverse map for lookups by short ID
const SHORT_ID_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(PACK_ID_MAP).map(([short, numeric]) => [short, numeric]),
);

// Build TOKEN_PACKS from pricing.ts source of truth
export const TOKEN_PACKS: TokenPack[] = Object.entries(PRICING_TOKEN_PACKS).map(
  ([shortId, config]) => ({
    id: PACK_ID_MAP[shortId as TokenPackId],
    tokens: config.credits,
    price: config.priceCents,
    pricePerMillion: config.priceCents / 100 / (config.credits / 1_000_000),
    enabled: true,
    displayName: config.label,
    description: config.description,
    popular: shortId === "2m", // Mark 2M pack as popular
  }),
);

/**
 * Get a token pack by its ID
 * Supports both numeric IDs ("500000") and short IDs ("500k")
 * Returns undefined if not found or disabled
 */
export function getTokenPack(id: string): TokenPack | undefined {
  // Normalize short IDs to numeric IDs
  const numericId = SHORT_ID_MAP[id] || id;
  return TOKEN_PACKS.find((pack) => pack.id === numericId && pack.enabled);
}

/**
 * Get all enabled token packs
 */
export function getEnabledTokenPacks(): TokenPack[] {
  return TOKEN_PACKS.filter((pack) => pack.enabled);
}

/**
 * Get a simple price/tokens map for enabled packs
 * Useful for backwards compatibility
 */
export function getTokenPackPriceMap(): Record<
  string,
  { price: number; tokens: number }
> {
  return Object.fromEntries(
    TOKEN_PACKS.filter((pack) => pack.enabled).map((pack) => [
      pack.id,
      { price: pack.price, tokens: pack.tokens },
    ]),
  );
}

/**
 * Validate a token pack ID
 */
export function isValidTokenPack(id: string): boolean {
  return TOKEN_PACKS.some((pack) => pack.id === id && pack.enabled);
}
