"use client";
import { appStore } from "@/app/store";
import { workflowToolsFetcher } from "@/lib/electron/workflow-tools-api";
import useSWR, { SWRConfiguration } from "swr";

export function useWorkflowToolList(options?: SWRConfiguration) {
  return useSWR("/api/workflow/tools", workflowToolsFetcher, {
    errorRetryCount: 0,
    revalidateOnFocus: false,
    focusThrottleInterval: 1000 * 60 * 30,
    fallbackData: [],
    onSuccess: (data) => {
      appStore.setState({ workflowToolList: data });
    },
    ...options,
  });
}
