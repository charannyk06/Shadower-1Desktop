"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Download, RefreshCw, X } from "lucide-react";
import { Button } from "ui/button";

interface UpdateInfo {
  version: string;
  releaseNotes?: string;
  releaseDate?: string;
}

interface DownloadProgress {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
}

export function UpdateNotification() {
  const [updateDownloaded, setUpdateDownloaded] = useState<UpdateInfo | null>(
    null,
  );

  useEffect(() => {
    // Check if we're in Electron with update API
    if (typeof window === "undefined" || !window.electronAPI?.update) {
      return;
    }

    const { update } = window.electronAPI;

    // Listen for update available
    const unsubAvailable = update.onAvailable((info: UpdateInfo) => {
      toast.info(`Update available: v${info.version}`, {
        description: "Downloading in background...",
        duration: 5000,
        icon: <Download className="h-4 w-4" />,
      });
    });

    // Listen for download progress (optional - can show progress)
    const unsubProgress = update.onProgress((progress: DownloadProgress) => {
      // Only log significant progress updates to avoid spam
      if (Math.floor(progress.percent) % 25 === 0) {
        console.log(`[Update] Download: ${progress.percent.toFixed(0)}%`);
      }
    });

    // Listen for update downloaded
    const unsubDownloaded = update.onDownloaded((info: UpdateInfo) => {
      setUpdateDownloaded(info);

      toast.success(`Update ready: v${info.version}`, {
        description: "Restart to apply the update",
        duration: Infinity, // Keep visible until dismissed
        icon: <RefreshCw className="h-4 w-4" />,
        action: {
          label: "Restart Now",
          onClick: () => {
            update.install();
          },
        },
        cancel: {
          label: "Later",
          onClick: () => {
            // Just dismiss
          },
        },
      });
    });

    // Listen for errors
    const unsubError = update.onError((data: { message: string }) => {
      console.error("[Update] Error:", data.message);
      // Only show error toast for critical errors, not network issues
      if (!data.message.includes("net::ERR")) {
        toast.error("Update check failed", {
          description: data.message,
          duration: 5000,
        });
      }
    });

    // Cleanup
    return () => {
      unsubAvailable();
      unsubProgress();
      unsubDownloaded();
      unsubError();
    };
  }, []);

  // Floating update banner when update is downloaded
  if (updateDownloaded) {
    return (
      <div className="fixed bottom-4 right-4 z-50 animate-in slide-in-from-bottom-4">
        <div className="bg-primary text-primary-foreground rounded-lg shadow-lg p-4 max-w-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5" />
              <div>
                <p className="font-medium">Update Ready</p>
                <p className="text-sm opacity-90">
                  Version {updateDownloaded.version} is ready to install
                </p>
              </div>
            </div>
            <button
              onClick={() => setUpdateDownloaded(null)}
              className="opacity-70 hover:opacity-100"
              type="button"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setUpdateDownloaded(null)}
            >
              Later
            </Button>
            <Button
              size="sm"
              onClick={() => window.electronAPI?.update?.install()}
              className="bg-white text-primary hover:bg-white/90"
            >
              Restart Now
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
