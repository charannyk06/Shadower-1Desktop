"use client";

import { format } from "date-fns";
import { cn } from "lib/utils";
import { DollarSign, Percent, Plus, Tag } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "ui/badge";
import { Button } from "ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "ui/dialog";
import { Input } from "ui/input";
import { Label } from "ui/label";
import { Progress } from "ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "ui/select";
import { Switch } from "ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "ui/table";

interface PromoCode {
  readonly id: string;
  readonly code: string;
  readonly description: string | null;
  readonly discountType: "percentage" | "fixed_amount";
  readonly discountValue: number;
  readonly discountDisplay: string;
  readonly appliesTo: string;
  readonly applicableTiers: readonly string[];
  readonly applicableTokenPacks: readonly string[];
  readonly maxRedemptions: number | null;
  readonly currentRedemptions: number;
  readonly maxPerUser: number;
  readonly newUsersOnly: boolean;
  readonly minAmount: number | null;
  readonly startsAt: string | undefined;
  readonly expiresAt: string | undefined;
  readonly isActive: boolean;
  readonly stripeCouponId: string | null;
  readonly createdAt: string | undefined;
  readonly usagePercent: number | null;
}

interface PromoCodesManagerProps {
  readonly promoCodes: readonly PromoCode[];
}

export function PromoCodesManager({ promoCodes }: PromoCodesManagerProps) {
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    code: "",
    description: "",
    discountType: "percentage" as "percentage" | "fixed_amount",
    discountValue: "",
    appliesTo: "all" as "all" | "subscription" | "token_pack",
    maxRedemptions: "",
    maxPerUser: "1",
    newUsersOnly: false,
    minAmount: "",
    expiresAt: "",
  });

  const handleCreate = async () => {
    if (!formData.code || !formData.discountValue) {
      toast.error("Code and discount value are required");
      return;
    }

    setIsSubmitting(true);
    try {
      // Get CSRF token
      const csrfRes = await fetch("/api/csrf");
      const { csrfToken } = await csrfRes.json();

      const response = await fetch("/api/admin/billing/promo-codes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify({
          code: formData.code,
          description: formData.description || undefined,
          discountType: formData.discountType,
          discountValue: Number.parseFloat(formData.discountValue),
          appliesTo: formData.appliesTo,
          maxRedemptions: formData.maxRedemptions
            ? Number.parseInt(formData.maxRedemptions, 10)
            : undefined,
          maxPerUser: Number.parseInt(formData.maxPerUser, 10),
          newUsersOnly: formData.newUsersOnly,
          minAmount: formData.minAmount
            ? Number.parseInt(formData.minAmount, 10)
            : undefined,
          expiresAt: formData.expiresAt || undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to create promo code");
      }

      toast.success("Promo code created successfully");
      setIsCreating(false);
      setFormData({
        code: "",
        description: "",
        discountType: "percentage",
        discountValue: "",
        appliesTo: "all",
        maxRedemptions: "",
        maxPerUser: "1",
        newUsersOnly: false,
        minAmount: "",
        expiresAt: "",
      });
      router.refresh();
    } catch (error: unknown) {
      toast.error((error as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleActive = async (id: string, isActive: boolean) => {
    try {
      const csrfRes = await fetch("/api/csrf");
      const { csrfToken } = await csrfRes.json();

      const response = await fetch("/api/admin/billing/promo-codes", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify({ id, isActive: !isActive }),
      });

      if (!response.ok) {
        throw new Error("Failed to update promo code");
      }

      toast.success(`Promo code ${isActive ? "deactivated" : "activated"}`);
      router.refresh();
    } catch (error: unknown) {
      toast.error((error as Error).message);
    }
  };

  const activeCount = promoCodes.filter((p) => p.isActive).length;

  return (
    <div className="space-y-4 w-full">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {promoCodes.length} total &middot; {activeCount} active
        </div>
        <Dialog open={isCreating} onOpenChange={setIsCreating}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Create Promo Code
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Create Promo Code</DialogTitle>
              <DialogDescription>
                Create a new promotional code for discounts.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="code">Code</Label>
                <Input
                  id="code"
                  placeholder="SUMMER2024"
                  value={formData.code}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      code: e.target.value.toUpperCase(),
                    })
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="description">Description (optional)</Label>
                <Input
                  id="description"
                  placeholder="Summer promotion"
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Discount Type</Label>
                  <Select
                    value={formData.discountType}
                    onValueChange={(v: "percentage" | "fixed_amount") =>
                      setFormData({ ...formData, discountType: v })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="percentage">Percentage (%)</SelectItem>
                      <SelectItem value="fixed_amount">
                        Fixed Amount ($)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="discountValue">
                    {formData.discountType === "percentage"
                      ? "Percentage"
                      : "Amount (cents)"}
                  </Label>
                  <Input
                    id="discountValue"
                    type="number"
                    placeholder={
                      formData.discountType === "percentage" ? "20" : "500"
                    }
                    value={formData.discountValue}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        discountValue: e.target.value,
                      })
                    }
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Applies To</Label>
                <Select
                  value={formData.appliesTo}
                  onValueChange={(v: "all" | "subscription" | "token_pack") =>
                    setFormData({ ...formData, appliesTo: v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Purchases</SelectItem>
                    <SelectItem value="subscription">
                      Subscriptions Only
                    </SelectItem>
                    <SelectItem value="token_pack">Token Packs Only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="maxRedemptions">Max Uses (optional)</Label>
                  <Input
                    id="maxRedemptions"
                    type="number"
                    placeholder="100"
                    value={formData.maxRedemptions}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        maxRedemptions: e.target.value,
                      })
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="maxPerUser">Per User Limit</Label>
                  <Input
                    id="maxPerUser"
                    type="number"
                    placeholder="1"
                    value={formData.maxPerUser}
                    onChange={(e) =>
                      setFormData({ ...formData, maxPerUser: e.target.value })
                    }
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="expiresAt">Expires (optional)</Label>
                <Input
                  id="expiresAt"
                  type="date"
                  value={formData.expiresAt}
                  onChange={(e) =>
                    setFormData({ ...formData, expiresAt: e.target.value })
                  }
                />
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="newUsersOnly"
                  checked={formData.newUsersOnly}
                  onCheckedChange={(v) =>
                    setFormData({ ...formData, newUsersOnly: v })
                  }
                />
                <Label htmlFor="newUsersOnly">New users only</Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreating(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={isSubmitting}>
                {isSubmitting ? "Creating..." : "Create Code"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-lg border bg-card w-full overflow-x-auto">
        <Table className="w-full">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="font-semibold">Code</TableHead>
              <TableHead className="font-semibold">Discount</TableHead>
              <TableHead className="font-semibold">Applies To</TableHead>
              <TableHead className="font-semibold">Usage</TableHead>
              <TableHead className="font-semibold">Expires</TableHead>
              <TableHead className="font-semibold">Status</TableHead>
              <TableHead className="font-semibold w-[80px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {promoCodes.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-center py-8 text-muted-foreground"
                >
                  No promo codes found
                </TableCell>
              </TableRow>
            ) : (
              promoCodes.map((code) => (
                <TableRow key={code.id} className="hover:bg-muted/50">
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Tag className="h-4 w-4 text-muted-foreground" />
                      <span className="font-mono font-medium">{code.code}</span>
                    </div>
                    {code.description && (
                      <div className="text-sm text-muted-foreground mt-1">
                        {code.description}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {code.discountType === "percentage" ? (
                        <Percent className="h-3 w-3 text-muted-foreground" />
                      ) : (
                        <DollarSign className="h-3 w-3 text-muted-foreground" />
                      )}
                      <span className="font-medium">
                        {code.discountDisplay}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">
                      {code.appliesTo.replace("_", " ")}
                    </Badge>
                    {code.newUsersOnly && (
                      <Badge variant="secondary" className="ml-1 text-xs">
                        New users
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <div className="text-sm">
                        {code.currentRedemptions}
                        {code.maxRedemptions ? ` / ${code.maxRedemptions}` : ""}
                      </div>
                      {code.usagePercent !== null && (
                        <Progress
                          value={code.usagePercent}
                          className="h-1 w-20"
                        />
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {code.expiresAt
                      ? format(new Date(code.expiresAt), "MMM d, yyyy")
                      : "Never"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={code.isActive ? "default" : "secondary"}
                      className={cn(
                        code.isActive
                          ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                          : "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
                      )}
                    >
                      {code.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={code.isActive}
                      onCheckedChange={() =>
                        handleToggleActive(code.id, code.isActive)
                      }
                      aria-label={code.isActive ? "Deactivate" : "Activate"}
                    />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
