import { NextRequest, NextResponse } from "next/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  await params; // params will be used when implementing this route
  return NextResponse.json({ error: "Not implemented" }, { status: 501 });
}
