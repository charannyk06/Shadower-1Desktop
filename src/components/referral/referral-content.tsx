"use client";

import { fetcher } from "lib/utils";
import { Check, Coins, Copy, Gift, Share2, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { Badge } from "ui/badge";
import { Button } from "ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "ui/card";
import { Input } from "ui/input";
import { Skeleton } from "ui/skeleton";

interface ReferralStats {
  code: string;
  stats: {
    totalReferrals: number;
    completedReferrals: number;
    pendingReferrals: number;
    totalBonusEarned: number;
  };
  referrals: Array<{
    id: string;
    refereeId: string;
    referralCode: string;
    status: "pending" | "completed" | "expired";
    referrerBonus: string | null;
    refereeBonus: string | null;
    createdAt: string;
    completedAt: string | null;
    referee?: {
      id: string;
      name: string;
      email: string;
    };
  }>;
  config: {
    referrerBonus: number;
    refereeBonus: number;
  };
}

function formatCredits(credits: number): string {
  if (credits >= 1_000_000) {
    return `${(credits / 1_000_000).toFixed(1)}M`;
  }
  if (credits >= 1_000) {
    return `${(credits / 1_000).toFixed(0)}K`;
  }
  return credits.toString();
}

function StatCard({
  icon: Icon,
  label,
  value,
  subtext,
}: Readonly<{
  icon: React.ElementType;
  label: string;
  value: string | number;
  subtext?: string;
}>) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Icon className="size-5 text-primary" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold">{value}</p>
            {subtext && (
              <p className="text-xs text-muted-foreground">{subtext}</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function getStatusBadgeVariant(
  status: "pending" | "completed" | "expired",
): "default" | "secondary" | "destructive" {
  if (status === "completed") return "default";
  if (status === "pending") return "secondary";
  return "destructive";
}

export function ReferralContent() {
  const [copied, setCopied] = useState(false);
  const { data, error, isLoading } = useSWR<ReferralStats>(
    "/api/referral",
    fetcher,
  );

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Copied to clipboard!");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy");
    }
  };

  const shareReferral = async () => {
    if (!data?.code) return;
    const shareUrl = `${globalThis.location.origin}/sign-up?ref=${data.code}`;
    const shareData = {
      title: "Join me on Shadower!",
      text: `Use my referral code ${data.code} to get ${formatCredits(data.config.refereeBonus)} free credits!`,
      url: shareUrl,
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch {
        copyToClipboard(shareUrl);
      }
    } else {
      copyToClipboard(shareUrl);
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto max-w-5xl py-6 sm:py-8 px-4 space-y-4 sm:space-y-6">
        <Skeleton className="h-7 sm:h-8 w-40 sm:w-48" />
        <Skeleton className="h-28 sm:h-32 w-full" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="container mx-auto max-w-5xl py-6 sm:py-8 px-4">
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              {error?.message || "Failed to load referral data"}
            </p>
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => globalThis.location.reload()}
            >
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const referralUrl = `${globalThis.location?.origin ?? ""}/sign-up?ref=${data.code}`;

  return (
    <div className="container mx-auto max-w-5xl py-6 sm:py-8 px-4 space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold">Referral Program</h1>
        <p className="text-muted-foreground">
          Invite friends and earn {formatCredits(data.config.referrerBonus)}{" "}
          credits for each successful referral
        </p>
      </div>

      {/* Referral Code Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gift className="size-5" />
            Your Referral Code
          </CardTitle>
          <CardDescription>
            Share this code with friends. They get{" "}
            {formatCredits(data.config.refereeBonus)} credits, you get{" "}
            {formatCredits(data.config.referrerBonus)} credits when they make
            their first purchase.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Input
                value={data.code}
                readOnly
                className="text-base sm:text-lg font-mono pr-10"
              />
              <Button
                size="icon"
                variant="ghost"
                className="absolute right-1 top-1/2 -translate-y-1/2 size-8"
                onClick={() => copyToClipboard(data.code)}
              >
                {copied ? (
                  <Check className="size-4" />
                ) : (
                  <Copy className="size-4" />
                )}
              </Button>
            </div>
            <Button onClick={shareReferral} className="gap-2 w-full sm:w-auto">
              <Share2 className="size-4" />
              Share
            </Button>
          </div>

          <div className="p-3 bg-muted rounded-lg">
            <p className="text-sm text-muted-foreground mb-1">
              Or share this link:
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-sm break-all">{referralUrl}</code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => copyToClipboard(referralUrl)}
              >
                <Copy className="size-3" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          icon={Users}
          label="Total Referrals"
          value={data.stats.totalReferrals}
          subtext={`${data.stats.pendingReferrals} pending`}
        />
        <StatCard
          icon={Check}
          label="Completed"
          value={data.stats.completedReferrals}
        />
        <StatCard
          icon={Coins}
          label="Credits Earned"
          value={formatCredits(data.stats.totalBonusEarned)}
        />
      </div>

      {/* Referral History */}
      {data.referrals.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Referral History</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.referrals.map((referral) => (
                <div
                  key={referral.id}
                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 p-3 rounded-lg border"
                >
                  <div className="flex items-center gap-3">
                    <div className="size-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                      <Users className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {referral.referee?.name || "User"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(referral.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pl-11 sm:pl-0">
                    <Badge variant={getStatusBadgeVariant(referral.status)}>
                      {referral.status}
                    </Badge>
                    {referral.status === "completed" &&
                      referral.referrerBonus && (
                        <span className="text-sm text-green-600 font-medium">
                          +
                          {formatCredits(
                            Number.parseInt(referral.referrerBonus, 10),
                          )}
                        </span>
                      )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* How it Works */}
      <Card>
        <CardHeader>
          <CardTitle>How it Works</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-4">
            <li className="flex gap-3">
              <span className="flex-shrink-0 size-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-medium">
                1
              </span>
              <div>
                <p className="font-medium">Share your code</p>
                <p className="text-sm text-muted-foreground">
                  Send your referral code or link to friends
                </p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 size-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-medium">
                2
              </span>
              <div>
                <p className="font-medium">They sign up</p>
                <p className="text-sm text-muted-foreground">
                  Your friend creates an account using your code
                </p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 size-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-medium">
                3
              </span>
              <div>
                <p className="font-medium">They make a purchase</p>
                <p className="text-sm text-muted-foreground">
                  Once they subscribe or buy tokens, you both get rewarded
                </p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 size-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-medium">
                4
              </span>
              <div>
                <p className="font-medium">Everyone wins!</p>
                <p className="text-sm text-muted-foreground">
                  You get {formatCredits(data.config.referrerBonus)} credits,
                  they get {formatCredits(data.config.refereeBonus)} credits
                </p>
              </div>
            </li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
