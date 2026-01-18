"use client";

import { appStore } from "@/app/store";
import { AlertTriangle, X, Zap } from "lucide-react";
import { useEffect, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Opens the billing popup drawer */
function openBillingPopup(): void {
  appStore.getState().mutate({ openBilling: true });
}

interface UsageWarning {
  type: string;
  label: string;
  usage: number;
  limit: number;
  percentUsed: number;
  severity: "warning" | "critical";
}

interface UsageWarningsResponse {
  warnings: UsageWarning[];
  hasWarnings: boolean;
  hasCritical: boolean;
  tier: string;
}

interface UsageWarningBannerProps {
  className?: string;
  showUpgradeLink?: boolean;
  dismissable?: boolean;
}

export function UsageWarningBanner({
  className,
  showUpgradeLink = true,
  dismissable = true,
}: Readonly<UsageWarningBannerProps>) {
  const [warnings, setWarnings] = useState<UsageWarningsResponse | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchWarnings = async () => {
      try {
        const response = await fetch("/api/billing/usage?warnings=true");
        if (response.ok) {
          const data = await response.json();
          setWarnings(data);
        }
      } catch {
        // Silently fail - don't block UI
      } finally {
        setLoading(false);
      }
    };

    fetchWarnings();
  }, []);

  // Don't show if loading, dismissed, or no warnings
  if (loading || dismissed || !warnings?.hasWarnings) {
    return null;
  }

  const isCritical = warnings.hasCritical;
  const topWarning = warnings.warnings[0];

  // Format the message
  const getWarningMessage = () => {
    if (warnings.warnings.length === 1) {
      return `You've used ${topWarning.percentUsed.toFixed(0)}% of your monthly ${topWarning.label.toLowerCase()} limit`;
    }
    return `You're approaching limits on ${warnings.warnings.length} resources (${topWarning.label}: ${topWarning.percentUsed.toFixed(0)}%)`;
  };

  return (
    <Alert
      variant={isCritical ? "destructive" : "default"}
      className={cn(
        isCritical
          ? "border-red-500/50 bg-red-500/10"
          : "border-orange-500/50 bg-orange-500/10",
        className,
      )}
    >
      <AlertTriangle
        className={`h-4 w-4 ${isCritical ? "text-red-500" : "text-orange-500"}`}
      />
      <AlertDescription className="flex items-center justify-between w-full">
        <span
          className={`${isCritical ? "text-red-600 dark:text-red-400" : "text-orange-600 dark:text-orange-400"}`}
        >
          {getWarningMessage()}
        </span>
        <div className="flex items-center gap-2">
          {showUpgradeLink && warnings.tier !== "ultra" && (
            <Button
              variant="outline"
              size="sm"
              onClick={openBillingPopup}
              className={`${
                isCritical
                  ? "border-red-500/50 hover:bg-red-500/10"
                  : "border-orange-500/50 hover:bg-orange-500/10"
              }`}
            >
              <Zap className="h-3 w-3 mr-1" />
              Upgrade
            </Button>
          )}
          {dismissable && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setDismissed(true)}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
}

/**
 * Compact inline warning for chat interface
 */
export function UsageWarningInline({
  className,
}: Readonly<{ className?: string }>) {
  const [warnings, setWarnings] = useState<UsageWarningsResponse | null>(null);

  useEffect(() => {
    const fetchWarnings = async () => {
      try {
        const response = await fetch("/api/billing/usage?warnings=true");
        if (response.ok) {
          const data = await response.json();
          setWarnings(data);
        }
      } catch {
        // Silently fail
      }
    };

    fetchWarnings();
  }, []);

  if (!warnings?.hasWarnings) {
    return null;
  }

  const isCritical = warnings.hasCritical;
  const topWarning = warnings.warnings[0];

  return (
    <button
      type="button"
      onClick={openBillingPopup}
      className={cn(
        "inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md transition-colors",
        isCritical
          ? "bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20"
          : "bg-orange-500/10 text-orange-600 dark:text-orange-400 hover:bg-orange-500/20",
        className,
      )}
    >
      <AlertTriangle className="h-3 w-3" />
      <span>
        {topWarning.label}: {topWarning.percentUsed.toFixed(0)}%
      </span>
    </button>
  );
}
