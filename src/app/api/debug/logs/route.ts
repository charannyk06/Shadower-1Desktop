import { NextResponse } from "next/server";
import logger from "logger";

/**
 * Debug endpoint to check recent logs
 * GET /api/debug/logs
 */
export async function GET() {
  // Consola doesn't expose logs directly, but we can check if logger is working
  logger.info("[DEBUG] Logs endpoint accessed");

  return NextResponse.json({
    message:
      "Check your server terminal for logs. The logger outputs to console.",
    note: "Look for lines containing [FRAGMENT], [POOL], or [E2B] in your terminal where you ran 'pnpm dev'",
    tip: "The error 'You have reached your specified API usage limits' is coming from E2B's API, not our code.",
  });
}
