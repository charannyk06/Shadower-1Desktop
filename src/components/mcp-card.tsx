"use client";
import {
  ChevronRight,
  FlaskConical,
  Loader,
  RotateCw,
  Settings,
  Settings2,
  ShieldAlertIcon,
  Wrench,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { memo, useCallback, useMemo, useState } from "react";
import { useSWRConfig } from "swr";
import { safe } from "ts-safe";
import { Alert, AlertDescription, AlertTitle } from "ui/alert";
import { Button } from "ui/button";
import { Card, CardContent, CardHeader } from "ui/card";
import JsonView from "ui/json-view";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";
import { MCPIcon } from "ui/mcp-icon";

import { mcpApi } from "@/lib/electron/mcp-api";
import { handleErrorWithToast } from "ui/shared-toast";
import { ShareableActions } from "./shareable-actions";
import { RECOMMENDED_MCPS } from "./mcp-overview";

import type { MCPServerInfo, MCPToolInfo } from "app-types/mcp";

// Helper to format server name for display (fallback when not in RECOMMENDED_MCPS)
function formatServerName(name: string): string {
  // Handle common patterns like "brave-search" -> "Brave Search"
  return name
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// Helper to get MCP info from RECOMMENDED_MCPS
function getMCPInfo(name: string) {
  const normalizedName = name.toLowerCase();
  return RECOMMENDED_MCPS.find(
    (mcp) => mcp.name.toLowerCase() === normalizedName,
  );
}

import { appStore } from "@/app/store";
import { BasicUser } from "app-types/user";
import { redriectMcpOauth } from "lib/ai/mcp/oauth-redirect";
import { isString } from "lib/utils";
import { Separator } from "ui/separator";
import { ToolDetailPopup } from "./tool-detail-popup";

// Main MCPCard component
export const MCPCard = memo(function MCPCard({
  id,
  config,
  error,
  status,
  name,
  toolInfo,
  enabled,
  userId,
  user: _user,
}: MCPServerInfo & { user: BasicUser }) {
  const [isProcessing, setIsProcessing] = useState(false);
  const appStoreMutate = appStore((state) => state.mutate);
  const { mutate } = useSWRConfig();

  const isLoading = useMemo(() => {
    return isProcessing || status === "loading";
  }, [isProcessing, status]);

  // Get MCP info for icon and display label
  const mcpInfo = useMemo(() => getMCPInfo(name), [name]);
  const displayName = mcpInfo?.label || formatServerName(name);
  const ServerIcon = mcpInfo?.icon || MCPIcon;

  const needsAuthorization = status === "authorizing";
  const isDisabled = isLoading || needsAuthorization;

  const errorMessage = useMemo(() => {
    if (error) {
      return isString(error) ? error : JSON.stringify(error);
    }
    return null;
  }, [error]);

  const pipeProcessing = useCallback(
    async (fn: () => Promise<any>) =>
      safe(() => setIsProcessing(true))
        .ifOk(fn)
        .ifOk(() => mutate("/api/mcp/list"))
        .ifFail(handleErrorWithToast)
        .watch(() => setIsProcessing(false)),
    [],
  );

  const handleRefresh = useCallback(
    () => pipeProcessing(() => mcpApi.refreshClient(id)),
    [id],
  );

  const handleDelete = useCallback(async () => {
    await pipeProcessing(() => mcpApi.delete(id));
  }, [id]);

  const handleAuthorize = useCallback(
    () => pipeProcessing(() => redriectMcpOauth(id)),
    [id],
  );

  return (
    <Card
      key={`mcp-card-${id}-${status}`}
      className="relative hover:border-foreground/20 transition-colors bg-secondary/40"
      data-testid="mcp-server-card"
    >
      {isLoading && (
        <div className="animate-pulse z-10 absolute inset-0 bg-background/50 flex items-center justify-center w-full h-full" />
      )}
      <CardHeader
        key={`header-${status}-${needsAuthorization}`}
        className="flex items-center gap-1 mb-2"
      >
        {isLoading && <Loader className="size-4 z-20 animate-spin mr-1" />}

        <h4 className="font-bold text-xs sm:text-lg flex items-center gap-2">
          <ServerIcon className="size-5" />
          {displayName}
        </h4>

        <div className="flex-1" />

        {needsAuthorization && (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleAuthorize}
                  disabled={isProcessing}
                >
                  <ShieldAlertIcon className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Authorize</p>
              </TooltipContent>
            </Tooltip>
            <div className="h-4">
              <Separator orientation="vertical" />
            </div>
          </>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              disabled={isDisabled}
              onClick={() =>
                appStoreMutate({
                  mcpCustomizationPopup: {
                    id,
                    name,
                    config,
                    status,
                    toolInfo,
                    error,
                    enabled,
                    userId,
                  },
                })
              }
            >
              <Settings2 className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>MCP Server Customization</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            {isDisabled ? (
              <div className="cursor-pointer hidden sm:block">
                <Button variant="ghost" size="icon" disabled>
                  <FlaskConical className="size-3.5" />
                </Button>
              </div>
            ) : (
              <Link
                to="/mcp/$serverId/test"
                params={{ serverId: id }}
                className="cursor-pointer hidden sm:block"
              >
                <Button variant="ghost" size="icon">
                  <FlaskConical className="size-3.5" />
                </Button>
              </Link>
            )}
          </TooltipTrigger>
          <TooltipContent>
            <p>Tools Test</p>
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
              disabled={isLoading}
            >
              <RotateCw className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Refresh</p>
          </TooltipContent>
        </Tooltip>
        {/* Actions for single-user mode */}
        <ShareableActions
          type="mcp"
          isOwner={true}
          editHref={`/mcp/modify/${encodeURIComponent(id)}`}
          onDelete={handleDelete}
          isDeleteLoading={isProcessing}
          disabled={isLoading}
        />
      </CardHeader>

      {errorMessage && <ErrorAlert error={errorMessage} />}

      {needsAuthorization && (
        <div className="px-6 pb-2">
          <Alert
            className="cursor-pointer hover:bg-accent/10 transition-colors"
            onClick={handleAuthorize}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleAuthorize();
              }
            }}
          >
            <ShieldAlertIcon />
            <AlertTitle>Authorization Required</AlertTitle>
            <AlertDescription>
              Click here to authorize this MCP server and access its tools.
            </AlertDescription>
          </Alert>
        </div>
      )}

      <div className="relative hidden sm:flex w-full">
        <CardContent className="flex min-w-0 w-full flex-row text-sm max-h-[320px] overflow-hidden border-r-0">
          {/* Show config in single-user mode */}
          {config && (
            <div className="w-1/2 min-w-0 flex flex-col pr-2 border-r border-border">
              <div className="flex items-center gap-2 mb-2 pt-2 pb-1 z-10">
                <Settings size={14} className="text-muted-foreground" />
                <h5 className="text-muted-foreground text-sm font-medium">
                  Configuration
                </h5>
              </div>
              <div className="flex-1 overflow-y-auto">
                <JsonView data={config} />
              </div>
            </div>
          )}

          <div
            className={`${config ? "w-1/2" : "w-full"} min-w-0 flex flex-col ${config ? "pl-4" : ""}`}
          >
            <div className="flex items-center gap-2 mb-4 pt-2 pb-1 z-10">
              <Wrench size={14} className="text-muted-foreground" />
              <h5 className="text-muted-foreground text-sm font-medium">
                Available Tools
              </h5>
            </div>

            <div className="flex-1 overflow-y-auto">
              {toolInfo.length > 0 ? (
                <ToolsList tools={toolInfo} serverId={id} />
              ) : (
                <div className="bg-secondary/30 rounded-md p-3 text-center">
                  <p className="text-sm text-muted-foreground">
                    No tools available
                  </p>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </div>
    </Card>
  );
});

// Tools list component
const ToolsList = memo(
  ({ tools, serverId }: { tools: MCPToolInfo[]; serverId: string }) => (
    <div className="space-y-2 pr-2">
      {tools.map((tool) => (
        <div
          key={tool.name}
          className="flex items-start gap-2 bg-secondary rounded-md p-2 hover:bg-input transition-colors"
        >
          <ToolDetailPopup tool={tool} serverId={serverId}>
            <div className="flex-1 min-w-0 cursor-pointer">
              <p className="font-medium text-sm mb-1 truncate">{tool.name}</p>
              <p className="text-xs text-muted-foreground line-clamp-1">
                {tool.description}
              </p>
            </div>
          </ToolDetailPopup>

          <div className="flex items-center px-1 justify-center self-stretch">
            <ChevronRight size={16} />
          </div>
        </div>
      ))}
    </div>
  ),
);

ToolsList.displayName = "ToolsList";

// Error alert component
const ErrorAlert = memo(({ error }: { error: string }) => (
  <div className="px-6 pb-2">
    <Alert variant="destructive" className="border-destructive">
      <AlertTitle>Error</AlertTitle>
      <AlertDescription className="whitespace-pre-wrap break-words">
        {error}
      </AlertDescription>
    </Alert>
  </div>
));

ErrorAlert.displayName = "ErrorAlert";
