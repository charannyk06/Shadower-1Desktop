import { validateCronAuth } from "@/lib/cron/auth";
import {
  checkAndCreateAlertsForAllUsers,
  sendPendingAlertEmails,
} from "lib/billing/alerts";
import { usageAlertRepository } from "lib/db/repository";
import { NextResponse } from "next/server";

/**
 * POST /api/cron/usage-alerts
 *
 * Cron job to check usage thresholds and create alerts for all active users.
 * Should be run every hour.
 *
 * Also sends pending email notifications and cleans up old alerts.
 */
export async function POST(req: Request) {
  const authError = validateCronAuth(req, "UsageAlerts");
  if (authError) return authError;

  try {
    console.log("[UsageAlerts Cron] Starting usage alerts check...");
    const startTime = Date.now();

    // Check and create alerts for all active users
    const alertStats = await checkAndCreateAlertsForAllUsers();

    // Send pending email notifications
    const emailsSent = await sendPendingAlertEmails();

    // Cleanup old alerts (once per day, check if it's midnight-ish)
    const currentHour = new Date().getHours();
    let alertsCleanedUp = 0;
    if (currentHour === 0) {
      alertsCleanedUp = await usageAlertRepository.cleanupOldAlerts();
    }

    const duration = Date.now() - startTime;

    const result = {
      success: true,
      duration: `${duration}ms`,
      stats: {
        usersChecked: alertStats.usersChecked,
        alertsCreated: alertStats.totalAlertsCreated,
        errors: alertStats.errors,
        emailsSent,
        alertsCleanedUp,
      },
    };

    console.log("[UsageAlerts Cron] Completed:", result);

    return NextResponse.json(result);
  } catch (error: unknown) {
    const err = error as Error;
    console.error("[UsageAlerts Cron] Error:", err);
    return NextResponse.json(
      { error: err.message || "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * GET /api/cron/usage-alerts
 *
 * Health check endpoint for the cron job.
 */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    endpoint: "usage-alerts",
    description:
      "Checks usage thresholds and creates alerts for users approaching limits",
    schedule: "Every hour",
  });
}
