"use client";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ModelTier,
  TIER_DISPLAY,
  getModelMultiplierInfo,
} from "@/lib/billing/model-multipliers";
import { cn } from "lib/utils";

interface ModelMultiplierBadgeProps {
  model: string;
  provider?: string;
  className?: string;
  showTooltip?: boolean;
  size?: "sm" | "md";
}

const TIER_COLORS: Record<ModelTier, string> = {
  free: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400 dark:border-emerald-500/30",
  budget:
    "bg-green-500/10 text-green-600 border-green-500/20 dark:text-green-400 dark:border-green-500/30",
  standard:
    "bg-yellow-500/10 text-yellow-600 border-yellow-500/20 dark:text-yellow-400 dark:border-yellow-500/30",
  premium:
    "bg-orange-500/10 text-orange-600 border-orange-500/20 dark:text-orange-400 dark:border-orange-500/30",
  ultra:
    "bg-red-500/10 text-red-600 border-red-500/20 dark:text-red-400 dark:border-red-500/30",
};

export function ModelMultiplierBadge({
  model,
  provider,
  className,
  showTooltip = true,
  size = "sm",
}: Readonly<ModelMultiplierBadgeProps>) {
  const { multiplier, tier } = getModelMultiplierInfo(model, provider);
  const tierInfo = TIER_DISPLAY[tier];

  // Show "Free" for free tier, multiplier for others
  const displayText = tier === "free" ? "Free" : `${multiplier}x`;

  const badge = (
    <Badge
      variant="outline"
      className={cn(
        TIER_COLORS[tier],
        size === "sm" ? "text-[10px] px-1.5 py-0" : "text-xs px-2 py-0.5",
        tier === "free" ? "font-medium" : "font-semibold tabular-nums",
        className,
      )}
    >
      {displayText}
    </Badge>
  );

  if (!showTooltip) {
    return badge;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent side="top" className="max-w-[200px]">
        <div className="space-y-1">
          <p className="font-medium">
            {tier === "free"
              ? "Unlimited for Pro/Ultra"
              : `Uses ${multiplier}x tokens from your quota`}
          </p>
          <p className="text-muted-foreground">{tierInfo.description}</p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Compact version for inline display next to model name
 */
export function ModelMultiplierIndicator({
  model,
  provider,
  className,
}: Readonly<{
  model: string;
  provider?: string;
  className?: string;
}>) {
  const { multiplier, tier } = getModelMultiplierInfo(model, provider);

  // Don't show 1x multiplier for budget models - they're the default
  if (multiplier === 1) {
    return null;
  }

  const textColors: Record<ModelTier, string> = {
    free: "text-emerald-600 dark:text-emerald-400",
    budget: "text-green-600 dark:text-green-400",
    standard: "text-yellow-600 dark:text-yellow-400",
    premium: "text-orange-600 dark:text-orange-400",
    ultra: "text-red-600 dark:text-red-400",
  };

  return (
    <span
      className={cn(
        "text-[10px] font-semibold tabular-nums",
        textColors[tier],
        className,
      )}
    >
      {multiplier}x
    </span>
  );
}
