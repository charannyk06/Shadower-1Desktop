import type { SubscriptionTier } from "@/lib/billing/types";
import { and, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { pgDb as db, pgDbUnpooled as dbUnpooled } from "../db.pg";
import {
  PromoCodeRedemptionTable,
  PromoCodeTable,
  SubscriptionTable,
} from "../schema.pg";

// In-memory tracking for idempotent release operations
// Key format: "promoCodeId:sessionId"
// This prevents double-releases within a single server instance
const releasedReservations = new Set<string>();

// Cleanup old entries periodically to prevent memory leaks
// Entries older than 1 hour are automatically removed
const RELEASE_TRACKING_TTL_MS = 60 * 60 * 1000; // 1 hour
const releaseTimestamps = new Map<string, number>();

function cleanupOldReleaseTracking() {
  const now = Date.now();
  for (const [key, timestamp] of releaseTimestamps.entries()) {
    if (now - timestamp > RELEASE_TRACKING_TTL_MS) {
      releasedReservations.delete(key);
      releaseTimestamps.delete(key);
    }
  }
}

export interface PromoCode {
  id: string;
  code: string;
  description: string | null;
  discountType: "percentage" | "fixed_amount";
  discountValue: string;
  appliesTo: "all" | "subscription" | "token_pack";
  applicableTiers: string[];
  applicableTokenPacks: string[]; // e.g., ["500000", "2000000", "5000000"]
  maxRedemptions: string | null;
  currentRedemptions: string;
  maxPerUser: string;
  newUsersOnly: boolean;
  minAmount: string | null;
  startsAt: Date;
  expiresAt: Date | null;
  isActive: boolean;
  stripeCouponId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
  discount?: {
    type: "percentage" | "fixed_amount";
    value: number;
    discountAmount: number;
    finalAmount: number;
  };
  promoCode?: PromoCode;
}

export interface CreatePromoCode {
  code: string;
  description?: string;
  discountType: "percentage" | "fixed_amount";
  discountValue: number;
  appliesTo?: "all" | "subscription" | "token_pack";
  applicableTiers?: string[];
  applicableTokenPacks?: string[]; // e.g., ["2000000"] for 2M pack only
  maxRedemptions?: number;
  maxPerUser?: number;
  newUsersOnly?: boolean;
  minAmount?: number;
  startsAt?: Date;
  expiresAt?: Date;
}

export interface RecordRedemption {
  promoCodeId: string;
  userId: string;
  purchaseType: "subscription" | "token_pack";
  originalAmount: number;
  discountAmount: number;
  finalAmount: number;
  stripeCheckoutSessionId?: string;
  stripeInvoiceId?: string;
}

export interface AtomicReservationResult {
  success: boolean;
  error?: string;
}

export interface PromoCodeRepository {
  create(data: CreatePromoCode): Promise<PromoCode>;
  getByCode(code: string): Promise<PromoCode | null>;
  getById(id: string): Promise<PromoCode | null>;
  getAll(): Promise<PromoCode[]>;
  update(id: string, data: Partial<PromoCode>): Promise<PromoCode>;
  deactivate(id: string): Promise<void>;
  listActive(): Promise<PromoCode[]>;
  validateCode(
    code: string,
    userId: string,
    purchaseType: "subscription" | "token_pack",
    amount: number,
    tier?: SubscriptionTier,
    tokenPackAmount?: string, // e.g., "2000000" for 2M pack
  ): Promise<ValidationResult>;
  recordRedemption(data: RecordRedemption): Promise<void>;
  getUserRedemptions(userId: string, promoCodeId: string): Promise<number>;
  incrementRedemptionCount(promoCodeId: string): Promise<void>;
  updateStripeCouponId(id: string, stripeCouponId: string): Promise<void>;
  /**
   * SECURITY: Atomic check-and-reserve to prevent race conditions
   * Atomically checks if redemption is allowed AND reserves the slot
   * Returns success=true if reservation was made, false if limit exceeded
   */
  atomicReserveRedemption(
    promoCodeId: string,
    userId: string,
    maxRedemptions: number | null,
    maxPerUser: number,
  ): Promise<AtomicReservationResult>;
  /**
   * Release a reservation if checkout fails (decrement the count)
   * Returns true if release was successful, false if already released or failed
   * @param promoCodeId - The promo code ID
   * @param sessionId - Optional session ID for idempotency (prevents double-releases)
   */
  releaseReservation(promoCodeId: string, sessionId?: string): Promise<boolean>;
}

export const pgPromoCodeRepository: PromoCodeRepository = {
  async create(data) {
    const [result] = await db
      .insert(PromoCodeTable)
      .values({
        code: data.code.toUpperCase(),
        description: data.description,
        discountType: data.discountType,
        discountValue: String(data.discountValue),
        appliesTo: data.appliesTo || "all",
        applicableTiers: data.applicableTiers || [],
        applicableTokenPacks: data.applicableTokenPacks || [],
        maxRedemptions: data.maxRedemptions
          ? String(data.maxRedemptions)
          : null,
        maxPerUser: String(data.maxPerUser || 1),
        newUsersOnly: data.newUsersOnly || false,
        minAmount: data.minAmount ? String(data.minAmount) : null,
        startsAt: data.startsAt || new Date(),
        expiresAt: data.expiresAt,
      })
      .returning();
    return result as unknown as PromoCode;
  },

  async getByCode(code: string) {
    const normalizedCode = code.trim().toUpperCase();
    const [result] = await db
      .select()
      .from(PromoCodeTable)
      .where(eq(PromoCodeTable.code, normalizedCode));
    return (result as unknown as PromoCode) || null;
  },

  async getById(id: string) {
    const [result] = await db
      .select()
      .from(PromoCodeTable)
      .where(eq(PromoCodeTable.id, id));
    return (result as unknown as PromoCode) || null;
  },

  async getAll() {
    const results = await db
      .select()
      .from(PromoCodeTable)
      .orderBy(PromoCodeTable.createdAt);
    return results as unknown as PromoCode[];
  },

  async update(id: string, data: Partial<PromoCode>) {
    const [result] = await db
      .update(PromoCodeTable)
      .set({
        ...data,
        updatedAt: new Date(),
      } as any)
      .where(eq(PromoCodeTable.id, id))
      .returning();
    return result as unknown as PromoCode;
  },

  async deactivate(id: string) {
    await db
      .update(PromoCodeTable)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(PromoCodeTable.id, id));
  },

  async listActive() {
    const now = new Date();
    const results = await db
      .select()
      .from(PromoCodeTable)
      .where(
        and(
          eq(PromoCodeTable.isActive, true),
          lte(PromoCodeTable.startsAt, now),
          or(
            isNull(PromoCodeTable.expiresAt),
            gte(PromoCodeTable.expiresAt, now),
          ),
        ),
      );
    return results as unknown as PromoCode[];
  },

  async validateCode(
    code,
    userId,
    purchaseType,
    amount,
    tier,
    tokenPackAmount,
  ) {
    const promo = await this.getByCode(code);

    if (!promo) {
      return { valid: false, error: "Invalid promo code" };
    }

    if (!promo.isActive) {
      return { valid: false, error: "This code is no longer active" };
    }

    const now = new Date();

    if (promo.expiresAt && promo.expiresAt < now) {
      return { valid: false, error: "This code has expired" };
    }

    if (promo.startsAt > now) {
      return { valid: false, error: "This code is not yet active" };
    }

    // Check max redemptions
    if (promo.maxRedemptions) {
      const maxRedemptions = Number(promo.maxRedemptions);
      const currentRedemptions = Number(promo.currentRedemptions);
      if (currentRedemptions >= maxRedemptions) {
        return { valid: false, error: "This code has reached its usage limit" };
      }
    }

    // Check user-specific limits
    const userRedemptions = await this.getUserRedemptions(userId, promo.id);
    const maxPerUser = Number(promo.maxPerUser);
    if (userRedemptions >= maxPerUser) {
      return { valid: false, error: "You've already used this code" };
    }

    // Check new users only
    if (promo.newUsersOnly) {
      const [existingSub] = await db
        .select()
        .from(SubscriptionTable)
        .where(eq(SubscriptionTable.userId, userId));

      if (existingSub && existingSub.tier !== "free") {
        return {
          valid: false,
          error: "This code is for new subscribers only",
        };
      }
    }

    // Check purchase type applicability
    if (promo.appliesTo !== "all" && promo.appliesTo !== purchaseType) {
      return {
        valid: false,
        error: `This code only applies to ${promo.appliesTo === "subscription" ? "subscriptions" : "token packs"}`,
      };
    }

    // Check tier applicability
    if (
      tier &&
      promo.applicableTiers &&
      promo.applicableTiers.length > 0 &&
      !promo.applicableTiers.includes(tier)
    ) {
      return {
        valid: false,
        error: `This code is not valid for the ${tier} plan`,
      };
    }

    // Check token pack applicability
    if (
      purchaseType === "token_pack" &&
      tokenPackAmount &&
      promo.applicableTokenPacks &&
      promo.applicableTokenPacks.length > 0 &&
      !promo.applicableTokenPacks.includes(tokenPackAmount)
    ) {
      const packLabels: Record<string, string> = {
        "500000": "500K",
        "2000000": "2M",
        "5000000": "5M",
      };
      const allowedPacks = promo.applicableTokenPacks
        .map((p) => packLabels[p] || p)
        .join(", ");
      return {
        valid: false,
        error: `This code only applies to ${allowedPacks} token pack${promo.applicableTokenPacks.length > 1 ? "s" : ""}`,
      };
    }

    // Check minimum amount
    if (promo.minAmount) {
      const minAmount = Number(promo.minAmount);
      if (amount < minAmount) {
        return {
          valid: false,
          error: `Minimum purchase of $${(minAmount / 100).toFixed(2)} required`,
        };
      }
    }

    // Calculate discount
    const discountValue = Number(promo.discountValue);
    const discountAmount =
      promo.discountType === "percentage"
        ? Math.round((amount * discountValue) / 100)
        : Math.min(discountValue, amount);

    return {
      valid: true,
      discount: {
        type: promo.discountType,
        value: discountValue,
        discountAmount,
        finalAmount: amount - discountAmount,
      },
      promoCode: promo,
    };
  },

  async recordRedemption(data) {
    await db.insert(PromoCodeRedemptionTable).values({
      promoCodeId: data.promoCodeId,
      userId: data.userId,
      purchaseType: data.purchaseType,
      originalAmount: String(data.originalAmount),
      discountAmount: String(data.discountAmount),
      finalAmount: String(data.finalAmount),
      stripeCheckoutSessionId: data.stripeCheckoutSessionId,
      stripeInvoiceId: data.stripeInvoiceId,
    });

    // NOTE: We no longer increment here since atomicReserveRedemption does it
    // at checkout time to prevent race conditions. The count is reserved
    // before the Stripe checkout session is created.
    // If you need to support legacy flows without atomic reservation,
    // uncomment the line below:
    // await this.incrementRedemptionCount(data.promoCodeId);
  },

  async getUserRedemptions(userId: string, promoCodeId: string) {
    const results = await db
      .select({ count: sql<number>`count(*)` })
      .from(PromoCodeRedemptionTable)
      .where(
        and(
          eq(PromoCodeRedemptionTable.userId, userId),
          eq(PromoCodeRedemptionTable.promoCodeId, promoCodeId),
        ),
      );
    return Number(results[0]?.count) || 0;
  },

  async incrementRedemptionCount(promoCodeId: string) {
    await db
      .update(PromoCodeTable)
      .set({
        currentRedemptions: sql`(${PromoCodeTable.currentRedemptions}::numeric + 1)::text`,
        updatedAt: new Date(),
      })
      .where(eq(PromoCodeTable.id, promoCodeId));
  },

  async updateStripeCouponId(id: string, stripeCouponId: string) {
    await db
      .update(PromoCodeTable)
      .set({
        stripeCouponId,
        updatedAt: new Date(),
      })
      .where(eq(PromoCodeTable.id, id));
  },

  /**
   * SECURITY: Atomic check-and-reserve to prevent race conditions on redemption limits
   * Uses a transaction with row-level locking to ensure atomicity
   * This prevents the TOCTOU (time-of-check-time-of-use) race condition for both
   * global limits AND per-user limits
   */
  async atomicReserveRedemption(
    promoCodeId: string,
    userId: string,
    maxRedemptions: number | null,
    maxPerUser: number,
  ): Promise<AtomicReservationResult> {
    console.log(
      `[PromoCode] atomicReserveRedemption called for promoCodeId: ${promoCodeId}, userId: ${userId}`,
    );
    try {
      // IMPORTANT: Use unpooled connection for transactions with row-level locking.
      // Neon's connection pooler (PgBouncer) in transaction mode doesn't properly
      // support SELECT ... FOR UPDATE because queries may be routed to different
      // backend connections, breaking the lock.
      return await dbUnpooled.transaction(async (tx) => {
        // Lock the promo code row to prevent concurrent modifications
        // Using FOR UPDATE to acquire an exclusive lock
        const [promo] = await tx
          .select()
          .from(PromoCodeTable)
          .where(eq(PromoCodeTable.id, promoCodeId))
          .for("update");

        if (!promo) {
          return { success: false, error: "Promo code not found" };
        }

        // Check global redemption limit
        const currentRedemptions = Number(promo.currentRedemptions);
        if (maxRedemptions !== null && currentRedemptions >= maxRedemptions) {
          return {
            success: false,
            error: "This code has reached its usage limit",
          };
        }

        // Check per-user limit within the transaction
        const userRedemptionResults = await tx
          .select({ count: sql<number>`count(*)` })
          .from(PromoCodeRedemptionTable)
          .where(
            and(
              eq(PromoCodeRedemptionTable.userId, userId),
              eq(PromoCodeRedemptionTable.promoCodeId, promoCodeId),
            ),
          );
        const userRedemptions = Number(userRedemptionResults[0]?.count) || 0;

        if (userRedemptions >= maxPerUser) {
          return { success: false, error: "You've already used this code" };
        }

        // All checks passed - increment the counter
        await tx
          .update(PromoCodeTable)
          .set({
            currentRedemptions: sql`(${PromoCodeTable.currentRedemptions}::numeric + 1)::text`,
            updatedAt: new Date(),
          })
          .where(eq(PromoCodeTable.id, promoCodeId));

        console.log(
          `[PromoCode] atomicReserveRedemption succeeded for promoCodeId: ${promoCodeId}, userId: ${userId}`,
        );
        return { success: true };
      });
    } catch (error) {
      console.error(
        `[PromoCode] atomicReserveRedemption failed for ${promoCodeId}:`,
        error,
      );
      return {
        success: false,
        error: "Failed to reserve promo code. Please try again.",
      };
    }
  },

  /**
   * Release a reservation if checkout fails (decrement the count)
   * Returns true if release was successful, false if already released or failed
   * @param promoCodeId - The promo code ID
   * @param sessionId - Optional session ID for idempotency (prevents double-releases)
   */
  async releaseReservation(
    promoCodeId: string,
    sessionId?: string,
  ): Promise<boolean> {
    try {
      // Idempotency check: if sessionId is provided, check if already released
      if (sessionId) {
        const releaseKey = `${promoCodeId}:${sessionId}`;

        // Clean up old tracking entries periodically
        cleanupOldReleaseTracking();

        if (releasedReservations.has(releaseKey)) {
          console.log(
            `[PromoCode] Skipping duplicate release for ${promoCodeId} (session: ${sessionId})`,
          );
          return true; // Return true since the release was already done
        }

        // Mark as released before the operation (optimistic)
        releasedReservations.add(releaseKey);
        releaseTimestamps.set(releaseKey, Date.now());
      }

      const result = await db
        .update(PromoCodeTable)
        .set({
          currentRedemptions: sql`GREATEST(0, ${PromoCodeTable.currentRedemptions}::numeric - 1)::text`,
          updatedAt: new Date(),
        })
        .where(eq(PromoCodeTable.id, promoCodeId))
        .returning({ id: PromoCodeTable.id });

      if (result.length === 0) {
        console.error(
          `[PromoCode] Release failed - promo code not found: ${promoCodeId}`,
        );
        return false;
      }

      console.log(
        `[PromoCode] Successfully released reservation for promo code: ${promoCodeId}${sessionId ? ` (session: ${sessionId})` : ""}`,
      );
      return true;
    } catch (error) {
      // Log the error but don't throw - this is a cleanup operation
      // We don't want a failed release to break the checkout flow
      console.error(
        `[PromoCode] Failed to release reservation for ${promoCodeId}:`,
        error,
      );
      return false;
    }
  },
};
