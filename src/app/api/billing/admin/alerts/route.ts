import { requireAdminPermission } from "@/lib/auth/permissions";
import {
  calculateUserCost,
  getAggregateCostStats,
  getCostAlerts,
} from "@/lib/billing/cost-tracker";

/**
 * GET /api/billing/admin/alerts
 *
 * Admin endpoint to view cost alerts and margin analysis
 * Shows users with low or negative margins
 *
 * Query params:
 * - type: "alerts" | "stats" | "user" (default: "alerts")
 * - userId: for type="user", specific user to analyze
 * - warningThreshold: margin % below which to warn (default: 10)
 * - criticalThreshold: margin % below which is critical (default: 0)
 * - limit: max alerts to return (default: 50)
 */
export async function GET(request: Request) {
  try {
    // Require admin permission
    await requireAdminPermission("view billing alerts");

    const url = new URL(request.url);
    const type = url.searchParams.get("type") || "alerts";

    switch (type) {
      case "alerts": {
        const warningThreshold = Number.parseInt(
          url.searchParams.get("warningThreshold") || "10",
          10,
        );
        const criticalThreshold = Number.parseInt(
          url.searchParams.get("criticalThreshold") || "0",
          10,
        );
        const limit = Number.parseInt(
          url.searchParams.get("limit") || "50",
          10,
        );

        const alerts = await getCostAlerts({
          warningThreshold,
          criticalThreshold,
          limit,
        });

        return Response.json({
          alerts,
          count: alerts.length,
          criticalCount: alerts.filter((a) => a.severity === "critical").length,
          warningCount: alerts.filter((a) => a.severity === "warning").length,
        });
      }

      case "stats": {
        const stats = await getAggregateCostStats();
        return Response.json(stats);
      }

      case "user": {
        const userId = url.searchParams.get("userId");
        if (!userId) {
          return Response.json(
            { error: "userId is required for type=user" },
            { status: 400 },
          );
        }
        const cost = await calculateUserCost(userId);
        return Response.json(cost);
      }

      default:
        return Response.json(
          { error: "Invalid type. Use: alerts, stats, or user" },
          { status: 400 },
        );
    }
  } catch (error: unknown) {
    const err = error as Error;
    if (err.message?.includes("Unauthorized")) {
      return Response.json({ error: "Unauthorized" }, { status: 403 });
    }
    console.error("Admin alerts API Error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
