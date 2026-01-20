"use client";

import { appStore } from "@/app/store";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerPortal,
  DrawerTitle,
} from "ui/drawer";
import { useShallow } from "zustand/shallow";

export function KnowledgePopup({
  knowledgeComponent,
}: {
  knowledgeComponent: React.ReactNode;
}) {
  const { t } = useTranslation();
  const [openKnowledge, appStoreMutate] = appStore(
    useShallow((state) => [state.openKnowledge, state.mutate]),
  );

  const handleClose = () => {
    appStoreMutate({ openKnowledge: false });
  };

  return (
    <Drawer
      handleOnly
      open={openKnowledge}
      direction="top"
      onOpenChange={(open) => appStoreMutate({ openKnowledge: open })}
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
              data-testid="close-knowledge-button"
            >
              <X />
            </Button>
          </div>
          <DrawerTitle className="sr-only">
            {t("Layout.allKnowledge")}
          </DrawerTitle>
          <DrawerDescription className="sr-only" />
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto">{knowledgeComponent}</div>
          </div>
        </DrawerContent>
      </DrawerPortal>
    </Drawer>
  );
}
