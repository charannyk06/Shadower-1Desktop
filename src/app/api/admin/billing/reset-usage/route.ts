import { NextResponse } from "next/server";

// Local-first mode: Usage reset is not supported
export async function POST() {
  return NextResponse.json({
    success: true,
    message: "Usage reset is not required in local-first mode",
  });
}
