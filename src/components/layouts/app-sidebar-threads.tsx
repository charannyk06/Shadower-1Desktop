"use client";

import { threadApi, threadFetcher } from "@/lib/electron/thread-api";
import { appStore } from "@/app/store";
import { useMounted } from "@/hooks/use-mounted";
import { ChevronDown, ChevronUp, MoreHorizontal, Trash } from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
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
import { deduplicateByKey, groupBy } from "lib/utils";
import { useTranslation } from "react-i18next";
import { TextShimmer } from "ui/text-shimmer";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";

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

  const { data: threadList, isLoading } = useSWR("/api/thread", threadFetcher, {
    onError: handleErrorWithToast,
    fallbackData: [],
    onSuccess: (data) => {
      storeMutate((prev) => {
        const groupById = groupBy(prev.threadList, "id");

        const generatingTitleThreads = prev.generatingTitleThreadIds
          .map((id) => {
            return groupById[id]?.[0];
          })
          .filter(Boolean) as ChatThread[];
        const list = deduplicateByKey(
          generatingTitleThreads.concat(data),
          "id",
        );
        return {
          threadList: list.map((v) => {
            const target = groupById[v.id]?.[0];
            if (!target) return v;
            if (target.title && !v.title)
              return {
                ...v,
                title: target.title,
              };
            return v;
          }),
        };
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

  const handleDeleteUnarchivedThreads = async () => {
    await toast.promise(threadApi.deleteUnarchived(), {
      loading: t("Layout.deletingUnarchivedChats"),
      success: () => {
        // Clear thread-related state for unarchived threads
        // Note: We clear all state here since we can't reliably determine which threads
        // were deleted before the thread list is refreshed. The state will rebuild
        // as threads are accessed.
        appStore.setState((state) => {
          // Keep only archived threads' state
          const archivedThreadIds = new Set(
            (threadList || []).filter((t) => t.archivedAt).map((t) => t.id),
          );

          const newThreadContextUsage: typeof state.threadContextUsage = {};
          const newThreadPlans: typeof state.threadPlans = {};
          const newThreadFiles: typeof state.threadFiles = {};
          const newThreadMentions: typeof state.threadMentions = {};

          // Preserve state only for archived threads
          Object.keys(state.threadContextUsage || {}).forEach((threadId) => {
            if (archivedThreadIds.has(threadId)) {
              newThreadContextUsage[threadId] =
                state.threadContextUsage[threadId];
            }
          });
          Object.keys(state.threadPlans || {}).forEach((threadId) => {
            if (archivedThreadIds.has(threadId)) {
              newThreadPlans[threadId] = state.threadPlans[threadId];
            }
          });
          Object.keys(state.threadFiles || {}).forEach((threadId) => {
            if (archivedThreadIds.has(threadId)) {
              newThreadFiles[threadId] = state.threadFiles[threadId];
            }
          });
          Object.keys(state.threadMentions || {}).forEach((threadId) => {
            if (archivedThreadIds.has(threadId)) {
              newThreadMentions[threadId] = state.threadMentions[threadId];
            }
          });

          return {
            threadContextUsage: newThreadContextUsage,
            threadPlans: newThreadPlans,
            threadFiles: newThreadFiles,
            threadMentions: newThreadMentions,
          };
        });
        mutate("/api/thread");
        navigate({ to: "/" });
        return t("Layout.unarchivedChatsDeleted");
      },
      error: t("Layout.failedToDeleteUnarchivedChats"),
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
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={handleDeleteUnarchivedThreads}
                          >
                            <Trash />
                            {t("Layout.deleteUnarchivedChats")}
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
                        <ThreadDropdown
                          side="right"
                          threadId={thread.id}
                          beforeTitle={thread.title}
                        >
                          <div className="flex items-center data-[state=open]:bg-input! group-hover/thread:bg-input! rounded-lg">
                            <Tooltip delayDuration={1000}>
                              <TooltipTrigger asChild>
                                <SidebarMenuButton
                                  asChild
                                  className="group-hover/thread:bg-transparent!"
                                  isActive={currentThreadId === thread.id}
                                >
                                  <Link
                                    to={`/chat/${thread.id}`}
                                    className="flex items-center"
                                  >
                                    {generatingTitleThreadIds.includes(
                                      thread.id,
                                    ) ? (
                                      <TextShimmer className="truncate min-w-0">
                                        {thread.title || "New Chat"}
                                      </TextShimmer>
                                    ) : (
                                      <p className="truncate min-w-0">
                                        {thread.title || "New Chat"}
                                      </p>
                                    )}
                                  </Link>
                                </SidebarMenuButton>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-[200px] p-4 break-all overflow-y-auto max-h-[200px]">
                                {thread.title || "New Chat"}
                              </TooltipContent>
                            </Tooltip>

                            <SidebarMenuAction className="data-[state=open]:bg-input data-[state=open]:opacity-100 opacity-0 group-hover/thread:opacity-100">
                              <MoreHorizontal />
                            </SidebarMenuAction>
                          </div>
                        </ThreadDropdown>
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
