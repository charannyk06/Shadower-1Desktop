import { NextResponse } from "next/server";

/**
 * Validates CRON endpoint authentication.
 * CRON_SECRET is REQUIRED - endpoints are disabled if not configured.
 *
 * Supports:
 * - Bearer token in Authorization header
 * - x-cron-secret custom header
 * - x-vercel-cron header (Vercel Cron)
 *
 * @param request - The incoming request
 * @param endpointName - Name for logging (e.g., "WebhookRetry", "Cleanup")
 * @returns null if authorized, NextResponse with error if unauthorized
 */
export function validateCronAuth(
  request: Request,
  endpointName: string,
): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET;

  // CRON_SECRET is REQUIRED - reject if not configured
  if (!cronSecret) {
    console.error(
      `[${endpointName} Cron] CRON_SECRET not configured - endpoint disabled`,
    );
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 },
    );
  }

  // Get auth from various headers
  const authHeader = request.headers.get("authorization");
  const cronSecretHeader = request.headers.get("x-cron-secret");
  const vercelCronHeader = request.headers.get("x-vercel-cron");

  // Support Bearer token, custom header, or Vercel Cron header
  const providedSecret = authHeader?.replace("Bearer ", "") || cronSecretHeader;

  // Allow if valid secret provided OR if Vercel Cron header present
  if (providedSecret === cronSecret || vercelCronHeader) {
    return null; // Authorized
  }

  console.warn(`[${endpointName} Cron] Unauthorized request`);
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
