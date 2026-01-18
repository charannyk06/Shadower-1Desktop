"use client";

import { useDebounce } from "@/hooks/use-debounce";
import { format } from "date-fns";
import { cn } from "lib/utils";
import { Filter, Search, X } from "lucide-react";
import Form from "next/form";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef } from "react";
import { Badge } from "ui/badge";
import { buttonVariants } from "ui/button";
import { Input } from "ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "ui/table";
import { TablePagination } from "ui/table-pagination";

interface SubscriptionWithUser {
  readonly userId: string;
  readonly tier: string;
  readonly status: string;
  readonly stripeCustomerId: string | null;
  readonly stripeSubscriptionId: string | null;
  readonly purchasedTokens: string | null;
  readonly cancelAtPeriodEnd: boolean | null;
  readonly currentPeriodEnd: Date | null;
  readonly createdAt: Date | null;
  readonly userEmail: string;
  readonly userName: string;
}

interface SubscriptionsTableProps {
  readonly subscriptions: readonly SubscriptionWithUser[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
  readonly totalPages: number;
  readonly currentTier?: string;
  readonly currentStatus?: string;
  readonly query?: string;
}

const tierColors: Record<string, string> = {
  free: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  pro: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  ultra: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
};

const statusColors: Record<string, string> = {
  active: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  canceled: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  past_due:
    "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  trialing: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200",
  incomplete: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
};

function formatTokens(tokens: string | null): string {
  if (!tokens) return "0";
  const num = Number.parseInt(tokens, 10);
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(0)}K`;
  return num.toString();
}

export function SubscriptionsTable({
  subscriptions,
  total,
  page,
  totalPages,
  currentTier,
  currentStatus,
  query,
}: SubscriptionsTableProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const baseUrl = "/admin/billing/subscriptions";

  const submitForm = useCallback(() => {
    formRef.current?.requestSubmit();
  }, []);

  const debouncedSetUrlQuery = useDebounce(submitForm, 300);

  const buildUrl = useCallback(
    (
      params: {
        page?: number;
        tier?: string;
        status?: string;
        query?: string;
      } = {},
    ) => {
      const sp = new URLSearchParams();

      const finalPage = params.page ?? page;
      const finalTier = params.tier ?? currentTier;
      const finalStatus = params.status ?? currentStatus;
      const finalQuery = params.query ?? query;

      if (finalPage && finalPage !== 1) sp.set("page", finalPage.toString());
      if (finalTier && finalTier !== "all") sp.set("tier", finalTier);
      if (finalStatus && finalStatus !== "all") sp.set("status", finalStatus);
      if (finalQuery) sp.set("query", finalQuery);

      const qs = sp.toString();
      return qs ? `${baseUrl}?${qs}` : baseUrl;
    },
    [page, currentTier, currentStatus, query],
  );

  const handleTierChange = (value: string) => {
    router.push(buildUrl({ tier: value, page: 1 }));
  };

  const handleStatusChange = (value: string) => {
    router.push(buildUrl({ status: value, page: 1 }));
  };

  const hasFilters = currentTier || currentStatus || query;

  return (
    <div className="space-y-4 w-full">
      <div className="flex flex-wrap items-center gap-4">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Form action={baseUrl} ref={formRef}>
            {page !== 1 && <input type="hidden" name="page" value={1} />}
            {currentTier && currentTier !== "all" && (
              <input type="hidden" name="tier" value={currentTier} />
            )}
            {currentStatus && currentStatus !== "all" && (
              <input type="hidden" name="status" value={currentStatus} />
            )}
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by email or name..."
              className="pl-9"
              name="query"
              defaultValue={query}
              onChange={() => debouncedSetUrlQuery()}
            />
          </Form>
        </div>

        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select value={currentTier || "all"} onValueChange={handleTierChange}>
            <SelectTrigger className="w-[120px]">
              <SelectValue placeholder="Tier" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Tiers</SelectItem>
              <SelectItem value="free">Free</SelectItem>
              <SelectItem value="pro">Pro</SelectItem>
              <SelectItem value="ultra">Ultra</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={currentStatus || "all"}
            onValueChange={handleStatusChange}
          >
            <SelectTrigger className="w-[120px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="canceled">Canceled</SelectItem>
              <SelectItem value="past_due">Past Due</SelectItem>
              <SelectItem value="trialing">Trialing</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {hasFilters && (
          <Link
            href={baseUrl}
            className={cn("shrink-0", buttonVariants({ variant: "outline" }))}
          >
            <X className="h-4 w-4 mr-1" />
            Clear
          </Link>
        )}

        <div className="text-sm text-muted-foreground ml-auto">
          {total} subscription{total !== 1 ? "s" : ""}
        </div>
      </div>

      <div className="rounded-lg border bg-card w-full overflow-x-auto">
        <Table className="w-full">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="font-semibold">User</TableHead>
              <TableHead className="font-semibold">Tier</TableHead>
              <TableHead className="font-semibold">Status</TableHead>
              <TableHead className="font-semibold">Purchased Tokens</TableHead>
              <TableHead className="font-semibold">Period Ends</TableHead>
              <TableHead className="font-semibold">Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {subscriptions.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-center py-8 text-muted-foreground"
                >
                  No subscriptions found
                </TableCell>
              </TableRow>
            ) : (
              subscriptions.map((sub) => (
                <TableRow
                  key={sub.userId}
                  className="hover:bg-muted/50 transition-colors"
                >
                  <TableCell>
                    <div>
                      <div className="font-medium">{sub.userName}</div>
                      <div className="text-sm text-muted-foreground">
                        {sub.userEmail}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className={cn("capitalize", tierColors[sub.tier] || "")}
                    >
                      {sub.tier}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="secondary"
                        className={cn(
                          "capitalize",
                          statusColors[sub.status] || "",
                        )}
                      >
                        {sub.status.replace("_", " ")}
                      </Badge>
                      {sub.cancelAtPeriodEnd && (
                        <Badge variant="outline" className="text-orange-600">
                          Canceling
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono">
                    {formatTokens(sub.purchasedTokens)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {sub.currentPeriodEnd
                      ? format(new Date(sub.currentPeriodEnd), "MMM d, yyyy")
                      : "-"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {sub.createdAt
                      ? format(new Date(sub.createdAt), "MMM d, yyyy")
                      : "-"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <TablePagination
          currentPage={page}
          totalPages={totalPages}
          buildUrl={buildUrl}
        />
      )}
    </div>
  );
}
