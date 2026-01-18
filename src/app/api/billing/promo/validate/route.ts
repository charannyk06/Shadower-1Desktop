import * as crypto from "node:crypto";
import type { SubscriptionTier } from "@/lib/billing/types";
import { promoCodeRepository } from "@/lib/db/repository";
import { validateSessionJson } from "lib/api/auth-helpers";
import { promoCodeRateLimiter } from "lib/api/rate-limiter";
import { z } from "zod";

// Normalize promo code: uppercase and trim only
// Note: We preserve hyphens and other characters to match how codes are stored
function normalizePromoCode(code: string): string {
  return code.trim().toUpperCase();
}

// Add artificial delay to prevent timing attacks (uses cryptographic randomness)
async function securityDelay(ms: number = 100) {
  const jitter = crypto.randomInt(0, 51); // 0-50ms cryptographically random jitter
  await new Promise((resolve) => setTimeout(resolve, ms + jitter));
}

const validatePromoSchema = z.object({
  code: z
    .string()
    .min(1, "Promo code is required")
    .max(50, "Promo code too long")
    .transform(normalizePromoCode),
  purchaseType: z.enum(["subscription", "token_pack"]),
  tier: z.enum(["free", "pro", "ultra"]).optional(),
  amount: z.number().positive("Amount must be positive").max(1_000_000),
  tokenPackAmount: z.string().optional(),
});

// Generic error message to prevent enumeration
const GENERIC_INVALID_ERROR = "Invalid or expired promo code";

export async function POST(request: Request) {
  try {
    const auth = await validateSessionJson();
    if (!auth.success) return auth.response;

    // SECURITY: Rate limiting check
    const rateLimitResult = promoCodeRateLimiter.check(auth.userId);
    if (!rateLimitResult.allowed) {
      const retryAfterSec = Math.ceil(
        (rateLimitResult.retryAfterMs || 60000) / 1000,
      );
      return Response.json(
        {
          valid: false,
          error: `Too many attempts. Please try again in ${retryAfterSec} seconds.`,
        },
        { status: 429 },
      );
    }

    // Add delay if user has many failed attempts (anti-brute-force)
    if (rateLimitResult.shouldDelay) {
      await securityDelay(500); // 500ms delay after multiple failures
    }

    const body = await request.json();
    const parsed = validatePromoSchema.safeParse(body);

    if (!parsed.success) {
      return Response.json(
        {
          valid: false,
          error: parsed.error.issues[0]?.message || "Invalid request",
        },
        { status: 400 },
      );
    }

    const { code, purchaseType, tier, amount, tokenPackAmount } = parsed.data;

    // SECURITY: Reject empty codes after normalization
    if (code.length === 0) {
      await securityDelay(); // Consistent timing
      promoCodeRateLimiter.recordFailure(auth.userId);
      return Response.json(
        { valid: false, error: GENERIC_INVALID_ERROR },
        { status: 200 },
      );
    }

    const result = await promoCodeRepository.validateCode(
      code,
      auth.userId,
      purchaseType,
      amount,
      tier as SubscriptionTier | undefined,
      tokenPackAmount,
    );

    // SECURITY: Always add a small delay to prevent timing attacks
    await securityDelay();

    if (!result.valid) {
      // Log actual error for debugging (server-side only)
      console.log(
        `[Promo Validate] Code "${code}" failed: ${result.error} | purchaseType=${purchaseType} tier=${tier} amount=${amount}`,
      );
      promoCodeRateLimiter.recordFailure(auth.userId);
      // SECURITY: Use generic error to prevent enumeration
      // Only provide specific error for user-limit errors (non-sensitive)
      const safeError =
        result.error === "You've already used this code"
          ? result.error
          : GENERIC_INVALID_ERROR;
      return Response.json({ valid: false, error: safeError }, { status: 200 });
    }

    return Response.json({
      valid: true,
      discount: result.discount,
      promoCodeId: result.promoCode?.id,
      applicableTokenPacks: result.promoCode?.applicableTokenPacks || [],
    });
  } catch (error) {
    console.error("[Promo Validate] Error:", error);
    // SECURITY: Add delay even on errors
    await securityDelay();
    return Response.json(
      { valid: false, error: "Failed to validate promo code" },
      { status: 500 },
    );
  }
}
