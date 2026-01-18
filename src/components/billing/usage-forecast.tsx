"use client";

import {
  type UsageForecast,
  type UsageTrend,
  getTrendLabel,
} from "lib/billing/forecasting";
import { cn } from "lib/utils";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Calendar,
  CheckCircle,
  Minus,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import useSWR from "swr";
import { Button } from "ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "ui/card";
import { Progress } from "ui/progress";
import { Skeleton } from "ui/skeleton";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

function TrendIcon({ trend }: Readonly<{ trend: UsageTrend }>) {
  switch (trend) {
    case "increasing":
      return <TrendingUp className="size-4 text-orange-500" />;
    case "decreasing":
      return <TrendingDown className="size-4 text-green-500" />;
    default:
      return <Minus className="size-4 text-muted-foreground" />;
  }
}

function ForecastStatusIcon({
  percentUsed,
}: Readonly<{ percentUsed: number }>) {
  if (percentUsed >= 100) {
    return <AlertCircle className="size-5 text-destructive" />;
  }
  if (percentUsed >= 80) {
    return <AlertTriangle className="size-5 text-orange-500" />;
  }
  return <CheckCircle className="size-5 text-green-500" />;
}

function formatNumber(num: number): string {
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M`;
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(1)}K`;
  }
  return num.toString();
}

interface UsageForecastProps {
  onUpgrade?: () => void;
}

export function UsageForecastCard({ onUpgrade }: Readonly<UsageForecastProps>) {
  const {
    data: forecast,
    error,
    isLoading,
  } = useSWR<UsageForecast>("/api/billing/forecast", fetcher, {
    revalidateOnFocus: false,
    refreshInterval: 5 * 60 * 1000, // Refresh every 5 minutes
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-48 mt-1" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error || !forecast) {
    return null; // Silently fail if forecast not available
  }

  const usagePercent = Math.round(
    (forecast.currentUsage / forecast.monthlyLimit) * 100,
  );
  const isOverLimit = forecast.projectedUsagePercent >= 100;
  const isNearLimit = forecast.projectedUsagePercent >= 80;

  return (
    <Card
      className={cn(
        isOverLimit && "border-destructive/50",
        isNearLimit && !isOverLimit && "border-orange-500/50",
      )}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Calendar className="size-4" />
            Usage Forecast
          </CardTitle>
          <ForecastStatusIcon percentUsed={forecast.projectedUsagePercent} />
        </div>
        <CardDescription className="text-xs">
          Based on {forecast.analysisPeriod} days of usage history
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Current usage progress */}
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-muted-foreground">Current usage</span>
            <span className="font-medium">
              {formatNumber(forecast.currentUsage)} /{" "}
              {formatNumber(forecast.monthlyLimit)}
            </span>
          </div>
          <Progress
            value={Math.min(usagePercent, 100)}
            className={cn(
              "h-2",
              usagePercent >= 100 && "[&>div]:bg-destructive",
              usagePercent >= 80 &&
                usagePercent < 100 &&
                "[&>div]:bg-orange-500",
            )}
          />
        </div>

        {/* Forecast details */}
        <div className="grid grid-cols-2 gap-3 py-2">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Projected (EOM)</p>
            <p
              className={cn(
                "text-lg font-semibold",
                isOverLimit && "text-destructive",
                isNearLimit && !isOverLimit && "text-orange-500",
              )}
            >
              {formatNumber(forecast.projectedMonthlyUsage)}
            </p>
            <p className="text-xs text-muted-foreground">
              {forecast.projectedUsagePercent}% of limit
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Daily average</p>
            <p className="text-lg font-semibold">
              {formatNumber(forecast.dailyAverage)}
            </p>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <TrendIcon trend={forecast.trend} />
              {getTrendLabel(forecast.trend)}
            </div>
          </div>
        </div>

        {/* Time to limit */}
        {forecast.daysUntilLimit !== null && (
          <div
            className={cn(
              "flex items-center gap-2 p-2 rounded-md text-sm",
              forecast.daysUntilLimit <= 3 &&
                "bg-destructive/10 text-destructive",
              forecast.daysUntilLimit > 3 &&
                forecast.daysUntilLimit <= 7 &&
                "bg-orange-500/10 text-orange-700 dark:text-orange-400",
              forecast.daysUntilLimit > 7 && "bg-muted text-muted-foreground",
            )}
          >
            <AlertTriangle className="size-4" />
            {forecast.daysUntilLimit === 0 ? (
              <span>You've reached your limit</span>
            ) : (
              <span>~{forecast.daysUntilLimit} days until limit</span>
            )}
          </div>
        )}

        {/* Recommendation */}
        <div className="pt-2 border-t">
          <p className="text-xs text-muted-foreground mb-2">Recommendation</p>
          <p className="text-sm">{forecast.recommendation}</p>
        </div>

        {/* Upgrade CTA for free/pro users */}
        {(forecast.tier === "free" || forecast.tier === "pro") &&
          isNearLimit &&
          onUpgrade && (
            <Button
              onClick={onUpgrade}
              variant={isOverLimit ? "destructive" : "outline"}
              size="sm"
              className="w-full mt-2"
            >
              {forecast.tier === "free" ? "Upgrade to Pro" : "Upgrade to Ultra"}
              <ArrowRight className="size-4 ml-1" />
            </Button>
          )}

        {/* Days remaining */}
        <p className="text-xs text-muted-foreground text-center">
          {forecast.daysRemaining} days remaining in billing period
        </p>
      </CardContent>
    </Card>
  );
}

export default UsageForecastCard;
