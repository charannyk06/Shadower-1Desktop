"use client";

import { appStore } from "@/app/store";
import { isElectronWithIPC } from "@/lib/electron/ai-transport";
import { ChatModel } from "app-types/chat";
import { useCallback, useEffect, useRef } from "react";
import { mutate } from "swr";
import { toast } from "sonner";

// Debounce timer for SWR revalidation to prevent multiple rapid calls
let revalidationTimer: ReturnType<typeof setTimeout> | null = null;
const REVALIDATION_DELAY = 300;

function debouncedRevalidate() {
  if (revalidationTimer) {
    clearTimeout(revalidationTimer);
  }
  revalidationTimer = setTimeout(() => {
    console.log("[Title] Debounced SWR revalidation triggered");
    mutate("/api/thread", undefined, { revalidate: true });
    revalidationTimer = null;
  }, REVALIDATION_DELAY);
}

export function useGenerateThreadTitle(option: {
  threadId: string;
  chatModel?: ChatModel;
}) {
  // Track if we've already processed a title for this thread to prevent double updates
  const processedTitleRef = useRef<string | null>(null);

  const updateTitle = useCallback(
    (title: string) => {
      // Skip if we've already processed this exact title
      if (processedTitleRef.current === title) {
        console.log("[Title Update] Skipping duplicate title update:", title);
        return;
      }

      console.log("[Title Update] Updating title for thread:", option.threadId, "to:", title);
      processedTitleRef.current = title;

      // Get current state
      const currentState = appStore.getState();
      const { threadList } = currentState;

      // Check if thread exists
      const threadExists = threadList.some((v) => v.id === option.threadId);

      let newList: typeof threadList;

      if (!threadExists) {
        // Thread doesn't exist - add it
        newList = [
          {
            id: option.threadId,
            title,
            userId: "",
            createdAt: new Date(),
          },
          ...threadList,
        ];
      } else {
        // Thread exists - update its title
        newList = threadList.map((v) =>
          v.id === option.threadId ? { ...v, title } : v,
        );
      }

      // Use Zustand's native setState with replace: false (merge mode)
      appStore.setState({ threadList: newList }, false);
    },
    [option.threadId],
  );

  const generateTitle = useCallback(
    async (message: string) => {
      const { threadId, chatModel } = option;
      console.log(
        "[Title Generation] Starting for thread:",
        threadId,
        "message length:",
        message.length,
      );

      if (appStore.getState().generatingTitleThreadIds.includes(threadId)) {
        console.log(
          "[Title Generation] Already generating for thread:",
          threadId,
        );
        return;
      }

      const { mutate: storeMutate, generatingTitleThreadIds } = appStore.getState();
      storeMutate({ generatingTitleThreadIds: [...generatingTitleThreadIds, threadId] });

      try {
        // Use Electron IPC if available (always in Electron app)
        if (isElectronWithIPC()) {
          console.log("[Title Generation] Using Electron IPC");
          const api = (window as any).electronAPI;

          // Call the IPC handler - the persistent listener in useEffect will handle the response
          console.log("[Title Generation] Calling IPC generateTitle...");
          const result = await api.ai.generateTitle({
            threadId,
            message,
            chatModel: chatModel ?? appStore.getState().chatModel,
          });
          console.log("[Title Generation] IPC result:", result);

          // Only handle errors here - successful titles are handled by the persistent listener
          if (result.error) {
            console.error("[Title Generation] Error from IPC:", result.error);
            // Use fallback title from first few words of the message
            const fallbackTitle =
              message.slice(0, 50).trim() + (message.length > 50 ? "..." : "");
            updateTitle(fallbackTitle);
            // Only show toast for API key errors, not for other transient issues
            if (
              result.error.includes("API key") ||
              result.error.includes("No API key")
            ) {
              toast.error("Title generation failed: " + result.error);
            }
            // Trigger debounced revalidation for fallback
            debouncedRevalidate();
          }
          // Note: successful title updates are handled by the persistent listener below
        } else {
          // Desktop mode - IPC should always be available
          console.error("[Title Generation] Electron IPC not available");
          const fallbackTitle =
            message.slice(0, 50).trim() + (message.length > 50 ? "..." : "");
          updateTitle(fallbackTitle);
          debouncedRevalidate();
        }
      } catch (error) {
        console.error("[Title Generation] Caught error:", error);
      } finally {
        const state = appStore.getState();
        state.mutate({
          generatingTitleThreadIds: state.generatingTitleThreadIds.filter(
            (v) => v !== threadId,
          ),
        });
      }
    },
    [option, updateTitle],
  );

  // Reset processed title when threadId changes
  useEffect(() => {
    processedTitleRef.current = null;
  }, [option.threadId]);

  // CRITICAL: Set up a PERSISTENT listener for auto-generated titles from main process
  // This catches titles generated by maybeAutoGenerateTitle() after stream completion
  // This is the SINGLE source of truth for title updates to prevent duplicate processing
  useEffect(() => {
    if (!isElectronWithIPC()) return;

    const api = (window as any).electronAPI;

    console.log("[Title] Setting up persistent listener for thread:", option.threadId);

    // Listen for auto-generated titles from main process
    const cleanup = api.ai.onTitleGenerated(
      (data: { threadId: string; title: string }) => {
        if (data.threadId === option.threadId && data.title) {
          console.log(
            "[Title] Received auto-generated title for thread:",
            data.threadId,
            "title:",
            data.title,
          );
          updateTitle(data.title);
          // Use debounced revalidation to prevent multiple rapid SWR calls
          debouncedRevalidate();
        }
      },
    );

    return cleanup;
  }, [option.threadId, updateTitle]);

  return generateTitle;
}
