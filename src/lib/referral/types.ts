/**
 * Referral System Types
 */

export type ReferralStatus = "pending" | "completed" | "expired";

export interface Referral {
  id: string;
  referrerId: string;
  refereeId: string;
  referralCode: string;
  status: ReferralStatus;
  referrerBonus: string;
  refereeBonus: string;
  completedAt: Date | null;
  createdAt: Date;
}

export interface ReferralWithUsers extends Referral {
  referrer?: {
    id: string;
    name: string;
    email: string;
  };
  referee?: {
    id: string;
    name: string;
    email: string;
  };
}

export interface ReferralStats {
  totalReferrals: number;
  completedReferrals: number;
  pendingReferrals: number;
  totalBonusEarned: number;
}

export interface ReferralConfig {
  /** Bonus credits for the referrer when referral completes */
  referrerBonus: number;
  /** Bonus credits for the referee when referral completes */
  refereeBonus: number;
  /** Whether the referee must make a purchase to complete the referral */
  requirePurchase: boolean;
  /** Number of days before a pending referral expires */
  expirationDays: number;
}

export interface ApplyReferralResult {
  success: boolean;
  error?: string;
  referral?: Referral;
}

export interface CompleteReferralResult {
  success: boolean;
  referrerBonusAwarded: number;
  refereeBonusAwarded: number;
}
