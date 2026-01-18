"use client";

import { appStore } from "@/app/store";
import { ArrowRight, Coins, Crown, Gift, Rocket } from "lucide-react";
import { Button } from "ui/button";
import { Progress } from "ui/progress";

import type { SubscriptionTier } from "@/lib/billing/types";

/** Opens the billing popup drawer */
function openBillingPopup(): void {
  appStore.getState().mutate({ openBilling: true });
}

type LimitPeriod = "monthly" | "weekly" | "daily";

interface LimitExceededCardProps {
  usage: number;
  limit: number;
  tier: SubscriptionTier;
  limitType?: string;
  periodType?: LimitPeriod;
}

const TIER_NAMES: Record<SubscriptionTier, string> = {
  free: "Free",
  pro: "Pro",
  ultra: "Ultra",
};

const TIER_ICONS: Record<SubscriptionTier, React.ReactNode> = {
  free: <Gift className="size-4" />,
  pro: <Rocket className="size-4" />,
  ultra: <Crown className="size-4" />,
};

const TIER_ICONS_LARGE: Record<SubscriptionTier, React.ReactNode> = {
  free: <Gift className="size-6" />,
  pro: <Rocket className="size-6" />,
  ultra: <Crown className="size-6" />,
};

const NEXT_TIER: Record<SubscriptionTier, SubscriptionTier | null> = {
  free: "pro",
  pro: "ultra",
  ultra: null,
};

const PERIOD_LABELS: Record<LimitPeriod, string> = {
  monthly: "Monthly",
  weekly: "Weekly",
  daily: "Daily",
};

const PERIOD_RESET_TEXT: Record<LimitPeriod, string> = {
  monthly: "Resets at the start of next month.",
  weekly: "Resets on Sunday.",
  daily: "Resets tomorrow.",
};

export function LimitExceededCard({
  usage,
  limit,
  tier,
  limitType = "credits",
  periodType = "monthly",
}: Readonly<LimitExceededCardProps>) {
  const percentage = Math.min((usage / limit) * 100, 100);
  const nextTier = NEXT_TIER[tier];
  const isMaxTier = tier === "ultra";
  const periodLabel = PERIOD_LABELS[periodType];

  return (
    <div className="w-full mx-auto max-w-3xl px-6 animate-in fade-in slide-in-from-bottom-2 mt-4">
      <div className="rounded-xl border border-border/50 bg-gradient-to-br from-background via-background to-primary/5 p-6 shadow-lg">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 p-3 rounded-xl bg-primary/10 border border-primary/20 text-primary">
            {TIER_ICONS_LARGE[tier]}
          </div>

          <div className="flex-1 space-y-4">
            <div>
              <h3 className="font-semibold text-lg">
                {periodLabel} {limitType} Limit Reached
              </h3>
              <p className="text-muted-foreground text-sm mt-1">
                You&apos;ve used all your {limitType} for this {periodType}{" "}
                period on the{" "}
                <span className="font-medium text-foreground">
                  {TIER_NAMES[tier]}
                </span>{" "}
                plan. {PERIOD_RESET_TEXT[periodType]}
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Usage</span>
                <span className="font-medium">
                  {usage.toLocaleString()} / {limit.toLocaleString()}
                </span>
              </div>
              <Progress value={percentage} className="h-2" />
            </div>

            <div className="pt-2">
              {isMaxTier ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    You&apos;re on our highest tier. Need more? Purchase
                    additional credits to continue using the platform.
                  </p>
                  <Button
                    className="w-full sm:w-auto gap-2"
                    onClick={openBillingPopup}
                  >
                    <Coins className="size-4" />
                    Buy Additional Credits
                    <ArrowRight className="size-4" />
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Upgrade to{" "}
                    <span className="font-medium text-foreground">
                      {TIER_NAMES[nextTier!]}
                    </span>{" "}
                    for higher limits and unlock more features.
                  </p>
                  <Button
                    className="w-full sm:w-auto gap-2"
                    onClick={openBillingPopup}
                  >
                    {TIER_ICONS[nextTier!]}
                    Upgrade to {TIER_NAMES[nextTier!]}
                    <ArrowRight className="size-4" />
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Helper to parse limit exceeded error from API response
export function parseLimitExceededError(errorMessage: string): {
  isLimitExceeded: boolean;
  usage?: number;
  limit?: number;
  tier?: SubscriptionTier;
  limitType?: string;
  periodType?: LimitPeriod;
} {
  // Helper to determine period type from subLimitExceeded or message
  const getPeriodType = (
    subLimitExceeded?: string,
    message?: string,
  ): LimitPeriod => {
    if (subLimitExceeded === "weekly") return "weekly";
    if (subLimitExceeded === "daily_expensive") return "daily";
    // Fallback: check message content
    if (message?.toLowerCase().includes("weekly")) return "weekly";
    if (message?.toLowerCase().includes("daily")) return "daily";
    return "monthly";
  };

  try {
    // Try to parse as JSON
    const parsed = JSON.parse(errorMessage);
    if (parsed.error === "limit_exceeded") {
      // Extract limit type from message - unified credits is the default
      let limitType = "credits";
      const message = parsed.message || "";
      if (message.includes("Credit")) limitType = "credits";
      else if (message.includes("tokens")) limitType = "token credits";
      else if (message.includes("images")) limitType = "image credits";
      else if (message.includes("sandbox")) limitType = "sandbox credits";
      else if (message.includes("workflow")) limitType = "workflow credits";
      else if (message.includes("voice")) limitType = "voice credits";
      else if (message.includes("mcp")) limitType = "MCP credits";

      return {
        isLimitExceeded: true,
        usage: parsed.usage,
        limit: parsed.limit,
        tier: parsed.tier as SubscriptionTier,
        limitType,
        periodType: getPeriodType(parsed.subLimitExceeded, message),
      };
    }
  } catch {
    // Check if it's a stringified error message containing limit_exceeded
    if (errorMessage.includes("limit_exceeded")) {
      // Try to extract values using regex
      const usageMatch = /"usage":\s*(\d+)/.exec(errorMessage);
      const limitMatch = /"limit":\s*(\d+)/.exec(errorMessage);
      const tierMatch = /"tier":\s*"(\w+)"/.exec(errorMessage);
      const subLimitMatch = /"subLimitExceeded":\s*"(\w+)"/.exec(errorMessage);

      if (usageMatch && limitMatch && tierMatch) {
        let limitType = "credits";
        if (errorMessage.includes("Credit")) limitType = "credits";
        else if (errorMessage.includes("tokens")) limitType = "token credits";
        else if (errorMessage.includes("images")) limitType = "image credits";
        else if (errorMessage.includes("sandbox"))
          limitType = "sandbox credits";
        else if (errorMessage.includes("workflow"))
          limitType = "workflow credits";

        return {
          isLimitExceeded: true,
          usage: Number.parseInt(usageMatch[1], 10),
          limit: Number.parseInt(limitMatch[1], 10),
          tier: tierMatch[1] as SubscriptionTier,
          limitType,
          periodType: getPeriodType(subLimitMatch?.[1], errorMessage),
        };
      }
    }
  }

  return { isLimitExceeded: false };
}
