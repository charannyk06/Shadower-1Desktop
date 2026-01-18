"use client";

import { appStore } from "@/app/store";
import {
  ComposioApp,
  ComposioConnection,
  ComposioToolInfo,
} from "app-types/composio";
import { fetcher } from "lib/utils";
import { useMemo } from "react";
import useSWR, { SWRConfiguration } from "swr";
import { handleErrorWithToast } from "ui/shared-toast";

export function useComposioApps(options?: SWRConfiguration) {
  return useSWR<{ items: ComposioApp[]; enabled: boolean }>(
    "/api/composio/apps",
    fetcher,
    {
      revalidateOnFocus: false,
      errorRetryCount: 1,
      focusThrottleInterval: 1000 * 60 * 5,
      fallbackData: { items: [], enabled: false },
      onError: handleErrorWithToast,
      ...options,
    },
  );
}

export function useComposioConnections(options?: SWRConfiguration) {
  return useSWR<{ items: ComposioConnection[]; enabled: boolean }>(
    "/api/composio/connections",
    fetcher,
    {
      revalidateOnFocus: false,
      errorRetryCount: 1,
      focusThrottleInterval: 1000 * 60 * 5,
      fallbackData: { items: [], enabled: false },
      onError: handleErrorWithToast,
      ...options,
    },
  );
}

export function useComposioTools(appName?: string, options?: SWRConfiguration) {
  const url = appName
    ? `/api/composio/tools?app=${encodeURIComponent(appName)}`
    : "/api/composio/tools";

  return useSWR<{ items: ComposioToolInfo[]; enabled: boolean }>(url, fetcher, {
    revalidateOnFocus: false,
    errorRetryCount: 1,
    focusThrottleInterval: 1000 * 60 * 5,
    fallbackData: { items: [], enabled: false },
    onError: handleErrorWithToast,
    onSuccess: (data) => {
      if (!appName) {
        appStore.setState({
          composioToolList: data.items,
          composioEnabled: data.enabled,
        });
      }
    },
    ...options,
  });
}

export function useComposioToolsForMentions(options?: SWRConfiguration) {
  return useSWR<{ items: ComposioToolInfo[]; enabled: boolean }>(
    "/api/composio/tools",
    fetcher,
    {
      revalidateOnFocus: false,
      errorRetryCount: 1,
      focusThrottleInterval: 1000 * 60 * 5,
      fallbackData: { items: [], enabled: false },
      onError: handleErrorWithToast,
      onSuccess: (data) => {
        appStore.setState({
          composioToolList: data.items,
          composioEnabled: data.enabled,
        });
      },
      ...options,
    },
  );
}

export interface ComposioGroupedApp {
  appName: string;
  appId: string;
  displayName: string;
  logo?: string;
  description?: string;
  tools: ComposioToolInfo[];
  toolCount: number;
}

export function useComposioGroupedApps(options?: SWRConfiguration) {
  const { data: toolsData, isLoading: isToolsLoading } =
    useComposioToolsForMentions(options);
  const { data: appsData, isLoading: isAppsLoading } = useComposioApps(options);

  return useMemo(() => {
    if (!toolsData?.items || !appsData?.items) {
      return {
        items: [] as ComposioGroupedApp[],
        isLoading: isToolsLoading || isAppsLoading,
        enabled: toolsData?.enabled || false,
      };
    }

    const groupedMap = new Map<string, ComposioGroupedApp>();

    toolsData.items.forEach((tool) => {
      const appName = tool.appName || "other";
      if (!groupedMap.has(appName)) {
        const appInfo = appsData.items.find((a) => a.name === appName);
        const displayName =
          appInfo?.displayName ||
          appName.charAt(0).toUpperCase() + appName.slice(1);

        groupedMap.set(appName, {
          appName,
          appId: tool.appId,
          displayName,
          logo: appInfo?.logo,
          description: appInfo?.description || `${appName} integration`,
          tools: [],
          toolCount: 0,
        });
      }
      const group = groupedMap.get(appName)!;
      group.tools.push(tool);
      group.toolCount++;
    });

    return {
      items: Array.from(groupedMap.values()),
      isLoading: isToolsLoading || isAppsLoading,
      enabled: toolsData.enabled,
    };
  }, [toolsData, appsData, isToolsLoading, isAppsLoading]);
}
