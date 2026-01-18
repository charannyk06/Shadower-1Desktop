import { getSession } from "lib/auth/server";
import {
  acknowledgeAlert,
  acknowledgeAllAlerts,
  getActiveAlertsForUser,
  getAlertSummary,
} from "lib/billing/alerts";
import type {
  AlertType,
  LimitType,
} from "lib/db/pg/repositories/usage-alert-repository.pg";
import { NextResponse } from "next/server";

/**
 * GET /api/billing/alerts
 *
 * Get active (unacknowledged) alerts for the current user.
 */
export async function GET() {
  try {
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const alerts = await getActiveAlertsForUser(session.user.id);

    // Transform alerts to include display-friendly summaries
    const formattedAlerts = alerts.map((alert) => {
      const summary = getAlertSummary(
        alert.alertType as AlertType,
        alert.limitType as LimitType,
        Number(alert.currentUsage),
        Number(alert.usageLimit),
      );

      return {
        id: alert.id,
        type: alert.alertType,
        limitType: alert.limitType,
        threshold: Number(alert.threshold),
        currentUsage: Number(alert.currentUsage),
        usageLimit: Number(alert.usageLimit),
        percentUsed: Math.round(
          (Number(alert.currentUsage) / Number(alert.usageLimit)) * 100,
        ),
        title: summary.title,
        message: summary.message,
        severity: summary.severity,
        createdAt: alert.createdAt.toISOString(),
        periodStart: alert.periodStart.toISOString(),
        periodEnd: alert.periodEnd.toISOString(),
      };
    });

    return NextResponse.json({
      alerts: formattedAlerts,
      count: formattedAlerts.length,
    });
  } catch (error: unknown) {
    const err = error as Error;
    console.error("[Billing Alerts] GET error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * POST /api/billing/alerts
 *
 * Acknowledge (dismiss) one or all alerts.
 * Body:
 * - alertId: string (optional - specific alert to acknowledge)
 * - acknowledgeAll: boolean (optional - acknowledge all alerts)
 */
export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { alertId, acknowledgeAll: ackAll } = body;

    if (ackAll) {
      const count = await acknowledgeAllAlerts(session.user.id);
      return NextResponse.json({
        success: true,
        acknowledged: count,
        message: `Acknowledged ${count} alert${count !== 1 ? "s" : ""}`,
      });
    }

    if (alertId) {
      const success = await acknowledgeAlert(alertId, session.user.id);
      if (!success) {
        return NextResponse.json(
          { error: "Alert not found or already acknowledged" },
          { status: 404 },
        );
      }
      return NextResponse.json({
        success: true,
        acknowledged: 1,
        message: "Alert acknowledged",
      });
    }

    return NextResponse.json(
      { error: "Must provide alertId or acknowledgeAll: true" },
      { status: 400 },
    );
  } catch (error: unknown) {
    const err = error as Error;
    console.error("[Billing Alerts] POST error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
