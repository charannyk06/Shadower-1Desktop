/**
 * Referral System Service
 *
 * Handles referral code generation, application, and completion.
 */

import { eq, sql } from "drizzle-orm";
import { pgDb as db } from "lib/db/pg/db.pg";
import { UserTable } from "lib/db/pg/schema.pg";
import { referralRepository, subscriptionRepository } from "lib/db/repository";
import { nanoid } from "nanoid";
import type {
  ApplyReferralResult,
  CompleteReferralResult,
  ReferralConfig,
} from "./types";

/**
 * Default referral configuration
 */
export const REFERRAL_CONFIG: ReferralConfig = {
  referrerBonus: 100_000, // 100K credits for referrer
  refereeBonus: 50_000, // 50K credits for new user
  requirePurchase: true, // Must make first purchase to complete
  expirationDays: 30, // Referral expires after 30 days
};

/**
 * Generate a unique referral code for a user
 */
export async function generateReferralCode(userId: string): Promise<string> {
  // Check if user already has a referral code
  const [existingUser] = await db
    .select({ referralCode: UserTable.referralCode })
    .from(UserTable)
    .where(eq(UserTable.id, userId));

  if (existingUser?.referralCode) {
    return existingUser.referralCode;
  }

  // Generate a unique code (8 chars, uppercase alphanumeric)
  const code = nanoid(8).toUpperCase();

  // Save to user record
  await db
    .update(UserTable)
    .set({ referralCode: code })
    .where(eq(UserTable.id, userId));

  console.log(`[Referral] Generated code ${code} for user ${userId}`);
  return code;
}

/**
 * Get referral code for a user (generate if doesn't exist)
 */
export async function getReferralCode(userId: string): Promise<string> {
  const [user] = await db
    .select({ referralCode: UserTable.referralCode })
    .from(UserTable)
    .where(eq(UserTable.id, userId));

  if (user?.referralCode) {
    return user.referralCode;
  }

  return generateReferralCode(userId);
}

/**
 * Get the referrer user by referral code
 */
export async function getReferrerByCode(
  code: string,
): Promise<{ id: string; name: string | null; email: string | null } | null> {
  const [referrer] = await db
    .select({
      id: UserTable.id,
      name: UserTable.name,
      email: UserTable.email,
    })
    .from(UserTable)
    .where(eq(UserTable.referralCode, code.toUpperCase()));

  return referrer || null;
}

/**
 * Apply a referral code during signup
 * Creates a pending referral that will be completed after first purchase
 */
export async function applyReferralCode(
  refereeId: string,
  code: string,
): Promise<ApplyReferralResult> {
  const normalizedCode = code.toUpperCase().trim();

  // Find the referrer by code
  const referrer = await getReferrerByCode(normalizedCode);
  if (!referrer) {
    return { success: false, error: "Invalid referral code" };
  }

  // Can't refer yourself
  if (referrer.id === refereeId) {
    return { success: false, error: "Cannot use your own referral code" };
  }

  // Check if user has already been referred
  const alreadyReferred = await referralRepository.hasBeenReferred(refereeId);
  if (alreadyReferred) {
    return { success: false, error: "You have already used a referral code" };
  }

  // Create the pending referral
  const referral = await referralRepository.create({
    referrerId: referrer.id,
    refereeId,
    referralCode: normalizedCode,
  });

  // Update the referee's referredById field
  await db
    .update(UserTable)
    .set({ referredById: referrer.id })
    .where(eq(UserTable.id, refereeId));

  console.log(
    `[Referral] Code ${normalizedCode} applied by user ${refereeId}, referrer: ${referrer.id}`,
  );

  return { success: true, referral };
}

/**
 * Complete a referral after the referee makes their first purchase
 * Awards bonuses to both parties
 */
export async function completeReferral(
  refereeId: string,
): Promise<CompleteReferralResult> {
  // Check for pending referral
  const referral = await referralRepository.getPendingByReferee(refereeId);

  if (!referral) {
    return { success: false, referrerBonusAwarded: 0, refereeBonusAwarded: 0 };
  }

  // Complete the referral and record bonuses
  const completed = await referralRepository.complete(
    referral.id,
    REFERRAL_CONFIG.referrerBonus,
    REFERRAL_CONFIG.refereeBonus,
  );

  if (!completed) {
    console.error(
      `[Referral] Failed to complete referral ${referral.id} - may already be completed`,
    );
    return { success: false, referrerBonusAwarded: 0, refereeBonusAwarded: 0 };
  }

  // Award bonus credits to referrer
  await subscriptionRepository.addPurchasedTokens(
    referral.referrerId,
    REFERRAL_CONFIG.referrerBonus.toString(),
  );

  // Award bonus credits to referee
  await subscriptionRepository.addPurchasedTokens(
    refereeId,
    REFERRAL_CONFIG.refereeBonus.toString(),
  );

  // Update referrer's total referral count
  await db
    .update(UserTable)
    .set({
      totalReferrals: sql`${UserTable.totalReferrals} + 1`,
      totalReferralBonus: sql`(${UserTable.totalReferralBonus}::numeric + ${REFERRAL_CONFIG.referrerBonus})::text`,
    })
    .where(eq(UserTable.id, referral.referrerId));

  console.log(
    `[Referral] Completed referral ${referral.id}: referrer ${referral.referrerId} got ${REFERRAL_CONFIG.referrerBonus}, referee ${refereeId} got ${REFERRAL_CONFIG.refereeBonus}`,
  );

  return {
    success: true,
    referrerBonusAwarded: REFERRAL_CONFIG.referrerBonus,
    refereeBonusAwarded: REFERRAL_CONFIG.refereeBonus,
  };
}

/**
 * Get referral statistics for a user
 */
export async function getReferralStats(userId: string) {
  const stats = await referralRepository.getStats(userId);
  const referrals = await referralRepository.getByReferrerId(userId);

  // Get user's referral code
  const code = await getReferralCode(userId);

  return {
    code,
    stats,
    referrals,
    config: {
      referrerBonus: REFERRAL_CONFIG.referrerBonus,
      refereeBonus: REFERRAL_CONFIG.refereeBonus,
    },
  };
}

/**
 * Check if a user was referred and has a pending referral
 */
export async function hasPendingReferral(userId: string): Promise<boolean> {
  const referral = await referralRepository.getPendingByReferee(userId);
  return !!referral;
}

/**
 * Expire old pending referrals
 * Should be called by a cron job
 */
export async function expireOldReferrals(): Promise<number> {
  const expiredReferrals = await referralRepository.getExpiredReferrals(
    REFERRAL_CONFIG.expirationDays,
  );

  let expiredCount = 0;
  for (const referral of expiredReferrals) {
    const expired = await referralRepository.expire(referral.id);
    if (expired) {
      expiredCount++;
      console.log(`[Referral] Expired referral ${referral.id}`);
    }
  }

  if (expiredCount > 0) {
    console.log(`[Referral] Expired ${expiredCount} old referrals`);
  }

  return expiredCount;
}
