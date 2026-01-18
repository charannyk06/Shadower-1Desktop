"use client";

import { disconnectComposioAppAction } from "@/app/api/composio/actions";
import { appStore } from "@/app/store";
import { ComposioConnection, ComposioToolInfo } from "app-types/composio";
import {
  ChevronRight,
  FlaskConical,
  Loader,
  RotateCw,
  Settings2,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { memo, useCallback, useState } from "react";
import { mutate } from "swr";
import { safe } from "ts-safe";
import { Badge } from "ui/badge";
import { Button } from "ui/button";
import { Card, CardContent, CardHeader } from "ui/card";
import { Separator } from "ui/separator";
import { handleErrorWithToast } from "ui/shared-toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";
import { ComposioToolDetailPopup } from "./composio-tool-detail-popup";
import { ShareableActions } from "./shareable-actions";

interface ComposioCardProps {
  connection: ComposioConnection;
  tools: ComposioToolInfo[];
  logo?: string;
  displayName?: string;
  description?: string;
  actionsCount?: number;
}

export const ComposioCard = memo(function ComposioCard({
  connection,
  tools,
  logo,
  displayName,
  description,
  actionsCount,
}: ComposioCardProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [isLoadingTools, setIsLoadingTools] = useState(false);

  const pipeProcessing = useCallback(
    async (fn: () => Promise<any>) =>
      safe(() => setIsProcessing(true))
        .ifOk(fn)
        .ifOk(() => {
          mutate("/api/composio/connections");
          mutate("/api/composio/tools");
        })
        .ifFail(handleErrorWithToast)
        .watch(() => setIsProcessing(false)),
    [],
  );

  const handleDisconnect = useCallback(async () => {
    await pipeProcessing(() =>
      disconnectComposioAppAction(connection.id, connection.appName),
    );
  }, [connection.id, connection.appName]);

  const handleRefresh = useCallback(async () => {
    setIsLoadingTools(true);
    await mutate("/api/composio/tools");
    await mutate("/api/composio/connections");
    setIsLoadingTools(false);
  }, []);

  return (
    <Card className="relative hover:border-foreground/20 transition-colors bg-secondary/40">
      {isProcessing && (
        <div className="animate-pulse z-10 absolute inset-0 bg-background/50 flex items-center justify-center w-full h-full" />
      )}
      <CardHeader className="flex items-center gap-2 mb-2">
        {isProcessing && <Loader className="size-4 z-20 animate-spin mr-1" />}

        {logo && (
          <img src={logo} alt={connection.appName} className="size-6 rounded" />
        )}

        <h4 className="font-bold text-xs sm:text-lg flex items-center gap-2">
          {displayName || connection.appName}
          <Badge
            variant="secondary"
            className="bg-green-100 text-green-800 text-xs"
          >
            Connected
          </Badge>
        </h4>

        <div className="flex-1" />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              disabled={isProcessing}
              onClick={() =>
                appStore.setState({
                  composioCustomizationPopup: {
                    appName: connection.appName,
                    displayName: displayName || connection.appName,
                    tools,
                    logo,
                  },
                })
              }
            >
              <Settings2 className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Customize Tools</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              href={`/integrations/test/${encodeURIComponent(connection.appName)}`}
              className="cursor-pointer hidden sm:block"
            >
              <Button variant="ghost" size="icon" disabled={isProcessing}>
                <FlaskConical className="size-3.5" />
              </Button>
            </Link>
          </TooltipTrigger>
          <TooltipContent>
            <p>Test Tools</p>
          </TooltipContent>
        </Tooltip>

        <div className="h-4">
          <Separator orientation="vertical" />
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleRefresh}
              disabled={isProcessing || isLoadingTools}
            >
              <RotateCw
                className={`size-3.5 ${isLoadingTools ? "animate-spin" : ""}`}
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Refresh Tools</p>
          </TooltipContent>
        </Tooltip>

        <ShareableActions
          type="composio"
          visibility="private"
          isOwner={true}
          canChangeVisibility={false}
          onDelete={handleDisconnect}
          isDeleteLoading={isProcessing}
          disabled={isProcessing}
          renderActions={() => null}
        />
      </CardHeader>

      {description && (
        <div className="px-6 pb-2">
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      )}

      <div className="relative hidden sm:flex w-full">
        <CardContent className="flex min-w-0 w-full flex-col text-sm max-h-[400px] overflow-hidden">
          <div className="flex items-center gap-2 mb-4 pt-2 pb-1 z-10">
            <Wrench size={14} className="text-muted-foreground" />
            <h5 className="text-muted-foreground text-sm font-medium">
              Available Tools ({tools.length}
              {actionsCount ? ` of ${actionsCount}` : ""})
            </h5>
          </div>

          <div className="flex-1 overflow-y-auto">
            {tools.length > 0 ? (
              <ToolsList tools={tools} appName={connection.appName} />
            ) : (
              <div className="bg-secondary/30 rounded-md p-3 text-center">
                <p className="text-sm text-muted-foreground">
                  Loading tools... Click refresh if this persists.
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </div>
    </Card>
  );
});

const ToolsList = memo(
  ({ tools, appName }: { tools: ComposioToolInfo[]; appName: string }) => (
    <div className="space-y-2 pr-2">
      {tools.map((tool) => (
        <div
          key={tool.name}
          className="flex items-start gap-2 bg-secondary rounded-md p-2 hover:bg-input transition-colors"
        >
          <ComposioToolDetailPopup tool={tool} appName={appName}>
            <div className="flex-1 min-w-0 cursor-pointer">
              <p className="font-medium text-sm mb-1 truncate">
                {tool.displayName || tool.name}
              </p>
              <p className="text-xs text-muted-foreground line-clamp-1">
                {tool.description}
              </p>
            </div>
          </ComposioToolDetailPopup>

          <div className="flex items-center px-1 justify-center self-stretch">
            <ChevronRight size={16} />
          </div>
        </div>
      ))}
    </div>
  ),
);

ToolsList.displayName = "ComposioToolsList";
