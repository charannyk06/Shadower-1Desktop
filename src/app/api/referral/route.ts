import { getSession } from "lib/auth/server";
import {
  REFERRAL_CONFIG,
  applyReferralCode,
  getReferralStats,
} from "lib/referral/service";
import { NextResponse } from "next/server";

/**
 * Check if an error is due to missing database table
 */
function isMissingTableError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    // PostgreSQL error for missing table: "relation X does not exist"
    return msg.includes("relation") && msg.includes("does not exist");
  }
  return false;
}

/**
 * Returns default empty stats when referral table doesn't exist
 */
function getDefaultReferralStats() {
  return {
    code: null,
    stats: {
      totalReferrals: 0,
      completedReferrals: 0,
      pendingReferrals: 0,
      totalBonusEarned: 0,
    },
    referrals: [],
    config: {
      referrerBonus: REFERRAL_CONFIG.referrerBonus,
      refereeBonus: REFERRAL_CONFIG.refereeBonus,
    },
  };
}

/**
 * GET /api/referral
 * Get referral stats and code for the current user
 */
export async function GET() {
  try {
    const session = await getSession();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const stats = await getReferralStats(session.user.id);

    return NextResponse.json(stats);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error("[Referral API] Error getting stats:", errorMessage, error);

    // Check for missing table error - return empty stats gracefully
    if (isMissingTableError(error)) {
      console.warn(
        "[Referral API] Referral table does not exist - returning empty stats. Please run database migrations.",
      );
      return NextResponse.json(getDefaultReferralStats());
    }

    // Check for common database errors
    if (
      errorMessage.includes("POSTGRES_URL") ||
      errorMessage.includes("database")
    ) {
      return NextResponse.json(
        { error: "Database connection error. Please try again later." },
        { status: 503 },
      );
    }

    return NextResponse.json(
      { error: "Failed to get referral stats" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/referral
 * Apply a referral code
 * Body: { code: string }
 */
export async function POST(req: Request) {
  try {
    const session = await getSession();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { code } = body;

    if (!code || typeof code !== "string") {
      return NextResponse.json(
        { error: "Referral code is required" },
        { status: 400 },
      );
    }

    const result = await applyReferralCode(session.user.id, code);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      message: "Referral code applied successfully",
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error("[Referral API] Error applying code:", errorMessage, error);

    // Check for missing table error
    if (isMissingTableError(error)) {
      console.warn(
        "[Referral API] Referral table does not exist - cannot apply code. Please run database migrations.",
      );
      return NextResponse.json(
        {
          error:
            "Referral system is currently unavailable. Please try again later.",
        },
        { status: 503 },
      );
    }

    if (
      errorMessage.includes("POSTGRES_URL") ||
      errorMessage.includes("database")
    ) {
      return NextResponse.json(
        { error: "Database connection error. Please try again later." },
        { status: 503 },
      );
    }

    return NextResponse.json(
      { error: "Failed to apply referral code" },
      { status: 500 },
    );
  }
}
