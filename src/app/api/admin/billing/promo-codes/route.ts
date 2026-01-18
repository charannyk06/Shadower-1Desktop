import { requireAdminPermission } from "auth/permissions";
import { getSession } from "lib/auth/server";
import { csrfErrorResponse, validateCsrfRequest } from "lib/csrf";
import { promoCodeRepository } from "lib/db/repository";
import { NextResponse } from "next/server";

/**
 * GET /api/admin/billing/promo-codes
 *
 * Returns all promo codes for admin dashboard.
 */
export async function GET() {
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

    const promoCodes = await promoCodeRepository.getAll();

    // Format response
    const formattedCodes = promoCodes.map((code) => ({
      id: code.id,
      code: code.code,
      description: code.description,
      discountType: code.discountType,
      discountValue: Number(code.discountValue),
      discountDisplay:
        code.discountType === "percentage"
          ? `${code.discountValue}%`
          : `$${(Number(code.discountValue) / 100).toFixed(2)}`,
      appliesTo: code.appliesTo,
      applicableTiers: code.applicableTiers,
      applicableTokenPacks: code.applicableTokenPacks,
      maxRedemptions: code.maxRedemptions ? Number(code.maxRedemptions) : null,
      currentRedemptions: Number(code.currentRedemptions || 0),
      maxPerUser: Number(code.maxPerUser || 1),
      newUsersOnly: code.newUsersOnly,
      minAmount: code.minAmount ? Number(code.minAmount) : null,
      startsAt: code.startsAt?.toISOString(),
      expiresAt: code.expiresAt?.toISOString(),
      isActive: code.isActive,
      stripeCouponId: code.stripeCouponId,
      createdAt: code.createdAt?.toISOString(),
      // Calculate usage percentage
      usagePercent:
        code.maxRedemptions && Number(code.maxRedemptions) > 0
          ? Math.round(
              (Number(code.currentRedemptions || 0) /
                Number(code.maxRedemptions)) *
                100,
            )
          : null,
    }));

    return NextResponse.json({
      promoCodes: formattedCodes,
      total: formattedCodes.length,
      active: formattedCodes.filter((c) => c.isActive).length,
    });
  } catch (error: unknown) {
    const err = error as Error;
    console.error("[Admin Promo Codes] GET Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * POST /api/admin/billing/promo-codes
 *
 * Create a new promo code.
 * Body:
 * - code: string
 * - description: string (optional)
 * - discountType: "percentage" | "fixed_amount"
 * - discountValue: number (percentage value or cents)
 * - appliesTo: "all" | "subscription" | "token_pack" (optional)
 * - applicableTiers: string[] (optional)
 * - applicableTokenPacks: string[] (optional)
 * - maxRedemptions: number (optional)
 * - maxPerUser: number (optional)
 * - newUsersOnly: boolean (optional)
 * - minAmount: number (optional, in cents)
 * - startsAt: string (ISO date, optional)
 * - expiresAt: string (ISO date, optional)
 */
export async function POST(req: Request) {
  try {
    // CSRF validation
    const csrfValid = await validateCsrfRequest(req);
    if (!csrfValid) {
      return csrfErrorResponse();
    }

    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      await requireAdminPermission();
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const {
      code,
      description,
      discountType,
      discountValue,
      appliesTo,
      applicableTiers,
      applicableTokenPacks,
      maxRedemptions,
      maxPerUser,
      newUsersOnly,
      minAmount,
      startsAt,
      expiresAt,
    } = body;

    // Validation
    if (!code || typeof code !== "string" || code.length < 3) {
      return NextResponse.json(
        { error: "Code must be at least 3 characters" },
        { status: 400 },
      );
    }

    if (
      !discountType ||
      !["percentage", "fixed_amount"].includes(discountType)
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid discount type. Must be 'percentage' or 'fixed_amount'",
        },
        { status: 400 },
      );
    }

    if (typeof discountValue !== "number" || discountValue <= 0) {
      return NextResponse.json(
        { error: "Discount value must be a positive number" },
        { status: 400 },
      );
    }

    if (discountType === "percentage" && discountValue > 100) {
      return NextResponse.json(
        { error: "Percentage discount cannot exceed 100" },
        { status: 400 },
      );
    }

    // Check if code already exists
    const existing = await promoCodeRepository.getByCode(code.toUpperCase());
    if (existing) {
      return NextResponse.json(
        { error: "Promo code already exists" },
        { status: 400 },
      );
    }

    const newCode = await promoCodeRepository.create({
      code: code.toUpperCase(),
      description: description || null,
      discountType,
      discountValue,
      appliesTo: appliesTo || "all",
      applicableTiers: applicableTiers || [],
      applicableTokenPacks: applicableTokenPacks || [],
      maxRedemptions: maxRedemptions || undefined,
      maxPerUser: maxPerUser || 1,
      newUsersOnly: newUsersOnly || false,
      minAmount: minAmount || undefined,
      startsAt: startsAt ? new Date(startsAt) : new Date(),
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
    });

    console.log(
      `[Admin] Created promo code ${code.toUpperCase()} by admin ${session.user.id}`,
    );

    return NextResponse.json({
      success: true,
      promoCode: {
        id: newCode.id,
        code: newCode.code,
        description: newCode.description,
        discountType: newCode.discountType,
        discountValue: newCode.discountValue,
        appliesTo: newCode.appliesTo,
        maxRedemptions: newCode.maxRedemptions,
        expiresAt: newCode.expiresAt?.toISOString(),
        isActive: newCode.isActive,
      },
    });
  } catch (error: unknown) {
    const err = error as Error;
    console.error("[Admin Promo Codes] POST Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/billing/promo-codes
 *
 * Update a promo code (enable/disable or update fields).
 * Body:
 * - id: string (required)
 * - isActive: boolean (optional)
 * - description: string (optional)
 * - maxRedemptions: number (optional)
 * - expiresAt: string (optional)
 */
export async function PATCH(req: Request) {
  try {
    // CSRF validation
    const csrfValid = await validateCsrfRequest(req);
    if (!csrfValid) {
      return csrfErrorResponse();
    }

    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      await requireAdminPermission();
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const { id, isActive, description, maxRedemptions, expiresAt } = body;

    if (!id) {
      return NextResponse.json(
        { error: "Promo code ID required" },
        { status: 400 },
      );
    }

    // Build update data
    const updateData: Record<string, any> = {};

    if (typeof isActive === "boolean") {
      updateData.isActive = isActive;
    }

    if (description !== undefined) {
      updateData.description = description;
    }

    if (maxRedemptions !== undefined) {
      updateData.maxRedemptions = maxRedemptions?.toString() || null;
    }

    if (expiresAt !== undefined) {
      updateData.expiresAt = expiresAt ? new Date(expiresAt) : null;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 },
      );
    }

    const updated = await promoCodeRepository.update(id, updateData);
    if (!updated) {
      return NextResponse.json(
        { error: "Promo code not found" },
        { status: 404 },
      );
    }

    console.log(
      `[Admin] Updated promo code ${updated.code} by admin ${session.user.id}: ${JSON.stringify(updateData)}`,
    );

    return NextResponse.json({
      success: true,
      message: "Promo code updated",
      promoCode: {
        id: updated.id,
        code: updated.code,
        isActive: updated.isActive,
        description: updated.description,
        maxRedemptions: updated.maxRedemptions,
        expiresAt: updated.expiresAt?.toISOString(),
      },
    });
  } catch (error: unknown) {
    const err = error as Error;
    console.error("[Admin Promo Codes] PATCH Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
