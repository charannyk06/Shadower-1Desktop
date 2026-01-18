import { validateCronAuth } from "@/lib/cron/auth";
import { expireOldReferrals } from "lib/referral/service";
import { NextResponse } from "next/server";

/**
 * Cron job to expire old pending referrals
 * Should be called daily
 *
 * Configure in vercel.json:
 * {
 *   "crons": [{
 *     "path": "/api/cron/referral-expiry",
 *     "schedule": "0 0 * * *"
 *   }]
 * }
 */
export async function GET(req: Request) {
  const authError = validateCronAuth(req, "ReferralExpiry");
  if (authError) return authError;

  try {
    console.log("[Referral Expiry Cron] Starting");

    const expiredCount = await expireOldReferrals();

    console.log(
      `[Referral Expiry Cron] Completed - expired ${expiredCount} referrals`,
    );

    return NextResponse.json({
      success: true,
      expired: expiredCount,
    });
  } catch (error: unknown) {
    const err = error as Error;
    console.error("[Referral Expiry Cron] Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
