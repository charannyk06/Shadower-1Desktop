"use client";

import { Loader2, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";
import { WriteIcon } from "ui/write-icon";

interface ShareableActionsProps {
  type: "agent" | "workflow" | "mcp";
  isOwner: boolean;
  editHref?: string;
  onDelete?: () => void;
  isDeleteLoading?: boolean;
  renderActions?: () => React.ReactNode;
  disabled?: boolean;
}

export function ShareableActions({
  isOwner,
  editHref,
  onDelete,
  renderActions,
  isDeleteLoading = false,
  disabled = false,
}: ShareableActionsProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="flex items-center gap-1">
      {/* Edit Action */}
      {isOwner && editHref && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground hover:text-foreground"
              disabled={isDeleteLoading || disabled}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                navigate({ to: editHref });
              }}
            >
              <WriteIcon className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("Common.edit")}</TooltipContent>
        </Tooltip>
      )}

      {/* Custom Actions */}
      {isOwner && renderActions && renderActions()}

      {/* Delete Action */}
      {isOwner && onDelete && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground hover:text-destructive"
              disabled={isDeleteLoading || disabled}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDelete();
              }}
            >
              {isDeleteLoading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("Common.delete")}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
