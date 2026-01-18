"use client";

import { cn } from "@/lib/utils";
import { Check, DollarSign, Loader2, Percent, Tag, X } from "lucide-react";
import { useCallback, useState } from "react";
import { Button } from "ui/button";
import { Input } from "ui/input";

interface PromoCodeInputProps {
  purchaseType: "subscription" | "token_pack";
  tier?: "free" | "pro" | "ultra";
  amount: number; // in cents
  tokenPackAmount?: string; // e.g., "2000000" for specific pack validation
  onPromoApplied?: (promoData: PromoAppliedData | null) => void;
  className?: string;
}

export interface PromoAppliedData {
  code: string;
  promoCodeId: string;
  discountType: "percentage" | "fixed_amount";
  discountValue: number;
  discountAmount: number;
  finalAmount: number;
  applicableTokenPacks: string[]; // e.g., ["2000000"] - empty means all packs
}

type ValidationState = "idle" | "loading" | "valid" | "invalid";

export function PromoCodeInput({
  purchaseType,
  tier,
  amount,
  tokenPackAmount,
  onPromoApplied,
  className,
}: Readonly<PromoCodeInputProps>) {
  const [code, setCode] = useState("");
  const [state, setState] = useState<ValidationState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [appliedPromo, setAppliedPromo] = useState<PromoAppliedData | null>(
    null,
  );

  const validateCode = useCallback(async () => {
    if (!code.trim()) {
      setError("Please enter a promo code");
      return;
    }

    setState("loading");
    setError(null);

    try {
      const response = await fetch("/api/billing/promo/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: code.trim().toUpperCase(),
          purchaseType,
          tier,
          amount,
          tokenPackAmount,
        }),
      });

      const data = await response.json();

      if (data.valid && data.discount) {
        const promoData: PromoAppliedData = {
          code: code.trim().toUpperCase(),
          promoCodeId: data.promoCodeId,
          discountType: data.discount.type,
          discountValue: data.discount.value,
          discountAmount: data.discount.discountAmount,
          finalAmount: data.discount.finalAmount,
          applicableTokenPacks: Array.isArray(data.applicableTokenPacks)
            ? data.applicableTokenPacks
            : [],
        };
        setAppliedPromo(promoData);
        setState("valid");
        onPromoApplied?.(promoData);
      } else {
        setState("invalid");
        setError(data.error || "Invalid promo code");
        setAppliedPromo(null);
        onPromoApplied?.(null);
      }
    } catch {
      setState("invalid");
      setError("Failed to validate promo code");
      setAppliedPromo(null);
      onPromoApplied?.(null);
    }
  }, [code, purchaseType, tier, amount, tokenPackAmount, onPromoApplied]);

  const clearPromo = useCallback(() => {
    setCode("");
    setState("idle");
    setError(null);
    setAppliedPromo(null);
    onPromoApplied?.(null);
  }, [onPromoApplied]);

  const formatDiscount = (promo: PromoAppliedData) => {
    if (promo.discountType === "percentage") {
      return `${promo.discountValue}% off`;
    }
    return `$${(promo.discountValue / 100).toFixed(2)} off`;
  };

  const formatSavings = (promo: PromoAppliedData) => {
    return `Save $${(promo.discountAmount / 100).toFixed(2)}`;
  };

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Tag className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Enter Promo Code"
            value={code}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase());
              if (state !== "idle") {
                setState("idle");
                setError(null);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !appliedPromo) {
                e.preventDefault();
                validateCode();
              }
            }}
            disabled={state === "loading" || !!appliedPromo}
            className={cn(
              "pl-9 pr-10",
              state === "valid" && "border-green-500 bg-green-50/50",
              state === "invalid" && "border-red-500 bg-red-50/50",
            )}
          />
          {state === "valid" && (
            <Check className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-green-600" />
          )}
          {state === "invalid" && (
            <X className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-red-500" />
          )}
        </div>

        {appliedPromo ? (
          <Button
            type="button"
            variant="outline"
            onClick={clearPromo}
            className="shrink-0"
          >
            Remove
          </Button>
        ) : (
          <Button
            type="button"
            onClick={validateCode}
            disabled={state === "loading" || !code.trim()}
            className="shrink-0"
          >
            {state === "loading" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              "Apply"
            )}
          </Button>
        )}
      </div>

      {/* Error message */}
      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* Success message with discount preview */}
      {appliedPromo && (
        <div className="flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 p-3 text-sm">
          {appliedPromo.discountType === "percentage" ? (
            <Percent className="size-4 text-green-600 shrink-0" />
          ) : (
            <DollarSign className="size-4 text-green-600 shrink-0" />
          )}
          <div className="flex-1">
            <span className="font-medium text-green-700">
              {formatDiscount(appliedPromo)}
            </span>
            <span className="text-green-600 ml-2">
              — {formatSavings(appliedPromo)}
            </span>
          </div>
          <span className="font-semibold text-green-700">
            ${(appliedPromo.finalAmount / 100).toFixed(2)}
          </span>
        </div>
      )}
    </div>
  );
}
