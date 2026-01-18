import { validateCronAuth } from "@/lib/cron/auth";
import { webhookEventRepository } from "lib/db/repository";

// Default to keeping events for 7 days
const DEFAULT_RETENTION_DAYS = 7;

/**
 * Cleanup old webhook events to prevent database bloat.
 *
 * This endpoint should be called periodically by a cron job.
 * It can be secured by checking a secret header or using Vercel Cron.
 *
 * Example cron setup (vercel.json):
 * {
 *   "crons": [{
 *     "path": "/api/billing/webhook/cleanup",
 *     "schedule": "0 3 * * *"
 *   }]
 * }
 */
export async function POST(req: Request) {
  const authError = validateCronAuth(req, "WebhookCleanup");
  if (authError) return authError;

  try {
    const body = await req.json().catch(() => ({}));
    const retentionDays = body.retentionDays || DEFAULT_RETENTION_DAYS;

    const deletedCount =
      await webhookEventRepository.cleanupOldEvents(retentionDays);

    console.log(
      `[Webhook Cleanup] Deleted ${deletedCount} webhook events older than ${retentionDays} days`,
    );

    return Response.json({
      success: true,
      deletedCount,
      retentionDays,
    });
  } catch (error: unknown) {
    const err = error as Error;
    console.error("[Webhook Cleanup] Error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}

// GET endpoint for health check / manual trigger
export async function GET(_req: Request) {
  return Response.json({
    endpoint: "Webhook Event Cleanup",
    description: "Cleans up old webhook events from the database",
    usage: "POST with optional { retentionDays: number }",
    defaultRetentionDays: DEFAULT_RETENTION_DAYS,
  });
}
