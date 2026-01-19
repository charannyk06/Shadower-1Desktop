import { NextResponse } from "next/server";

// Local-first mode: Billing stats are not supported
export async function GET() {
  return NextResponse.json({
    totalUsers: 1,
    activeSubscriptions: 0,
    revenue: 0,
    message: "Billing stats are not available in local-first mode",
  });
}
