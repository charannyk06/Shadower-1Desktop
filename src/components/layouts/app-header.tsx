"use client";

import {
  ChevronDown,
  FolderOpen,
  MicIcon,
  PanelLeft,
} from "lucide-react";
import { Button } from "ui/button";
import { Separator } from "ui/separator";
import { useSidebar } from "ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";

import { appStore } from "@/app/store";
import { Shortcuts, getShortcutKeyList } from "lib/keyboard-shortcuts";
import { useTranslation } from "react-i18next";
import { useLocation } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { TextShimmer } from "ui/text-shimmer";
import { useShallow } from "zustand/shallow";
import { ThreadDropdown } from "../thread-dropdown";
import { WorkingDirectoryDisplay } from "../working-directory-display";

export function AppHeader() {
  const { t } = useTranslation();
  const [appStoreMutate, theaterMode, currentThreadId, threadList] = appStore(
    useShallow((state) => [state.mutate, state.theaterMode, state.currentThreadId, state.threadList]),
  );
  const { toggleSidebar, open, setOpen } = useSidebar();
  const location = useLocation();
  const currentPaths = location.pathname;

  // Check if we're on a chat page with an active conversation
  // Thread must exist in threadList (meaning a message has been sent)
  const hasActiveConversation = useMemo(() => {
    if (currentPaths.startsWith("/chat/")) {
      // Check if this thread exists in the list (has started)
      const urlThreadId = currentPaths.replace("/chat/", "");
      return threadList.some((t) => t.id === urlThreadId);
    }
    if (currentThreadId) {
      return threadList.some((t) => t.id === currentThreadId);
    }
    return false;
  }, [currentPaths, currentThreadId, threadList]);

  // Show thread dropdown if on /chat/ URL OR if there's an active thread
  const componentByPage = useMemo(() => {
    if (currentPaths.startsWith("/chat/") || currentThreadId) {
      return <ThreadDropdownComponent />;
    }
  }, [currentPaths, currentThreadId]);

  return (
    <header className="sticky top-0 z-50 flex items-center px-3 py-2 pt-8">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Toggle Sidebar"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              // If theater mode is open, close it and open sidebar
              // Only one panel should be open at a time
              if (theaterMode.isOpen) {
                appStoreMutate((state) => ({
                  theaterMode: { ...state.theaterMode, isOpen: false },
                }));
                setOpen(true);
              } else {
                toggleSidebar();
              }
            }}
            data-testid="sidebar-toggle"
            data-state={open ? "open" : "closed"}
          >
            <PanelLeft />
          </Button>
        </TooltipTrigger>
        <TooltipContent align="start" side="bottom">
          <div className="flex items-center gap-2">
            {t("KeyboardShortcuts.toggleSidebar")}
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              {getShortcutKeyList(Shortcuts.toggleSidebar).map((key) => (
                <span
                  key={key}
                  className="w-5 h-5 flex items-center justify-center bg-muted rounded "
                >
                  {key}
                </span>
              ))}
            </div>
          </div>
        </TooltipContent>
      </Tooltip>

      <div className="w-1 h-4">
        <Separator orientation="vertical" />
      </div>

      {componentByPage}

      <div className="flex-1" />

      <WorkingDirectoryDisplay />

      {
        <div className="flex items-center gap-2">
          {hasActiveConversation && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size={"icon"}
                  variant={"ghost"}
                  className="bg-secondary/40"
                  onClick={() => {
                    appStoreMutate((state) => ({
                      theaterMode: {
                        ...state.theaterMode,
                        isOpen: true,
                        defaultTab: "all-files",
                      },
                    }));
                  }}
                >
                  <FolderOpen className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent align="end" side="bottom">
                <div className="text-xs">Workspace Files</div>
              </TooltipContent>
            </Tooltip>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size={"icon"}
                variant={"ghost"}
                className="bg-secondary/40"
                onClick={() => {
                  appStoreMutate((state) => ({
                    voiceChat: {
                      ...state.voiceChat,
                      isOpen: true,
                      agentId: undefined,
                    },
                  }));
                }}
              >
                <MicIcon className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent align="end" side="bottom">
              <div className="text-xs flex items-center gap-2">
                {t("KeyboardShortcuts.toggleVoiceChat")}
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  {getShortcutKeyList(Shortcuts.toggleVoiceChat).map((key) => (
                    <span
                      className="w-5 h-5 flex items-center justify-center bg-muted rounded "
                      key={key}
                    >
                      {key}
                    </span>
                  ))}
                </div>
              </div>
            </TooltipContent>
          </Tooltip>
        </div>
      }
    </header>
  );
}

function ThreadDropdownComponent() {
  const location = useLocation();
  // Subscribe to each field individually for more reliable updates
  const threadList = appStore((state) => state.threadList);
  const currentThreadId = appStore((state) => state.currentThreadId);
  const generatingTitleThreadIds = appStore((state) => state.generatingTitleThreadIds);

  // Extract threadId from URL as fallback (URL is /chat/:threadId)
  const urlThreadId = useMemo(() => {
    const match = location.pathname.match(/^\/chat\/(.+)$/);
    return match ? match[1] : null;
  }, [location.pathname]);

  // Use URL threadId as fallback when store hasn't been updated yet
  const effectiveThreadId = currentThreadId || urlThreadId;

  // Find the current thread - recompute when threadList or currentThreadId changes
  const currentThread = useMemo(() => {
    if (!effectiveThreadId) return null;
    return threadList.find((thread) => thread.id === effectiveThreadId) ?? null;
  }, [threadList, effectiveThreadId]);

  // Determine title to display
  const displayTitle = currentThread?.title || "New Chat";
  const isGeneratingTitle = currentThread ? generatingTitleThreadIds.includes(currentThread.id) : false;

  useEffect(() => {
    if (currentThread) {
      document.title = displayTitle;
    }
  }, [currentThread, displayTitle]);

  // Only show dropdown when the thread exists in threadList
  // This means a message has been sent and the thread has started
  if (!currentThread) return null;

  return (
    <div className="flex items-center gap-1">
      <div className="w-1 h-4">
        <Separator orientation="vertical" />
      </div>

      <ThreadDropdown
        threadId={currentThread.id}
        beforeTitle={displayTitle}
      >
        <div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                className="data-[state=open]:bg-input! hover:text-foreground cursor-pointer flex gap-1 items-center px-2 py-1 rounded-md hover:bg-accent"
              >
                {isGeneratingTitle ? (
                  <TextShimmer className="truncate max-w-40 sm:max-w-60 min-w-0 mr-1">
                    {displayTitle}
                  </TextShimmer>
                ) : (
                  <p className="truncate max-w-40 sm:max-w-60 min-w-0 mr-1">
                    {displayTitle}
                  </p>
                )}

                <ChevronDown size={14} />
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-[200px] p-4 break-all overflow-y-auto max-h-[200px]">
              {displayTitle}
            </TooltipContent>
          </Tooltip>
        </div>
      </ThreadDropdown>
    </div>
  );
}
