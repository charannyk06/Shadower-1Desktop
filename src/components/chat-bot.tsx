"use client";

import { appStore } from "@/app/store";
import type { PlanTask } from "@/app/store";
import { useAutoScroll } from "@/hooks/use-auto-scroll";
import { useIsMobile } from "@/hooks/use-mobile";
import { useChat } from "@ai-sdk/react";
import clsx from "clsx";
import { clientLogger } from "lib/client-logger";
import { cn, createDebounce, generateUUID, truncateString } from "lib/utils";
import React, {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { ChatGreeting } from "./chat-greeting";
import { ErrorMessage, PreviewMessage } from "./message";
import PromptInput from "./prompt-input";
import {
  SubAgentEvent,
  isSubAgentEvent,
} from "./tool-invocation/sub-agent-view";
import type { FragmentProgressEvent } from "@/types/fragment";

import {
  TextUIPart,
  UIMessage,
  getToolName,
  isToolUIPart,
  lastAssistantMessageIsCompleteWithToolCalls,
} from "ai";
import { ElectronIPCTransport } from "@/lib/electron/ai-transport";
import { useShallow } from "zustand/shallow";

import { threadApi } from "@/lib/electron/thread-api";
import { cleanupThreadState } from "@/app/store";
import { useGenerateThreadTitle } from "@/hooks/queries/use-generate-thread-title";
import { useFileDragOverlay } from "@/hooks/use-file-drag-overlay";
import { useToRef } from "@/hooks/use-latest";
import { useMounted } from "@/hooks/use-mounted";
import { useThreadFileUploader } from "@/hooks/use-thread-file-uploader";
import {
  ChatApiSchemaRequestBody,
  ChatAttachment,
  ChatModel,
} from "app-types/chat";
import { AnimatePresence, motion } from "framer-motion";
import { getStorageManager } from "lib/browser-stroage";
import { Shortcuts, isShortcutEvent } from "lib/keyboard-shortcuts";
import { ArrowDown, FilePlus, Loader } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { mutate } from "swr";
import { safe } from "ts-safe";
import { Button } from "ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "ui/dialog";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "ui/resizable";
import { useSidebar } from "ui/sidebar";
import { Think } from "ui/think";
import { TheaterPanel } from "./theater-panel";

type Props = {
  threadId: string;
  initialMessages: Array<UIMessage>;
  selectedChatModel?: string;
};

const LightRays = React.lazy(() => import("ui/light-rays"));

const Particles = React.lazy(() => import("ui/particles"));

const debounce = createDebounce();

// Plan event types from data stream
interface PlanCreatedEvent {
  type: "data-plan-created";
  data: {
    planId: string;
    request: string;
    tasks: PlanTask[];
    status: "planning" | "executing" | "completed" | "failed";
    progress: number;
  };
}

interface TaskUpdatedEvent {
  type: "data-task-updated";
  data: {
    planId: string;
    taskId: string;
    newStatus: string;
    taskDescription?: string;
    tasks: PlanTask[];
    progress: number;
    planStatus: "planning" | "executing" | "completed" | "failed";
  };
}

type PlanEvent = PlanCreatedEvent | TaskUpdatedEvent;

function isPlanEvent(event: { type: string }): event is PlanEvent {
  return (
    event.type === "data-plan-created" || event.type === "data-task-updated"
  );
}

// Context management event types from data stream (using data- prefix)
interface ContextUsageUpdateEvent {
  type: "data-context-usage-update";
  data: {
    usedTokens: number;
    limit: number;
    percentage: number;
    remaining: number;
  };
}

interface ContextCompactionEvent {
  type: "data-context-compaction";
  data: {
    compactedCount: number;
    tokensSaved: number;
    oldUsage?: {
      usedTokens: number;
      percentage: number;
    };
    newUsage: {
      usedTokens: number;
      limit: number;
      percentage: number;
      remaining?: number;
    };
  };
}

type ContextEvent = ContextUsageUpdateEvent | ContextCompactionEvent;

function isCollaboraOpenEvent(event: {
  type: string;
  data?: unknown;
}): event is {
  type: "collabora-open";
  data: {
    editorUrl: string;
    fileUrl: string;
    fileName: string;
    documentType: string;
  };
} {
  return event.type === "collabora-open";
}

function isContextEvent(event: { type: string }): event is ContextEvent {
  return (
    event.type === "data-context-usage-update" ||
    event.type === "data-context-compaction"
  );
}

function isFragmentProgressEvent(event: {
  type: string;
}): event is { type: "data-fragment-progress"; data: FragmentProgressEvent } {
  return event.type === "data-fragment-progress";
}

function handleFragmentProgressEvent(
  event: { type: "data-fragment-progress"; data: FragmentProgressEvent },
  _setMessages: React.Dispatch<React.SetStateAction<UIMessage[]>>,
): void {
  const { data } = event;

  // Debug logging
  console.log("[FragmentProgress] Received event:", {
    stage: data.stage,
    message: data.message,
    hasOperation: !!data.operation,
    operationType: data.operation?.type,
    operationsCount: data.operations?.length || 0,
    workspaceFilesCount: data.workspaceFiles?.length || 0,
    toolCallId: data.toolCallId,
  });

  // Update app store with fragment progress
  // Use toolCallId if available, otherwise use 'current'
  // NOTE: The AI SDK should provide toolCallId automatically, but if not, we use 'current'
  const progressKey = data.toolCallId || "current";

  appStore.getState().mutate((state) => {
    const existingProgress = state.fragmentProgress[progressKey];
    const operations = existingProgress?.operations || [];
    const existingWorkspaceFiles = existingProgress?.workspaceFiles || [];

    // Add current operation to history if it exists
    if (data.operation) {
      // Always add new operations - don't deduplicate
      // Operations are unique by timestamp, so we can have multiple of the same type
      // If status changed from "running" to "success", update the last matching one
      if (
        data.operation.status === "success" ||
        data.operation.status === "error"
      ) {
        // Find the last "running" operation of the same type and update it
        // Work backwards through the array to find the last matching operation
        let lastRunningIndex = -1;
        for (let i = operations.length - 1; i >= 0; i--) {
          const op = operations[i];
          if (
            op.type === data.operation?.type &&
            op.status === "running" &&
            (!data.operation.command ||
              op.command === data.operation.command) &&
            (!data.operation.filePath ||
              op.filePath === data.operation.filePath)
          ) {
            lastRunningIndex = i;
            break;
          }
        }

        if (lastRunningIndex >= 0) {
          // Update existing running operation
          operations[lastRunningIndex] = data.operation;
        } else {
          // Add as new operation
          operations.push(data.operation);
        }
      } else {
        // For "running" status, always add as new operation
        operations.push(data.operation);
      }

      // Keep only last 100 operations to prevent memory issues
      if (operations.length > 100) {
        operations.shift();
      }
    }

    // Also merge operations from data.operations if provided (for bulk updates)
    if (data.operations && Array.isArray(data.operations)) {
      // Merge new operations, avoiding duplicates by timestamp
      const existingTimestamps = new Set(operations.map((op) => op.timestamp));
      const newOperations = data.operations.filter(
        (op) => !existingTimestamps.has(op.timestamp),
      );
      operations.push(...newOperations);

      // Sort by timestamp
      operations.sort((a, b) => a.timestamp - b.timestamp);

      // Keep only last 100
      if (operations.length > 100) {
        operations.splice(0, operations.length - 100);
      }
    }

    // Merge workspace files - don't overwrite, accumulate
    let workspaceFiles = [...existingWorkspaceFiles];
    if (data.workspaceFiles && Array.isArray(data.workspaceFiles)) {
      // Merge new files, avoiding duplicates by path
      const existingPaths = new Set(existingWorkspaceFiles.map((f) => f.path));
      const newFiles = data.workspaceFiles.filter(
        (f) => !existingPaths.has(f.path),
      );
      workspaceFiles = [...workspaceFiles, ...newFiles];

      // Also update existing files if content changed
      for (const newFile of data.workspaceFiles) {
        const existingIndex = workspaceFiles.findIndex(
          (f) => f.path === newFile.path,
        );
        if (existingIndex >= 0) {
          // Update existing file with new content
          workspaceFiles[existingIndex] = newFile;
        }
      }

      console.log(
        `[FragmentProgress] Workspace files updated: ${workspaceFiles.length} total`,
        {
          existing: existingWorkspaceFiles.length,
          new: data.workspaceFiles.length,
          paths: workspaceFiles.map((f) => f.path),
        },
      );
    }

    return {
      fragmentProgress: {
        ...state.fragmentProgress,
        [progressKey]: {
          stage: data.stage,
          message: data.message,
          template: data.template,
          fragmentId: data.fragmentId,
          previewUrl: data.previewUrl,
          error: data.error,
          codeChunk: data.codeChunk,
          codeLength: data.codeLength,
          generatedCode: data.generatedCode || existingProgress?.generatedCode,
          timestamp: Date.now(),
          operation: data.operation,
          operations: operations,
          workspaceFiles: workspaceFiles, // Use merged files
        },
      },
    };
  });
}

const firstTimeStorage = getStorageManager("IS_FIRST");
const isFirstTime = firstTimeStorage.get() ?? true;
firstTimeStorage.set(false);

// Helper functions to reduce cognitive complexity
function shouldSkipPlanReconstruction(
  hasReconstructed: boolean,
  existingPlan: any,
): boolean {
  if (hasReconstructed || existingPlan) {
    if (existingPlan && existingPlan.tasks.length > 0) {
      clientLogger.info("[Plan Reconstruction] Using persisted plan state", {
        planId: existingPlan.planId,
        completed: existingPlan.tasks.filter(
          (t: any) => t.status === "completed",
        ).length,
        total: existingPlan.tasks.length,
      });
      return true;
    }
  }
  return false;
}

function collectTaskDefinitions(messages: UIMessage[]): {
  planId: string | undefined;
  request: string | undefined;
  taskDefinitions: Map<string, { description: string; assignedAgent?: string }>;
  statusUpdates: Map<string, PlanTask["status"]>;
} {
  let planId: string | undefined;
  let request: string | undefined;
  const taskDefinitions = new Map<
    string,
    { description: string; assignedAgent?: string }
  >();
  const statusUpdates = new Map<string, PlanTask["status"]>();

  for (const m of messages) {
    for (const p of m.parts) {
      if (!isToolUIPart(p)) continue;

      const output = p.output as Record<string, any> | undefined;
      const toolName = getToolName(p);

      clientLogger.debug("[Plan Reconstruction] Found tool", {
        toolName,
        hasOutput: !!output,
        state: (p as any).state,
      });

      if (!output) continue;

      if (toolName === "createPlan" && output.planId) {
        clientLogger.info("[Plan Reconstruction] createPlan found", {
          planId: output.planId,
          taskCount: output.tasks?.length,
        });
        planId = output.planId;
        request = (p.input as any)?.request || request || "";
        if (output.tasks) {
          for (const t of output.tasks) {
            taskDefinitions.set(t.id, {
              description: t.description,
              assignedAgent: t.assignedAgent,
            });
            if (!statusUpdates.has(t.id)) {
              statusUpdates.set(t.id, t.status || "pending");
            }
          }
        }
      }

      if (toolName === "updateTaskStatus") {
        clientLogger.debug("[Plan Reconstruction] updateTaskStatus found", {
          taskId: output.taskId,
          newStatus: output.newStatus,
        });
        if (output.taskId && output.newStatus) {
          statusUpdates.set(output.taskId, output.newStatus);
        }
      }
    }
  }

  return { planId, request, taskDefinitions, statusUpdates };
}

function buildFinalTasks(
  taskDefinitions: Map<string, { description: string; assignedAgent?: string }>,
  statusUpdates: Map<string, PlanTask["status"]>,
  persistedPlan: any,
  planId: string,
): PlanTask[] {
  const tasks: PlanTask[] = [];
  const persistedTasksMap =
    persistedPlan?.planId === planId
      ? new Map(persistedPlan.tasks.map((t) => [t.id, t]))
      : new Map();

  for (const [id, def] of taskDefinitions) {
    const persistedTask = persistedTasksMap.get(id);
    const status = persistedTask?.status || statusUpdates.get(id) || "pending";

    tasks.push({
      id,
      description: def.description,
      status,
      assignedAgent: def.assignedAgent || persistedTask?.assignedAgent,
    });
  }

  return tasks;
}

function calculatePlanProgress(tasks: PlanTask[]): {
  progress: number;
  allDone: boolean;
} {
  const completedCount = tasks.filter((t) => t.status === "completed").length;
  const progress = Math.round((completedCount / tasks.length) * 100);
  const allDone = completedCount === tasks.length;
  return { progress, allDone };
}

// Helper functions to reduce cognitive complexity of onData handler
function createEventWithTimestamp(dataPart: SubAgentEvent): SubAgentEvent {
  return {
    ...dataPart,
    data: {
      ...dataPart.data,
      timestamp: dataPart.data.timestamp || Date.now(),
    },
  };
}

function checkPartExists(
  msg: UIMessage,
  eventWithTimestamp: SubAgentEvent,
): boolean {
  return msg.parts.some((p: any) => {
    if (p.type !== eventWithTimestamp.type) return false;
    if (p.data?.agentId !== eventWithTimestamp.data?.agentId) return false;

    // For tool calls, check toolName and args too
    if (eventWithTimestamp.type === "data-sub-agent-tool-call") {
      return (
        p.data?.toolName === eventWithTimestamp.data?.toolName &&
        p.data?.timestamp === eventWithTimestamp.data?.timestamp
      );
    }

    // For other events, check timestamp
    return p.data?.timestamp === eventWithTimestamp.data?.timestamp;
  });
}

function appendSubAgentEventToMessage(
  msg: UIMessage,
  eventWithTimestamp: SubAgentEvent,
): UIMessage {
  const newParts = [
    ...msg.parts,
    {
      type: eventWithTimestamp.type,
      data: eventWithTimestamp.data,
    } as any,
  ];

  return {
    ...msg,
    parts: newParts,
  };
}

function handleSubAgentEvent(
  dataPart: SubAgentEvent,
  setSubAgentEvents: React.Dispatch<React.SetStateAction<SubAgentEvent[]>>,
  setMessages: React.Dispatch<React.SetStateAction<UIMessage[]>>,
): void {
  setSubAgentEvents((prev) => [...prev, dataPart]);

  setMessages((prev) => {
    const lastMessage = prev[prev.length - 1];
    if (!lastMessage || lastMessage.role !== "assistant") {
      return prev;
    }

    const eventWithTimestamp = createEventWithTimestamp(dataPart);

    if (checkPartExists(lastMessage, eventWithTimestamp)) {
      clientLogger.debug("[ChatBot] Duplicate sub-agent event skipped", {
        type: eventWithTimestamp.type,
        agentId: eventWithTimestamp.data?.agentId,
      });
      return prev;
    }

    return prev.map((msg, idx) => {
      if (idx === prev.length - 1) {
        return appendSubAgentEventToMessage(msg, eventWithTimestamp);
      }
      return msg;
    });
  });
}

function handlePlanCreatedEvent(
  event: PlanCreatedEvent,
  threadId: string,
): void {
  appStore.getState().mutate((state) => ({
    threadPlans: {
      ...state.threadPlans,
      [threadId]: {
        planId: event.data.planId,
        request: event.data.request,
        tasks: event.data.tasks,
        status: event.data.status,
        progress: event.data.progress,
      },
    },
  }));
}

function handleTaskUpdatedEvent(
  event: TaskUpdatedEvent,
  threadId: string,
): void {
  appStore.getState().mutate((state) => {
    const existingPlan = state.threadPlans[threadId];
    if (!existingPlan) {
      return state;
    }

    return {
      threadPlans: {
        ...state.threadPlans,
        [threadId]: {
          ...existingPlan,
          tasks: event.data.tasks,
          progress: event.data.progress,
          status: event.data.planStatus,
        },
      },
    };
  });
}

function handlePlanEvent(dataPart: PlanEvent, threadId: string): void {
  if (dataPart.type === "data-plan-created") {
    handlePlanCreatedEvent(dataPart, threadId);
  } else if (dataPart.type === "data-task-updated") {
    handleTaskUpdatedEvent(dataPart, threadId);
  }
}

// Context event handlers
function handleContextUsageUpdate(
  event: ContextUsageUpdateEvent,
  threadId: string,
): void {
  const eventData = event.data as any;

  // Always log to see if events are being received
  console.log("[Context] Usage update received", {
    threadId,
    usedTokens: event.data.usedTokens,
    limit: event.data.limit,
    percentage: (event.data.percentage * 100).toFixed(1) + "%",
    provider: eventData.provider,
    model: eventData.model,
  });

  // Update context usage state - CRITICAL: Use appStore.set directly to ensure subscriptions trigger
  // Create completely new object references to ensure Zustand detects the change
  // IMPORTANT: Create a NEW object reference every time, even if values are the same
  appStore.setState((state) => {
    const currentUsage = state.threadContextUsage[threadId];

    // Only update if values actually changed to avoid unnecessary re-renders
    // But always create a new object reference to ensure Zustand detects the change
    const newUsage = {
      usedTokens: event.data.usedTokens,
      limit: event.data.limit,
      percentage: event.data.percentage,
      remaining: event.data.remaining,
      provider: eventData.provider,
      model: eventData.model,
      // Preserve lastCompaction if it exists
      lastCompaction: currentUsage?.lastCompaction,
    };

    // Always create a new object reference, even if values are the same
    // This ensures Zustand's shallow equality check detects the change
    const newThreadContextUsage = {
      ...state.threadContextUsage,
    };
    // Force new object reference by creating a new object
    newThreadContextUsage[threadId] = { ...newUsage };

    console.log("[Context] Updating store", {
      threadId,
      oldUsedTokens: currentUsage?.usedTokens,
      newUsedTokens: newUsage.usedTokens,
      oldPercentage: currentUsage
        ? (currentUsage.percentage * 100).toFixed(2) + "%"
        : "N/A",
      newPercentage: (newUsage.percentage * 100).toFixed(2) + "%",
      willTriggerRerender: true,
      objectReferenceChanged: currentUsage !== newUsage,
    });

    return {
      threadContextUsage: newThreadContextUsage,
    };
  });
}

function handleContextCompaction(
  event: ContextCompactionEvent,
  threadId: string,
  setMessages?: React.Dispatch<React.SetStateAction<UIMessage[]>>,
): void {
  const oldUsage = appStore.getState().threadContextUsage[threadId];
  const oldPercentage =
    oldUsage?.percentage ?? event.data.oldUsage?.percentage ?? 0;
  const newUsage = {
    usedTokens: event.data.newUsage.usedTokens,
    limit: event.data.newUsage.limit,
    percentage: event.data.newUsage.percentage,
    remaining:
      event.data.newUsage.remaining ??
      event.data.newUsage.limit - event.data.newUsage.usedTokens,
  };

  console.log("[Context] Compaction event received - RESETTING INDICATOR", {
    threadId,
    compactedCount: event.data.compactedCount,
    tokensSaved: event.data.tokensSaved,
    oldPercentage: (oldPercentage * 100).toFixed(1) + "%",
    newPercentage: (newUsage.percentage * 100).toFixed(1) + "%",
  });

  // Add visible compaction status message to chat
  if (setMessages) {
    const tokensSavedFormatted =
      event.data.tokensSaved >= 1000
        ? `${(event.data.tokensSaved / 1000).toFixed(1)}k`
        : String(event.data.tokensSaved);

    const compactionMessage: UIMessage = {
      id: `compaction-${Date.now()}`,
      role: "assistant",
      parts: [
        {
          type: "text",
          text:
            `🔄 **Context Compressed**\n\n` +
            `- Compacted **${event.data.compactedCount}** messages\n` +
            `- Saved **${tokensSavedFormatted}** tokens\n` +
            `- Context usage: **${(oldPercentage * 100).toFixed(1)}%** → **${(newUsage.percentage * 100).toFixed(1)}%**\n\n` +
            `*Context indicator has been reset with the new compressed context.*`,
        },
      ],
    };

    setMessages((prev) => {
      // Add compaction message before the last assistant message (if exists) or at the end
      const lastIndex = prev.length - 1;
      if (lastIndex >= 0 && prev[lastIndex].role === "assistant") {
        return [
          ...prev.slice(0, lastIndex),
          compactionMessage,
          prev[lastIndex],
        ];
      }
      return [...prev, compactionMessage];
    });
  }

  // CRITICAL: Force update by creating completely new object references
  appStore.setState((state) => {
    const newThreadContextUsage = {
      ...state.threadContextUsage,
    };

    // Create completely new usage object to force re-render
    newThreadContextUsage[threadId] = {
      usedTokens: newUsage.usedTokens,
      limit: newUsage.limit,
      percentage: newUsage.percentage,
      remaining: newUsage.remaining,
      provider: state.threadContextUsage[threadId]?.provider,
      model: state.threadContextUsage[threadId]?.model,
      lastCompaction: {
        compactedCount: event.data.compactedCount,
        tokensSaved: event.data.tokensSaved,
        timestamp: Date.now(),
      },
    };

    return {
      threadContextUsage: newThreadContextUsage,
    };
  });

  // Log compaction for visibility
  clientLogger.info("[Context] Compaction completed - indicator reset", {
    threadId,
    compactedCount: event.data.compactedCount,
    tokensSaved: event.data.tokensSaved,
    oldPercentage: (oldPercentage * 100).toFixed(1) + "%",
    newPercentage: (newUsage.percentage * 100).toFixed(1) + "%",
  });

  // Show toast notification to user
  const tokensSavedFormatted =
    event.data.tokensSaved >= 1000
      ? `${(event.data.tokensSaved / 1000).toFixed(1)}k`
      : String(event.data.tokensSaved);

  toast.success("Context Compressed", {
    description: `Compressed ${event.data.compactedCount} messages, saved ${tokensSavedFormatted} tokens. Context usage reset to ${(newUsage.percentage * 100).toFixed(1)}%`,
    duration: 5000,
  });
}

function handleContextEvent(
  dataPart: ContextEvent,
  threadId: string,
  setMessages?: React.Dispatch<React.SetStateAction<UIMessage[]>>,
): void {
  if (dataPart.type === "data-context-usage-update") {
    handleContextUsageUpdate(dataPart, threadId);
  } else if (dataPart.type === "data-context-compaction") {
    handleContextCompaction(dataPart, threadId, setMessages);
  }
}

export default function ChatBot({ threadId, initialMessages }: Props) {
  const { uploadFiles } = useThreadFileUploader(threadId);
  const handleFileDrop = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      await uploadFiles(files);
    },
    [uploadFiles],
  );
  const { isDragging } = useFileDragOverlay({
    onDropFiles: handleFileDrop,
  });

  const [
    appStoreMutate,
    model,
    toolChoice,
    allowedAppDefaultToolkit,
    allowedMcpServers,
    threadList,
    threadMentions,
    pendingThreadMention,
    threadImageToolModel,
  ] = appStore(
    useShallow((state) => [
      state.mutate,
      state.chatModel,
      state.toolChoice,
      state.allowedAppDefaultToolkit,
      state.allowedMcpServers,
      state.threadList,
      state.threadMentions,
      state.pendingThreadMention,
      state.threadImageToolModel,
    ]),
  );

  const generateTitle = useGenerateThreadTitle({
    threadId,
  });

  const [showParticles, setShowParticles] = useState(isFirstTime);

  const onFinish = useCallback(() => {
    const messages = latestRef.current.messages;
    const prevThread = latestRef.current.threadList.find(
      (v) => v.id === threadId,
    );
    const isNewThread =
      !prevThread?.title &&
      messages.filter((v) => v.role === "user" || v.role === "assistant")
        .length < 3;
    if (isNewThread) {
      const part = messages
        .slice(0, 2)
        .flatMap((m) =>
          m.parts
            .filter((v) => v.type === "text")
            .map(
              (p) =>
                `${m.role}: ${truncateString((p as TextUIPart).text, 500)}`,
            ),
        );
      if (part.length > 0) {
        generateTitle(part.join("\n\n"));
      }
    } else if (latestRef.current.threadList[0]?.id !== threadId) {
      mutate("/api/thread");
    }

    // DON'T navigate here - it causes a remount and loses the streaming messages.
    // The URL will remain at "/" but that's OK - the messages are saved to DB
    // by the main process, and when the user clicks on the thread in sidebar
    // or refreshes, they'll see the saved conversation.
    //
    // The thread title will be generated and the thread will appear in sidebar
    // automatically via the IPC event.
  }, [threadId]);

  const [input, setInput] = useState("");

  // Track sub-agent events from the data stream for real-time UI updates
  // These will be integrated into the message stream as parts
  const [subAgentEvents, setSubAgentEvents] = useState<SubAgentEvent[]>([]);

  const {
    messages,
    status,
    setMessages,
    addToolResult: _addToolResult,
    error,
    sendMessage,
    stop,
  } = useChat({
    id: threadId,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onError: (error) => {
      console.error("[ChatBot] useChat error:", error);
      console.error("[ChatBot] useChat error stack:", error?.stack);
    },
    onData: (data) => {
      console.log("[ChatBot] useChat onData callback triggered:", data);
    },
    onFinish: (message) => {
      console.log("[ChatBot] useChat onFinish:", message);
      onFinish();
    },
    transport: new ElectronIPCTransport({
      prepareSendMessagesRequest: ({ messages, body, id }) => {
        // NOTE: Do NOT update URL here with replaceState!
        // TanStack Router detects URL changes and re-routes, causing the component
        // to remount and lose the streaming state. URL is updated in onFinish instead.
        const lastMessage = messages.at(-1)!;
        // Filter out UI-only parts (e.g., source-url) so the model doesn't receive unknown parts
        const attachments: ChatAttachment[] = lastMessage.parts.reduce(
          (acc: ChatAttachment[], part: any) => {
            if (part?.type === "file") {
              acc.push({
                type: "file",
                url: part.url,
                mediaType: part.mediaType,
                filename: part.filename,
              });
            } else if (part?.type === "source-url") {
              acc.push({
                type: "source-url",
                url: part.url,
                mediaType: part.mediaType,
                filename: part.title,
              });
            }
            return acc;
          },
          [],
        );

        const sanitizedLastMessage = {
          ...lastMessage,
          parts: lastMessage.parts.filter((p: any) => p?.type !== "source-url"),
        } as typeof lastMessage;
        const _hasFilePart = lastMessage.parts?.some(
          (p) => (p as any)?.type === "file",
        );

        const requestBody: ChatApiSchemaRequestBody = {
          ...body,
          id,
          chatModel:
            (body as { model: ChatModel })?.model ?? latestRef.current.model,
          toolChoice: latestRef.current.toolChoice,
          allowedAppDefaultToolkit: latestRef.current.allowedAppDefaultToolkit,
          allowedMcpServers: latestRef.current.mentions?.length
            ? {}
            : latestRef.current.allowedMcpServers,
          mentions: latestRef.current.mentions,
          message: sanitizedLastMessage,
          imageTool: {
            model: latestRef.current.threadImageToolModel[threadId],
          },
          attachments,
        };
        return { body: requestBody };
      },
    }),
    messages: initialMessages,
    generateId: generateUUID,
    experimental_throttle: 100,
    onFinish,
    // Handle custom data stream events (sub-agent and plan updates)
    onData: (dataPart) => {
      if (isSubAgentEvent(dataPart)) {
        handleSubAgentEvent(dataPart, setSubAgentEvents, setMessages);
      } else if (isPlanEvent(dataPart)) {
        handlePlanEvent(dataPart, threadId);
      } else if (isContextEvent(dataPart)) {
        handleContextEvent(dataPart, threadId, setMessages);
      } else if (isFragmentProgressEvent(dataPart)) {
        handleFragmentProgressEvent(dataPart, setMessages);
      } else if (
        isCollaboraOpenEvent(dataPart as { type: string; data?: unknown })
      ) {
        // Open Collabora editor in theater panel
        const collaboraData = (
          dataPart as {
            data: {
              editorUrl: string;
              fileUrl: string;
              fileName: string;
              documentType: string;
            };
          }
        ).data;
        const { editorUrl, fileUrl, fileName, documentType } = collaboraData;
        const mimeType =
          documentType === "presentation"
            ? "application/vnd.openxmlformats-officedocument.presentationml.presentation"
            : documentType === "spreadsheet"
              ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

        appStoreMutate((state) => ({
          theaterMode: {
            ...state.theaterMode,
            isOpen: true,
            type: "office",
            title: fileName,
            urlContent: fileUrl,
            editorUrl: editorUrl,
            fileMetadata: {
              name: fileName,
              storageKey: fileUrl, // Use URL as storage key for now
              url: fileUrl,
              type: mimeType,
            },
          },
        }));
      }
    },
  });

  // DEBUG: Track when messages and status change
  useEffect(() => {
    const lastMsg = messages.at(-1);
    console.log("[ChatBot] DEBUG messages changed:", {
      count: messages.length,
      status,
      lastMsgRole: lastMsg?.role,
      lastMsgId: lastMsg?.id,
      lastMsgPartsCount: lastMsg?.parts.length,
      lastMsgParts: lastMsg?.parts.slice(0, 3).map((p: any) => ({
        type: p.type,
        textLength: p.type === "text" ? p.text?.length : undefined,
      })),
    });
  }, [messages, status]);

  // Set currentThreadId synchronously on mount/thread change
  // Using useLayoutEffect ensures child components (like sandbox executors) have access
  // to the threadId before their effects run - critical for sandbox file persistence
  useLayoutEffect(() => {
    clientLogger.debug("[ChatBot] Setting currentThreadId", { threadId });
    appStoreMutate((state) => {
      const prevThreadId = state.currentThreadId;
      const threadChanged = prevThreadId && prevThreadId !== threadId;

      // When switching threads, reset non-thread-scoped theater mode state
      // This prevents showing content from a different thread
      if (threadChanged) {
        clientLogger.info(
          "[ChatBot] Thread changed, resetting theater mode content",
          {
            prevThreadId,
            newThreadId: threadId,
          },
        );
        return {
          currentThreadId: threadId,
          theaterMode: {
            ...state.theaterMode,
            // Reset non-thread-scoped content when switching threads
            content: undefined,
            type: undefined,
            title: undefined,
            executionArtifacts: undefined,
            // Keep isOpen but reset to files tab if it was showing content
            defaultTab: state.theaterMode.isOpen ? "files" : undefined,
          },
        };
      }

      return { currentThreadId: threadId };
    });
  }, [threadId]);

  // Clear sub-agent events when streaming completes
  useEffect(() => {
    if (status === "ready" && subAgentEvents.length > 0) {
      // Clear events after a short delay to let the final state show
      const timer = setTimeout(() => {
        setSubAgentEvents([]);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [status, subAgentEvents.length]);

  // Auto-complete in-progress tasks when streaming ends
  // This handles the case where the agent finished work but forgot to call updateTaskStatus
  useEffect(() => {
    if (status === "ready") {
      const currentPlan = appStore.getState().threadPlans[threadId];
      if (currentPlan && currentPlan.status !== "completed") {
        const hasInProgress = currentPlan.tasks.some(
          (t) => t.status === "in-progress",
        );
        const hasPending = currentPlan.tasks.some(
          (t) => t.status === "pending",
        );

        // If there are in-progress tasks but no pending tasks, mark them complete
        if (hasInProgress && !hasPending) {
          const updatedTasks = currentPlan.tasks.map((t) =>
            t.status === "in-progress"
              ? { ...t, status: "completed" as const }
              : t,
          );
          const completedCount = updatedTasks.filter(
            (t) => t.status === "completed",
          ).length;

          appStore.getState().mutate((state) => ({
            threadPlans: {
              ...state.threadPlans,
              [threadId]: {
                ...currentPlan,
                tasks: updatedTasks,
                progress: Math.round(
                  (completedCount / updatedTasks.length) * 100,
                ),
                status:
                  completedCount === updatedTasks.length
                    ? "completed"
                    : currentPlan.status,
              },
            },
          }));
        }
      }
    }
  }, [status, threadId]);

  // Reconstruct plan state from messages on mount (handles page refresh)
  // Uses two-pass approach to handle multiple createPlan calls correctly
  const hasReconstructedRef = useRef(false);
  useEffect(() => {
    const existingPlan = appStore.getState().threadPlans[threadId];
    if (
      shouldSkipPlanReconstruction(hasReconstructedRef.current, existingPlan)
    ) {
      return;
    }

    hasReconstructedRef.current = true;

    clientLogger.info(
      "[Plan Reconstruction] Starting reconstruction for thread",
      { threadId },
    );
    clientLogger.debug("[Plan Reconstruction] Initial messages count", {
      count: initialMessages.length,
    });

    const { planId, request, taskDefinitions, statusUpdates } =
      collectTaskDefinitions(initialMessages);

    clientLogger.info("[Plan Reconstruction] Results", {
      planId,
      taskDefinitionsCount: taskDefinitions.size,
      statusUpdatesCount: statusUpdates.size,
      statusUpdates: Object.fromEntries(statusUpdates),
    });

    const persistedPlan = appStore.getState().threadPlans[threadId];
    if (planId && taskDefinitions.size > 0) {
      const tasks = buildFinalTasks(
        taskDefinitions,
        statusUpdates,
        persistedPlan,
        planId,
      );

      const { progress, allDone } = calculatePlanProgress(tasks);

      clientLogger.info("[Plan Reconstruction] Final plan state", {
        planId,
        tasks: tasks.map((t) => ({ id: t.id, status: t.status })),
        progress,
        allDone,
        usedPersistedState: persistedPlan?.planId === planId,
      });

      appStore.getState().mutate((state) => ({
        threadPlans: {
          ...state.threadPlans,
          [threadId]: {
            planId,
            request: request || persistedPlan?.request || "",
            tasks,
            status:
              persistedPlan?.status || (allDone ? "completed" : "executing"),
            progress: persistedPlan?.progress || progress,
          },
        },
      }));
    } else {
      clientLogger.debug("[Plan Reconstruction] No plan found to reconstruct", {
        threadId,
      });
    }
  }, [threadId, initialMessages]);

  // Aggregate ALL artifacts from the entire conversation history
  // Only include actual file artifacts from sandbox/code execution, not web search results
  const allArtifacts = useMemo(() => {
    const extracted: any[] = [];

    // Tools that produce file artifacts
    const artifactProducingTools = new Set([
      "sandbox",
      "code",
      "execute_code",
      "run_code",
      "runCode",
      "python",
      "javascript",
      "create_pie_chart",
      "create_bar_chart",
      "create_line_chart",
      "create_table",
      "createPieChart",
      "createBarChart",
      "createLineChart",
      "createTable",
    ]);

    messages.forEach((m) => {
      m.parts.forEach((p) => {
        // Use AI SDK v6 pattern - tool parts have type like "tool-{name}"
        if (!isToolUIPart(p)) return;

        // Get tool name from the part type (format: "tool-{toolName}")
        const toolName = p.type.replace("tool-", "");

        // Skip tools that don't produce file artifacts (like web search)
        if (!artifactProducingTools.has(toolName)) {
          return;
        }

        // In v6, output is directly on the part - cast to any for flexible access
        const result = p.output as Record<string, any> | any[] | undefined;
        const hasData = !!result;

        // In v6, completed states start with "output"
        if (!hasData && !p.state.startsWith("output")) return;

        if (!result) return;

        let items: any[] = [];

        // Case 1: Result is the array of artifacts itself
        if (Array.isArray(result)) {
          items = result;
        }
        // Case 2: Result is wrapped in 'results' property (sandbox execution pattern)
        else if (result.results && Array.isArray(result.results)) {
          items = result.results;
        }
        // Case 3: Result is wrapped in 'artifacts' property
        else if (result.artifacts && Array.isArray(result.artifacts)) {
          items = result.artifacts;
        }
        // Case 4: Result has a 'data' property that's an array (for charts)
        else if (result.data && Array.isArray(result.data)) {
          items = result.data;
        }

        // Filter and add valid file artifacts only
        // Must have filename OR be a media type (image, chart, etc.)
        items.forEach((item) => {
          if (item && typeof item === "object") {
            // Valid artifact must have filename OR be media content
            const hasFilename = !!item.filename;
            const isMediaArtifact = !!(
              item.mediaType ||
              (item.type &&
                ["image", "chart", "file", "pdf"].includes(item.type))
            );
            const hasBase64Data = !!(item.data && item.mediaType);

            if (hasFilename || isMediaArtifact || hasBase64Data) {
              extracted.push(item);
            }
          }
        });
      });
    });

    return extracted;
  }, [messages]);

  // Sync artifacts to thread-scoped store for TheaterPanel
  // This ensures all artifacts from the conversation are always available in workspace files
  useEffect(() => {
    // Always sync artifacts from message history to ensure they're available in the workspace files view
    appStoreMutate((state) => {
      const threadArtifacts = state.theaterMode.threadArtifacts || {};
      const currentThreadArtifacts = threadArtifacts[threadId] || [];

      // Create a deduplication map using multiple possible keys
      const createKey = (a: any) => {
        // Try filename first (most reliable)
        if (a.filename) return `filename:${a.filename}`;
        if (a.id) return `id:${a.id}`;
        if (a.url) return `url:${a.url}`;
        if (a.name) return `name:${a.name}`;
        if (a.title) return `title:${a.title}`;
        // Fallback to content hash for deduplication
        if (a.content)
          return `content:${typeof a.content === "string" ? a.content.substring(0, 50) : JSON.stringify(a.content).substring(0, 50)}`;
        return null;
      };

      const historyMap = new Map<string, any>();
      allArtifacts.forEach((a) => {
        const key = createKey(a);
        if (key) {
          historyMap.set(key, a);
        }
      });

      // Keep ALL real-time artifacts - they're the source of truth for current session
      // Only exclude if we have an exact match in history (same filename/url)
      const realtimeMap = new Map<string, any>();
      currentThreadArtifacts.forEach((a) => {
        const key = createKey(a);
        if (key && !historyMap.has(key)) {
          realtimeMap.set(key, a);
        } else if (!key) {
          // Include artifacts without keys (they might be unique)
          realtimeMap.set(`realtime-${realtimeMap.size}`, a);
        }
      });

      // Merge: real-time artifacts first (they're most current), then history ones not in real-time
      // This ensures we don't lose artifacts that were added in real-time but not yet saved to messages
      const merged = [
        ...Array.from(realtimeMap.values()),
        ...Array.from(historyMap.values()),
      ];

      // Always update to ensure artifacts are synced
      return {
        theaterMode: {
          ...state.theaterMode,
          threadArtifacts: {
            ...threadArtifacts,
            [threadId]: merged,
          },
        },
      };
    });
  }, [allArtifacts, appStoreMutate, threadId, messages.length]);

  const [isDeleteThreadPopupOpen, setIsDeleteThreadPopupOpen] = useState(false);

  const addToolResult = useCallback(
    async (result: Parameters<typeof _addToolResult>[0]) => {
      // 1. Update local state
      await _addToolResult(result);

      // 2. Persist to DB immediately without triggering LLM or Scroll
      // We need the *latest* message from the ref because _addToolResult updates internal state
      // but 'messages' here might be stale in this closure if not for the await above (which is void anyway).
      // However, _addToolResult updates the 'messages' used by 'useChat'.
      // The safest way is to construct the message we expect to be there.
      // Actually, 'result' tells us which tool call it matches.
      // But simpler: just grab the latest assistant message from the ref (which we have via useToRef)
      // AFTER a small tick, or trust that _addToolResult accepts the result.

      // Wait for next tick for state to update in latestRef
      setTimeout(async () => {
        const latestMessages = latestRef.current.messages;
        const lastMessage = latestMessages.at(-1);
        if (lastMessage?.role === "assistant") {
          // We need to save this message because it now contains the tool result
          await threadApi.upsertMessage(lastMessage, threadId);
        }
      }, 0);
    },
    [_addToolResult, threadId], // Removed sendMessage
  );

  const mounted = useMounted();

  const latestRef = useToRef({
    toolChoice,
    model,
    allowedAppDefaultToolkit,
    allowedMcpServers,
    messages,
    threadList,
    threadId,
    mentions: threadMentions[threadId],
    threadImageToolModel,
  });

  const isLoading = useMemo(
    () => status === "streaming" || status === "submitted",
    [status],
  );

  const emptyMessage = useMemo(
    () => messages.length === 0 && !error,
    [messages.length, error],
  );

  const isInitialThreadEntry = useMemo(
    () =>
      initialMessages.length > 0 &&
      initialMessages.at(-1)?.id === messages.at(-1)?.id,
    [messages],
  );

  const isPendingToolCall = useMemo(() => {
    if (status != "ready") return false;
    const lastMessage = messages.at(-1);
    if (lastMessage?.role != "assistant") return false;
    const lastPart = lastMessage.parts.at(-1);
    if (!lastPart) return false;
    if (!isToolUIPart(lastPart)) return false;
    if (lastPart.state.startsWith("output")) return false;
    return true;
  }, [status, messages]);

  const space = useMemo(() => {
    if (!isLoading || error) return false;
    const lastMessage = messages.at(-1);
    if (lastMessage?.role == "user") return "think";
    const lastPart = lastMessage?.parts.at(-1);
    if (!lastPart) return "think";
    const secondPart = lastMessage?.parts[1];
    if (secondPart?.type == "text" && secondPart.text.length == 0)
      return "think";
    if (lastPart?.type == "step-start") {
      return lastMessage?.parts.length == 1 ? "think" : "space";
    }
    return false;
  }, [isLoading, messages.at(-1)]);

  const particle = useMemo(() => {
    return (
      <AnimatePresence>
        {showParticles && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 5 }}
          >
            <div className="absolute top-0 left-0 w-full h-full z-10">
              <Suspense fallback={null}>
                <LightRays />
              </Suspense>
            </div>
            <div className="absolute top-0 left-0 w-full h-full z-10">
              <Suspense fallback={null}>
                <Particles particleCount={400} particleBaseSize={10} />
              </Suspense>
            </div>

            <div className="absolute top-0 left-0 w-full h-full z-10">
              <div className="w-full h-full bg-gradient-to-t from-background to-50% to-transparent z-20" />
            </div>
            <div className="absolute top-0 left-0 w-full h-full z-10">
              <div className="w-full h-full bg-gradient-to-l from-background to-20% to-transparent z-20" />
            </div>
            <div className="absolute top-0 left-0 w-full h-full z-10">
              <div className="w-full h-full bg-gradient-to-r from-background to-20% to-transparent z-20" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    );
  }, [showParticles]);

  const handleFocus = useCallback(() => {
    setShowParticles(false);
    debounce(() => setShowParticles(true), 60000);
  }, []);

  // Track scroll position for scroll-to-bottom button
  const [isAtBottom, setIsAtBottom] = useState(true);

  // Use auto-scroll hook
  const {
    containerRef,
    scrollToBottom,
    handleScroll: handleAutoScroll,
  } = useAutoScroll({
    isLoading,
    status,
    messages,
    onScrollPositionChange: setIsAtBottom,
    onScroll: handleFocus,
  });

  // Combine auto-scroll handler with focus handler
  const handleScroll = useCallback(() => {
    handleAutoScroll();
  }, [handleAutoScroll]);

  // Clear thread-specific state when navigating away from thread
  useEffect(() => {
    return () => {
      appStoreMutate((prev) => ({
        currentThreadId: null,
        threadPlans: {
          ...prev.threadPlans,
          [threadId]: undefined,
        },
        // Don't clear context usage - it's useful to keep for reference
        // and will be updated on next message send
      }));
    };
  }, [threadId, appStoreMutate]);

  useEffect(() => {
    if (pendingThreadMention && threadId) {
      appStoreMutate((prev) => ({
        threadMentions: {
          ...prev.threadMentions,
          [threadId]: [pendingThreadMention],
        },
        pendingThreadMention: undefined,
      }));
    }
  }, [pendingThreadMention, threadId, appStoreMutate]);

  useEffect(() => {
    if (isInitialThreadEntry)
      containerRef.current?.scrollTo({
        top: containerRef.current?.scrollHeight,
        behavior: "instant",
      });
  }, [isInitialThreadEntry, containerRef]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const messages = latestRef.current.messages;
      if (messages.length === 0) return;
      const isLastMessageCopy = isShortcutEvent(e, Shortcuts.lastMessageCopy);
      const isDeleteThread = isShortcutEvent(e, Shortcuts.deleteThread);
      if (!isDeleteThread && !isLastMessageCopy) return;
      e.preventDefault();
      e.stopPropagation();
      if (isLastMessageCopy) {
        const lastMessage = messages.at(-1);
        const lastMessageText = lastMessage!.parts
          .filter((part): part is TextUIPart => part.type == "text")
          ?.at(-1)?.text;
        if (!lastMessageText) return;
        navigator.clipboard.writeText(lastMessageText);
        toast.success("Last message copied to clipboard");
      }
      if (isDeleteThread) {
        setIsDeleteThreadPopupOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (mounted) {
      handleFocus();
    }
  }, [input]);

  const [theaterMode] = appStore(useShallow((state) => [state.theaterMode]));
  const { setOpen } = useSidebar();
  const isMobile = useIsMobile();

  useEffect(() => {
    if (theaterMode.isOpen) {
      setOpen(false);
    }
  }, [theaterMode.isOpen, setOpen]);

  // On mobile, show theater panel fullscreen when open
  if (isMobile && theaterMode.isOpen) {
    return (
      <div className="flex flex-col h-full w-full overflow-hidden">
        <TheaterPanel />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      {particle}
      <ResizablePanelGroup direction="horizontal" className="h-full w-full">
        <ResizablePanel
          defaultSize={theaterMode.isOpen ? 40 : 100}
          minSize={theaterMode.isOpen ? 15 : 30}
          className={cn(
            "flex flex-col min-w-0 relative h-full z-40",
            emptyMessage && "justify-center pb-24",
            isMobile && theaterMode.isOpen && "hidden",
          )}
        >
          {isDragging && (
            <div className="absolute inset-0 z-40 bg-background/70 backdrop-blur-sm flex items-center justify-center pointer-events-none">
              <div className="rounded-2xl px-6 py-5 bg-background/80 shadow-xl border border-border flex items-center gap-3">
                <div className="rounded-full bg-primary/10 p-2 text-primary">
                  <FilePlus className="size-6" />
                </div>
                <span className="text-sm text-muted-foreground">
                  Drop files to upload
                </span>
              </div>
            </div>
          )}
          {emptyMessage ? (
            <ChatGreeting />
          ) : (
            <div
              className={"flex flex-col gap-2 overflow-y-auto py-6 z-10"}
              ref={containerRef}
              onScroll={handleScroll}
            >
              {messages.map((message, index) => {
                const isLastMessage = messages.length - 1 === index;
                return (
                  <PreviewMessage
                    threadId={threadId}
                    messageIndex={index}
                    prevMessage={messages[index - 1]}
                    key={message.id}
                    message={message}
                    status={status}
                    addToolResult={addToolResult}
                    isLoading={isLoading || isPendingToolCall}
                    isLastMessage={isLastMessage}
                    setMessages={setMessages}
                    sendMessage={sendMessage}
                    className={
                      isLastMessage &&
                      message.role != "user" &&
                      !space &&
                      message.parts.length > 1
                        ? "min-h-[calc(55dvh-40px)]"
                        : ""
                    }
                  />
                );
              })}
              {space && (
                <>
                  <div className="w-full mx-auto max-w-3xl px-6 relative">
                    <div className={space == "space" ? "opacity-0" : ""}>
                      <Think />
                    </div>
                  </div>
                  <div className="min-h-[calc(55dvh-56px)]" />
                </>
              )}

              {error && <ErrorMessage error={error} />}
              <div className="min-w-0 min-h-52" />
            </div>
          )}

          <div
            className={clsx(
              messages.length > 0 && "absolute bottom-14",
              "w-full z-10",
            )}
          >
            <div className="max-w-3xl mx-auto relative flex justify-center items-center -top-2">
              <ScrollToBottomButton
                show={!isAtBottom && messages.length > 0}
                onClick={scrollToBottom}
              />
            </div>

            <PromptInput
              input={input}
              threadId={threadId}
              sendMessage={sendMessage}
              setInput={setInput}
              isLoading={isLoading || isPendingToolCall}
              onStop={stop}
              onFocus={isFirstTime ? undefined : handleFocus}
            />
          </div>
          <DeleteThreadPopup
            threadId={threadId}
            onClose={() => setIsDeleteThreadPopupOpen(false)}
            open={isDeleteThreadPopupOpen}
          />
        </ResizablePanel>

        {theaterMode.isOpen && (
          <>
            <ResizableHandle
              withHandle={false}
              className="w-4 bg-transparent z-50 -mr-2 relative flex items-center justify-center outline-none"
            >
              <div className="h-16 w-1 rounded-full bg-white/20 transition-all duration-300 hover:bg-white/50 hover:w-1.5 active:bg-primary active:w-1.5" />
            </ResizableHandle>
            <ResizablePanel
              defaultSize={60}
              minSize={20}
              className="z-50 bg-transparent pl-2 py-4 pr-4 transition-[flex-grow] duration-300 ease-in-out"
            >
              <TheaterPanel />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </div>
  );
}

function DeleteThreadPopup({
  threadId,
  onClose,
  open,
}: {
  readonly threadId: string;
  readonly onClose: () => void;
  readonly open: boolean;
}) {
  const { t } = useTranslation();
  const [isDeleting, setIsDeleting] = useState(false);
  const navigate = useNavigate();
  const handleDelete = useCallback(() => {
    setIsDeleting(true);
    safe(() => threadApi.delete(threadId))
      .watch(() => setIsDeleting(false))
      .ifOk(() => {
        // Clean up thread-related state (context usage, plans, files, mentions)
        cleanupThreadState(threadId);
        toast.success(t("Chat.Thread.threadDeleted"));
        navigate({ to: "/" });
      })
      .ifFail(() => toast.error(t("Chat.Thread.failedToDeleteThread")))
      .watch(() => onClose());
  }, [threadId, navigate]);
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Chat.Thread.deleteChat")}</DialogTitle>
          <DialogDescription>
            {t("Chat.Thread.areYouSureYouWantToDeleteThisChatThread")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("Common.cancel")}
          </Button>
          <Button variant="destructive" onClick={handleDelete} autoFocus>
            {t("Common.delete")}
            {isDeleting && <Loader className="size-3.5 ml-2 animate-spin" />}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ScrollToBottomButtonProps {
  show: boolean;
  onClick: () => void;
  className?: string;
}

function ScrollToBottomButton({
  show,
  onClick,
  className,
}: ScrollToBottomButtonProps) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          transition={{ duration: 0.2, ease: "easeInOut" }}
          className={className}
        >
          <Button
            onClick={onClick}
            className="shadow-lg backdrop-blur-sm border transition-colors"
            size="icon"
            variant="ghost"
          >
            <ArrowDown />
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
