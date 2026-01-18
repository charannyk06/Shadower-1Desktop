import { requireAdminPermission } from "auth/permissions";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { getSession } from "lib/auth/server";
import { getMonthBoundaries } from "lib/billing/date-utils";
import { pgDb as db } from "lib/db/pg/db.pg";
import {
  SubscriptionTable,
  UsageAlertTable,
  UsageEventTable,
  UserTable,
} from "lib/db/pg/schema.pg";
import { NextResponse } from "next/server";

/**
 * POST /api/admin/billing/reset-usage
 *
 * Resets monthly credits usage for a user by email by deleting usage events
 * for the current month. Also resets purchasedTokensUsed.
 *
 * Body:
 * - email: string - User email to reset usage for
 */
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      await requireAdminPermission();
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const { email } = body;

    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    // Find user by email
    const [user] = await db
      .select()
      .from(UserTable)
      .where(eq(UserTable.email, email))
      .limit(1);

    if (!user) {
      return NextResponse.json(
        { error: `User not found: ${email}` },
        { status: 404 },
      );
    }

    // Get current month boundaries
    const { start: monthStart, end: monthEnd } = getMonthBoundaries();

    // Count events before deletion
    const eventsBefore = await db
      .select({ count: sql<number>`count(*)` })
      .from(UsageEventTable)
      .where(
        and(
          eq(UsageEventTable.userId, user.id),
          gte(UsageEventTable.createdAt, monthStart),
          lte(UsageEventTable.createdAt, monthEnd),
        ),
      );
    const eventCount = Number(eventsBefore[0]?.count || 0);

    // Count alerts before deletion
    const alertsBefore = await db
      .select({ count: sql<number>`count(*)` })
      .from(UsageAlertTable)
      .where(
        and(
          eq(UsageAlertTable.userId, user.id),
          gte(UsageAlertTable.periodStart, monthStart),
          lte(UsageAlertTable.periodEnd, monthEnd),
        ),
      );
    const alertCount = Number(alertsBefore[0]?.count || 0);

    // Delete usage events
    if (eventCount > 0) {
      await db
        .delete(UsageEventTable)
        .where(
          and(
            eq(UsageEventTable.userId, user.id),
            gte(UsageEventTable.createdAt, monthStart),
            lte(UsageEventTable.createdAt, monthEnd),
          ),
        );
    }

    // Delete usage alerts
    if (alertCount > 0) {
      await db
        .delete(UsageAlertTable)
        .where(
          and(
            eq(UsageAlertTable.userId, user.id),
            gte(UsageAlertTable.periodStart, monthStart),
            lte(UsageAlertTable.periodEnd, monthEnd),
          ),
        );
    }

    // Reset purchasedTokensUsed
    const [subscription] = await db
      .select()
      .from(SubscriptionTable)
      .where(eq(SubscriptionTable.userId, user.id))
      .limit(1);

    let purchasedTokensReset = false;
    if (subscription) {
      const purchasedUsed = Number(subscription.purchasedTokensUsed || "0");
      if (purchasedUsed > 0) {
        await db
          .update(SubscriptionTable)
          .set({
            purchasedTokensUsed: "0",
            updatedAt: new Date(),
          })
          .where(eq(SubscriptionTable.userId, user.id));
        purchasedTokensReset = true;
      }
    }

    return NextResponse.json({
      success: true,
      message: `Reset monthly usage for ${user.name} (${email})`,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
      period: {
        start: monthStart.toISOString(),
        end: monthEnd.toISOString(),
      },
      deleted: {
        events: eventCount,
        alerts: alertCount,
        purchasedTokensUsed: purchasedTokensReset,
      },
    });
  } catch (error) {
    console.error("[Admin] Error resetting usage:", error);
    return NextResponse.json(
      {
        error: "Failed to reset usage",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
