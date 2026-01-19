"use client";
import { appStore } from "@/app/store";
import { mcpFetcher } from "@/lib/electron/mcp-api";
import { MCPServerInfo } from "app-types/mcp";
import { objectFlow } from "lib/utils";
import useSWR, { SWRConfiguration } from "swr";
import { handleErrorWithToast } from "ui/shared-toast";

export function useMcpList(options?: SWRConfiguration) {
  return useSWR<MCPServerInfo[]>("/api/mcp/list", mcpFetcher, {
    revalidateOnFocus: false,
    errorRetryCount: 0,
    focusThrottleInterval: 1000 * 60 * 5,
    fallbackData: [],
    onError: handleErrorWithToast,
    onSuccess: (data) => {
      const ids = data.map((v) => v.id);
      appStore.setState((prev) => ({
        mcpList: data,
        allowedMcpServers: objectFlow(prev.allowedMcpServers || {}).filter(
          (_, key) => ids.includes(key),
        ),
      }));
    },
    ...options,
  });
}
