"use client";

import { threadApi, threadFetcher } from "@/lib/electron/thread-api";
import { appStore } from "@/app/store";
import { useMounted } from "@/hooks/use-mounted";
import { ChevronDown, ChevronUp, Code2, MoreHorizontal, Trash } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import useSWR, { mutate } from "swr";
import { Button } from "ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "ui/dropdown-menu";
import { handleErrorWithToast } from "ui/shared-toast";
import { SidebarGroupLabel, SidebarMenuSub } from "ui/sidebar";
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuSkeleton,
  SidebarMenuSubItem,
} from "ui/sidebar";
import { SidebarGroupContent, SidebarMenu, SidebarMenuItem } from "ui/sidebar";
import { SidebarGroup } from "ui/sidebar";
import { useShallow } from "zustand/shallow";
import { ThreadDropdown } from "../thread-dropdown";

import { ChatThread } from "app-types/chat";
import { useTranslation } from "react-i18next";
import { TextShimmer } from "ui/text-shimmer";

type ThreadGroup = {
  label: string;
  threads: any[];
};

const MAX_THREADS_COUNT = 40;

export function AppSidebarThreads() {
  const mounted = useMounted();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [storeMutate, currentThreadId, generatingTitleThreadIds] = appStore(
    useShallow((state) => [
      state.mutate,
      state.currentThreadId,
      state.generatingTitleThreadIds,
    ]),
  );
  // State to track if expanded view is active
  const [isExpanded, setIsExpanded] = useState(false);

  // Listen for new thread creation events to immediately refresh sidebar
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.ai?.onThreadCreated) return;

    const cleanup = api.ai.onThreadCreated(
      (data: { threadId: string; title: string }) => {
        console.log(
          "[Sidebar] Thread created event received:",
          data.threadId,
          data.title,
        );
        // Immediately refresh the thread list
        mutate("/api/thread");
      },
    );

    return cleanup;
  }, []);

  const { data: threadList, isLoading } = useSWR("/api/thread", threadFetcher, {
    onError: handleErrorWithToast,
    fallbackData: [],
    // Disable automatic revalidation on focus/reconnect to reduce flicker
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    // Keep previous data while revalidating to prevent flash
    keepPreviousData: true,
    onSuccess: (data) => {
      console.log(
        "[Sidebar] threadFetcher onSuccess, received threads:",
        data?.length,
      );
      storeMutate((prev) => {
        // Create a map of current store threads for quick lookup
        const storeThreadsById = new Map(
          prev.threadList.map((t) => [t.id, t]),
        );

        // For threads currently generating titles, preserve the store's title
        // This prevents DB data (which may be stale) from overwriting recently generated titles
        const mergedList = data.map((dbThread: ChatThread) => {
          const storeThread = storeThreadsById.get(dbThread.id);

          // If this thread is actively generating a title, keep store version
          if (prev.generatingTitleThreadIds.includes(dbThread.id) && storeThread) {
            return storeThread;
          }

          // If store has a real title but DB still shows "New Chat", keep store title
          // This handles the brief window between store update and DB sync
          if (
            storeThread?.title &&
            storeThread.title !== "New Chat" &&
            (!dbThread.title || dbThread.title === "New Chat")
          ) {
            return { ...dbThread, title: storeThread.title };
          }

          // Otherwise use the DB version (source of truth)
          return dbThread;
        });

        return { threadList: mergedList };
      });
    },
  });

  // Check if we have 40 or more threads to display "View All" button
  const hasExcessThreads = threadList && threadList.length >= MAX_THREADS_COUNT;

  // Use either limited or full thread list based on expanded state
  const displayThreadList = useMemo(() => {
    if (!threadList) return [];
    return !isExpanded && hasExcessThreads
      ? threadList.slice(0, MAX_THREADS_COUNT)
      : threadList;
  }, [threadList, hasExcessThreads, isExpanded]);

  const threadGroupByDate = useMemo(() => {
    if (!displayThreadList || displayThreadList.length === 0) {
      return [];
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const lastWeek = new Date(today);
    lastWeek.setDate(lastWeek.getDate() - 7);

    const groups: ThreadGroup[] = [
      { label: t("Layout.today"), threads: [] },
      { label: t("Layout.yesterday"), threads: [] },
      { label: t("Layout.lastWeek"), threads: [] },
      { label: t("Layout.older"), threads: [] },
    ];

    displayThreadList.forEach((thread) => {
      const threadDate =
        (thread.lastMessageAt
          ? new Date(thread.lastMessageAt)
          : new Date(thread.createdAt)) || new Date();
      threadDate.setHours(0, 0, 0, 0);

      if (threadDate.getTime() === today.getTime()) {
        groups[0].threads.push(thread);
      } else if (threadDate.getTime() === yesterday.getTime()) {
        groups[1].threads.push(thread);
      } else if (threadDate.getTime() >= lastWeek.getTime()) {
        groups[2].threads.push(thread);
      } else {
        groups[3].threads.push(thread);
      }
    });

    // Filter out empty groups
    return groups.filter((group) => group.threads.length > 0);
  }, [displayThreadList]);

  const handleDeleteAllThreads = async () => {
    await toast.promise(threadApi.deleteAll(), {
      loading: t("Layout.deletingAllChats"),
      success: () => {
        // Clear all thread-related state since all threads are deleted
        appStore.setState({
          threadContextUsage: {},
          threadPlans: {},
          threadFiles: {},
          threadMentions: {},
        });
        mutate("/api/thread");
        navigate({ to: "/" });
        return t("Layout.allChatsDeleted");
      },
      error: t("Layout.failedToDeleteAllChats"),
    });
  };

  if (isLoading || threadList?.length === 0)
    return (
      <SidebarGroup>
        <SidebarGroupContent className="group-data-[collapsible=icon]:hidden group/threads">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarGroupLabel className="">
                <h4 className="text-xs text-muted-foreground">
                  {t("Layout.recentChats")}
                </h4>
              </SidebarGroupLabel>

              {isLoading ? (
                Array.from({ length: 12 }).map(
                  (_, index) => mounted && <SidebarMenuSkeleton key={index} />,
                )
              ) : (
                <div className="px-2 py-4 text-center">
                  <p className="text-sm text-muted-foreground">
                    {t("Layout.noConversationsYet")}
                  </p>
                </div>
              )}
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    );

  return (
    <>
      {threadGroupByDate.map((group, index) => {
        const isFirst = index === 0;
        return (
          <SidebarGroup key={group.label}>
            <SidebarGroupContent className="group-data-[collapsible=icon]:hidden group/threads">
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarGroupLabel className="">
                    <h4 className="text-xs text-muted-foreground group-hover/threads:text-foreground transition-colors">
                      {group.label}
                    </h4>
                    <div className="flex-1" />
                    {isFirst && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="data-[state=open]:bg-input! opacity-0 data-[state=open]:opacity-100! group-hover/threads:opacity-100 transition-opacity"
                          >
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent side="right" align="start">
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={handleDeleteAllThreads}
                          >
                            <Trash />
                            {t("Layout.deleteAllChats")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </SidebarGroupLabel>

                  {group.threads.map((thread) => (
                    <SidebarMenuSub
                      key={thread.id}
                      className={"group/thread mr-0"}
                    >
                      <SidebarMenuSubItem>
                        <div className="flex items-center group-hover/thread:bg-input! rounded-lg">
                          <SidebarMenuButton
                            className="group-hover/thread:bg-transparent!"
                            isActive={currentThreadId === thread.id}
                            onClick={() => {
                              console.log("[Sidebar] Thread clicked:", thread.id, "navigating to:", `/chat/${thread.id}`);
                              navigate({ to: `/chat/${thread.id}` });
                            }}
                          >
                            {/* Show coding agent icon for ACP chats */}
                            {thread.provider === "coding-agents" && (
                              <Code2 className="h-3.5 w-3.5 flex-shrink-0 text-purple-500" />
                            )}
                            {generatingTitleThreadIds.includes(thread.id) ? (
                              <TextShimmer className="truncate min-w-0">
                                {thread.title || "New Chat"}
                              </TextShimmer>
                            ) : (
                              <span className="truncate min-w-0" title={thread.title || "New Chat"}>
                                {thread.title || "New Chat"}
                              </span>
                            )}
                          </SidebarMenuButton>

                          <ThreadDropdown
                            side="right"
                            threadId={thread.id}
                            beforeTitle={thread.title}
                          >
                            <SidebarMenuAction className="data-[state=open]:bg-input data-[state=open]:opacity-100 opacity-0 group-hover/thread:opacity-100">
                              <MoreHorizontal />
                            </SidebarMenuAction>
                          </ThreadDropdown>
                        </div>
                      </SidebarMenuSubItem>
                    </SidebarMenuSub>
                  ))}
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        );
      })}

      {hasExcessThreads && (
        <SidebarMenu>
          <SidebarMenuItem>
            {/* TODO: Later implement a dedicated search/all chats page instead of this expand functionality */}
            <div className="w-full flex px-4">
              <Button
                variant="secondary"
                size="sm"
                className="w-full hover:bg-input! justify-start"
                onClick={() => setIsExpanded(!isExpanded)}
              >
                <MoreHorizontal className="mr-2" />
                {isExpanded
                  ? t("Layout.showLessChats")
                  : t("Layout.showAllChats")}
                {isExpanded ? <ChevronUp /> : <ChevronDown />}
              </Button>
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      )}
    </>
  );
}
