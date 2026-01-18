import { BillingNavTabs } from "@/components/admin/billing-nav-tabs";
import type { ReactNode } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "ui/card";

interface BillingLayoutProps {
  readonly children: ReactNode;
}

export default async function BillingLayout({ children }: BillingLayoutProps) {
  return (
    <div className="relative bg-background w-full flex flex-col min-h-screen">
      <div className="flex-1 overflow-y-auto p-6 w-full">
        <div className="space-y-4 w-full max-w-none">
          <Card className="w-full border-none bg-transparent">
            <CardHeader>
              <CardTitle className="text-2xl">Billing Management</CardTitle>
              <CardDescription>
                View and manage subscriptions, promo codes, and revenue
              </CardDescription>
            </CardHeader>
            <CardContent className="p-2 md:p-6 w-full">
              <BillingNavTabs />
              {children}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
