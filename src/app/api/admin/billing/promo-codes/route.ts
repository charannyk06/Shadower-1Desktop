import { NextResponse } from "next/server";

// Local-first mode: Promo codes are not supported
export async function GET() {
  return NextResponse.json({
    promoCodes: [],
    message: "Promo codes are not available in local-first mode",
  });
}

export async function POST() {
  return NextResponse.json(
    { error: "Promo codes are not available in local-first mode" },
    { status: 501 },
  );
}

export async function DELETE() {
  return NextResponse.json(
    { error: "Promo codes are not available in local-first mode" },
    { status: 501 },
  );
}
