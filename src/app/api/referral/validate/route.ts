import { getReferrerByCode } from "lib/referral/service";
import { NextResponse } from "next/server";

/**
 * Check if an error is due to missing database table or column
 */
function isMissingTableOrColumnError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    // PostgreSQL errors for missing table/column
    return (
      (msg.includes("relation") && msg.includes("does not exist")) ||
      (msg.includes("column") && msg.includes("does not exist"))
    );
  }
  return false;
}

/**
 * GET /api/referral/validate?code=XXXXX
 * Validate a referral code and get referrer info
 * This is a public endpoint that doesn't require authentication
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get("code");

    if (!code) {
      return NextResponse.json(
        { valid: false, error: "Code is required" },
        { status: 400 },
      );
    }

    const referrer = await getReferrerByCode(code);

    if (!referrer) {
      return NextResponse.json({ valid: false, error: "Invalid code" });
    }

    // Return minimal referrer info (don't expose email)
    return NextResponse.json({
      valid: true,
      referrer: {
        name: referrer.name || "A friend",
      },
    });
  } catch (error) {
    console.error("[Referral Validate] Error:", error);

    // If the referral table/column doesn't exist, return invalid gracefully
    if (isMissingTableOrColumnError(error)) {
      console.warn(
        "[Referral Validate] Referral system not set up - returning invalid. Please run database migrations.",
      );
      return NextResponse.json({ valid: false, error: "Invalid code" });
    }

    return NextResponse.json(
      { valid: false, error: "Failed to validate code" },
      { status: 500 },
    );
  }
}
