"use client";

import { appStore } from "@/app/store";
import { isElectronWithIPC } from "@/lib/electron/ai-transport";
import { ChatModel } from "app-types/chat";
import { useCallback, useEffect, useRef } from "react";
import { mutate } from "swr";
import { toast } from "sonner";

export function useGenerateThreadTitle(option: {
  threadId: string;
  chatModel?: ChatModel;
}) {
  const cleanupRef = useRef<(() => void) | null>(null);

  const updateTitle = useCallback(
    (title: string) => {
      console.log("[Title Update] START - Updating title for thread:", option.threadId, "to:", title);

      // Get current state
      const currentState = appStore.getState();
      const { threadList } = currentState;

      console.log("[Title Update] Current threadList length:", threadList.length);
      console.log("[Title Update] Looking for thread:", option.threadId);

      // Check if thread exists
      const threadExists = threadList.some((v) => v.id === option.threadId);
      console.log("[Title Update] Thread exists:", threadExists);

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
        console.log("[Title Update] Adding new thread, new list length:", newList.length);
      } else {
        // Thread exists - update its title
        newList = threadList.map((v) =>
          v.id === option.threadId ? { ...v, title } : v,
        );
        console.log("[Title Update] Updating existing thread");
      }

      // Use Zustand's native setState with replace: false (merge mode)
      console.log("[Title Update] Calling appStore.setState with new threadList");
      appStore.setState({ threadList: newList }, false);

      // Verify the update
      const updatedState = appStore.getState();
      const updatedThread = updatedState.threadList.find(t => t.id === option.threadId);
      console.log("[Title Update] VERIFY - Updated thread title:", updatedThread?.title);
      console.log("[Title Update] END");
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

          // Set up listener for title generation
          cleanupRef.current = api.ai.onTitleGenerated(
            (data: { threadId: string; title: string }) => {
              if (data.threadId === threadId && data.title) {
                updateTitle(data.title);
              }
            },
          );

          // Call the IPC handler
          console.log("[Title Generation] Calling IPC generateTitle...");
          const result = await api.ai.generateTitle({
            threadId,
            message,
            chatModel: chatModel ?? appStore.getState().chatModel,
          });
          console.log("[Title Generation] IPC result:", result);

          if (result.title) {
            console.log("[Title Generation] Got title:", result.title);
            try {
              updateTitle(result.title);
              console.log("[Title Generation] updateTitle completed successfully");
            } catch (err) {
              console.error("[Title Generation] updateTitle threw error:", err);
            }
          } else if (result.error) {
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
          }
        } else {
          // Desktop mode - IPC should always be available
          console.error("[Title Generation] Electron IPC not available");
          const fallbackTitle =
            message.slice(0, 50).trim() + (message.length > 50 ? "..." : "");
          updateTitle(fallbackTitle);
        }

        console.log(
          "[Title Generation] Calling mutate('/api/thread') to refresh sidebar",
        );
        // Use revalidate: true to force a refetch from the database
        // Add a small delay to ensure the database write has completed
        setTimeout(() => {
          console.log("[Title Generation] Triggering SWR revalidation now");
          mutate("/api/thread", undefined, { revalidate: true });
        }, 500);
      } catch (error) {
        console.error("[Title Generation] Caught error:", error);
      } finally {
        // Cleanup listener
        cleanupRef.current?.();
        cleanupRef.current = null;

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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupRef.current?.();
    };
  }, []);

  return generateTitle;
}
