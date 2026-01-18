"use client";

import { initiateComposioConnectionAction } from "@/app/api/composio/actions";
import {
  useComposioApps,
  useComposioConnections,
} from "@/hooks/queries/use-composio";
import { authClient } from "auth/client";
import { OAUTH_SETUP_LINKS } from "lib/composio/oauth-config";
import { cn } from "lib/utils";
import {
  ArrowLeft,
  CheckCircle2Icon,
  ExternalLinkIcon,
  KeyIcon,
  Loader,
  PlugIcon,
  SearchIcon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { mutate } from "swr";
import { safe } from "ts-safe";
import { Badge } from "ui/badge";
import { Button } from "ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "ui/dialog";
import { Input } from "ui/input";
import { Label } from "ui/label";
import { ScrollArea } from "ui/scroll-area";
import { handleErrorWithToast } from "ui/shared-toast";
import { Skeleton } from "ui/skeleton";
import { Textarea } from "ui/textarea";

// Helper function to determine button variant
function getButtonVariant(
  isConnected: boolean,
  hasIntegration: boolean,
): "outline" | "default" | "secondary" {
  if (isConnected) return "outline";
  if (hasIntegration) return "default";
  return "secondary";
}

// Helper component for button icon
function ButtonIcon({
  isConnecting,
  isConnected,
}: {
  readonly isConnecting: boolean;
  readonly isConnected: boolean;
}) {
  if (isConnecting) {
    return <Loader className="size-4 animate-spin mr-2" />;
  }
  if (isConnected) {
    return <CheckCircle2Icon className="size-4 mr-2" />;
  }
  return <ExternalLinkIcon className="size-4 mr-2" />;
}

export default function ComposioDashboard() {
  const [searchQuery, setSearchQuery] = useState("");
  const [connectingApp, setConnectingApp] = useState<string | null>(null);
  const [configuringApp, setConfiguringApp] = useState<any>(null);
  const [oauthConfig, setOauthConfig] = useState({
    clientId: "",
    clientSecret: "",
    scopes: "",
  });
  const [isSubmittingConfig, setIsSubmittingConfig] = useState(false);

  const { data: session } = authClient.useSession();
  const isAdmin = session?.user?.role === "admin";

  const { data: appsData, isLoading: isLoadingApps } = useComposioApps();
  const { data: connectionsData } = useComposioConnections();

  const apps = appsData?.items || [];
  const connections = connectionsData?.items || [];
  const enabled = appsData?.enabled || false;

  const connectedAppNames = new Set(
    connections.filter((c) => c.status === "active").map((c) => c.appName),
  );

  const filteredApps = apps.filter(
    (app) =>
      app.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.description?.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const handleConnect = useCallback(async (appName: string) => {
    setConnectingApp(appName);
    safe(() =>
      initiateComposioConnectionAction(appName, globalThis.location.href),
    )
      .ifOk((result) => {
        globalThis.open(result.redirectUrl, "_blank");
        toast.success(`Connecting to ${appName}...`);
        mutate("/api/composio/connections");
      })
      .ifFail((error) => {
        const errorMsg = error?.message || String(error);
        if (
          errorMsg.includes("No integration found") ||
          errorMsg.includes("Default auth config not found")
        ) {
          if (isAdmin) {
            const app = apps.find((a) => a.name === appName);
            setConfiguringApp(app);
          } else {
            toast.error(
              `${appName} requires OAuth configuration. Ask your admin to configure it.`,
              { duration: 8000 },
            );
          }
        } else {
          handleErrorWithToast(error);
        }
      })
      .watch(() => setConnectingApp(null));
  }, []);

  // Show loading skeleton while data is being fetched
  if (isLoadingApps) {
    return (
      <div className="flex flex-col gap-6 p-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <Skeleton className="size-8 rounded-md" />
            <Skeleton className="h-8 w-64" />
          </div>
          <Skeleton className="h-5 w-96 ml-11" />
        </div>
        <Skeleton className="h-10 w-full" />
        <div className="flex flex-col gap-4">
          <Skeleton className="h-6 w-32" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton
                key={`skeleton-loading-${i}`}
                className="h-48 rounded-lg"
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center">
        <PlugIcon className="size-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold mb-2">Integrations Not Enabled</h3>
        <p className="text-sm text-muted-foreground max-w-md">
          To enable app integrations, add your Integrations API Key to the .env
          file and enable the feature flag.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <Link href="/mcp">
            <Button variant="ghost" size="icon" className="size-8">
              <ArrowLeft className="size-4" />
            </Button>
          </Link>
          <h2 className="text-2xl font-bold">Application Integrations</h2>
        </div>
        <p className="text-muted-foreground ml-11">
          Connect to 500+ apps and access 10,000+ tools for your AI agents
        </p>
      </div>

      <div className="relative">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          placeholder="Search apps..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>

      <div className="flex flex-col gap-4">
        <h3 className="text-lg font-semibold">Available Apps</h3>
        {isLoadingApps ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={`skeleton-apps-${i}`} className="h-32" />
            ))}
          </div>
        ) : (
          <ScrollArea className="h-[500px]">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pr-4">
              {filteredApps.map((app) => {
                const isConnected = connectedAppNames.has(app.name);
                const isConnecting = connectingApp === app.name;

                return (
                  <Card
                    key={app.appId}
                    className={cn(
                      "relative transition-colors",
                      isConnected && "border-green-200 bg-green-50/50",
                    )}
                  >
                    <CardHeader className="pb-2">
                      <div className="flex items-center gap-3">
                        {app.logo && (
                          <img
                            src={app.logo}
                            alt={app.name}
                            className="size-8 rounded"
                          />
                        )}
                        <div className="flex-1 min-w-0">
                          <CardTitle className="text-base truncate">
                            {app.displayName || app.name}
                          </CardTitle>
                          {app.meta?.actionsCount && (
                            <span className="text-xs text-muted-foreground">
                              {app.meta.actionsCount} actions
                            </span>
                          )}
                          {app.categories?.length && (
                            <div className="flex flex-wrap gap-1 mt-1 overflow-hidden max-w-full">
                              {app.categories.slice(0, 1).map((cat) => (
                                <Badge
                                  key={cat}
                                  variant="outline"
                                  className="text-xs truncate max-w-[150px]"
                                >
                                  {cat}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {app.description && (
                        <CardDescription className="text-xs line-clamp-2 mb-3">
                          {app.description}
                        </CardDescription>
                      )}
                      <Button
                        variant={getButtonVariant(
                          isConnected,
                          app.hasIntegration ?? false,
                        )}
                        size="sm"
                        className="w-full"
                        onClick={() => handleConnect(app.name)}
                        disabled={isConnecting || isConnected}
                      >
                        <ButtonIcon
                          isConnecting={isConnecting}
                          isConnected={isConnected}
                        />
                        {isConnected ? "Connected" : "Connect"}
                      </Button>
                      {!app.hasIntegration && !isConnected && (
                        <p className="text-xs text-muted-foreground mt-1 text-center">
                          May require custom OAuth setup
                        </p>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </div>

      {/* OAuth Configuration Dialog for Admins */}
      <Dialog
        open={!!configuringApp}
        onOpenChange={(o) => !o && setConfiguringApp(null)}
      >
        <DialogContent className="max-w-xl p-6 gap-6">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-2">
              {configuringApp?.logo ? (
                <img
                  src={configuringApp.logo}
                  alt={configuringApp?.name}
                  className="size-10 rounded-lg border shadow-sm"
                />
              ) : (
                <div className="size-10 rounded-lg border bg-muted flex items-center justify-center">
                  <PlugIcon className="size-5 text-muted-foreground" />
                </div>
              )}
              <div>
                <DialogTitle className="text-xl">
                  Configure{" "}
                  {configuringApp?.displayName || configuringApp?.name}
                </DialogTitle>
                <DialogDescription>
                  Enter OAuth credentials to enable this integration
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-6">
            {/* Instructions Box */}
            <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-4">
              <div className="flex gap-3">
                <div className="bg-blue-100/50 p-2 rounded-lg h-fit">
                  <ExternalLinkIcon className="size-4 text-blue-600" />
                </div>
                <div className="flex-1 space-y-2">
                  <h4 className="font-medium text-sm text-blue-900">
                    Configuration Steps
                  </h4>
                  <div className="text-sm text-blue-700/90 leading-relaxed font-sans">
                    <pre className="whitespace-pre-wrap font-sans text-sm">
                      {OAUTH_SETUP_LINKS[configuringApp?.name]?.instructions ||
                        OAUTH_SETUP_LINKS.default.instructions}
                    </pre>
                  </div>
                  {OAUTH_SETUP_LINKS[configuringApp?.name]?.url && (
                    <a
                      href={OAUTH_SETUP_LINKS[configuringApp?.name]?.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 hover:text-blue-800 transition-colors mt-1"
                    >
                      Open Developer Portal
                      <ExternalLinkIcon className="size-3" />
                    </a>
                  )}
                </div>
              </div>
            </div>

            {/* Redirect URL Section */}
            <div className="space-y-2">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Redirect URL
              </Label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                  <ArrowLeft className="size-4 text-muted-foreground rotate-180" />
                </div>
                <code className="flex items-center w-full h-10 pl-9 pr-3 rounded-md border bg-muted/30 text-sm font-mono text-muted-foreground select-all cursor-text">
                  https://backend.composio.dev/api/v1/auth-apps/add
                </code>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Copy this URL to your OAuth application settings
              </p>
            </div>

            {/* Form Fields */}
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="clientId">Client ID</Label>
                <Input
                  id="clientId"
                  value={oauthConfig.clientId}
                  onChange={(e) =>
                    setOauthConfig((prev) => ({
                      ...prev,
                      clientId: e.target.value,
                    }))
                  }
                  placeholder="Paste Client ID"
                  className="font-mono text-sm"
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="clientSecret">Client Secret</Label>
                <Input
                  id="clientSecret"
                  type="password"
                  value={oauthConfig.clientSecret}
                  onChange={(e) =>
                    setOauthConfig((prev) => ({
                      ...prev,
                      clientSecret: e.target.value,
                    }))
                  }
                  placeholder="Paste Client Secret"
                  className="font-mono text-sm"
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="scopes">
                  Scopes{" "}
                  <span className="text-muted-foreground font-normal">
                    (Optional)
                  </span>
                </Label>
                <Textarea
                  id="scopes"
                  value={oauthConfig.scopes}
                  onChange={(e) =>
                    setOauthConfig((prev) => ({
                      ...prev,
                      scopes: e.target.value,
                    }))
                  }
                  placeholder="e.g. read:user, write:data"
                  className="font-mono text-sm min-h-[80px]"
                />
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="ghost"
              onClick={() => setConfiguringApp(null)}
              disabled={isSubmittingConfig}
            >
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (!oauthConfig.clientId || !oauthConfig.clientSecret) {
                  toast.error("Client ID and Client Secret are required");
                  return;
                }
                setIsSubmittingConfig(true);
                try {
                  const response = await fetch(
                    "/api/admin/composio/integrations",
                    {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        appName: configuringApp?.name,
                        clientId: oauthConfig.clientId,
                        clientSecret: oauthConfig.clientSecret,
                        scopes: oauthConfig.scopes
                          ? oauthConfig.scopes.split(",").map((s) => s.trim())
                          : [],
                      }),
                    },
                  );
                  if (!response.ok) {
                    const error = await response.json();
                    throw new Error(
                      error.error || "Failed to create integration",
                    );
                  }
                  toast.success(
                    `Successfully configured ${configuringApp?.displayName || configuringApp?.name}`,
                  );
                  setConfiguringApp(null);
                  setOauthConfig({
                    clientId: "",
                    clientSecret: "",
                    scopes: "",
                  });
                  mutate("/api/composio/apps");
                } catch (error) {
                  handleErrorWithToast(error as Error);
                } finally {
                  setIsSubmittingConfig(false);
                }
              }}
              disabled={isSubmittingConfig}
              className="px-6"
            >
              {isSubmittingConfig ? (
                <Loader className="size-4 animate-spin mr-2" />
              ) : (
                <KeyIcon className="size-4 mr-2" />
              )}
              Save Configuration
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
