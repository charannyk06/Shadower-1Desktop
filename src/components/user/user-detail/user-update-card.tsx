"use client";

import { useState, useEffect } from "react";
import { Download, RefreshCw, CheckCircle, AlertCircle, Loader } from "lucide-react";
import { Button } from "ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "ui/card";
import { Label } from "ui/label";
import { toast } from "sonner";

interface UpdateStatus {
  currentVersion: string;
  isDev: boolean;
}

interface UpdateCheckResult {
  updateAvailable: boolean;
  version?: string;
  error?: string;
}

export function UserUpdateCard() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [updateReady, setUpdateReady] = useState<string | null>(null);

  useEffect(() => {
    // Check if we're in Electron
    if (typeof window === "undefined" || !window.electronAPI?.update) {
      return;
    }

    const { update } = window.electronAPI;

    // Get current status
    update.getStatus?.().then((s: UpdateStatus) => {
      setStatus(s);
    }).catch(() => {});

    // Listen for update available
    const unsubAvailable = update.onAvailable?.((info: { version: string }) => {
      setUpdateAvailable(info.version);
      setDownloading(true);
    });

    // Listen for download progress
    const unsubProgress = update.onProgress?.((progress: { percent: number }) => {
      setDownloadProgress(progress.percent);
    });

    // Listen for update downloaded
    const unsubDownloaded = update.onDownloaded?.((info: { version: string }) => {
      setDownloading(false);
      setUpdateReady(info.version);
      setUpdateAvailable(null);
    });

    // Listen for up-to-date
    const unsubUpToDate = update.onUpToDate?.(() => {
      setUpdateAvailable(null);
    });

    return () => {
      unsubAvailable?.();
      unsubProgress?.();
      unsubDownloaded?.();
      unsubUpToDate?.();
    };
  }, []);

  const handleCheckForUpdates = async () => {
    if (!window.electronAPI?.update?.check) {
      toast.error("Update check not available");
      return;
    }

    setChecking(true);
    try {
      const result: UpdateCheckResult = await window.electronAPI.update.check();
      if (result.updateAvailable && result.version) {
        toast.info(`Update available: v${result.version}`, {
          description: "Downloading in background...",
        });
      } else if (result.error) {
        toast.error("Update check failed", {
          description: result.error,
        });
      } else {
        toast.success("You're on the latest version!", {
          description: `Current version: v${status?.currentVersion}`,
        });
      }
    } catch (_error) {
      toast.error("Failed to check for updates");
    } finally {
      setChecking(false);
    }
  };

  const handleInstallUpdate = () => {
    if (window.electronAPI?.update?.install) {
      window.electronAPI.update.install();
    }
  };

  // Don't render if not in Electron
  if (typeof window === "undefined" || !window.electronAPI?.update) {
    return null;
  }

  return (
    <Card className="transition-all duration-200 hover:shadow-md">
      <CardHeader className="pb-4">
        <CardTitle className="text-xl font-semibold flex items-center gap-2">
          <Download className="h-5 w-5 text-primary" />
          App Updates
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Check for and install application updates
        </p>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Current Version */}
        <div className="space-y-3">
          <Label className="text-sm font-medium flex items-center gap-2">
            <CheckCircle className="h-4 w-4" />
            Current Version
          </Label>

          <div className="rounded-lg border bg-muted/30 p-3">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  Shadower v{status?.currentVersion || "..."}
                </p>
                <p className="text-xs text-muted-foreground">
                  {status?.isDev ? "Development build" : "Production build"}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Update Status */}
        {updateReady && (
          <div className="space-y-3">
            <Label className="text-sm font-medium flex items-center gap-2 text-green-600">
              <CheckCircle className="h-4 w-4" />
              Update Ready
            </Label>

            <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-3">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-green-700">
                    Version {updateReady} is ready to install
                  </p>
                  <p className="text-xs text-green-600/80">
                    Restart to apply the update
                  </p>
                </div>

                <Button
                  variant="default"
                  size="sm"
                  onClick={handleInstallUpdate}
                  className="h-8 text-xs bg-green-600 hover:bg-green-700"
                >
                  <RefreshCw className="w-3 h-3 mr-1" />
                  Restart Now
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Download Progress */}
        {downloading && (
          <div className="space-y-3">
            <Label className="text-sm font-medium flex items-center gap-2">
              <Loader className="h-4 w-4 animate-spin" />
              Downloading Update
            </Label>

            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Downloading v{updateAvailable}...</span>
                  <span>{downloadProgress.toFixed(0)}%</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${downloadProgress}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Check for Updates */}
        {!updateReady && !downloading && (
          <div className="space-y-3">
            <Label className="text-sm font-medium flex items-center gap-2">
              <RefreshCw className="h-4 w-4" />
              Check for Updates
            </Label>

            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-sm font-medium">Manual Update Check</p>
                  <p className="text-xs text-muted-foreground">
                    {status?.isDev
                      ? "Updates disabled in dev mode"
                      : "Check if a newer version is available"}
                  </p>
                </div>

                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleCheckForUpdates}
                  disabled={checking || status?.isDev}
                  className="h-8 text-xs"
                >
                  {checking ? (
                    <>
                      <Loader className="w-3 h-3 mr-1 animate-spin" />
                      Checking...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-3 h-3 mr-1" />
                      Check Now
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Dev Mode Warning */}
        {status?.isDev && (
          <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-yellow-600 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-yellow-700">
                  Development Mode
                </p>
                <p className="text-xs text-yellow-600/80">
                  Auto-updates are disabled in development builds. Install a
                  production build to receive updates.
                </p>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
