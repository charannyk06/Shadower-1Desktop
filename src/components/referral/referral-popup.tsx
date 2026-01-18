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

export function ReferralPopup({
  referralComponent,
}: {
  referralComponent: React.ReactNode;
}) {
  const t = useTranslations("Layout");
  const [openReferral, appStoreMutate] = appStore(
    useShallow((state) => [state.openReferral, state.mutate]),
  );

  const handleClose = () => {
    appStoreMutate({ openReferral: false });
  };

  return (
    <Drawer
      handleOnly
      open={openReferral}
      direction="top"
      onOpenChange={(open) => appStoreMutate({ openReferral: open })}
    >
      <DrawerPortal>
        <DrawerContent
          style={{
            userSelect: "text",
          }}
          className="max-h-[100vh]! w-full h-full rounded-none flex flex-col overflow-hidden p-4 md:p-6"
        >
          <div className="flex items-center justify-end">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleClose}
              data-testid="close-referral-button"
            >
              <X />
            </Button>
          </div>
          <DrawerTitle className="sr-only">{t("referral")}</DrawerTitle>
          <DrawerDescription className="sr-only" />
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto">{referralComponent}</div>
          </div>
        </DrawerContent>
      </DrawerPortal>
    </Drawer>
  );
}
