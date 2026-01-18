import { getSession } from "lib/auth/server";
import { generateForecast } from "lib/billing/forecasting";
import { NextResponse } from "next/server";

/**
 * GET /api/billing/forecast
 * Get usage forecast for the current user
 */
export async function GET() {
  try {
    const session = await getSession();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const forecast = await generateForecast(session.user.id);

    return NextResponse.json(forecast);
  } catch (error) {
    console.error("[Forecast API] Error generating forecast:", error);
    return NextResponse.json(
      { error: "Failed to generate usage forecast" },
      { status: 500 },
    );
  }
}
