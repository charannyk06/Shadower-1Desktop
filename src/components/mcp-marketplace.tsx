"use client";

import { memo, useCallback, useMemo, useState } from "react";
import { useSWRConfig } from "swr";
import { toast } from "sonner";
import { ExternalLink, Search } from "lucide-react";

import { appStore } from "@/app/store";
import { useMcpList } from "@/hooks/queries/use-mcp-list";
import { mcpApi } from "@/lib/electron/mcp-api";
import { redriectMcpOauth } from "lib/ai/mcp/oauth-redirect";
import { cn } from "lib/utils";
import { handleErrorWithToast } from "ui/shared-toast";

import { Button } from "ui/button";
import { Input } from "ui/input";
import { Label } from "ui/label";
import { ScrollArea } from "ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "ui/tabs";
import { MCPIcon } from "ui/mcp-icon";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "ui/dialog";

import {
  RECOMMENDED_MCPS,
  MCP_CATEGORIES,
  type MCPCategory,
  type RecommendedMCP,
} from "./mcp-overview";
import { MCPMarketplaceTile } from "./mcp-marketplace-tile";
import type { MCPServerInfo } from "app-types/mcp";

interface MCPMarketplaceProps {
  className?: string;
}

export const MCPMarketplace = memo(function MCPMarketplace({
  className,
}: MCPMarketplaceProps) {
  const { mutate } = useSWRConfig();
  const appStoreMutate = appStore((state) => state.mutate);

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<MCPCategory>("all");

  // State for env var prompt dialog
  const [envVarDialogOpen, setEnvVarDialogOpen] = useState(false);
  const [pendingMcp, setPendingMcp] = useState<RecommendedMCP | null>(null);
  const [envVarValues, setEnvVarValues] = useState<Record<string, string>>({});
  const [isInstallingWithEnv, setIsInstallingWithEnv] = useState(false);

  const { data: mcpList = [], isLoading } = useMcpList({
    refreshInterval: 5000, // Refresh every 5 seconds to get updated status
  });

  // Create a map of installed servers by name for quick lookup
  const installedServersByName = useMemo(() => {
    const map = new Map<string, MCPServerInfo>();
    mcpList.forEach((server) => {
      map.set(server.name.toLowerCase(), server);
    });
    return map;
  }, [mcpList]);

  // Filter MCPs based on search and category
  const filteredMCPs = useMemo(() => {
    let mcps = RECOMMENDED_MCPS;

    // Filter by category
    if (selectedCategory !== "all") {
      mcps = mcps.filter((mcp) => mcp.category === selectedCategory);
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      mcps = mcps.filter(
        (mcp) =>
          mcp.name.toLowerCase().includes(query) ||
          mcp.label.toLowerCase().includes(query) ||
          mcp.description.toLowerCase().includes(query),
      );
    }

    return mcps;
  }, [selectedCategory, searchQuery]);

  // Show all MCPs with their installed status
  // Installed MCPs will show their status (Connected, Disabled, Error, etc.)
  const availableMCPs = useMemo(() => {
    return filteredMCPs.map((mcp) => {
      const server = installedServersByName.get(mcp.name.toLowerCase());
      return { mcp, server };
    });
  }, [filteredMCPs, installedServersByName]);

  // Handle quick install
  const handleInstall = useCallback(async (mcp: RecommendedMCP) => {
    // Check if this MCP requires environment variables
    if (mcp.requiredEnvVars && mcp.requiredEnvVars.length > 0) {
      // Open dialog to collect env vars from user
      setPendingMcp(mcp);
      setEnvVarValues({});
      setEnvVarDialogOpen(true);
      return;
    }

    // No env vars required, proceed with direct install
    await performInstall(mcp);
  }, []);

  // Perform the actual installation
  const performInstall = useCallback(
    async (mcp: RecommendedMCP, envVars?: Record<string, string>) => {
      try {
        // If env vars are provided, modify the config to include them
        let config = mcp.config;
        if (envVars && Object.keys(envVars).length > 0) {
          // For stdio config, add env vars to the env field
          if ("command" in config) {
            // Merge provided env vars with any existing env in the config
            const existingEnv = (config as any).env || {};
            const mergedEnv = { ...existingEnv, ...envVars };
            config = { ...config, env: mergedEnv } as typeof config;
          }
        }

        const result = await mcpApi.quickInstall({
          name: mcp.name,
          config,
          requiresAuth: mcp.requiresAuth,
        });

        if (!result.success) {
          throw new Error(result.error || "Failed to install MCP server");
        }

        // Refresh the list
        mutate("/api/mcp/list");

        // Show success message
        if (result.needsAuth && result.serverId) {
          toast.success(
            `${mcp.label} installed! Please authorize it in "My Servers" to access its tools.`,
          );
        } else {
          toast.success(`${mcp.label} installed successfully!`);
        }
      } catch (error: any) {
        handleErrorWithToast(error);
      }
    },
    [mutate],
  );

  // Handle install with environment variables from dialog
  const handleInstallWithEnvVars = useCallback(async () => {
    if (!pendingMcp) return;

    // Validate all required env vars are filled
    const missingVars = pendingMcp.requiredEnvVars?.filter(
      (v) => !envVarValues[v.name]?.trim(),
    );
    if (missingVars && missingVars.length > 0) {
      toast.error(
        `Please fill in all required fields: ${missingVars.map((v) => v.label).join(", ")}`,
      );
      return;
    }

    setIsInstallingWithEnv(true);
    try {
      await performInstall(pendingMcp, envVarValues);
      setEnvVarDialogOpen(false);
      setPendingMcp(null);
      setEnvVarValues({});
    } finally {
      setIsInstallingWithEnv(false);
    }
  }, [pendingMcp, envVarValues, performInstall]);

  // Handle connect (OAuth)
  const handleConnect = useCallback(
    async (serverId: string) => {
      try {
        await redriectMcpOauth(serverId);
        mutate("/api/mcp/list");
      } catch (error: any) {
        handleErrorWithToast(error);
      }
    },
    [mutate],
  );

  // Handle refresh
  const handleRefresh = useCallback(
    async (serverId: string) => {
      try {
        await mcpApi.refreshClient(serverId);
        mutate("/api/mcp/list");
        toast.success("Connection refreshed");
      } catch (error: any) {
        handleErrorWithToast(error);
      }
    },
    [mutate],
  );

  // Handle settings (open customization popup)
  const handleSettings = useCallback(
    (server: MCPServerInfo) => {
      appStoreMutate({
        mcpCustomizationPopup: {
          id: server.id,
          name: server.name,
          config: server.config,
          status: server.status,
          toolInfo: server.toolInfo || [],
          error: server.error,
          enabled: server.enabled ?? true,
          userId: server.userId,
        },
      });
    },
    [appStoreMutate],
  );

  return (
    <div className={cn("flex flex-col h-full overflow-hidden", className)}>
      {/* Header with Search */}
      <div className="flex items-center justify-between px-8 pt-4 pb-3 border-b shrink-0">
        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 w-64"
            />
          </div>
        </div>
      </div>

      {/* Category Tabs */}
      <div className="px-8 py-2 border-b overflow-x-auto shrink-0">
        <Tabs
          value={selectedCategory}
          onValueChange={(v) => setSelectedCategory(v as MCPCategory)}
        >
          <TabsList className="bg-transparent h-auto p-0 gap-1">
            {MCP_CATEGORIES.map((cat) => {
              const CatIcon = cat.icon;
              return (
                <TabsTrigger
                  key={cat.id}
                  value={cat.id}
                  className="data-[state=active]:bg-secondary px-3 py-1.5 rounded-full text-xs"
                >
                  <CatIcon className="size-3.5 mr-1.5" />
                  {cat.label}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <ScrollArea className="h-full w-full">
          <div className="px-8 py-6 space-y-8">
            {/* Available MCPs Section */}
            {availableMCPs.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-4">
                  <h2 className="text-lg font-semibold text-muted-foreground">
                    Available MCPs
                  </h2>
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-xs text-muted-foreground px-2 py-0.5 bg-secondary rounded-full">
                    {availableMCPs.length} available
                  </span>
                </div>

                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 auto-rows-fr">
                  {availableMCPs.map(({ mcp, server }) => (
                    <MCPMarketplaceTile
                      key={mcp.name}
                      mcp={mcp}
                      installedServer={server}
                      onInstall={() => handleInstall(mcp)}
                      onConnect={() => server && handleConnect(server.id)}
                      onRefresh={() => server && handleRefresh(server.id)}
                      onSettings={() => server && handleSettings(server)}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Empty State */}
            {availableMCPs.length === 0 && !isLoading && (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <MCPIcon className="fill-muted-foreground size-16 mb-4 opacity-50" />
                <h3 className="text-xl font-semibold mb-2">No MCPs found</h3>
                <p className="text-sm text-muted-foreground max-w-md mb-4">
                  {searchQuery
                    ? `No MCP servers match "${searchQuery}". Try a different search term.`
                    : "No MCP servers available in this category."}
                </p>
                {searchQuery && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSearchQuery("")}
                  >
                    Clear search
                  </Button>
                )}
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Environment Variables Dialog */}
      <Dialog open={envVarDialogOpen} onOpenChange={setEnvVarDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {pendingMcp?.icon && <pendingMcp.icon className="size-5" />}
              Configure {pendingMcp?.label}
            </DialogTitle>
            <DialogDescription>
              This MCP server requires the following configuration to work
              properly.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {pendingMcp?.requiredEnvVars?.map((envVar) => (
              <div key={envVar.name} className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor={envVar.name} className="text-sm font-medium">
                    {envVar.label}
                  </Label>
                  {envVar.helpUrl && (
                    <a
                      href={envVar.helpUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline flex items-center gap-1"
                    >
                      Get one <ExternalLink className="size-3" />
                    </a>
                  )}
                </div>
                <Input
                  id={envVar.name}
                  type={envVar.isSecret ? "password" : "text"}
                  placeholder={envVar.description}
                  value={envVarValues[envVar.name] || ""}
                  onChange={(e) =>
                    setEnvVarValues((prev) => ({
                      ...prev,
                      [envVar.name]: e.target.value,
                    }))
                  }
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  {envVar.description}
                </p>
              </div>
            ))}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => {
                setEnvVarDialogOpen(false);
                setPendingMcp(null);
                setEnvVarValues({});
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleInstallWithEnvVars}
              disabled={isInstallingWithEnv}
            >
              {isInstallingWithEnv ? "Installing..." : "Install"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
});

MCPMarketplace.displayName = "MCPMarketplace";

export default MCPMarketplace;
