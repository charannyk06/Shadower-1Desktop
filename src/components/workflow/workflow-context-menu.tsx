"use client";
import { workflowApi } from "@/lib/electron/workflow-api";
import { DBWorkflow } from "app-types/workflow";
import { useState } from "react";
import { safe } from "ts-safe";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "ui/dropdown-menu";
import { EditWorkflowPopup } from "./edit-workflow-popup";

import { PencilIcon, Trash2Icon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { mutate } from "swr";

interface WorkflowContextMenuProps {
  children: React.ReactNode;
  workflow: Pick<
    DBWorkflow,
    "id" | "name" | "description" | "icon" | "isPublished"
  >;
}

export function WorkflowContextMenu(props: WorkflowContextMenuProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();
  const handleDeleteWorkflow = async () => {
    toast.promise(
      safe(() => workflowApi.delete(props.workflow.id))
        .ifOk(() => {
          mutate("electron:workflows");
          setOpen(false);
        })
        .unwrap(),
      {
        success: t("Common.success"),
        loading: t("Common.deleting"),
      },
    );
  };

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>{props.children}</DropdownMenuTrigger>
        <DropdownMenuContent onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem
            className="cursor-pointer text-sm"
            onClick={() => setEditOpen(true)}
          >
            <PencilIcon className="size-3.5" />
            {t("Common.edit")}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="cursor-pointer text-sm"
            variant="destructive"
            onClick={(e) => {
              e.stopPropagation();
              handleDeleteWorkflow();
            }}
          >
            <Trash2Icon className="size-3.5" />
            {t("Common.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <EditWorkflowPopup
        defaultValue={props.workflow}
        submitAfterRoute={false}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
    </>
  );
}
