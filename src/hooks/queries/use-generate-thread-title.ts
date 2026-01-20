"use client";

import { appStore } from "@/app/store";
import { isElectronWithIPC } from "@/lib/electron/ai-transport";
import { ChatModel } from "app-types/chat";
import { useCallback, useEffect, useRef } from "react";
import { mutate } from "swr";

export function useGenerateThreadTitle(option: {
  threadId: string;
  chatModel?: ChatModel;
}) {
  const cleanupRef = useRef<(() => void) | null>(null);

  const updateTitle = useCallback(
    (title: string) => {
      appStore.setState((prev) => {
        if (prev.threadList.some((v) => v.id !== option.threadId)) {
          return {
            threadList: [
              {
                id: option.threadId,
                title,
                userId: "",
                createdAt: new Date(),
              },
              ...prev.threadList,
            ],
          };
        }

        return {
          threadList: prev.threadList.map((v) =>
            v.id === option.threadId ? { ...v, title } : v,
          ),
        };
      });
    },
    [option.threadId],
  );

  const generateTitle = useCallback(
    async (message: string) => {
      const { threadId, chatModel } = option;
      if (appStore.getState().generatingTitleThreadIds.includes(threadId))
        return;

      appStore.setState((prev) => ({
        generatingTitleThreadIds: [...prev.generatingTitleThreadIds, threadId],
      }));

      try {
        // Use Electron IPC if available (always in Electron app)
        if (isElectronWithIPC()) {
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
          const result = await api.ai.generateTitle({
            threadId,
            message,
            chatModel: chatModel ?? appStore.getState().chatModel,
          });

          if (result.title) {
            updateTitle(result.title);
          }

          if (result.error) {
            console.error("[Title Generation] Error:", result.error);
          }
        } else {
          // Fallback to HTTP for web (shouldn't happen in Electron)
          const response = await fetch("/api/chat/title", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              message,
              threadId,
              chatModel: chatModel ?? appStore.getState().chatModel,
            }),
          });

          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }

          // Read the streaming response
          const reader = response.body?.getReader();
          if (reader) {
            let title = "";
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              title += new TextDecoder().decode(value);
            }
            if (title.trim()) {
              updateTitle(title.trim());
            }
          }
        }

        mutate("/api/thread");
      } catch (error) {
        console.error("[Title Generation] Error:", error);
      } finally {
        // Cleanup listener
        cleanupRef.current?.();
        cleanupRef.current = null;

        appStore.setState((prev) => ({
          generatingTitleThreadIds: prev.generatingTitleThreadIds.filter(
            (v) => v !== threadId,
          ),
        }));
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
