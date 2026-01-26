"use client";

import { appStore } from "@/app/store";
import { X } from "lucide-react";
import { Button } from "ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerPortal,
  DrawerTitle,
} from "ui/drawer";
import { useShallow } from "zustand/shallow";

export function UserSettingsPopup({
  userSettingsComponent,
}: {
  userSettingsComponent: React.ReactNode;
}) {
  const [openUserSettings, appStoreMutate] = appStore(
    useShallow((state) => [state.openUserSettings, state.mutate]),
  );

  const handleClose = () => {
    appStoreMutate({ openUserSettings: false });
  };

  return (
    <Drawer
      handleOnly
      open={openUserSettings}
      direction="top"
      onOpenChange={(open) => appStoreMutate({ openUserSettings: open })}
    >
      <DrawerPortal>
        <DrawerContent
          aria-label="User Settings"
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
              data-testid="close-user-settings-button"
            >
              <X />
            </Button>
          </div>
          <DrawerTitle className="sr-only">User Settings</DrawerTitle>
          <DrawerDescription className="sr-only" />
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto">
              {userSettingsComponent}
            </div>
          </div>
        </DrawerContent>
      </DrawerPortal>
    </Drawer>
  );
}
