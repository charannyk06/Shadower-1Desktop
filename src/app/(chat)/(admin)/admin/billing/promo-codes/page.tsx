import { PromoCodesManager } from "@/components/admin/promo-codes-manager";
import { requireAdminPermission } from "auth/permissions";
import { getSession } from "lib/auth/server";
import { promoCodeRepository } from "lib/db/repository";
import { redirect, unauthorized } from "next/navigation";

export const dynamic = "force-dynamic";

async function getPromoCodes() {
  const promoCodes = await promoCodeRepository.getAll();

  return promoCodes.map((code) => ({
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
    usagePercent:
      code.maxRedemptions && Number(code.maxRedemptions) > 0
        ? Math.round(
            (Number(code.currentRedemptions || 0) /
              Number(code.maxRedemptions)) *
              100,
          )
        : null,
  }));
}

export default async function PromoCodesPage() {
  try {
    await requireAdminPermission();
  } catch (_error) {
    unauthorized();
  }

  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const promoCodes = await getPromoCodes();

  return <PromoCodesManager promoCodes={promoCodes} />;
}
