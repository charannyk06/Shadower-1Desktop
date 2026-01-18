"use client";

import { useComposioApps } from "@/hooks/queries/use-composio";
import { OAUTH_SETUP_LINKS } from "lib/composio/oauth-config";
import { cn } from "lib/utils";
import {
  CheckCircle2Icon,
  ExternalLinkIcon,
  KeyIcon,
  Loader,
  SearchIcon,
  SettingsIcon,
} from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { mutate } from "swr";
import { Badge } from "ui/badge";
import { Button } from "ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "ui/card";
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

interface OAuthConfigDialogProps {
  readonly app: any;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (config: {
    clientId: string;
    clientSecret: string;
    scopes: string;
  }) => Promise<void>;
}

function OAuthConfigDialog({
  app,
  open,
  onClose,
  onSubmit,
}: OAuthConfigDialogProps) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [scopes, setScopes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const setupInfo = OAUTH_SETUP_LINKS[app?.name] || OAUTH_SETUP_LINKS.default;

  const handleSubmit = async () => {
    if (!clientId || !clientSecret) {
      toast.error("Client ID and Client Secret are required");
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit({ clientId, clientSecret, scopes });
      setClientId("");
      setClientSecret("");
      setScopes("");
      onClose();
    } catch (error) {
      handleErrorWithToast(error as Error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl p-6 gap-6">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            {app?.logo ? (
              <img
                src={app.logo}
                alt={app?.name}
                className="size-10 rounded-lg border shadow-sm"
              />
            ) : (
              <div className="size-10 rounded-lg border bg-muted flex items-center justify-center">
                <SettingsIcon className="size-5 text-muted-foreground" />
              </div>
            )}
            <div>
              <DialogTitle className="text-xl">
                Configure {app?.displayName || app?.name}
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
                    {setupInfo.instructions}
                  </pre>
                </div>
                {setupInfo.url && (
                  <a
                    href={setupInfo.url}
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
              <code className="flex items-center w-full h-10 px-3 rounded-md border bg-muted/30 text-sm font-mono text-muted-foreground select-all cursor-text">
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
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="Paste Client ID"
                className="font-mono text-sm"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="clientSecret">Client Secret</Label>
              <Input
                id="clientSecret"
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
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
                value={scopes}
                onChange={(e) => setScopes(e.target.value)}
                placeholder="e.g. read:user, write:data"
                className="font-mono text-sm min-h-[80px]"
              />
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="px-6"
          >
            {isSubmitting ? (
              <Loader className="size-4 animate-spin mr-2" />
            ) : (
              <KeyIcon className="size-4 mr-2" />
            )}
            Save Configuration
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AdminIntegrationsDashboard() {
  const [searchQuery, setSearchQuery] = useState("");
  const [configuringApp, setConfiguringApp] = useState<any>(null);
  const [filter, setFilter] = useState<"all" | "configured" | "unconfigured">(
    "unconfigured",
  );

  const { data: appsData, isLoading: isLoadingApps } = useComposioApps();
  const apps = appsData?.items || [];
  const enabled = appsData?.enabled ?? false;

  const filteredApps = apps.filter((app) => {
    const matchesSearch =
      app.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.description?.toLowerCase().includes(searchQuery.toLowerCase());

    if (filter === "configured") {
      return matchesSearch && app.hasIntegration;
    } else if (filter === "unconfigured") {
      return matchesSearch && !app.hasIntegration;
    }
    return matchesSearch;
  });

  const handleConfigureOAuth = useCallback(
    async (config: {
      clientId: string;
      clientSecret: string;
      scopes: string;
    }) => {
      if (!configuringApp) return;

      const response = await fetch("/api/admin/composio/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appName: configuringApp.name,
          clientId: config.clientId,
          clientSecret: config.clientSecret,
          scopes: config.scopes
            ? config.scopes.split(",").map((s) => s.trim())
            : [],
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create integration");
      }

      toast.success(
        `Successfully configured ${configuringApp.displayName || configuringApp.name}`,
      );
      mutate("/api/composio/apps");
    },
    [configuringApp],
  );

  if (!enabled) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center">
        <KeyIcon className="size-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold mb-2">Integrations Not Enabled</h3>
        <p className="text-sm text-muted-foreground max-w-md">
          To manage integrations, add your Integrations API Key to the .env file
          and enable the feature flag.
        </p>
      </div>
    );
  }

  const configuredCount = apps.filter((a) => a.hasIntegration).length;
  const unconfiguredCount = apps.filter((a) => !a.hasIntegration).length;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">App Integrations</h1>
        <p className="text-muted-foreground">
          Configure OAuth credentials for apps to enable user connections. Apps
          without configuration require custom OAuth setup.
        </p>
      </div>

      <div className="flex flex-wrap gap-4 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search apps..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex gap-2">
          <Button
            variant={filter === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter("all")}
          >
            All ({apps.length})
          </Button>
          <Button
            variant={filter === "configured" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter("configured")}
          >
            <CheckCircle2Icon className="size-3.5 mr-1" />
            Configured ({configuredCount})
          </Button>
          <Button
            variant={filter === "unconfigured" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter("unconfigured")}
          >
            <SettingsIcon className="size-3.5 mr-1" />
            Needs Setup ({unconfiguredCount})
          </Button>
        </div>
      </div>

      {isLoadingApps ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={`admin-skeleton-${i}`} className="h-48" />
          ))}
        </div>
      ) : (
        <ScrollArea className="h-[calc(100vh-280px)]">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pr-4">
            {filteredApps.map((app) => {
              const isConfigured = app.hasIntegration;

              return (
                <Card
                  key={app.appId}
                  className={cn(
                    "relative transition-all duration-200 group overflow-hidden",
                    isConfigured
                      ? "border-green-200/50 bg-green-50/30 hover:bg-green-50/50 hover:border-green-300/50"
                      : "border-border/40 bg-card hover:border-primary/20 hover:shadow-sm",
                  )}
                >
                  {/* Status Badge - Absolute Positioned */}
                  <div className="absolute top-3 right-3 z-10">
                    {isConfigured ? (
                      <Badge
                        variant="secondary"
                        className="bg-green-100/80 text-green-700 hover:bg-green-100 border-green-200 backdrop-blur-sm text-[10px] px-2 py-0.5"
                      >
                        <CheckCircle2Icon className="size-3 mr-1" />
                        Ready
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="bg-amber-50/50 text-amber-700 border-amber-200/60 backdrop-blur-sm text-[10px] px-2 py-0.5"
                      >
                        <SettingsIcon className="size-3 mr-1" />
                        Setup Required
                      </Badge>
                    )}
                  </div>

                  <CardHeader className="pb-3 pt-5 px-5">
                    <div className="flex items-start gap-3.5">
                      {app.logo ? (
                        <div className="size-10 rounded-lg border bg-white p-1.5 shrink-0 flex items-center justify-center shadow-sm">
                          <img
                            src={app.logo}
                            alt={app.name}
                            className="size-full object-contain"
                          />
                        </div>
                      ) : (
                        <div className="size-10 rounded-lg border bg-muted/30 flex items-center justify-center shrink-0">
                          <span className="text-lg font-bold text-muted-foreground/50">
                            {app.name.charAt(0).toUpperCase()}
                          </span>
                        </div>
                      )}

                      <div className="flex-1 min-w-0 pt-0.5">
                        <CardTitle className="text-sm font-semibold truncate pr-16 leading-tight">
                          {app.displayName || app.name}
                        </CardTitle>
                        {app.categories && app.categories.length > 0 && (
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[11px] text-muted-foreground truncate rounded-full bg-muted/40 px-2 py-0.5">
                              {app.categories?.[0]}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent className="px-5 pb-5">
                    <div className="h-10 mb-4">
                      {app.description ? (
                        <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                          {app.description}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground/40 italic">
                          No description available
                        </p>
                      )}
                    </div>

                    <Button
                      variant={isConfigured ? "outline" : "default"}
                      size="sm"
                      className={cn(
                        "w-full h-8 text-xs font-medium shadow-sm",
                        isConfigured
                          ? "hover:bg-green-50 hover:text-green-700 hover:border-green-200"
                          : "bg-primary/90 hover:bg-primary",
                      )}
                      onClick={() => setConfiguringApp(app)}
                    >
                      <KeyIcon className="size-3.5 mr-2" />
                      {isConfigured ? "Update OAuth" : "Configure OAuth"}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </ScrollArea>
      )}

      <OAuthConfigDialog
        app={configuringApp}
        open={!!configuringApp}
        onClose={() => setConfiguringApp(null)}
        onSubmit={handleConfigureOAuth}
      />
    </div>
  );
}
