"use client";

import { authClient } from "@/lib/auth/client";
import { useState } from "react";
import { useSWRConfig } from "swr";

export interface BookmarkItem {
  id: string;
  isBookmarked?: boolean;
}

interface UseBookmarkOptions {
  itemType?: "agent" | "workflow" | "mcp";
}

/**
 * Check if we're running in Electron mode with bookmark support
 */
function isElectronMode(): boolean {
  return (
    typeof window !== "undefined" &&
    window.electronAPI !== undefined &&
    window.electronAPI.db?.bookmark !== undefined
  );
}

export function useBookmark(options: UseBookmarkOptions = {}) {
  const { itemType = "agent" } = options;
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const { mutate } = useSWRConfig();
  const { data: session } = authClient.useSession();

  const toggleBookmark = async (item: BookmarkItem) => {
    const { id, isBookmarked = false } = item;
    const userId = session?.user?.id;

    if (loadingIds.has(id) || !userId) return;

    setLoadingIds((prev) => new Set(prev).add(id));

    try {
      let newBookmarkState: boolean;

      if (isElectronMode()) {
        // Use Electron IPC
        const result = await window.electronAPI.db.bookmark.toggle(
          userId,
          id,
          itemType,
          isBookmarked,
        );
        if (!result.success) {
          throw new Error("Failed to update bookmark");
        }
        newBookmarkState = result.isBookmarked;
      } else {
        // Fallback to HTTP (shouldn't happen in Electron-only app)
        const response = await fetch(`/api/bookmark`, {
          method: isBookmarked ? "DELETE" : "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            itemId: id,
            itemType,
          }),
        });

        if (!response.ok) {
          throw new Error("Failed to update bookmark");
        }
        newBookmarkState = !isBookmarked;
      }

      // Update all list caches with optimistic data
      // Use electron cache keys for Electron mode
      const cacheKeyPrefix = isElectronMode()
        ? `electron:${itemType}s`
        : `/api/${itemType}`;

      await mutate(
        (key) => {
          if (typeof key !== "string") return false;
          // Update list endpoints but not individual item details
          return (
            key.startsWith(cacheKeyPrefix) &&
            !key.match(new RegExp(`${cacheKeyPrefix}/[^/?]+$`))
          );
        },
        (cachedData: any) => {
          if (!cachedData) return cachedData;

          // Handle arrays of items
          if (Array.isArray(cachedData)) {
            return cachedData.map((item: any) =>
              item.id === id
                ? { ...item, isBookmarked: newBookmarkState }
                : item,
            );
          }

          // Handle single item objects
          if (cachedData.id === id) {
            return { ...cachedData, isBookmarked: newBookmarkState };
          }

          return cachedData;
        },
        { revalidate: true },
      );

      // Also update individual item cache
      const itemCacheKey = isElectronMode()
        ? `electron:${itemType}s:${id}`
        : `/api/${itemType}/${id}`;

      await mutate(
        itemCacheKey,
        (cachedData: any) => {
          if (!cachedData) return cachedData;
          return { ...cachedData, isBookmarked: newBookmarkState };
        },
        { revalidate: true },
      );

      return newBookmarkState;
    } catch (error) {
      console.error("Error toggling bookmark:", error);
      throw error;
    } finally {
      setLoadingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  return {
    toggleBookmark,
    isLoading: (itemId: string) => loadingIds.has(itemId),
  };
}
