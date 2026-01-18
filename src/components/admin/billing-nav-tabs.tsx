"use client";

import { cn } from "lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";

const billingTabs = [
  { href: "/admin/billing", label: "Overview", exact: true },
  {
    href: "/admin/billing/subscriptions",
    label: "Subscriptions",
    exact: false,
  },
  { href: "/admin/billing/promo-codes", label: "Promo Codes", exact: false },
];

export function BillingNavTabs() {
  const pathname = usePathname();

  const isActive = (tab: { href: string; exact: boolean }) => {
    if (tab.exact) {
      return pathname === tab.href;
    }
    return pathname.startsWith(tab.href);
  };

  return (
    <nav className="flex gap-2 mb-6 border-b pb-4">
      {billingTabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={cn(
            "px-4 py-2 rounded-md text-sm font-medium transition-colors",
            "hover:bg-muted",
            isActive(tab)
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "text-muted-foreground",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
