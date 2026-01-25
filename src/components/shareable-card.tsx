"use client";

import { getSystemAgentCustomIcon } from "@/hooks/use-system-agent-icon";
import { AgentSummary } from "app-types/agent";
import { MCPServerInfo } from "app-types/mcp";
import { format } from "date-fns";
import { cn } from "lib/utils";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "ui/avatar";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "ui/card";
import { MCPIcon } from "ui/mcp-icon";
import { ShareableActions } from "./shareable-actions";

export interface ShareableIcon {
  value?: string;
  style?: {
    backgroundColor?: string;
  };
}
interface ShareableCardProps {
  type: "agent" | "mcp";
  item: AgentSummary | MCPServerInfo;
  isOwner?: boolean;
  href: string;
  onDelete?: (itemId: string) => void;
  isDeleteLoading?: boolean;
  actionsDisabled?: boolean;
  hideActions?: boolean;
}

export function ShareableCard({
  type,
  item,
  isOwner = true,
  href,
  onDelete,
  isDeleteLoading,
  actionsDisabled,
  hideActions = false,
}: ShareableCardProps) {
  const { t: _t } = useTranslation();

  // Get effective icon - use custom icon for system agents if available
  const effectiveIcon = useMemo(() => {
    if (type === "agent") {
      const agent = item as AgentSummary;
      // Check if this is a system agent (ID starts with "system-")
      if (agent.id?.startsWith("system-")) {
        const customIcon = getSystemAgentCustomIcon(agent.id);
        if (customIcon) {
          return customIcon;
        }
      }
    }
    return item.icon;
  }, [type, item.id, item.icon]);

  return (
    <Link to={href} title={item.name}>
      <Card
        className={cn(
          "w-full min-h-[196px] @container transition-colors group flex flex-col gap-3 cursor-pointer hover:bg-input",
        )}
        data-testid={`${type}-card`}
        data-item-name={item.name}
        data-item-id={item.id}
      >
        <CardHeader className="shrink gap-y-0">
          <CardTitle className="flex gap-3 items-stretch min-w-0">
            <div
              style={{ backgroundColor: effectiveIcon?.style?.backgroundColor }}
              className="p-2 rounded-lg flex items-center justify-center ring ring-background border shrink-0"
            >
              {type === "mcp" ? (
                <MCPIcon className="fill-white size-6" />
              ) : (
                <Avatar className="size-6">
                  <AvatarImage src={effectiveIcon?.value} />
                  <AvatarFallback />
                </Avatar>
              )}
            </div>

            <div className="flex flex-col justify-around min-w-0 flex-1 overflow-hidden">
              <span
                className="truncate font-medium"
                data-testid={`${type}-card-name`}
              >
                {item.name}
              </span>
              <time className="text-xs text-muted-foreground shrink-0">
                {format(item.updatedAt || new Date(), "MMM d, yyyy")}
              </time>
            </div>
          </CardTitle>
        </CardHeader>

        <CardContent className="min-h-0 grow">
          <CardDescription className="text-xs line-clamp-3 break-words overflow-hidden">
            {item.description}
          </CardDescription>
        </CardContent>

        <CardFooter className="shrink min-h-0 overflow-visible">
          <div className="flex items-center justify-between w-full min-w-0">
            {!hideActions && (
              <div onClick={(e) => e.stopPropagation()}>
                <ShareableActions
                  type={type}
                  isOwner={isOwner}
                  editHref={href}
                  onDelete={onDelete ? () => onDelete(item.id) : undefined}
                  isDeleteLoading={isDeleteLoading}
                  disabled={actionsDisabled}
                />
              </div>
            )}
          </div>
        </CardFooter>
      </Card>
    </Link>
  );
}
