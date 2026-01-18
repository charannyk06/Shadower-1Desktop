"use client";

import { formatPrice, getMonthlyPrice } from "@/lib/billing/pricing";
import {
  Coins,
  CreditCard,
  DollarSign,
  Tag,
  TrendingDown,
  Users,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "ui/card";

interface BillingStatsCardsProps {
  readonly stats: Readonly<{
    mrr: number;
    arr: number;
    tierCounts: Readonly<{
      free: number;
      pro: number;
      ultra: number;
    }>;
    totalSubscriptions: number;
    totalPurchasedTokens: string;
    promoCodes: Readonly<{
      total: number;
      active: number;
      totalRedemptions: number;
    }>;
    churnRate: number;
    pendingCancellations: number;
  }>;
}

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function formatNumber(num: number | string): string {
  const value = typeof num === "string" ? Number.parseInt(num, 10) : num;
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return value.toString();
}

export function BillingStatsCards({ stats }: BillingStatsCardsProps) {
  return (
    <div className="space-y-6">
      {/* Revenue Section */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Revenue</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Monthly Recurring Revenue
              </CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatCurrency(stats.mrr)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                From {stats.tierCounts.pro + stats.tierCounts.ultra} paid
                subscribers
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Annual Recurring Revenue
              </CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatCurrency(stats.arr)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Projected annual revenue
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Churn Rate
              </CardTitle>
              <TrendingDown className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.churnRate}%</div>
              <p className="text-xs text-muted-foreground mt-1">
                {stats.pendingCancellations} pending cancellations
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Purchased Tokens
              </CardTitle>
              <Coins className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatNumber(stats.totalPurchasedTokens)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Total tokens purchased
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Subscriptions Section */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Subscriptions</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Subscriptions
              </CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {stats.totalSubscriptions}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                All active subscription records
              </p>
            </CardContent>
          </Card>

          <Card className="border-blue-200 dark:border-blue-800">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-blue-600 dark:text-blue-400">
                Free Tier
              </CardTitle>
              <CreditCard className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.tierCounts.free}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {stats.totalSubscriptions > 0
                  ? `${Math.round((stats.tierCounts.free / stats.totalSubscriptions) * 100)}%`
                  : "0%"}{" "}
                of subscribers
              </p>
            </CardContent>
          </Card>

          <Card className="border-purple-200 dark:border-purple-800">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-purple-600 dark:text-purple-400">
                Pro Tier
              </CardTitle>
              <CreditCard className="h-4 w-4 text-purple-600 dark:text-purple-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.tierCounts.pro}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {formatPrice(getMonthlyPrice("pro"))}/month &middot;{" "}
                {stats.totalSubscriptions > 0
                  ? `${Math.round((stats.tierCounts.pro / stats.totalSubscriptions) * 100)}%`
                  : "0%"}
              </p>
            </CardContent>
          </Card>

          <Card className="border-amber-200 dark:border-amber-800">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-amber-600 dark:text-amber-400">
                Ultra Tier
              </CardTitle>
              <CreditCard className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.tierCounts.ultra}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {formatPrice(getMonthlyPrice("ultra"))}/month &middot;{" "}
                {stats.totalSubscriptions > 0
                  ? `${Math.round((stats.tierCounts.ultra / stats.totalSubscriptions) * 100)}%`
                  : "0%"}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Promo Codes Section */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Promo Codes</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Promo Codes
              </CardTitle>
              <Tag className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.promoCodes.total}</div>
              <p className="text-xs text-muted-foreground mt-1">
                All created promo codes
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Active Codes
              </CardTitle>
              <Tag className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                {stats.promoCodes.active}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Currently usable codes
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Redemptions
              </CardTitle>
              <Tag className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {stats.promoCodes.totalRedemptions}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Times codes were used
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
