"use client";
import { MCPCard } from "@/components/mcp-card";
import { canCreateMCP } from "lib/auth/client-permissions";

import { MCPOverview, RECOMMENDED_MCPS } from "@/components/mcp-overview";
import { SmitheryIntegration } from "@/components/smithery-integration";
import { Button } from "@/components/ui/button";
import Link from "next/link";

import { Skeleton } from "ui/skeleton";

import { disconnectComposioAppAction } from "@/app/api/composio/actions";
import {
  useComposioApps,
  useComposioConnections,
  useComposioTools,
} from "@/hooks/queries/use-composio";
import { useMcpList } from "@/hooks/queries/use-mcp-list";
import { BasicUser } from "app-types/user";
import { cn } from "lib/utils";
import {
  ChevronRight,
  FlaskConical,
  InfoIcon,
  Loader2,
  PlugIcon,
  RotateCw,
  Settings2,
  Wrench,
} from "lucide-react";
import { useTranslations } from "next-intl";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { mutate } from "swr";
import { safe } from "ts-safe";
import { Badge } from "ui/badge";
import { Card, CardContent, CardHeader } from "ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "ui/dropdown-menu";
import { MCPIcon } from "ui/mcp-icon";
import { ScrollArea } from "ui/scroll-area";
import { Separator } from "ui/separator";
import { handleErrorWithToast } from "ui/shared-toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";
import { ShareableActions } from "./shareable-actions";

const LightRays = dynamic(() => import("@/components/ui/light-rays"), {
  ssr: false,
});

interface MCPDashboardProps {
  message?: string;
  user: BasicUser;
}

export default function MCPDashboard({ message, user }: MCPDashboardProps) {
  const t = useTranslations("MCP");
  const router = useRouter();

  // Check if user can create MCP connections using Better Auth permissions
  const canCreate = canCreateMCP(user?.role);

  const {
    data: mcpList,
    isLoading,
    isValidating,
  } = useMcpList({
    refreshInterval: 10000,
  });

  const { myServers, featuredServers } = useMemo(() => {
    if (!mcpList) return { myServers: [], featuredServers: [] };

    const sortFn = (a: any, b: any) => {
      if (a.status === b.status) return 0;
      if (a.status === "authorizing") return -1;
      if (b.status === "authorizing") return 1;
      return 0;
    };

    const owned = mcpList.filter((s) => s.userId === user?.id).sort(sortFn);
    const featured = mcpList
      .filter((s) => s.userId !== user?.id && s.visibility === "public")
      .sort(sortFn);

    return { myServers: owned, featuredServers: featured };
  }, [mcpList]);

  const displayIcons = useMemo(() => {
    const shuffled = [...RECOMMENDED_MCPS].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, 5);
  }, []);

  // Delay showing validating spinner until validating persists for 500ms
  const [showValidating, setShowValidating] = useState(false);

  const handleRecommendedSelect = (mcp: (typeof RECOMMENDED_MCPS)[number]) => {
    const params = new URLSearchParams();
    params.set("name", mcp.name);
    params.set("config", JSON.stringify(mcp.config));
    router.push(`/mcp/create?${params.toString()}`);
  };

  const particle = useMemo(() => {
    return (
      <>
        <div className="absolute opacity-30 pointer-events-none top-0 left-0 w-full h-full z-10 fade-in animate-in duration-5000">
          <LightRays className="bg-transparent" />
        </div>

        <div className="absolute pointer-events-none top-0 left-0 w-full h-full z-10 fade-in animate-in duration-5000">
          <div className="w-full h-full bg-gradient-to-t from-background to-50% to-transparent z-20" />
        </div>
        <div className="absolute pointer-events-none top-0 left-0 w-full h-full z-10 fade-in animate-in duration-5000">
          <div className="w-full h-full bg-gradient-to-l from-background to-20% to-transparent z-20" />
        </div>
        <div className="absolute pointer-events-none top-0 left-0 w-full h-full z-10 fade-in animate-in duration-5000">
          <div className="w-full h-full bg-gradient-to-r from-background to-20% to-transparent z-20" />
        </div>
      </>
    );
  }, [isLoading, mcpList?.length]);

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
      {particle}
      <ScrollArea className="h-full w-full z-40 ">
        <div className="pt-8 flex-1 relative flex flex-col gap-4 px-8 max-w-3xl h-full mx-auto pb-8">
          <div className={cn("flex items-center  pb-8")}>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              {canCreate ? t("mcpServers") : t("availableMcpServers")}
              {showValidating && isValidating && !isLoading && (
                <Loader2 className="size-4 animate-spin" />
              )}
            </h1>
            <div className="flex-1" />

            <div className="flex gap-2">
              {canCreate && mcpList?.length ? (
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
                    {RECOMMENDED_MCPS.map((mcp) => {
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
              ) : null}

              {canCreate && (
                <Link href="/integrations">
                  <Button className="font-semibold" variant={"ghost"}>
                    {t("marketplace")}
                  </Button>
                </Link>
              )}
              {canCreate && (
                <div className="flex items-center gap-1">
                  <SmitheryIntegration>
                    <Button variant="ghost" size="icon" className="size-8">
                      <InfoIcon className="size-4" />
                    </Button>
                  </SmitheryIntegration>
                  <Link href="/mcp/create">
                    <Button
                      className="font-semibold bg-input/20"
                      variant="outline"
                      data-testid="add-mcp-server-button"
                    >
                      <MCPIcon className="fill-foreground size-3.5" />
                      {t("addMcpServer")}
                    </Button>
                  </Link>
                </div>
              )}
            </div>
          </div>
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
                    {t("myMcpServers")}
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
                    {t("featuredMcpServers")}
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
                {t("noMcpServersAvailable")}
              </h3>
              <p className="text-muted-foreground max-w-md">
                {t("noMcpServersAvailableDescription")}
              </p>
            </div>
          )}

          {/* Composio Connected Apps Section */}
          <ComposioConnectedAppsSection />
        </div>
      </ScrollArea>
    </>
  );
}

function ComposioConnectedAppsSection() {
  const { data: connectionsData } = useComposioConnections();
  const { data: appsData } = useComposioApps();
  const [disconnectingApp, setDisconnectingApp] = useState<string | null>(null);

  const connections =
    connectionsData?.items?.filter((c) => c.status === "active") || [];
  const apps = appsData?.items || [];
  const enabled = connectionsData?.enabled || false;

  const handleDisconnect = async (connectionId: string, appName: string) => {
    setDisconnectingApp(appName);
    safe(() => disconnectComposioAppAction(connectionId, appName))
      .ifOk(() => {
        toast.success(`Disconnected from ${appName}`);
        mutate("/api/composio/connections");
      })
      .ifFail(handleErrorWithToast)
      .watch(() => setDisconnectingApp(null));
  };

  if (!enabled || connections.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4 mt-8">
      <h2 className="text-lg font-semibold text-muted-foreground flex items-center gap-2">
        <PlugIcon className="size-4" />
        Connected Apps
      </h2>
      <div className="flex flex-col gap-6">
        {connections.map((connection) => {
          const appInfo = apps.find((a) => a.name === connection.appName);
          return (
            <ComposioAppCard
              key={connection.id}
              connection={connection}
              appInfo={appInfo}
              disconnectingApp={disconnectingApp}
              handleDisconnect={handleDisconnect}
            />
          );
        })}
      </div>
    </div>
  );
}

function ComposioAppCard({
  connection,
  appInfo,
  disconnectingApp,
  handleDisconnect,
}: {
  readonly connection: any;
  readonly appInfo: any;
  readonly disconnectingApp: string | null;
  readonly handleDisconnect: (id: string, appName: string) => void;
}) {
  const { data: toolsData, isLoading: isLoadingTools } = useComposioTools(
    connection.appName,
  );
  const tools = toolsData?.items || [];
  const [isRefreshing, setIsRefreshing] = useState(false);

  return (
    <Card className="relative hover:border-foreground/20 transition-colors bg-secondary/40">
      <CardHeader className="flex items-center gap-1 mb-2">
        {appInfo?.logo && (
          <img
            src={appInfo.logo}
            alt={connection.appName}
            className="size-6 rounded mr-2"
          />
        )}
        <h4 className="font-bold text-xs sm:text-lg flex items-center gap-2">
          {appInfo?.displayName || connection.appName}
          <Badge
            variant="secondary"
            className="bg-green-100 text-green-800 text-xs"
          >
            Connected
          </Badge>
        </h4>
        <div className="flex-1" />

        {/* Manage/Customize - goes to Composio dashboard */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" asChild>
              <Link href="/integrations">
                <Settings2 className="size-3.5" />
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Manage Apps</p>
          </TooltipContent>
        </Tooltip>

        {/* Test Tools */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" asChild>
              <Link href={`/integrations/test/${connection.appName}`}>
                <FlaskConical className="size-3.5" />
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Test Tools</p>
          </TooltipContent>
        </Tooltip>

        <div className="h-4">
          <Separator orientation="vertical" />
        </div>

        {/* Refresh */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setIsRefreshing(true);
                Promise.all([
                  mutate("/api/composio/tools"),
                  mutate("/api/composio/connections"),
                  mutate(`/api/composio/tools?app=${connection.appName}`),
                ]).finally(() => setIsRefreshing(false));
              }}
              disabled={isRefreshing}
            >
              <RotateCw
                className={`size-3.5 ${isRefreshing ? "animate-spin" : ""}`}
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Refresh</p>
          </TooltipContent>
        </Tooltip>

        {/* Shareable Actions (visibility, delete) */}
        <ShareableActions
          type="composio"
          visibility="private"
          isOwner={true}
          canChangeVisibility={true}
          onVisibilityChange={(newVisibility) => {
            toast.info(
              `Visibility change to ${newVisibility} - feature coming soon!`,
            );
          }}
          onDelete={() => handleDisconnect(connection.id, connection.appName)}
          isDeleteLoading={disconnectingApp === connection.appName}
          disabled={disconnectingApp === connection.appName}
          renderActions={() => null}
        />
      </CardHeader>
      <div className="relative hidden sm:flex w-full">
        <CardContent className="flex min-w-0 w-full flex-col text-sm max-h-[320px] overflow-hidden">
          <div className="flex items-center gap-2 mb-4 pt-2 pb-1 z-10">
            <Wrench size={14} className="text-muted-foreground" />
            <h5 className="text-muted-foreground text-sm font-medium">
              Available Tools ({tools.length})
            </h5>
          </div>
          <div className="flex-1 overflow-y-auto">
            {isLoadingTools && (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            )}
            {!isLoadingTools && tools.length > 0 && (
              <div className="space-y-2 pr-2">
                {tools.map((tool: any) => (
                  <Link
                    key={tool.name}
                    href={`/integrations/test/${connection.appName}?tool=${encodeURIComponent(tool.name)}`}
                    className="flex items-start gap-2 bg-secondary rounded-md p-2 hover:bg-input transition-colors cursor-pointer"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm mb-1 truncate">
                        {tool.displayName || tool.name}
                      </p>
                      <p className="text-xs text-muted-foreground line-clamp-1">
                        {tool.description}
                      </p>
                    </div>
                    <div className="flex items-center px-1 justify-center self-stretch">
                      <ChevronRight size={16} />
                    </div>
                  </Link>
                ))}
              </div>
            )}
            {!isLoadingTools && tools.length === 0 && (
              <div className="bg-secondary/30 rounded-md p-3 text-center">
                <p className="text-sm text-muted-foreground">
                  No tools available
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </div>
    </Card>
  );
}
