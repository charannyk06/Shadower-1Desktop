"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Folder, FolderSync } from "lucide-react";
import { FinderIcon } from "ui/finder-icon";
import { Button } from "ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";
import { appStore } from "@/app/store";
import { useShallow } from "zustand/shallow";
import { cn } from "lib/utils";

export function WorkingDirectoryDisplay() {
  const [appStoreMutate, workingDirectory] = appStore(
    useShallow((state) => [state.mutate, state.workingDirectory])
  );
  const [isOpen, setIsOpen] = useState(false);
  const [homeDir, setHomeDir] = useState<string>("");

  // Get the home directory on mount (runs once)
  useEffect(() => {
    if (typeof window !== "undefined" && window.electronAPI) {
      window.electronAPI.app.getPath("home").then((homePath) => {
        setHomeDir(homePath);
      });
    }
  }, []);

  // Set default working directory to home if not set (separate effect to avoid re-running on workingDirectory changes)
  useEffect(() => {
    if (homeDir && !workingDirectory) {
      const name = homeDir.split("/").pop() || "Home";
      appStoreMutate({ workingDirectory: { path: homeDir, name } });
    }
  }, [homeDir, workingDirectory, appStoreMutate]);

  const handleChangeDirectory = async () => {
    if (typeof window === "undefined" || !window.electronAPI) return;

    const result = await window.electronAPI.dialog.openDirectory({
      title: "Select Working Directory",
      defaultPath: workingDirectory?.path || homeDir,
      buttonLabel: "Select Directory",
    });

    if (result.success && result.path && result.name) {
      appStoreMutate({
        workingDirectory: {
          path: result.path,
          name: result.name,
        },
      });
    }
  };

  const handleOpenInFinder = async () => {
    if (typeof window === "undefined" || !window.electronAPI) return;

    const directoryPath = workingDirectory?.path || homeDir;
    if (directoryPath) {
      await window.electronAPI.dialog.openInFileManager(directoryPath);
    }
  };

  // Format the path for display - show abbreviated path
  const formatPath = (path: string | undefined): string => {
    if (!path) return "No directory selected";

    // Replace home directory with ~
    if (homeDir && path.startsWith(homeDir)) {
      return "~" + path.slice(homeDir.length);
    }
    return path;
  };

  // Get the display name (folder name)
  const displayName = workingDirectory?.name || "Select Directory";
  const displayPath = formatPath(workingDirectory?.path);

  return (
    <div className="flex items-center">
      <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className={cn(
                  "h-auto py-1.5 px-3 gap-2 max-w-[300px]",
                  "hover:bg-secondary/60 transition-colors",
                  "data-[state=open]:bg-secondary/80"
                )}
              >
                <Folder className="size-4 shrink-0 text-muted-foreground" />
                <div className="flex flex-col items-start min-w-0">
                  <span className="text-xs font-medium truncate w-full text-left">
                    {displayName}
                  </span>
                  <span className="text-[10px] text-muted-foreground truncate w-full text-left">
                    {displayPath}
                  </span>
                </div>
                <ChevronDown
                  className={cn(
                    "size-3 shrink-0 text-muted-foreground transition-transform",
                    isOpen && "rotate-180"
                  )}
                />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent
            side="bottom"
            align="start"
            className="max-w-[400px] break-all"
          >
            <p className="text-xs font-medium">Working Directory</p>
            <p className="text-xs text-muted-foreground mt-1">
              {workingDirectory?.path || "No directory selected"}
            </p>
          </TooltipContent>
        </Tooltip>

        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuItem
            onClick={handleChangeDirectory}
            className="cursor-pointer"
          >
            <FolderSync className="size-4 mr-2" />
            <span>Change Directory</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={handleOpenInFinder}
            className="cursor-pointer"
            disabled={!workingDirectory?.path}
          >
            {typeof window !== "undefined" &&
            window.electronAPI?.platform === "darwin" ? (
              <FinderIcon className="size-4 mr-2" />
            ) : (
              <Folder className="size-4 mr-2" />
            )}
            <span>
              {typeof window !== "undefined" &&
              window.electronAPI?.platform === "darwin"
                ? "Open in Finder"
                : "Open in File Explorer"}
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
