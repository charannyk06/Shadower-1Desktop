"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Folder, FolderSync, GitBranch, HardDrive } from "lucide-react";
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
  const [
    appStoreMutate,
    workingDirectory,
    workingDirectoryMode,
    threadWorkingDirectories,
    currentThreadId,
  ] = appStore(
    useShallow((state) => [
      state.mutate,
      state.workingDirectory,
      state.workingDirectoryMode,
      state.threadWorkingDirectories,
      state.currentThreadId,
    ])
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

  const isWorktreeMode = workingDirectoryMode === "worktree";
  const activeThreadId = currentThreadId || undefined;
  const activeDirectory =
    isWorktreeMode && activeThreadId
      ? threadWorkingDirectories[activeThreadId] || workingDirectory
      : workingDirectory;
  const isInherited =
    isWorktreeMode &&
    activeThreadId &&
    !threadWorkingDirectories[activeThreadId] &&
    !!workingDirectory;

  const handleChangeDirectory = async () => {
    if (typeof window === "undefined" || !window.electronAPI) return;

    const result = await window.electronAPI.dialog.openDirectory({
      title: "Select Working Directory",
      defaultPath: activeDirectory?.path || homeDir,
      buttonLabel: "Select Directory",
    });

    if (result.success && result.path && result.name) {
      appStoreMutate((state) => {
        if (state.workingDirectoryMode === "worktree" && activeThreadId) {
          return {
            threadWorkingDirectories: {
              ...state.threadWorkingDirectories,
              [activeThreadId]: { path: result.path, name: result.name },
            },
          };
        }
        return {
          workingDirectory: {
            path: result.path,
            name: result.name,
          },
        };
      });
    }
  };

  const handleOpenInFinder = async () => {
    if (typeof window === "undefined" || !window.electronAPI) return;

    const directoryPath = activeDirectory?.path || homeDir;
    if (directoryPath) {
      await window.electronAPI.dialog.openInFileManager(directoryPath);
    }
  };

  const handleModeChange = (mode: "local" | "worktree") => {
    appStoreMutate((state) => {
      const nextState: Partial<typeof state> = {
        workingDirectoryMode: mode,
      };

      if (
        mode === "worktree" &&
        state.currentThreadId &&
        state.workingDirectory &&
        !state.threadWorkingDirectories[state.currentThreadId]
      ) {
        nextState.threadWorkingDirectories = {
          ...state.threadWorkingDirectories,
          [state.currentThreadId]: state.workingDirectory,
        };
      }

      return nextState;
    });
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
  const displayName = activeDirectory?.name || "Select Directory";
  const displayPath = formatPath(activeDirectory?.path);
  const modeLabel = isWorktreeMode ? "Worktree" : "Local";

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
                {isWorktreeMode ? (
                  <GitBranch className="size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <HardDrive className="size-4 shrink-0 text-muted-foreground" />
                )}
                <div className="flex flex-col items-start min-w-0">
                  <span className="text-xs font-medium truncate w-full text-left">
                    {displayName}{" "}
                    <span className="text-[10px] text-muted-foreground">
                      · {modeLabel}
                    </span>
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
              {activeDirectory?.path || "No directory selected"}
            </p>
            {isInherited && (
              <p className="text-[10px] text-muted-foreground mt-1">
                Inherited from Local
              </p>
            )}
          </TooltipContent>
        </Tooltip>

        <DropdownMenuContent align="start" className="w-56">
          <div className="px-2 py-2">
            <div className="grid grid-cols-2 gap-1 rounded-lg border bg-muted/40 p-1">
              <button
                type="button"
                onClick={() => handleModeChange("local")}
                className={cn(
                  "flex items-center justify-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                  !isWorktreeMode
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <HardDrive className="size-3" />
                Local
              </button>
              <button
                type="button"
                onClick={() => handleModeChange("worktree")}
                className={cn(
                  "flex items-center justify-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                  isWorktreeMode
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <GitBranch className="size-3" />
                Worktree
              </button>
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground">
              Worktree applies per chat. Local applies globally.
            </p>
          </div>
          <DropdownMenuItem
            onClick={handleChangeDirectory}
            className="cursor-pointer"
          >
            <FolderSync className="size-4 mr-2" />
            <span>
              {isWorktreeMode ? "Change Worktree" : "Change Directory"}
            </span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={handleOpenInFinder}
            className="cursor-pointer"
            disabled={!activeDirectory?.path}
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
