"use client";

import { memo, useState } from "react";
import { BadgeCheck, FlaskConical, Loader2, RotateCw, Settings2, ShieldAlert, Wrench } from "lucide-react";
import { Button } from "ui/button";
import { Badge } from "ui/badge";
import { Card, CardContent, CardFooter, CardHeader } from "ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";
import { cn } from "lib/utils";
import type { RecommendedMCP } from "./mcp-overview";
import type { MCPServerInfo } from "app-types/mcp";
import { Link } from "@tanstack/react-router";

export type MCPTileStatus =
  | "not_installed"
  | "installing"
  | "connected"
  | "disconnected"
  | "error"
  | "authorizing"
  | "loading";

export interface MCPMarketplaceTileProps {
  mcp: RecommendedMCP;
  installedServer?: MCPServerInfo;
  onInstall: () => Promise<void>;
  onConnect: () => void;
  onRefresh: () => void;
  onSettings: () => void;
  className?: string;
}

export const MCPMarketplaceTile = memo(function MCPMarketplaceTile({
  mcp,
  installedServer,
  onInstall,
  onConnect,
  onRefresh,
  onSettings,
  className,
}: MCPMarketplaceTileProps) {
  const [isInstalling, setIsInstalling] = useState(false);

  // Explicitly type description to prevent TS unknown inference issues
  const description: string = mcp.description ?? "";

  const status: MCPTileStatus = isInstalling
    ? "installing"
    : installedServer
      ? (installedServer.status as MCPTileStatus)
      : "not_installed";

  const toolCount = installedServer?.toolInfo?.length ?? 0;
  const hasError = installedServer?.error;

  const handleInstall = async () => {
    setIsInstalling(true);
    try {
      await onInstall();
    } finally {
      setIsInstalling(false);
    }
  };

  const Icon = mcp.icon;

  return (
    <Card
      className={cn(
        "group relative flex flex-col h-full transition-all duration-200 hover:shadow-md",
        status === "connected" && "border-green-500/30 bg-green-500/5",
        status === "error" && "border-destructive/30 bg-destructive/5",
        status === "authorizing" && "border-yellow-500/30 bg-yellow-500/5",
        className
      )}
    >
      <CardHeader className="gap-3">
        {/* Header Row */}
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div
            className={cn(
              "flex items-center justify-center p-2 rounded-lg border bg-secondary/50 shrink-0",
              status === "connected" && "border-green-500/30",
              status === "error" && "border-destructive/30",
              status === "authorizing" && "border-yellow-500/30"
            )}
          >
            <Icon className="size-5" />
          </div>

          {/* Title & Badge */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-sm truncate">{mcp.label}</h3>
              {mcp.official && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <BadgeCheck className="size-4 text-blue-500 shrink-0" />
                  </TooltipTrigger>
                  <TooltipContent>Official MCP Server</TooltipContent>
                </Tooltip>
              )}
            </div>

            {/* Status indicator */}
            <div className="flex items-center gap-1.5 mt-1">
              {status === "not_installed" && (
                <span className="text-xs text-muted-foreground">
                  {mcp.requiresAuth ? "Authentication required" : "Free • One-click install"}
                </span>
              )}
              {status === "installing" && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Loader2 className="size-3 animate-spin" />
                  Installing...
                </span>
              )}
              {status === "connected" && (
                <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                  <span className="size-1.5 rounded-full bg-green-500" />
                  Enabled
                </span>
              )}
              {status === "disconnected" && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <span className="size-1.5 rounded-full bg-muted-foreground" />
                  Disabled
                </span>
              )}
              {status === "error" && (
                <span className="text-xs text-destructive flex items-center gap-1">
                  <span className="size-1.5 rounded-full bg-destructive" />
                  Error
                </span>
              )}
              {status === "authorizing" && (
                <span className="text-xs text-yellow-600 dark:text-yellow-400 flex items-center gap-1">
                  <ShieldAlert className="size-3" />
                  Needs authentication
                </span>
              )}
              {status === "loading" && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Loader2 className="size-3 animate-spin" />
                  Connecting...
                </span>
              )}
            </div>
          </div>

          {/* Tool count (if installed) */}
          {installedServer && toolCount > 0 && (
            <Badge variant="secondary" className="shrink-0 gap-1">
              <Wrench className="size-3" />
              {toolCount}
            </Badge>
          )}
        </div>
      </CardHeader>

      {/* Description */}
      <CardContent className="flex-1">
        <p className="text-sm text-muted-foreground line-clamp-2 min-h-[2.5rem]">
          {description}
        </p>
        {/* Error message */}
        {hasError != null && (
          <p className="text-xs text-destructive mt-2 truncate" title={String(hasError)}>
            {String(hasError)}
          </p>
        )}
      </CardContent>

      {/* Actions Row */}
      <CardFooter className="gap-2 pt-0">
        {status === "not_installed" && (
          <Button
            variant="default"
            size="sm"
            className="flex-1"
            onClick={handleInstall}
            disabled={isInstalling}
          >
            {isInstalling ? (
              <>
                <Loader2 className="size-3 animate-spin mr-1" />
                Installing...
              </>
            ) : (
              "Install"
            )}
          </Button>
        )}

        {status === "authorizing" && (
          <Button
            variant="default"
            size="sm"
            className="flex-1 bg-blue-600 hover:bg-blue-700"
            onClick={onConnect}
          >
            <ShieldAlert className="size-3 mr-1" />
            Connect
          </Button>
        )}

        {(status === "connected" || status === "disconnected" || status === "error") && (
          <>
            <div className="flex-1" />
            {/* Refresh */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8" onClick={onRefresh}>
                  <RotateCw className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh connection</TooltipContent>
            </Tooltip>

            {/* Test Tools */}
            {installedServer && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link to="/mcp/$serverId/test" params={{ serverId: installedServer.id }}>
                    <Button variant="ghost" size="icon" className="size-8">
                      <FlaskConical className="size-3.5" />
                    </Button>
                  </Link>
                </TooltipTrigger>
                <TooltipContent>Test tools</TooltipContent>
              </Tooltip>
            )}

            {/* Settings */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8" onClick={onSettings}>
                  <Settings2 className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Settings</TooltipContent>
            </Tooltip>
          </>
        )}
      </CardFooter>
    </Card>
  );
});

MCPMarketplaceTile.displayName = "MCPMarketplaceTile";
