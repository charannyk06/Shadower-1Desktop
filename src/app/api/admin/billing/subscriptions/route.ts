import { NextResponse } from "next/server";

// Local-first mode: Subscriptions management is not supported
export async function GET() {
  return NextResponse.json({
    subscriptions: [],
    total: 0,
    message: "Subscription management is not available in local-first mode",
  });
}
