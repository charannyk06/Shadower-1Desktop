"use client";
import { MCPCard } from "@/components/mcp-card";
import { MCPMarketplace } from "@/components/mcp-marketplace";
import { MCPOverview, RECOMMENDED_MCPS } from "@/components/mcp-overview";
import { SmitheryIntegration } from "@/components/smithery-integration";
import { Button } from "@/components/ui/button";
import { Link, useNavigate } from "@tanstack/react-router";

import { Skeleton } from "ui/skeleton";

import { useMcpList } from "@/hooks/queries/use-mcp-list";
import { BasicUser } from "app-types/user";
import type { MCPServerInfo } from "app-types/mcp";
import { Grid, InfoIcon, List, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "ui/dropdown-menu";
import { MCPIcon } from "ui/mcp-icon";
import { ScrollArea } from "ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "ui/tabs";

interface MCPDashboardProps {
  message?: string;
  user: BasicUser;
}

export default function MCPDashboard({ message, user }: MCPDashboardProps) {
  const navigate = useNavigate();

  // All authenticated users can create MCP connections (roles/permissions removed)
  const canCreate = true;

  const {
    data: mcpList,
    isLoading,
    isValidating,
  } = useMcpList({
    refreshInterval: 10000,
  });

  const [viewMode, setViewMode] = useState<"marketplace" | "list">(
    "marketplace",
  );

  const { myServers, featuredServers } = useMemo((): {
    myServers: MCPServerInfo[];
    featuredServers: MCPServerInfo[];
  } => {
    if (!mcpList) return { myServers: [], featuredServers: [] };

    const sortFn = (a: MCPServerInfo, b: MCPServerInfo) => {
      if (a.status === b.status) return 0;
      if (a.status === "authorizing") return -1;
      if (b.status === "authorizing") return 1;
      return 0;
    };

    // In single-user mode, all servers belong to the user
    const owned = mcpList.sort(sortFn);

    return { myServers: owned, featuredServers: [] };
  }, [mcpList]);

  const displayIcons = useMemo(() => {
    const shuffled = [...RECOMMENDED_MCPS].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, 5);
  }, []);

  // Delay showing validating spinner until validating persists for 500ms
  const [showValidating, setShowValidating] = useState(false);

  const handleRecommendedSelect = (mcp: (typeof RECOMMENDED_MCPS)[number]) => {
    navigate({
      to: "/mcp/create",
      search: {
        name: mcp.name,
        config: JSON.stringify(mcp.config),
      },
    });
  };

  useEffect(() => {
    if (isValidating) {
      setShowValidating(false);
      const timerId = setTimeout(() => setShowValidating(true), 500);
      return () => clearTimeout(timerId);
    }
    setShowValidating(false);
  }, [isValidating]);

  useEffect(() => {
    if (message) {
      toast(<p className="whitespace-pre-wrap break-all">{message}</p>, {
        id: "mcp-list-message",
      });
    }
  }, []);

  return (
    <>
      <div className="h-full w-full z-40 relative">
        <Tabs
          value={viewMode}
          onValueChange={(v) => setViewMode(v as "marketplace" | "list")}
          className="h-full flex flex-col"
        >
          {/* Tab Header */}
          <div className="flex items-center justify-between px-8 pt-8 pb-4">
            <TabsList className="bg-secondary/50">
              <TabsTrigger value="marketplace" className="gap-2">
                <Grid className="size-4" />
                Marketplace
              </TabsTrigger>
              <TabsTrigger value="list" className="gap-2">
                <List className="size-4" />
                My Servers
              </TabsTrigger>
            </TabsList>

            <div className="flex items-center gap-2">
              {showValidating && isValidating && !isLoading && (
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              )}

              {canCreate && viewMode === "list" && (
                <div className="flex items-center gap-1">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        className="gap-1 data-[state=open]:bg-muted data-[state=open]:text-foreground text-muted-foreground"
                      >
                        <div className="flex -space-x-2">
                          {displayIcons.map((mcp, index) => {
                            const Icon = mcp.icon;
                            return (
                              <div
                                key={mcp.name}
                                className="relative rounded-full bg-background border-[1px] p-1"
                                style={{
                                  zIndex: displayIcons.length - index,
                                }}
                              >
                                <Icon className="size-3" />
                              </div>
                            );
                          })}
                        </div>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      {RECOMMENDED_MCPS.slice(0, 10).map((mcp) => {
                        const Icon = mcp.icon;
                        return (
                          <DropdownMenuItem
                            key={mcp.name}
                            onClick={() => handleRecommendedSelect(mcp)}
                            className="cursor-pointer"
                          >
                            <Icon className="size-4 mr-2" />
                            <span>{mcp.label}</span>
                          </DropdownMenuItem>
                        );
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <SmitheryIntegration>
                    <Button variant="ghost" size="icon" className="size-8">
                      <InfoIcon className="size-4" />
                    </Button>
                  </SmitheryIntegration>
                  <Link
                    to="/mcp/create"
                    search={{ name: undefined, config: undefined }}
                  >
                    <Button
                      className="font-semibold bg-input/20"
                      variant="outline"
                      data-testid="add-mcp-server-button"
                    >
                      <MCPIcon className="fill-foreground size-3.5" />
                      Add MCP Server
                    </Button>
                  </Link>
                </div>
              )}
            </div>
          </div>

          {/* Marketplace Tab */}
          <TabsContent
            value="marketplace"
            className="flex-1 m-0 overflow-hidden"
          >
            <MCPMarketplace />
          </TabsContent>

          {/* List Tab (Original View) */}
          <TabsContent value="list" className="flex-1 m-0 overflow-hidden">
            <ScrollArea className="h-full w-full">
              <div className="flex-1 relative flex flex-col gap-4 px-8 max-w-3xl h-full mx-auto pb-8">
                {isLoading ? (
                  <div className="flex flex-col gap-4">
                    <Skeleton className="h-60 w-full" />
                    <Skeleton className="h-60 w-full" />
                    <Skeleton className="h-60 w-full" />
                  </div>
                ) : myServers?.length || featuredServers?.length ? (
                  <div
                    className="flex flex-col gap-8 mb-4"
                    data-testid="mcp-servers-section"
                  >
                    {myServers?.length > 0 && (
                      <div className="flex flex-col gap-4">
                        <h2 className="text-lg font-semibold text-muted-foreground">
                          My MCP Servers
                        </h2>
                        <div
                          className="flex flex-col gap-6"
                          data-testid="my-mcp-servers-section"
                        >
                          {myServers.map((mcp) => (
                            <MCPCard key={mcp.id} {...mcp} user={user} />
                          ))}
                        </div>
                      </div>
                    )}
                    {featuredServers?.length > 0 && (
                      <div className="flex flex-col gap-4">
                        <h2 className="text-lg font-semibold text-muted-foreground">
                          Featured MCP Servers
                        </h2>
                        <div
                          className="flex flex-col gap-6"
                          data-testid="featured-mcp-servers-section"
                        >
                          {featuredServers.map((mcp) => (
                            <MCPCard key={mcp.id} {...mcp} user={user} />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : // When MCP list is empty
                canCreate ? (
                  <MCPOverview />
                ) : (
                  <div className="flex flex-col items-center justify-center space-y-4 my-20 text-center">
                    <h3 className="text-2xl md:text-4xl font-semibold">
                      No MCP Servers Available
                    </h3>
                    <p className="text-muted-foreground max-w-md">
                      Connect MCP servers to extend your AI assistant with
                      powerful tools and integrations
                    </p>
                  </div>
                )}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
