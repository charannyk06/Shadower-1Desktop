"use client";

import {
  getAllTokenPacks,
  getMonthlyPrice,
  getPriceDollars,
} from "@/lib/billing/pricing";
import { format } from "date-fns";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CircleCheck,
  Coins,
  CreditCard,
  Crown,
  ExternalLink,
  Gift,
  Infinity,
  LayoutDashboard,
  Loader2,
  Package,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  TrendingUp,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import useSWR from "swr";
import { Badge } from "ui/badge";
import { Button } from "ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "ui/card";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "ui/chart";
import { ModelProviderIcon } from "ui/model-provider-icon";
import { Progress } from "ui/progress";
import { Separator } from "ui/separator";
import { handleErrorWithToast } from "ui/shared-toast";
import { Skeleton } from "ui/skeleton";
import { StripeIcon } from "ui/stripe-icon";
import { type PromoAppliedData, PromoCodeInput } from "./promo-code-input";

// Tab definitions for animated tabs
const BILLING_TABS = [
  {
    id: "overview",
    label: "Overview",
    icon: <LayoutDashboard className="size-4" />,
  },
  {
    id: "usage",
    label: "Usage Details",
    icon: <BarChart3 className="size-4" />,
  },
  {
    id: "plans",
    label: "Plans & Pricing",
    icon: <CreditCard className="size-4" />,
  },
] as const;

type TabId = (typeof BILLING_TABS)[number]["id"];

// Animation variants
const tabContentVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 40 : -40,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction < 0 ? 40 : -40,
    opacity: 0,
  }),
};

const staggerContainer = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.1,
    },
  },
};

const staggerItem = {
  hidden: { opacity: 0, y: 20, scale: 0.95 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      type: "spring" as const,
      stiffness: 260,
      damping: 20,
    },
  },
};

interface ModelBreakdown {
  model: string;
  provider: string;
  tokens: number;
  credits: number;
  count: number;
}

interface DailyUsageItem {
  date: string;
  credits: number;
  tokens: number;
}

interface CreditsBreakdown {
  tokenCredits: number;
  imageCredits: number;
  voiceCredits: number;
  sandboxCredits: number;
  mcpCredits: number;
  workflowCredits: number;
  composioCredits: number;
  webSearchCredits: number;
  totalCredits: number;
}

interface UsageData {
  // NEW: Unified credits system
  credits?: {
    used: number;
    limit: number;
    breakdown: CreditsBreakdown;
  };
  // Monthly credit limit
  limits: {
    monthlyCredits: number;
  };
  // Legacy usage counts (for backwards compatibility / analytics)
  usage: {
    llm_tokens: number;
    image_generation: number;
    sandbox_execution: number;
    voice_minutes: number;
    mcp_tool_call: number;
    workflow_execution: number;
    composio_action: number;
  };
  subscription: {
    tier: "free" | "pro" | "ultra";
    status: string;
    periodEnd?: string;
    cancelAtPeriodEnd?: boolean;
    cancelAt?: string | null;
    scheduledDowngrade?: {
      tier: "free" | "pro" | "ultra";
      effectiveDate: string;
    } | null;
    isPaused?: boolean;
  } | null;
  modelBreakdown?: ModelBreakdown[];
  dailyUsage?: DailyUsageItem[];
  purchasedTokens?: number;
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

type BillingCycle = "monthly" | "annual";

// Plan details using centralized pricing config
const PLAN_DETAILS = {
  free: {
    name: "Free",
    monthlyPrice: getPriceDollars("free", "monthly"),
    annualPrice: getPriceDollars("free", "annual"),
    description: "For personal projects and experimentation",
    features: [
      "100K credits/month",
      "Limited sandbox runs",
      "1 voice minute",
      "Community support",
    ],
    highlight: false,
  },
  pro: {
    name: "Pro",
    monthlyPrice: getPriceDollars("pro", "monthly"),
    annualPrice: getPriceDollars("pro", "annual"), // $192.00 (Stripe rounds to clean number)
    description: "For professionals and growing teams",
    features: [
      "3M credits/month",
      "Unlimited sandbox runs",
      "15 voice minutes",
      "Priority support",
      "Advanced analytics",
    ],
    highlight: true,
  },
  ultra: {
    name: "Ultra",
    monthlyPrice: getPriceDollars("ultra", "monthly"),
    annualPrice: getPriceDollars("ultra", "annual"), // $480.00 (Stripe rounds to clean number)
    description: "For enterprises and high-volume usage",
    features: [
      "8.75M credits/month",
      "Unlimited sandbox runs",
      "45 voice minutes",
      "Dedicated support",
      "Custom integrations",
      "SLA guarantee",
    ],
    highlight: false,
  },
};

// Token packs from centralized pricing config
// Maps the config structure to UI display format
const TOKEN_PACKS_UI = getAllTokenPacks().map((pack, index) => ({
  id: pack.id,
  amount: pack.credits,
  price: pack.priceCents / 100, // Convert cents to dollars for display
  label: pack.id === "500k" ? "500K" : pack.id === "2m" ? "2M" : "5M",
  popular: index === 1, // 2M pack is most popular
}));

// Chart colors for model breakdown
const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

// Helper functions to reduce cognitive complexity and eliminate nested ternaries

function getTierIcon(tier: "free" | "pro" | "ultra") {
  switch (tier) {
    case "free":
      return <Gift className="size-6 text-primary" />;
    case "pro":
      return <Rocket className="size-6 text-primary" />;
    case "ultra":
      return <Crown className="size-6 text-primary" />;
  }
}

function getSubscriptionStatusBadge(
  subscription: UsageData["subscription"] | undefined,
) {
  if (subscription?.isPaused) {
    return (
      <Badge
        variant="secondary"
        className="bg-yellow-500/10 text-yellow-600 border-yellow-500/20"
      >
        Paused
      </Badge>
    );
  }
  if (subscription?.scheduledDowngrade) {
    return (
      <Badge
        variant="secondary"
        className="bg-blue-500/10 text-blue-600 border-blue-500/20"
      >
        Downgrading
      </Badge>
    );
  }
  if (subscription?.cancelAtPeriodEnd || subscription?.cancelAt) {
    return (
      <Badge
        variant="secondary"
        className="bg-orange-500/10 text-orange-600 border-orange-500/20"
      >
        Canceling
      </Badge>
    );
  }
  if (subscription?.status === "past_due") {
    return (
      <Badge
        variant="secondary"
        className="bg-red-500/10 text-red-600 border-red-500/20"
      >
        Past Due
      </Badge>
    );
  }
  if (subscription?.status === "canceled") {
    return (
      <Badge
        variant="secondary"
        className="bg-gray-500/10 text-gray-500 border-gray-500/20"
      >
        Canceled
      </Badge>
    );
  }
  return (
    <Badge
      variant="secondary"
      className="bg-green-500/10 text-green-600 border-green-500/20"
    >
      Active
    </Badge>
  );
}

function getProgressColor(isCritical: boolean, isWarning: boolean): string {
  if (isCritical) return "[&>div]:bg-red-500";
  if (isWarning) return "[&>div]:bg-orange-500";
  return "";
}

function getStatusTextColor(isCritical: boolean, isWarning: boolean): string {
  if (isCritical) return "text-red-600 dark:text-red-400";
  if (isWarning) return "text-orange-600 dark:text-orange-400";
  return "text-muted-foreground";
}

function getBorderClass(isCritical: boolean, isWarning: boolean): string {
  if (isCritical) return "border-red-500/50";
  if (isWarning) return "border-orange-500/50";
  return "";
}

function getCanUpgrade(
  tier: keyof typeof PLAN_DETAILS,
  currentTier: "free" | "pro" | "ultra",
): boolean {
  if (tier === "pro") return currentTier === "free";
  if (tier === "ultra") return currentTier !== "ultra";
  return false;
}

function getCanDowngrade(
  tier: keyof typeof PLAN_DETAILS,
  currentTier: "free" | "pro" | "ultra",
): boolean {
  if (tier === "free") return currentTier === "pro" || currentTier === "ultra";
  if (tier === "pro") return currentTier === "ultra";
  return false;
}

export function BillingDashboard() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { data, isLoading, error, mutate } = useSWR<UsageData>(
    "/api/billing/usage",
    fetcher,
  );

  const [portalLoading, setPortalLoading] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [tokenPackLoading, setTokenPackLoading] = useState<number | null>(null);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("monthly");
  const [appliedPromo, setAppliedPromo] = useState<PromoAppliedData | null>(
    null,
  );
  const [tokenPackPromo, setTokenPackPromo] = useState<PromoAppliedData | null>(
    null,
  );
  const [pauseLoading, setPauseLoading] = useState(false);

  // Tab state with direction tracking for animations
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [direction, setDirection] = useState(0);
  const prevTabRef = useRef<TabId>("overview");

  const handleTabChange = useCallback((newTab: TabId) => {
    const tabOrder = BILLING_TABS.map((t) => t.id);
    const prevIndex = tabOrder.indexOf(prevTabRef.current);
    const newIndex = tabOrder.indexOf(newTab);
    setDirection(newIndex > prevIndex ? 1 : -1);
    prevTabRef.current = newTab;
    setActiveTab(newTab);
  }, []);

  // Handle success/error messages from URL params
  useEffect(() => {
    const success = searchParams.get("success");
    const upgraded = searchParams.get("upgraded");
    const downgraded = searchParams.get("downgraded");
    const canceled = searchParams.get("canceled");
    const errorMsg = searchParams.get("error");
    const type = searchParams.get("type");

    if (success === "true") {
      if (upgraded === "true") {
        toast.success("Subscription upgraded successfully!");
      } else if (downgraded === "true") {
        toast.success(
          "Downgrade scheduled! You'll keep your current plan until the end of the billing period.",
        );
      } else if (type === "tokens") {
        toast.success("Token pack purchased successfully!");
        mutate(); // Refresh usage data
      } else {
        toast.success("Subscription activated successfully!");
      }
      // Clear URL params
      router.replace(pathname, { scroll: false });
    } else if (canceled === "true") {
      toast.info("Checkout canceled");
      router.replace(pathname, { scroll: false });
    } else if (errorMsg) {
      toast.error(decodeURIComponent(errorMsg));
      router.replace(pathname, { scroll: false });
    }
  }, [searchParams, router, pathname, mutate]);

  // Convert real daily usage data to chart format
  const usageHistory = useMemo(() => {
    const dailyData = data?.dailyUsage || [];
    if (dailyData.length === 0) {
      return [];
    }
    // Format dates for display and return real data
    return dailyData.map((item) => ({
      date: format(new Date(item.date), "MMM d"),
      credits: item.credits,
      tokens: item.tokens,
    }));
  }, [data?.dailyUsage]);

  // Model breakdown from API (real usage data) - must be before early returns
  const modelBreakdown = useMemo(() => {
    return (data?.modelBreakdown || []).map((item, index) => ({
      ...item,
      color: CHART_COLORS[index % CHART_COLORS.length],
    }));
  }, [data?.modelBreakdown]);

  const handleManageSubscription = useCallback(async () => {
    setPortalLoading(true);
    try {
      const res = await fetch("/api/billing/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          returnUrl: `${globalThis.location.origin}${pathname}`,
        }),
      });

      const result = await res.json();
      if (result.url) {
        globalThis.location.href = result.url;
      } else {
        throw new Error(result.error || "Failed to open billing portal");
      }
    } catch (err) {
      handleErrorWithToast(err as Error);
    } finally {
      setPortalLoading(false);
    }
  }, []);

  const handleUpgrade = useCallback(
    async (tier: string) => {
      setCheckoutLoading(tier);
      try {
        let url = `/api/billing/checkout?tier=${tier}&cycle=${billingCycle}`;
        if (appliedPromo) {
          url += `&promo=${encodeURIComponent(appliedPromo.code)}`;
        }
        globalThis.location.href = url;
      } catch (err) {
        handleErrorWithToast(err as Error);
        setCheckoutLoading(null);
      }
    },
    [appliedPromo, billingCycle],
  );

  const handleBuyTokens = useCallback(
    async (amount: number) => {
      setTokenPackLoading(amount);
      try {
        let url = `/api/billing/checkout?type=token_pack&amount=${amount}`;
        if (tokenPackPromo) {
          url += `&promo=${encodeURIComponent(tokenPackPromo.code)}`;
        }
        globalThis.location.href = url;
      } catch (err) {
        handleErrorWithToast(err as Error);
        setTokenPackLoading(null);
      }
    },
    [tokenPackPromo],
  );

  const handlePauseResume = useCallback(
    async (action: "pause" | "resume") => {
      setPauseLoading(true);
      try {
        const res = await fetch("/api/billing/subscription/pause", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });

        const result = await res.json();
        if (!res.ok) {
          throw new Error(result.error || `Failed to ${action} subscription`);
        }

        toast.success(result.message);
        mutate(); // Refresh usage data
      } catch (err) {
        handleErrorWithToast(err as Error);
      } finally {
        setPauseLoading(false);
      }
    },
    [mutate],
  );

  if (isLoading) {
    return <BillingDashboardSkeleton />;
  }

  if (error) {
    return (
      <div className="w-full flex flex-col items-center justify-center gap-4 p-8 min-h-[400px]">
        <div className="text-center space-y-2">
          <h3 className="text-lg font-semibold">Failed to load billing data</h3>
          <p className="text-muted-foreground text-sm">
            There was an error fetching your usage information.
          </p>
        </div>
        <Button variant="outline" onClick={() => mutate()}>
          <RefreshCw className="size-4 mr-2" />
          Try Again
        </Button>
      </div>
    );
  }

  const currentTier = data?.subscription?.tier || "free";
  const planInfo = PLAN_DETAILS[currentTier];
  const limits = data?.limits || {
    monthlyCredits: 100000,
  };

  // Get unified credits data
  const credits = data?.credits || {
    used: 0,
    limit: limits.monthlyCredits,
    breakdown: {
      tokenCredits: 0,
      imageCredits: 0,
      voiceCredits: 0,
      sandboxCredits: 0,
      mcpCredits: 0,
      workflowCredits: 0,
      composioCredits: 0,
      webSearchCredits: 0,
      totalCredits: 0,
    },
  };

  const periodEnd = data?.subscription?.periodEnd
    ? format(new Date(data.subscription.periodEnd), "MMM d, yyyy")
    : null;

  // Get purchased tokens balance
  const purchasedTokens = data?.purchasedTokens || 0;

  // Calculate credits percentage for the primary usage display
  const creditsPercentage = Math.min((credits.used / credits.limit) * 100, 100);

  return (
    <div className="w-full flex flex-col gap-4 sm:gap-6 p-4 sm:p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Usage & Billing</h1>
          <p className="text-muted-foreground">
            Monitor API consumption and manage your subscription
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => mutate()}>
            <RefreshCw className="size-4" />
          </Button>
          {currentTier !== "free" && !data?.subscription?.isPaused && (
            <Button
              variant="outline"
              size="sm"
              className="text-xs sm:text-sm"
              onClick={() => handlePauseResume("pause")}
              disabled={pauseLoading}
            >
              {pauseLoading ? (
                <Loader2 className="size-4 animate-spin mr-1 sm:mr-2" />
              ) : (
                <Pause className="size-4 mr-1 sm:mr-2" />
              )}
              <span className="hidden sm:inline">Pause Subscription</span>
              <span className="sm:hidden">Pause</span>
            </Button>
          )}
          {currentTier !== "free" && (
            <Button
              variant="outline"
              size="sm"
              className="text-xs sm:text-sm"
              onClick={handleManageSubscription}
              disabled={portalLoading}
            >
              {portalLoading ? (
                <Loader2 className="size-4 animate-spin mr-1 sm:mr-2" />
              ) : (
                <StripeIcon className="size-4 mr-1 sm:mr-2" />
              )}
              <span className="hidden sm:inline">Manage Billing</span>
              <span className="sm:hidden">Billing</span>
            </Button>
          )}
        </div>
      </div>

      {/* Past Due Warning Banner */}
      {data?.subscription?.status === "past_due" && (
        <Card className="border-red-500 bg-red-50 dark:bg-red-950/20">
          <CardContent className="flex flex-col sm:flex-row items-center justify-between gap-4 py-6">
            <div className="flex items-center gap-3">
              <AlertTriangle className="size-5 text-red-600 shrink-0" />
              <div>
                <h3 className="font-semibold text-red-800 dark:text-red-400">
                  Payment Failed
                </h3>
                <p className="text-sm text-red-600 dark:text-red-500">
                  Please update your payment method to continue using{" "}
                  {planInfo.name} features.
                </p>
              </div>
            </div>
            <Button
              variant="destructive"
              onClick={handleManageSubscription}
              disabled={portalLoading}
            >
              {portalLoading ? (
                <Loader2 className="size-4 animate-spin mr-2" />
              ) : null}
              Update Payment Method
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Paused Subscription Banner */}
      {data?.subscription?.isPaused && (
        <Card className="border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20">
          <CardContent className="flex flex-col sm:flex-row items-center justify-between gap-4 py-6">
            <div className="flex items-center gap-3">
              <Pause className="size-5 text-yellow-600 shrink-0" />
              <div>
                <h3 className="font-semibold text-yellow-800 dark:text-yellow-400">
                  Subscription Paused
                </h3>
                <p className="text-sm text-yellow-600 dark:text-yellow-500">
                  Your subscription is paused. You won&apos;t be charged until
                  you resume.
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              className="border-yellow-600 text-yellow-700 hover:bg-yellow-100 dark:border-yellow-500 dark:text-yellow-400 dark:hover:bg-yellow-950"
              onClick={() => handlePauseResume("resume")}
              disabled={pauseLoading}
            >
              {pauseLoading ? (
                <Loader2 className="size-4 animate-spin mr-2" />
              ) : (
                <Play className="size-4 mr-2" />
              )}
              Resume Subscription
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Current Plan Card */}
      <Card className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-primary/5 via-transparent to-transparent" />
        <CardHeader className="relative flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 sm:space-y-0">
          <div className="flex items-start gap-3 sm:gap-4">
            <div className="p-2 sm:p-3 rounded-xl bg-primary/10 border border-primary/20 shrink-0">
              {getTierIcon(currentTier)}
            </div>
            <div className="space-y-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-lg sm:text-xl">
                  {planInfo.name} Plan
                </CardTitle>
                {getSubscriptionStatusBadge(data?.subscription)}
              </div>
              <CardDescription className="text-xs sm:text-sm">
                {planInfo.description}
              </CardDescription>
              {data?.subscription?.scheduledDowngrade ? (
                <p className="text-xs text-blue-600">
                  Switching to{" "}
                  {PLAN_DETAILS[data.subscription.scheduledDowngrade.tier].name}{" "}
                  on{" "}
                  {format(
                    new Date(
                      data.subscription.scheduledDowngrade.effectiveDate,
                    ),
                    "MMM d, yyyy",
                  )}
                  . You&apos;ll keep {planInfo.name} features until then.
                </p>
              ) : data?.subscription?.cancelAtPeriodEnd ||
                data?.subscription?.cancelAt ? (
                <p className="text-xs text-orange-600">
                  Your plan will be canceled on{" "}
                  {data?.subscription?.cancelAt
                    ? format(
                        new Date(data.subscription.cancelAt),
                        "MMM d, yyyy",
                      )
                    : periodEnd}
                  . You&apos;ll keep {planInfo.name} features until then.
                </p>
              ) : periodEnd && currentTier !== "free" ? (
                <p className="text-xs text-muted-foreground">
                  Billing period ends {periodEnd}
                </p>
              ) : null}
            </div>
          </div>
          <CardAction className="self-start sm:self-auto">
            <div className="text-left sm:text-right">
              <p className="text-2xl sm:text-3xl font-bold">
                ${planInfo.monthlyPrice}
                <span className="text-xs sm:text-sm font-normal text-muted-foreground">
                  /mo
                </span>
              </p>
            </div>
          </CardAction>
        </CardHeader>
      </Card>

      {/* Animated Tabs */}
      <div className="space-y-4 sm:space-y-6">
        {/* Tab Navigation with sliding indicator */}
        <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
          <div className="relative inline-flex h-11 sm:h-12 items-center justify-center rounded-xl bg-muted/60 p-1 sm:p-1.5 backdrop-blur-sm border border-border/40 min-w-fit">
            {BILLING_TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => handleTabChange(tab.id)}
                  className="relative z-10 inline-flex h-8 sm:h-9 items-center justify-center gap-1.5 sm:gap-2 rounded-lg px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium transition-colors min-w-[90px] sm:min-w-[140px]"
                >
                  {isActive && (
                    <motion.div
                      layoutId="billingTabIndicator"
                      className="absolute inset-0 rounded-lg bg-background shadow-md border border-border/50"
                      style={{ zIndex: -1 }}
                      transition={{
                        type: "spring",
                        stiffness: 500,
                        damping: 35,
                      }}
                    />
                  )}
                  <motion.span
                    initial={false}
                    animate={{
                      color: isActive
                        ? "hsl(var(--foreground))"
                        : "hsl(var(--muted-foreground))",
                      scale: isActive ? 1.02 : 1,
                    }}
                    transition={{ type: "spring", stiffness: 400, damping: 20 }}
                    className="flex items-center gap-1.5 sm:gap-2"
                  >
                    {tab.icon}
                    <span className="hidden sm:inline">{tab.label}</span>
                  </motion.span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Tab Content with AnimatePresence */}
        <div className="relative min-h-[500px]">
          <AnimatePresence mode="wait" custom={direction}>
            {/* Overview Tab */}
            {activeTab === "overview" && (
              <motion.div
                key="overview"
                custom={direction}
                variants={tabContentVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{
                  x: { type: "spring", stiffness: 300, damping: 30 },
                  opacity: { duration: 0.2 },
                }}
                className="space-y-6"
              >
                {/* Quick Stats - Unified Credits */}
                <motion.div
                  variants={staggerContainer}
                  initial="hidden"
                  animate="show"
                  className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4"
                >
                  <motion.div variants={staggerItem}>
                    <QuickStatCard
                      title="Credits Used"
                      value={formatNumber(credits.used)}
                      limit={formatNumber(credits.limit)}
                      percentage={creditsPercentage}
                      icon={<Coins className="size-4" />}
                    />
                  </motion.div>
                  <motion.div variants={staggerItem}>
                    <QuickStatCard
                      title="Purchased Credits"
                      value={formatNumber(purchasedTokens)}
                      limit={undefined}
                      percentage={undefined}
                      icon={<Plus className="size-4" />}
                      highlight={purchasedTokens > 0}
                    />
                  </motion.div>
                  <motion.div variants={staggerItem}>
                    <QuickStatCard
                      title="Token Credits"
                      value={formatNumber(credits.breakdown.tokenCredits)}
                      limit={undefined}
                      percentage={undefined}
                      icon={<BarChart3 className="size-4" />}
                    />
                  </motion.div>
                  <motion.div variants={staggerItem}>
                    <QuickStatCard
                      title="Image Credits"
                      value={formatNumber(credits.breakdown.imageCredits)}
                      limit={undefined}
                      percentage={undefined}
                      icon={<TrendingUp className="size-4" />}
                    />
                  </motion.div>
                  <motion.div variants={staggerItem}>
                    <QuickStatCard
                      title="Other Credits"
                      value={formatNumber(
                        credits.breakdown.voiceCredits +
                          credits.breakdown.sandboxCredits +
                          credits.breakdown.mcpCredits +
                          credits.breakdown.workflowCredits +
                          credits.breakdown.composioCredits +
                          credits.breakdown.webSearchCredits,
                      )}
                      limit={undefined}
                      percentage={undefined}
                      icon={<Package className="size-4" />}
                    />
                  </motion.div>
                </motion.div>

                {/* Free Models Banner - Only for Pro/Ultra */}
                {(currentTier === "pro" || currentTier === "ultra") && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15 }}
                  >
                    <Card className="relative overflow-hidden border-emerald-500/40 dark:border-emerald-400/30 bg-gradient-to-br from-emerald-500/[0.08] via-transparent to-emerald-500/[0.03] shadow-sm hover:shadow-md hover:border-emerald-500/50 transition-all duration-300">
                      <CardContent className="py-4">
                        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                          <div className="p-3 rounded-xl bg-gradient-to-br from-emerald-500/20 to-emerald-600/5 border border-emerald-500/30">
                            <Infinity className="size-5 text-emerald-500" />
                          </div>
                          <div className="flex-1">
                            <h3 className="text-base font-semibold text-foreground">
                              Unlimited Free Models
                            </h3>
                            <p className="text-sm text-muted-foreground mt-1">
                              As a {currentTier === "pro" ? "Pro" : "Ultra"}{" "}
                              subscriber, you have{" "}
                              <span className="font-medium text-emerald-600 dark:text-emerald-400">
                                unlimited access
                              </span>{" "}
                              to free-tier models that don&apos;t consume your
                              credits:
                            </p>
                            <div className="flex flex-wrap gap-2 mt-3">
                              <Badge
                                variant="secondary"
                                className="gap-1.5 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20 font-medium"
                              >
                                <ModelProviderIcon
                                  provider="groq"
                                  className="size-3.5"
                                />
                                Groq Models
                              </Badge>
                              <Badge
                                variant="secondary"
                                className="gap-1.5 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20 font-medium"
                              >
                                <ModelProviderIcon
                                  provider="openRouter"
                                  className="size-3.5"
                                />
                                OpenRouter
                              </Badge>
                              <Badge
                                variant="secondary"
                                className="gap-1.5 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20 font-medium"
                              >
                                <ModelProviderIcon
                                  provider="ollama"
                                  className="size-3.5"
                                />
                                Ollama
                              </Badge>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                )}

                {/* Charts Row */}
                <motion.div
                  variants={staggerContainer}
                  initial="hidden"
                  animate="show"
                  className="grid grid-cols-1 lg:grid-cols-2 gap-6"
                >
                  <motion.div variants={staggerItem}>
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">
                          Usage Over Time
                        </CardTitle>
                        <CardDescription>
                          Token consumption last 14 days
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <UsageAreaChart data={usageHistory} />
                      </CardContent>
                    </Card>
                  </motion.div>

                  <motion.div variants={staggerItem}>
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">
                          Usage by Model
                        </CardTitle>
                        <CardDescription>
                          Token distribution across providers
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        {modelBreakdown.length > 0 ? (
                          <ModelBreakdownChart data={modelBreakdown} />
                        ) : (
                          <div className="text-center py-8 text-muted-foreground">
                            <p>No usage data yet</p>
                            <p className="text-sm">
                              Start chatting to see model breakdown
                            </p>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </motion.div>
                </motion.div>

                {/* Buy More Credits */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                >
                  <Card>
                    <CardHeader>
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                          <Plus className="size-5 text-amber-600" />
                        </div>
                        <div>
                          <CardTitle className="text-base">
                            Need More Tokens?
                          </CardTitle>
                          <CardDescription>
                            {currentTier === "free"
                              ? "Upgrade to Pro or Ultra to purchase add-on credits"
                              : "Purchase additional tokens that never expire"}
                          </CardDescription>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {currentTier === "free" ? (
                        <div className="text-center py-6 space-y-4">
                          <p className="text-muted-foreground">
                            Token packs are exclusively available for Pro and
                            Ultra subscribers.
                          </p>
                          <Button
                            variant="default"
                            onClick={() => handleTabChange("plans")}
                          >
                            <Rocket className="size-4 mr-2" />
                            Upgrade Your Plan
                          </Button>
                        </div>
                      ) : (
                        <>
                          <PromoCodeInput
                            purchaseType="token_pack"
                            amount={2699}
                            onPromoApplied={setTokenPackPromo}
                          />
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            {TOKEN_PACKS_UI.map((pack) => {
                              const packQualifies =
                                tokenPackPromo &&
                                (tokenPackPromo.applicableTokenPacks.length ===
                                  0 ||
                                  tokenPackPromo.applicableTokenPacks.includes(
                                    pack.amount.toString(),
                                  ));
                              const displayPrice = packQualifies
                                ? (pack.price * 100 -
                                    (tokenPackPromo.discountType ===
                                    "percentage"
                                      ? (pack.price *
                                          100 *
                                          tokenPackPromo.discountValue) /
                                        100
                                      : tokenPackPromo.discountValue)) /
                                  100
                                : pack.price;
                              return (
                                <motion.div
                                  key={pack.amount}
                                  whileHover={{ scale: 1.02, y: -2 }}
                                  whileTap={{ scale: 0.98 }}
                                >
                                  <Button
                                    variant={
                                      pack.popular ? "default" : "outline"
                                    }
                                    className="h-auto py-4 flex flex-col gap-1 relative w-full"
                                    onClick={() => handleBuyTokens(pack.amount)}
                                    disabled={tokenPackLoading === pack.amount}
                                  >
                                    {pack.popular && (
                                      <Badge className="absolute -top-2 right-2 text-[10px]">
                                        Popular
                                      </Badge>
                                    )}
                                    {tokenPackLoading === pack.amount ? (
                                      <Loader2 className="size-4 animate-spin" />
                                    ) : (
                                      <>
                                        <span className="text-lg font-bold">
                                          {pack.label} Tokens
                                        </span>
                                        <span
                                          className={
                                            pack.popular
                                              ? "text-primary-foreground/80"
                                              : "text-muted-foreground"
                                          }
                                        >
                                          {packQualifies ? (
                                            <>
                                              <span className="line-through mr-1">
                                                ${pack.price}
                                              </span>
                                              ${displayPrice.toFixed(2)}
                                            </>
                                          ) : (
                                            `$${pack.price}`
                                          )}
                                        </span>
                                      </>
                                    )}
                                  </Button>
                                </motion.div>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </CardContent>
                  </Card>
                </motion.div>
              </motion.div>
            )}

            {/* Usage Details Tab */}
            {activeTab === "usage" && (
              <motion.div
                key="usage"
                custom={direction}
                variants={tabContentVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{
                  x: { type: "spring", stiffness: 300, damping: 30 },
                  opacity: { duration: 0.2 },
                }}
                className="space-y-6"
              >
                <motion.div
                  variants={staggerContainer}
                  initial="hidden"
                  animate="show"
                  className="grid grid-cols-1 md:grid-cols-2 gap-6"
                >
                  <motion.div variants={staggerItem}>
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">
                          Credits Overview
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-6">
                        <div className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">
                              Credits used this period
                            </span>
                            <span className="font-mono font-medium">
                              {formatNumber(credits.used)} /{" "}
                              {formatNumber(credits.limit)}
                            </span>
                          </div>
                          <Progress value={creditsPercentage} />
                          <p className="text-xs text-muted-foreground">
                            {creditsPercentage.toFixed(1)}% of monthly limit
                          </p>
                        </div>
                        <Separator />
                        <div className="space-y-3">
                          <h4 className="text-sm font-medium">By Provider</h4>
                          {modelBreakdown.length > 0 ? (
                            modelBreakdown.map((item) => (
                              <div
                                key={item.model}
                                className="flex items-center justify-between"
                              >
                                <div className="flex items-center gap-2">
                                  <ModelProviderIcon
                                    provider={item.provider}
                                    className="size-4"
                                  />
                                  <span className="text-sm truncate max-w-[120px]">
                                    {item.model}
                                  </span>
                                </div>
                                <span className="text-sm font-mono text-muted-foreground">
                                  {formatNumber(item.tokens)}
                                </span>
                              </div>
                            ))
                          ) : (
                            <p className="text-sm text-muted-foreground">
                              No usage data yet
                            </p>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>

                  <motion.div variants={staggerItem}>
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">
                          Credits by Service
                        </CardTitle>
                        <CardDescription>
                          {credits.used === 0
                            ? "Start using features to see credits tracked here"
                            : "Credits consumed by each service type"}
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-4">
                          <UsageRow
                            label="LLM Token Credits"
                            value={credits.breakdown.tokenCredits}
                          />
                          <UsageRow
                            label="Image Credits"
                            value={credits.breakdown.imageCredits}
                          />
                          <UsageRow
                            label="Voice Credits"
                            value={credits.breakdown.voiceCredits}
                          />
                          <Separator />
                          <UsageRow
                            label="Sandbox Credits"
                            value={credits.breakdown.sandboxCredits}
                          />
                          <UsageRow
                            label="MCP Credits"
                            value={credits.breakdown.mcpCredits}
                          />
                          <UsageRow
                            label="Workflow Credits"
                            value={credits.breakdown.workflowCredits}
                          />
                          <UsageRow
                            label="Composio Credits"
                            value={credits.breakdown.composioCredits}
                          />
                          <UsageRow
                            label="Web Search Credits"
                            value={credits.breakdown.webSearchCredits}
                          />
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                </motion.div>

                {/* Weekly Summary & Projection */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15 }}
                >
                  <WeeklySummaryCard credits={credits} />
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                >
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">
                        Daily Usage Breakdown
                      </CardTitle>
                      <CardDescription>
                        Token and execution usage over the past 14 days
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <UsageBarChart data={usageHistory} />
                    </CardContent>
                  </Card>
                </motion.div>
              </motion.div>
            )}

            {/* Plans Tab */}
            {activeTab === "plans" && (
              <motion.div
                key="plans"
                custom={direction}
                variants={tabContentVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{
                  x: { type: "spring", stiffness: 300, damping: 30 },
                  opacity: { duration: 0.2 },
                }}
                className="space-y-6"
              >
                {/* Billing Cycle Toggle - Clean pill style like Cursor */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex flex-col items-center gap-3"
                >
                  <div className="relative inline-flex h-10 items-center rounded-full bg-muted p-1">
                    <button
                      onClick={() => setBillingCycle("monthly")}
                      className="relative z-10 h-8 px-5 text-sm font-medium transition-colors rounded-full"
                    >
                      {billingCycle === "monthly" && (
                        <motion.div
                          layoutId="billingPill"
                          className="absolute inset-0 rounded-full bg-background shadow-sm"
                          style={{ zIndex: -1 }}
                          transition={{
                            type: "spring",
                            stiffness: 500,
                            damping: 30,
                          }}
                        />
                      )}
                      <span
                        className={
                          billingCycle === "monthly"
                            ? "text-foreground"
                            : "text-muted-foreground"
                        }
                      >
                        Monthly
                      </span>
                    </button>
                    <button
                      onClick={() => setBillingCycle("annual")}
                      className="relative z-10 h-8 px-5 text-sm font-medium transition-colors rounded-full"
                    >
                      {billingCycle === "annual" && (
                        <motion.div
                          layoutId="billingPill"
                          className="absolute inset-0 rounded-full bg-background shadow-sm"
                          style={{ zIndex: -1 }}
                          transition={{
                            type: "spring",
                            stiffness: 500,
                            damping: 30,
                          }}
                        />
                      )}
                      <span
                        className={
                          billingCycle === "annual"
                            ? "text-foreground"
                            : "text-muted-foreground"
                        }
                      >
                        Yearly
                      </span>
                    </button>
                  </div>
                  {/* Subtle save indicator - only show when annual is selected */}
                  <AnimatePresence>
                    {billingCycle === "annual" && (
                      <motion.p
                        initial={{ opacity: 0, y: -5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -5 }}
                        className="text-sm text-green-600 font-medium"
                      >
                        Save 20%
                      </motion.p>
                    )}
                  </AnimatePresence>
                </motion.div>

                {/* Promo Code Input for Subscriptions */}
                {currentTier !== "ultra" && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base">
                          Have a promo code?
                        </CardTitle>
                        <CardDescription>
                          Enter your code to get a discount on your subscription
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <PromoCodeInput
                          purchaseType="subscription"
                          tier={currentTier === "free" ? "pro" : "ultra"}
                          amount={getMonthlyPrice(
                            currentTier === "free" ? "pro" : "ultra",
                          )}
                          onPromoApplied={setAppliedPromo}
                        />
                      </CardContent>
                    </Card>
                  </motion.div>
                )}

                <motion.div
                  variants={staggerContainer}
                  initial="hidden"
                  animate="show"
                  className="grid grid-cols-1 md:grid-cols-3 gap-6"
                >
                  {(
                    Object.keys(PLAN_DETAILS) as Array<
                      keyof typeof PLAN_DETAILS
                    >
                  ).map((tier) => {
                    const plan = PLAN_DETAILS[tier];
                    const isCurrentPlan = tier === currentTier;
                    const canUpgrade = getCanUpgrade(tier, currentTier);
                    const canDowngrade = getCanDowngrade(tier, currentTier);

                    const displayPrice =
                      billingCycle === "annual"
                        ? plan.annualPrice
                        : plan.monthlyPrice;
                    const priceInCents = displayPrice * 100;
                    const hasDiscount = appliedPromo && canUpgrade;
                    const discountedPrice = hasDiscount
                      ? appliedPromo.discountType === "percentage"
                        ? (priceInCents -
                            (priceInCents * appliedPromo.discountValue) / 100) /
                          100
                        : (priceInCents - appliedPromo.discountValue) / 100
                      : displayPrice;

                    return (
                      <motion.div
                        key={tier}
                        variants={staggerItem}
                        whileHover={{ y: -4 }}
                        transition={{
                          type: "spring",
                          stiffness: 400,
                          damping: 17,
                        }}
                      >
                        <Card
                          className={`relative h-full ${isCurrentPlan ? "border-primary ring-1 ring-primary/20" : ""} ${plan.highlight && !isCurrentPlan ? "border-primary/50" : ""}`}
                        >
                          {plan.highlight && !isCurrentPlan && (
                            <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                              <Badge className="bg-primary">Most Popular</Badge>
                            </div>
                          )}
                          {hasDiscount && (
                            <div className="absolute -top-3 right-4">
                              <Badge
                                variant="secondary"
                                className="bg-green-500/10 text-green-600 border-green-500/20"
                              >
                                {appliedPromo.discountType === "percentage"
                                  ? `${appliedPromo.discountValue}% OFF`
                                  : `$${(appliedPromo.discountValue / 100).toFixed(0)} OFF`}
                              </Badge>
                            </div>
                          )}
                          <CardHeader className="text-center pb-2">
                            <CardTitle className="text-lg">
                              {plan.name}
                            </CardTitle>
                            <div className="mt-4">
                              {hasDiscount ? (
                                <>
                                  <span className="text-2xl text-muted-foreground line-through mr-2">
                                    ${displayPrice}
                                  </span>
                                  <span className="text-4xl font-bold text-green-600">
                                    ${discountedPrice.toFixed(2)}
                                  </span>
                                </>
                              ) : (
                                <span className="text-4xl font-bold">
                                  ${displayPrice}
                                </span>
                              )}
                              <span className="text-muted-foreground">
                                {billingCycle === "annual" ? "/year" : "/month"}
                              </span>
                            </div>
                            <CardDescription className="mt-2">
                              {plan.description}
                            </CardDescription>
                          </CardHeader>
                          <CardContent className="space-y-4">
                            <Separator />
                            <ul className="space-y-3">
                              {plan.features.map((feature) => (
                                <li
                                  key={feature}
                                  className="flex items-center gap-2 text-sm"
                                >
                                  <CircleCheck className="size-4 text-primary shrink-0" />
                                  <span>{feature}</span>
                                </li>
                              ))}
                            </ul>
                            <div className="pt-4">
                              {isCurrentPlan ? (
                                <Button
                                  variant="outline"
                                  className="w-full"
                                  disabled
                                >
                                  Current Plan
                                </Button>
                              ) : canUpgrade ? (
                                <Button
                                  className="w-full"
                                  onClick={() => handleUpgrade(tier)}
                                  disabled={checkoutLoading === tier}
                                >
                                  {checkoutLoading === tier ? (
                                    <Loader2 className="size-4 animate-spin mr-2" />
                                  ) : null}
                                  Upgrade
                                  <ArrowRight className="size-4 ml-2" />
                                </Button>
                              ) : canDowngrade ? (
                                <Button
                                  variant="outline"
                                  className="w-full"
                                  onClick={() => handleUpgrade(tier)}
                                  disabled={checkoutLoading === tier}
                                >
                                  {checkoutLoading === tier ? (
                                    <Loader2 className="size-4 animate-spin mr-2" />
                                  ) : null}
                                  Switch to {plan.name}
                                </Button>
                              ) : (
                                <Button
                                  variant="ghost"
                                  className="w-full"
                                  asChild
                                >
                                  <a
                                    href="mailto:sales@shadower.ai?subject=Enterprise%20Inquiry"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    <ExternalLink className="size-4 mr-2" />
                                    Contact Sales
                                  </a>
                                </Button>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      </motion.div>
                    );
                  })}
                </motion.div>

                {/* Enterprise CTA */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                >
                  <Card className="bg-gradient-to-r from-secondary via-secondary/50 to-secondary">
                    <CardContent className="flex flex-col sm:flex-row items-center justify-between gap-4 py-8">
                      <div className="text-center sm:text-left">
                        <h3 className="text-lg font-semibold">
                          Need a custom solution?
                        </h3>
                        <p className="text-muted-foreground">
                          Get dedicated support, custom limits, and enterprise
                          SLAs
                        </p>
                      </div>
                      <Button variant="outline" size="lg" asChild>
                        <a
                          href="mailto:sales@shadower.ai?subject=Enterprise%20Inquiry"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ExternalLink className="size-4 mr-2" />
                          Contact Sales
                        </a>
                      </Button>
                    </CardContent>
                  </Card>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function BillingDashboardSkeleton() {
  return (
    <div className="w-full flex flex-col gap-6 p-8 max-w-6xl mx-auto">
      <div className="flex justify-between items-center">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-10 w-32" />
      </div>
      <Skeleton className="h-32" />
      <Skeleton className="h-10 w-80" />
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
    </div>
  );
}

interface QuickStatCardProps {
  title: string;
  value: string | number;
  limit?: string | number;
  percentage?: number;
  icon: React.ReactNode;
  highlight?: boolean;
}

function QuickStatCard({
  title,
  value,
  limit,
  percentage,
  icon,
  highlight,
}: Readonly<QuickStatCardProps>) {
  const isWarning =
    percentage !== undefined && percentage >= 80 && percentage < 95;
  const isCritical = percentage !== undefined && percentage >= 95;

  const progressColor = getProgressColor(isCritical, isWarning);

  const cardBorderClass = getBorderClass(isCritical, isWarning);
  const highlightClass = highlight
    ? "border-emerald-500/40 bg-gradient-to-br from-emerald-500/[0.08] to-transparent"
    : "";

  return (
    <Card
      className={`overflow-hidden bg-gradient-to-br from-card to-muted/30 shadow-sm hover:shadow-md transition-all duration-200 ${cardBorderClass} ${highlightClass}`}
    >
      <CardContent className="py-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{title}</span>
            {isCritical && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-600 dark:text-red-400 font-medium">
                LIMIT
              </span>
            )}
            {isWarning && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-600 dark:text-orange-400 font-medium">
                80%+
              </span>
            )}
          </div>
          <div className="p-2 rounded-lg bg-muted/60 border border-border/40">
            {icon}
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-2xl font-bold tabular-nums">
            {value}
            {limit !== undefined && (
              <span className="text-sm font-normal text-muted-foreground">
                {" "}
                / {limit}
              </span>
            )}
          </p>
          {percentage !== undefined && (
            <div className="space-y-1">
              <Progress
                value={percentage}
                className={`h-1.5 ${progressColor}`}
              />
              <p
                className={`text-[10px] tabular-nums ${getStatusTextColor(isCritical, isWarning)}`}
              >
                {percentage.toFixed(1)}% used
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

interface UsageRowProps {
  label: string;
  value: number;
  limit?: number;
}

function UsageRow({ label, value, limit }: Readonly<UsageRowProps>) {
  const percentage = limit ? Math.min((value / limit) * 100, 100) : undefined;
  const isWarning =
    percentage !== undefined && percentage >= 80 && percentage < 95;
  const isCritical = percentage !== undefined && percentage >= 95;

  const progressColor = getProgressColor(isCritical, isWarning);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <span>{label}</span>
          {isCritical && (
            <span className="text-[10px] px-1 py-0.5 rounded bg-red-500/10 text-red-600 dark:text-red-400 font-medium">
              LIMIT
            </span>
          )}
          {isWarning && (
            <span className="text-[10px] px-1 py-0.5 rounded bg-orange-500/10 text-orange-600 dark:text-orange-400 font-medium">
              80%+
            </span>
          )}
        </div>
        <span
          className={`font-mono ${getStatusTextColor(isCritical, isWarning)}`}
        >
          {value.toLocaleString()}
          {limit !== undefined && ` / ${limit.toLocaleString()}`}
        </span>
      </div>
      {percentage !== undefined && (
        <Progress value={percentage} className={`h-1.5 ${progressColor}`} />
      )}
    </div>
  );
}

interface WeeklySummaryCardProps {
  credits: {
    used: number;
    limit: number;
    breakdown: CreditsBreakdown;
  };
}

function WeeklySummaryCard({ credits }: Readonly<WeeklySummaryCardProps>) {
  // Calculate days elapsed in current month
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const daysElapsed = Math.max(
    1,
    Math.ceil((now.getTime() - startOfMonth.getTime()) / (1000 * 60 * 60 * 24)),
  );
  const daysInMonth = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0,
  ).getDate();
  const daysRemaining = daysInMonth - daysElapsed;

  // Calculate weekly average (based on days elapsed)
  const weeklyCredits = Math.round((credits.used / daysElapsed) * 7);
  const dailyCredits = Math.round(credits.used / daysElapsed);

  // Project end-of-month usage
  const projectedMonthlyCredits = Math.round(
    (credits.used / daysElapsed) * daysInMonth,
  );
  const projectedPercentage = (projectedMonthlyCredits / credits.limit) * 100;

  // Determine projection status
  const isNearLimit = projectedPercentage > 80 && projectedPercentage <= 100;
  const willExceed = projectedPercentage > 100;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingUp className="size-4" />
          Weekly Summary & Projection
        </CardTitle>
        <CardDescription>
          Based on {daysElapsed} days of usage this month ({daysRemaining} days
          remaining)
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Current Week Stats */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground">
              Current Pace
            </h4>
            <div className="space-y-1">
              <p className="text-2xl font-bold tabular-nums">
                {formatNumber(dailyCredits)}
                <span className="text-sm font-normal text-muted-foreground">
                  /day
                </span>
              </p>
              <p className="text-sm text-muted-foreground">
                ~{formatNumber(weeklyCredits)} credits/week
              </p>
            </div>
          </div>

          {/* Projected Usage */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground">
              Projected Monthly
            </h4>
            <div className="space-y-2">
              <p
                className={`text-2xl font-bold tabular-nums ${getStatusTextColor(willExceed, isNearLimit)}`}
              >
                {formatNumber(projectedMonthlyCredits)}
              </p>
              <div className="flex items-center gap-2">
                <Progress
                  value={Math.min(projectedPercentage, 100)}
                  className={`h-1.5 flex-1 ${getProgressColor(willExceed, isNearLimit)}`}
                />
                <span
                  className={`text-xs tabular-nums ${getStatusTextColor(willExceed, isNearLimit)}`}
                >
                  {projectedPercentage.toFixed(0)}%
                </span>
              </div>
            </div>
          </div>

          {/* Status Indicator */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground">
              Status
            </h4>
            <div className="space-y-2">
              {willExceed ? (
                <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
                  <div className="size-2 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-sm font-medium">Exceeds Limit</span>
                </div>
              ) : isNearLimit ? (
                <div className="flex items-center gap-2 text-orange-600 dark:text-orange-400">
                  <div className="size-2 rounded-full bg-orange-500" />
                  <span className="text-sm font-medium">Near Limit</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                  <CircleCheck className="size-4" />
                  <span className="text-sm font-medium">On Track</span>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {willExceed
                  ? `~${formatNumber(projectedMonthlyCredits - credits.limit)} over limit`
                  : `~${formatNumber(credits.limit - projectedMonthlyCredits)} credits headroom`}
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Chart configurations
const areaChartConfig: ChartConfig = {
  tokens: {
    label: "Tokens",
    color: "var(--chart-1)",
  },
};

const barChartConfig: ChartConfig = {
  tokens: {
    label: "Tokens",
    color: "var(--chart-1)",
  },
  credits: {
    label: "Credits",
    color: "var(--chart-2)",
  },
};

function UsageAreaChart({
  data,
}: Readonly<{ data: Array<{ date: string; tokens: number }> }>) {
  return (
    <ChartContainer config={areaChartConfig} className="h-[200px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <defs>
            <linearGradient id="tokenGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.3} />
              <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            fontSize={12}
            tickMargin={8}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            fontSize={12}
            tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
          />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Area
            type="monotone"
            dataKey="tokens"
            stroke="var(--chart-1)"
            strokeWidth={2}
            fill="url(#tokenGradient)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}

function UsageBarChart({
  data,
}: Readonly<{
  data: Array<{ date: string; tokens: number; credits: number }>;
}>) {
  return (
    <ChartContainer config={barChartConfig} className="h-[250px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            fontSize={12}
            tickMargin={8}
          />
          <YAxis
            yAxisId="left"
            tickLine={false}
            axisLine={false}
            fontSize={12}
            tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tickLine={false}
            axisLine={false}
            fontSize={12}
          />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Legend />
          <Bar
            yAxisId="left"
            dataKey="tokens"
            fill="var(--chart-1)"
            radius={4}
          />
          <Bar
            yAxisId="right"
            dataKey="credits"
            fill="var(--chart-2)"
            radius={4}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}

function ModelBreakdownChart({
  data,
}: Readonly<{
  data: Array<{
    provider: string;
    model: string;
    tokens: number;
    credits: number;
    count: number;
    color: string;
  }>;
}>) {
  const total = data.reduce((sum, item) => sum + item.tokens, 0);

  const pieConfig: ChartConfig = {};
  data.forEach((item, idx) => {
    pieConfig[item.model] = {
      label: item.model,
      color: `var(--chart-${(idx % 5) + 1})`,
    };
  });

  return (
    <div className="flex flex-col lg:flex-row items-center gap-6">
      <ChartContainer config={pieConfig} className="h-[180px] w-[180px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <ChartTooltip content={<ChartTooltipContent hideLabel />} />
            <Pie
              data={data.map((d) => ({ ...d, name: d.model, value: d.tokens }))}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={75}
              strokeWidth={2}
            >
              {data.map((entry, index) => (
                <Cell
                  key={entry.model}
                  fill={`var(--chart-${(index % 5) + 1})`}
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </ChartContainer>
      <div className="flex-1 space-y-2">
        {data.map((item, idx) => {
          const pct = ((item.tokens / total) * 100).toFixed(1);
          return (
            <div key={item.model} className="flex items-center gap-3">
              <div
                className="size-3 rounded-full"
                style={{ backgroundColor: `var(--chart-${(idx % 5) + 1})` }}
              />
              <ModelProviderIcon provider={item.provider} className="size-4" />
              <span className="text-sm truncate max-w-[100px]">
                {item.model}
              </span>
              <span className="text-sm font-mono text-muted-foreground ml-auto">
                {formatNumber(item.tokens)} ({pct}%)
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatNumber(num: number): string {
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M`;
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(1)}K`;
  }
  return num.toLocaleString();
}
