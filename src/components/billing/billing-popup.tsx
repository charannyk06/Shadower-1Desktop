"use client";

import { appStore } from "@/app/store";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerPortal,
  DrawerTitle,
} from "ui/drawer";
import { useShallow } from "zustand/shallow";

export function BillingPopup({
  billingComponent,
}: {
  billingComponent: React.ReactNode;
}) {
  const t = useTranslations("Layout");
  const [openBilling, appStoreMutate] = appStore(
    useShallow((state) => [state.openBilling, state.mutate]),
  );

  const handleClose = () => {
    appStoreMutate({ openBilling: false });
  };

  return (
    <Drawer
      handleOnly
      open={openBilling}
      direction="top"
      onOpenChange={(open) => appStoreMutate({ openBilling: open })}
    >
      <DrawerPortal>
        <DrawerContent
          style={{ userSelect: "text" }}
          className="max-h-[100vh]! w-full h-full rounded-none flex flex-col overflow-hidden p-4 md:p-6"
        >
          <div className="flex items-center justify-end">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleClose}
              data-testid="close-billing-button"
            >
              <X />
            </Button>
          </div>
          <DrawerTitle className="sr-only">{t("billing")}</DrawerTitle>
          <DrawerDescription className="sr-only" />
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto">{billingComponent}</div>
          </div>
        </DrawerContent>
      </DrawerPortal>
    </Drawer>
  );
}
