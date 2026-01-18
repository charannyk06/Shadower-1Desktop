import { BillingStatsCards } from "@/components/admin/billing-stats-cards";
import { requireAdminPermission } from "auth/permissions";
import { getSession } from "lib/auth/server";
import { getMonthlyPrice } from "lib/billing/pricing";
import { promoCodeRepository, subscriptionRepository } from "lib/db/repository";
import { redirect, unauthorized } from "next/navigation";

export const dynamic = "force-dynamic";

async function getBillingStats() {
  const allSubscriptions = await subscriptionRepository.getAllActive();

  // Count by tier
  const tierCounts = {
    free: 0,
    pro: 0,
    ultra: 0,
  };

  let totalPurchasedTokens = BigInt(0);
  let cancelAtPeriodEndCount = 0;

  for (const sub of allSubscriptions) {
    const tier = sub.tier as keyof typeof tierCounts;
    if (tier in tierCounts) {
      tierCounts[tier]++;
    }
    totalPurchasedTokens += BigInt(sub.purchasedTokens || "0");
    if (sub.cancelAtPeriodEnd) {
      cancelAtPeriodEndCount++;
    }
  }

  // Calculate MRR and ARR based on centralized pricing config
  const mrr =
    tierCounts.pro * getMonthlyPrice("pro") +
    tierCounts.ultra * getMonthlyPrice("ultra");
  const arr = mrr * 12;

  // Get promo codes stats
  const promoCodes = await promoCodeRepository.getAll();
  const activePromoCodes = promoCodes.filter((p) => p.isActive).length;
  const totalRedemptions = promoCodes.reduce(
    (sum, p) => sum + Number(p.currentRedemptions || 0),
    0,
  );

  // Calculate churn rate (simplified: pending cancellations / total paid)
  const totalPaid = tierCounts.pro + tierCounts.ultra;
  const churnRate =
    totalPaid > 0 ? Math.round((cancelAtPeriodEndCount / totalPaid) * 100) : 0;

  return {
    mrr,
    arr,
    tierCounts,
    totalSubscriptions: allSubscriptions.length,
    totalPurchasedTokens: totalPurchasedTokens.toString(),
    promoCodes: {
      total: promoCodes.length,
      active: activePromoCodes,
      totalRedemptions,
    },
    churnRate,
    pendingCancellations: cancelAtPeriodEndCount,
  };
}

export default async function BillingOverviewPage() {
  try {
    await requireAdminPermission();
  } catch {
    // User lacks admin permission - redirect to unauthorized page
    unauthorized();
  }

  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const stats = await getBillingStats();

  return <BillingStatsCards stats={stats} />;
}
