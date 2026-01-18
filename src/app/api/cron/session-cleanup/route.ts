/**
 * Cron Endpoint for Session Cleanup
 *
 * This endpoint should be called by a cron job (e.g., Vercel Cron)
 * to clean up expired and inactive browser/desktop sessions.
 *
 * Recommended schedule: Every 5 minutes (cron: 0/5 * * * *)
 *
 * Example vercel.json configuration:
 * {
 *   "crons": [{
 *     "path": "/api/cron/session-cleanup",
 *     "schedule": "0/5 * * * *"
 *   }]
 * }
 */

import { validateCronAuth } from "@/lib/cron/auth";
import { getCleanupStats, runSessionCleanup } from "@/lib/jobs/session-cleanup";
import { toApiResponse, toHttpStatus } from "@/lib/utils/result";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/cron/session-cleanup
 *
 * Triggers the session cleanup job.
 * Requires CRON_SECRET header for authorization.
 */
export async function POST(request: NextRequest) {
  const authError = validateCronAuth(request, "SessionCleanup");
  if (authError) return authError;

  try {
    const result = await runSessionCleanup();

    return NextResponse.json(toApiResponse(result), {
      status: toHttpStatus(result),
    });
  } catch (error) {
    console.error("[CronSessionCleanup] Unexpected error:", error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message:
            error instanceof Error ? error.message : "Unknown error occurred",
        },
      },
      { status: 500 },
    );
  }
}

/**
 * GET /api/cron/session-cleanup
 *
 * Returns cleanup statistics without running cleanup.
 * Useful for monitoring dashboards.
 */
export async function GET(request: NextRequest) {
  const authError = validateCronAuth(request, "SessionCleanup");
  if (authError) return authError;

  try {
    const result = await getCleanupStats();

    return NextResponse.json(toApiResponse(result), {
      status: toHttpStatus(result),
    });
  } catch (error) {
    console.error("[CronSessionCleanup] Stats error:", error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message:
            error instanceof Error ? error.message : "Unknown error occurred",
        },
      },
      { status: 500 },
    );
  }
}
