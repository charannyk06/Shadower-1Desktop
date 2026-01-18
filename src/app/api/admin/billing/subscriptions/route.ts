import { requireAdminPermission } from "auth/permissions";
import { SQL, and, asc, count, desc, eq, ilike } from "drizzle-orm";
import { getSession } from "lib/auth/server";
import type { SubscriptionTier } from "lib/billing/types";
import { pgDb as db } from "lib/db/pg/db.pg";
import { SubscriptionTable, UserTable } from "lib/db/pg/schema.pg";
import { NextResponse } from "next/server";

type SubscriptionStatus =
  | "active"
  | "canceled"
  | "incomplete"
  | "incomplete_expired"
  | "past_due"
  | "trialing"
  | "unpaid"
  | "paused";

/**
 * GET /api/admin/billing/subscriptions
 *
 * Returns paginated list of subscriptions for admin dashboard.
 * Query params:
 * - page: number (default 1)
 * - limit: number (default 20)
 * - query: string (search by email)
 * - tier: "free" | "pro" | "ultra" | "all"
 * - status: "active" | "canceled" | "past_due" | "all"
 * - sortBy: "createdAt" | "tier" | "status"
 * - sortDirection: "asc" | "desc"
 */
export async function GET(req: Request) {
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

    const { searchParams } = new URL(req.url);
    const page = Number.parseInt(searchParams.get("page") || "1", 10);
    const limit = Math.min(
      Number.parseInt(searchParams.get("limit") || "20", 10),
      100,
    );
    const offset = (page - 1) * limit;
    const query = searchParams.get("query") || "";
    const tierFilter = searchParams.get("tier") || "all";
    const statusFilter = searchParams.get("status") || "all";
    const sortBy = searchParams.get("sortBy") || "createdAt";
    const sortDirection = searchParams.get("sortDirection") || "desc";

    // Build filters
    const filters: SQL[] = [];

    if (query) {
      filters.push(ilike(UserTable.email, `%${query}%`));
    }

    if (tierFilter !== "all") {
      filters.push(eq(SubscriptionTable.tier, tierFilter as SubscriptionTier));
    }

    if (statusFilter !== "all") {
      filters.push(
        eq(SubscriptionTable.status, statusFilter as SubscriptionStatus),
      );
    }

    // Build sort
    const sortColumn =
      sortBy === "tier"
        ? SubscriptionTable.tier
        : sortBy === "status"
          ? SubscriptionTable.status
          : SubscriptionTable.createdAt;

    const sortOrder =
      sortDirection === "asc" ? asc(sortColumn) : desc(sortColumn);

    // Get total count
    const countQuery = db
      .select({ count: count() })
      .from(SubscriptionTable)
      .innerJoin(UserTable, eq(SubscriptionTable.userId, UserTable.id));

    if (filters.length > 0) {
      countQuery.where(and(...filters));
    }

    const [countResult] = await countQuery;
    const total = Number(countResult?.count || 0);

    // Get subscriptions with user info
    const subscriptionsQuery = db
      .select({
        id: SubscriptionTable.id,
        userId: SubscriptionTable.userId,
        tier: SubscriptionTable.tier,
        status: SubscriptionTable.status,
        stripeSubscriptionId: SubscriptionTable.stripeSubscriptionId,
        currentPeriodStart: SubscriptionTable.currentPeriodStart,
        currentPeriodEnd: SubscriptionTable.currentPeriodEnd,
        cancelAtPeriodEnd: SubscriptionTable.cancelAtPeriodEnd,
        purchasedTokens: SubscriptionTable.purchasedTokens,
        createdAt: SubscriptionTable.createdAt,
        updatedAt: SubscriptionTable.updatedAt,
        // User info
        userEmail: UserTable.email,
        userName: UserTable.name,
        userCreatedAt: UserTable.createdAt,
      })
      .from(SubscriptionTable)
      .innerJoin(UserTable, eq(SubscriptionTable.userId, UserTable.id))
      .orderBy(sortOrder)
      .limit(limit)
      .offset(offset);

    if (filters.length > 0) {
      subscriptionsQuery.where(and(...filters));
    }

    const subscriptions = await subscriptionsQuery;

    // Format response
    const formattedSubscriptions = subscriptions.map((sub) => ({
      id: sub.id,
      userId: sub.userId,
      tier: sub.tier || "free",
      status: sub.status || "active",
      stripeSubscriptionId: sub.stripeSubscriptionId,
      currentPeriodStart: sub.currentPeriodStart?.toISOString(),
      currentPeriodEnd: sub.currentPeriodEnd?.toISOString(),
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      purchasedTokens: sub.purchasedTokens,
      createdAt: sub.createdAt?.toISOString(),
      updatedAt: sub.updatedAt?.toISOString(),
      user: {
        email: sub.userEmail,
        name: sub.userName,
        createdAt: sub.userCreatedAt?.toISOString(),
      },
    }));

    return NextResponse.json({
      subscriptions: formattedSubscriptions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error: unknown) {
    const err = error as Error;
    console.error("[Admin Subscriptions] Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
