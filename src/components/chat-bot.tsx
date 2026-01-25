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
import { useACPChat } from "@/hooks/use-acp-chat";
import { ACPPermissionDialog } from "./acp/permission-dialog";
import { respondToACPPermission } from "@/lib/electron/acp-api";
import type { RespondToPermissionRequest, ACPPermissionRequest } from "@/types/acp";
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

interface ContextCompactionStartEvent {
  type: "data-context-compaction-start";
  data: {
    oldUsage: {
      usedTokens: number;
      percentage: number;
    };
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

type ContextEvent =
  | ContextUsageUpdateEvent
  | ContextCompactionStartEvent
  | ContextCompactionEvent;

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
    event.type === "data-context-compaction-start" ||
    event.type === "data-context-compaction"
  );
}

// Screenshot event - image sent to UI, only metadata to AI
interface ScreenshotEvent {
  type: "data-screenshot";
  data: {
    id: string;
    screenshot: string; // base64 image data
    width: number;
    height: number;
    timestamp: string;
    description?: string;
  };
}

function isScreenshotEvent(event: { type: string }): event is ScreenshotEvent {
  return event.type === "data-screenshot";
}

// Document-ready event - file ready for desktop saving
interface DocumentReadyEvent {
  type: "data-document-ready";
  data: {
    fileName: string;
    fileBase64: string;
    documentType: "presentation" | "document" | "spreadsheet" | "pdf";
    timestamp: string;
  };
}

function isDocumentReadyEvent(event: { type: string }): event is DocumentReadyEvent {
  return event.type === "data-document-ready";
}

/**
 * Handle document-ready event for desktop mode
 * Saves the document to the working directory and auto-opens it
 */
async function handleDocumentReadyEvent(event: DocumentReadyEvent): Promise<void> {
  // Parse the data if it's a string (JSON.stringify was used when writing to stream)
  const eventData = typeof event.data === "string"
    ? JSON.parse(event.data)
    : event.data;
  const { fileName, fileBase64, documentType } = eventData as DocumentReadyEvent["data"];

  // Check if we're in Electron mode with file API support
  if (typeof window === "undefined" || !window.electronAPI) {
    console.log("[DocumentReady] Not in Electron mode, skipping save");
    return;
  }

  // Get the working directory from the store
  const workingDirectory = appStore.getState().workingDirectory;

  if (!workingDirectory?.path) {
    console.log("[DocumentReady] No working directory set, skipping save");
    toast.warning("No working directory set", {
      description: "Select a working directory to save documents automatically.",
    });
    return;
  }

  try {
    // Build the full file path
    const filePath = `${workingDirectory.path}/${fileName}`;

    console.log(`[DocumentReady] Saving ${documentType} to: ${filePath}`);

    // Save the file using the IPC handler
    const writeResult = await window.electronAPI.dialog.writeToPath({
      filePath,
      content: fileBase64,
    });

    if (!writeResult.success) {
      console.error("[DocumentReady] Failed to save file:", writeResult.error);
      toast.error(`Failed to save ${fileName}`, {
        description: writeResult.error || "Unknown error occurred while saving the file.",
      });
      return;
    }

    console.log(`[DocumentReady] File saved successfully: ${filePath}`);
    toast.success(`Saved ${fileName}`, {
      description: `Document saved to ${workingDirectory.name}`,
    });

    // Auto-open the file in the system's default application
    const openResult = await window.electronAPI.dialog.openPath(filePath);

    if (!openResult.success) {
      console.warn("[DocumentReady] Failed to open file:", openResult.error);
      toast.warning(`Could not open ${fileName}`, {
        description: "File was saved but could not be opened automatically.",
      });
    } else {
      console.log(`[DocumentReady] Opened ${fileName} in default application`);
    }
  } catch (error) {
    console.error("[DocumentReady] Error handling document:", error);
    toast.error("Error saving document", {
      description: error instanceof Error ? error.message : "An unexpected error occurred.",
    });
  }
}

function handleScreenshotEvent(
  event: ScreenshotEvent,
  setMessages: React.Dispatch<React.SetStateAction<UIMessage[]>>,
): void {
  // Add screenshot as a visible message part in the chat
  // This shows the user what the AI captured without consuming AI context
  const { id, screenshot, width, height, description } = event.data;

  setMessages((prev) => {
    // Find the last assistant message to append to, or create indication
    const lastMsg = prev[prev.length - 1];

    if (lastMsg?.role === "assistant") {
      // Append screenshot part to the last assistant message
      // Cast to UIMessage[] as screenshot-display is a custom part type
      return prev.map((msg, idx) => {
        if (idx === prev.length - 1) {
          return {
            ...msg,
            parts: [
              ...msg.parts,
              {
                type: "screenshot-display" as const,
                id,
                screenshot,
                width,
                height,
                description: description || "Screenshot captured",
              } as any,
            ],
          };
        }
        return msg;
      }) as UIMessage[];
    }

    // If no assistant message, create a new one with the screenshot
    // Cast to UIMessage[] as screenshot-display is a custom part type
    return [
      ...prev,
      {
        id: `screenshot-msg-${id}`,
        role: "assistant" as const,
        parts: [
          {
            type: "screenshot-display" as const,
            id,
            screenshot,
            width,
            height,
            description: description || "Screenshot captured",
          } as any,
        ],
      },
    ] as UIMessage[];
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
  // Skip storing error plans - they're just notifications that the AI will retry
  // This prevents the UI from showing "error" as a valid plan
  if (event.data.planId === "error") {
    console.log(
      "[Plan] Skipping error plan event - AI will retry with correct parameters",
    );
    return;
  }

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

// Handler for compression START - shows loading tool block
function handleContextCompactionStart(
  event: ContextCompactionStartEvent,
  threadId: string,
  setMessages?: React.Dispatch<React.SetStateAction<UIMessage[]>>,
): void {
  console.log("[Context] Compaction START - showing loading tool block", {
    threadId,
    oldPercentage: (event.data.oldUsage.percentage * 100).toFixed(1) + "%",
  });

  // Add compression "loading" tool block to messages
  if (setMessages) {
    const compressionMessage: UIMessage = {
      id: `compression-${Date.now()}`,
      role: "assistant",
      parts: [
        {
          type: "tool-context-compression",
          state: "loading",
          oldUsage: event.data.oldUsage,
        } as any,
      ],
    };

    setMessages((prev) => [...prev, compressionMessage]);
  }
}

// Handler for compression COMPLETE - updates tool block to show results
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

  console.log("[Context] Compaction COMPLETE - updating tool block", {
    threadId,
    compactedCount: event.data.compactedCount,
    tokensSaved: event.data.tokensSaved,
    oldPercentage: (oldPercentage * 100).toFixed(1) + "%",
    newPercentage: (newUsage.percentage * 100).toFixed(1) + "%",
  });

  // Update the compression tool block from "loading" to "complete"
  if (setMessages) {
    setMessages((prev) => {
      return prev.map((msg) => {
        if (msg.id.startsWith("compression-")) {
          return {
            ...msg,
            parts: [
              {
                type: "tool-context-compression",
                state: "complete",
                compactedCount: event.data.compactedCount,
                tokensSaved: event.data.tokensSaved,
                oldPercentage: event.data.oldUsage?.percentage ?? oldPercentage,
                newPercentage: newUsage.percentage,
              } as any,
            ],
          };
        }
        return msg;
      });
    });
  }

  // CRITICAL: Update store to reset context indicator
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
  toast.success("Context Compressed", {
    description: `${event.data.compactedCount} messages compressed, context reset to ${(newUsage.percentage * 100).toFixed(0)}%`,
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
  } else if (dataPart.type === "data-context-compaction-start") {
    handleContextCompactionStart(dataPart, threadId, setMessages);
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
    chatMode,
    allowedAppDefaultToolkit,
    allowedMcpServers,
    threadList,
    threadMentions,
    pendingThreadMention,
    threadImageToolModel,
    workingDirectory,
  ] = appStore(
    useShallow((state) => [
      state.mutate,
      state.chatModel,
      state.toolChoice,
      state.chatMode,
      state.allowedAppDefaultToolkit,
      state.allowedMcpServers,
      state.threadList,
      state.threadMentions,
      state.pendingThreadMention,
      state.threadImageToolModel,
      state.workingDirectory,
    ]),
  );

  const generateTitle = useGenerateThreadTitle({
    threadId,
    chatModel: model,
  });

  const [showParticles, setShowParticles] = useState(isFirstTime);

  // Check if current model is an ACP agent (provider === "coding-agents")
  const isACPAgent = model?.provider === "coding-agents";
  const acpAgentId = isACPAgent ? model?.model : null;

  // ACP Permission dialog state
  const [acpPermissionOpen, setACPPermissionOpen] = useState(false);
  const [acpPermissionRequest, setACPPermissionRequest] = useState<ACPPermissionRequest | null>(null);

  // Handle ACP permission response
  const handleACPPermissionRespond = useCallback((response: RespondToPermissionRequest) => {
    respondToACPPermission(response.requestId, response.optionId, response.rememberGlobally)
      .then(() => {
        setACPPermissionOpen(false);
        setACPPermissionRequest(null);
      })
      .catch((err) => {
        console.error("[ChatBot] Failed to respond to ACP permission:", err);
        toast.error("Failed to respond to permission request");
      });
  }, []);

  // Track if we've already generated title for this thread
  const acpTitleGeneratedRef = useRef<string | null>(null);

  // Track previous ACP messages count to detect new messages for persistence
  const prevAcpMessageCountRef = useRef(0);
  // Track if we've already created the ACP thread
  const acpThreadCreatedRef = useRef<string | null>(null);
  // Promise to track ongoing thread creation
  const acpThreadCreationPromiseRef = useRef<Promise<void> | null>(null);

  // Helper function to ensure ACP thread exists before persisting messages
  const ensureACPThreadExists = useCallback(async () => {
    // Return existing promise if thread creation is already in progress
    if (acpThreadCreationPromiseRef.current) {
      return acpThreadCreationPromiseRef.current;
    }

    // Skip if already created for this thread
    if (acpThreadCreatedRef.current === threadId) {
      return Promise.resolve();
    }

    const createThread = async () => {
      try {
        // Create thread with coding-agents provider
        await threadApi.create({
          id: threadId,
          title: "New Chat",
          provider: "coding-agents",
        });
        console.log("[ChatBot] Created ACP thread with provider:", threadId);
        // Only mark as created on successful creation
        acpThreadCreatedRef.current = threadId;
      } catch (err: any) {
        // Thread might already exist, that's ok - mark as created
        // Only mark if it's a duplicate/exists error, not a real failure
        const isDuplicateError = err?.message?.includes("UNIQUE constraint") ||
          err?.message?.includes("already exists") ||
          err?.code === "SQLITE_CONSTRAINT";
        if (isDuplicateError) {
          console.log("[ChatBot] Thread already exists:", threadId);
          acpThreadCreatedRef.current = threadId;
        } else {
          console.error("[ChatBot] Failed to create ACP thread:", err);
          // Don't mark as created on real errors - allow retry
        }
      } finally {
        acpThreadCreationPromiseRef.current = null;
      }
    };

    acpThreadCreationPromiseRef.current = createThread();
    return acpThreadCreationPromiseRef.current;
  }, [threadId]);

  // Use ACP chat hook when an ACP agent is selected
  const acpChat = useACPChat({
    threadId,
    agentId: acpAgentId || "",
    onFinish: useCallback(async (message: UIMessage) => {
      console.log("[ChatBot] ACP message finished:", message.id);
      // Ensure thread exists before persisting the message
      await ensureACPThreadExists();
      // Persist the finished assistant message to database
      threadApi.upsertMessage(message, threadId).catch((err) => {
        console.error("[ChatBot] Failed to persist ACP message:", err);
      });
      // Refresh thread list to show the chat in sidebar
      mutate("/api/thread");
    }, [threadId, ensureACPThreadExists]),
    onError: useCallback((error: Error) => {
      console.error("[ChatBot] ACP error:", error);
      toast.error("Agent error: " + error.message);
    }, []),
  });

  // Initialize ACP messages with saved messages from database
  useEffect(() => {
    if (isACPAgent && initialMessages.length > 0 && acpChat.messages.length === 0) {
      console.log("[ChatBot] Initializing ACP chat with saved messages:", initialMessages.length);
      acpChat.setMessages(initialMessages);
    }
  }, [isACPAgent, initialMessages, acpChat.messages.length, acpChat.setMessages]);

  // Persist ACP messages when new ones are added
  useEffect(() => {
    if (!isACPAgent) return;

    const currentCount = acpChat.messages.length;
    const prevCount = prevAcpMessageCountRef.current;

    // Only persist when we have new messages (not on initial load from DB)
    // Allow persisting even when prevCount is 0 for brand new conversations
    if (currentCount > prevCount && currentCount > 0) {
      // Skip if these are initial messages loaded from database
      const isInitialLoad = prevCount === 0 && initialMessages.length > 0;
      if (isInitialLoad) {
        prevAcpMessageCountRef.current = currentCount;
        return;
      }

      const newMessages = acpChat.messages.slice(prevCount);
      console.log("[ChatBot] Persisting new ACP messages:", newMessages.length);

      // Create thread then persist messages
      ensureACPThreadExists().then(() => {
        // Persist each new message
        for (const msg of newMessages) {
          threadApi.upsertMessage(msg, threadId).catch((err) => {
            console.error("[ChatBot] Failed to persist ACP message:", err);
          });
        }
      });
    }

    prevAcpMessageCountRef.current = currentCount;
  }, [isACPAgent, acpChat.messages, threadId, initialMessages.length, ensureACPThreadExists]);

  // Generate title for new ACP chats (when we have user + assistant messages)
  // For ACP agents, we use a simple fallback title since they don't support title generation API
  useEffect(() => {
    if (!isACPAgent) return;
    if (acpTitleGeneratedRef.current === threadId) return; // Already generated for this thread

    const messages = acpChat.messages;
    const hasUserAndAssistant =
      messages.some((m) => m.role === "user") &&
      messages.some((m) => m.role === "assistant");

    if (hasUserAndAssistant && messages.length >= 2 && messages.length < 4) {
      // Check if thread needs a title from the store state
      const { threadList, mutate: storeMutate } = appStore.getState();
      const currentThread = threadList.find((t) => t.id === threadId);
      const needsTitle = !currentThread?.title || currentThread.title === "New Chat";

      if (needsTitle) {
        console.log("[ChatBot] Setting fallback title for ACP chat");
        // For ACP agents, use the first user message as title (they don't support AI title generation)
        const firstUserMessage = messages.find((m) => m.role === "user");
        const textPart = firstUserMessage?.parts.find((p) => p.type === "text") as TextUIPart | undefined;
        const userText = textPart?.text || "";
        const fallbackTitle = truncateString(userText, 50) || "ACP Chat";

        // Update store directly
        const newList = threadList.map((t) =>
          t.id === threadId ? { ...t, title: fallbackTitle } : t
        );
        storeMutate({ threadList: newList });

        // Also update in database
        threadApi.update(threadId, { title: fallbackTitle }).catch((err) => {
          console.error("[ChatBot] Failed to update ACP thread title:", err);
        });

        acpTitleGeneratedRef.current = threadId;
        mutate("/api/thread");
      }
    }
  }, [isACPAgent, acpChat.messages, threadId]);

  // Handle ACP permission requests from the hook
  useEffect(() => {
    if (acpChat.pendingPermission) {
      setACPPermissionRequest(acpChat.pendingPermission);
      setACPPermissionOpen(true);
    }
  }, [acpChat.pendingPermission]);

  const onFinish = useCallback(
    (options: {
      message: UIMessage;
      messages: UIMessage[];
      isAbort: boolean;
      isDisconnect: boolean;
      isError: boolean;
      finishReason?: string;
    }) => {
      console.log("[ChatBot] onFinish called for thread:", threadId, {
        isAbort: options.isAbort,
        isDisconnect: options.isDisconnect,
        isError: options.isError,
        finishReason: options.finishReason,
        messageCount: options.messages.length,
      });

      // Don't generate title on abort, disconnect, or error
      if (options.isAbort || options.isDisconnect || options.isError) {
        console.log("[ChatBot] onFinish - skipping title generation due to abort/disconnect/error");
        return;
      }

      const messages = options.messages;
      const prevThread = latestRef.current.threadList.find(
        (v) => v.id === threadId,
      );
      console.log(
        "[ChatBot] onFinish - prevThread:",
        prevThread?.title,
        "messages count:",
        messages.length,
      );

      const isNewThread =
        (!prevThread?.title || prevThread?.title === "New Chat") &&
        messages.filter((v) => v.role === "user" || v.role === "assistant")
          .length < 3;
      console.log("[ChatBot] onFinish - isNewThread:", isNewThread);

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
        console.log("[ChatBot] onFinish - text parts for title:", part.length);
        if (part.length > 0) {
          console.log("[ChatBot] onFinish - calling generateTitle");
          generateTitle(part.join("\n\n"));
        } else {
          console.log(
            "[ChatBot] onFinish - no text parts found for title generation",
          );
        }
      } else if (latestRef.current.threadList[0]?.id !== threadId) {
        console.log("[ChatBot] onFinish - mutating thread list");
        mutate("/api/thread");
      }

      // DON'T navigate here - it causes a remount and loses the streaming messages.
      // The URL will remain at "/" but that's OK - the messages are saved to DB
      // by the main process, and when the user clicks on the thread in sidebar
      // or refreshes, they'll see the saved conversation.
      //
      // The thread title will be generated and the thread will appear in sidebar
      // automatically via the IPC event.
    },
    [threadId, generateTitle],
  );

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
    transport: new ElectronIPCTransport({
      prepareSendMessagesRequest: ({ messages, body, id }) => {
        // NOTE: Do NOT update URL here with replaceState!
        // TanStack Router detects URL changes and re-routes, causing the component
        // to remount and lose the streaming state. URL is updated in onFinish instead.
        const lastMessage = messages.at(-1)!;
        
        // Ensure message has parts array (convert content to parts if needed)
        if (!lastMessage.parts && (lastMessage as any).content) {
          (lastMessage as any).parts = [{ type: "text", text: (lastMessage as any).content }];
        }
        
        // Filter out UI-only parts (e.g., source-url) so the model doesn't receive unknown parts
        const attachments: ChatAttachment[] = (lastMessage.parts || []).reduce(
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

        // Filter out source-url parts, but ensure at least one part remains
        const filteredParts = (lastMessage.parts || []).filter((p: any) => p?.type !== "source-url");

        const sanitizedLastMessage = {
          ...lastMessage,
          parts: filteredParts.length > 0 ? filteredParts : [{ type: "text" as const, text: "" }],
        } as typeof lastMessage;

        const requestBody: ChatApiSchemaRequestBody = {
          ...body,
          id,
          chatModel:
            (body as { model: ChatModel })?.model ?? latestRef.current.model,
          toolChoice: latestRef.current.toolChoice,
          chatMode: latestRef.current.chatMode,
          allowedAppDefaultToolkit: latestRef.current.allowedAppDefaultToolkit || [],
          allowedMcpServers: latestRef.current.mentions?.length
            ? {}
            : latestRef.current.allowedMcpServers || {},
          mentions: latestRef.current.mentions || [],
          message: sanitizedLastMessage,
          imageTool: {
            model: latestRef.current.threadImageToolModel[threadId],
          },
          attachments: attachments || [],
          workingDirectory: latestRef.current.workingDirectory ?? undefined,
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
      } else if (isScreenshotEvent(dataPart)) {
        handleScreenshotEvent(dataPart, setMessages);
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
      } else if (isDocumentReadyEvent(dataPart as { type: string })) {
        // Handle document ready for desktop mode (save to working directory + auto-open)
        handleDocumentReadyEvent(dataPart as DocumentReadyEvent);
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
      // Show ALL parts with their types
      allPartTypes: lastMsg?.parts.map((p: any) => ({
        type: p.type,
        ...(p.type === "text"
          ? { textLength: p.text?.length, textPreview: p.text?.slice(0, 100) }
          : {}),
        ...(p.type === "tool-invocation"
          ? {
              toolName: p.toolInvocation?.toolName,
              state: p.toolInvocation?.state,
            }
          : {}),
      })),
    });
  }, [messages, status]);

  // Set currentThreadId synchronously on mount/thread change
  // Using useLayoutEffect ensures child components have access
  // to the threadId before their effects run - critical for file persistence
  // NOTE: We do NOT add the thread to threadList here - that happens when
  // the first message is sent and the backend creates the thread
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
            // Keep isOpen but reset to changes tab if it was showing content
            defaultTab: state.theaterMode.isOpen ? "changes" : undefined,
          },
        };
      }

      return { currentThreadId: threadId };
    });
  }, [threadId]);

  // Track whether we've already added this thread to prevent race conditions
  const threadAddedRef = useRef<string | null>(null);

  // Add thread to threadList when the first message is being sent
  // This ensures the title dropdown appears only after the chat actually starts
  useEffect(() => {
    // Only add once per threadId to prevent duplicates from rapid status changes
    if (
      (status === "streaming" || status === "submitted") &&
      threadAddedRef.current !== threadId
    ) {
      appStoreMutate((state) => {
        const threadExists = state.threadList.some((t) => t.id === threadId);
        if (threadExists) return state;

        // Mark as added before mutation to prevent race conditions
        threadAddedRef.current = threadId;

        return {
          threadList: [
            {
              id: threadId,
              title: "New Chat",
              userId: "",
              createdAt: new Date(),
            },
            ...state.threadList,
          ],
        };
      });
    }
  }, [status, threadId]);

  // Reset ref when threadId changes (navigating to a new chat)
  useEffect(() => {
    if (threadAddedRef.current !== threadId) {
      threadAddedRef.current = null;
    }
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
  // Only include actual file artifacts from code execution, not web search results
  const allArtifacts = useMemo(() => {
    const extracted: any[] = [];

    // Tools that produce file artifacts
    const artifactProducingTools = new Set([
      "desktop_command",
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
      if (!m.parts) return;
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
        if (!hasData && !p.state?.startsWith("output")) return;

        if (!result) return;

        let items: any[] = [];

        // Case 1: Result is the array of artifacts itself
        if (Array.isArray(result)) {
          items = result;
        }
        // Case 2: Result is wrapped in 'results' property (code execution pattern)
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

      // CRITICAL: Capture current threadId to prevent stale closure issues
      // If user navigates to a different thread before the microtask runs,
      // we should not upsert to the old thread
      const currentThreadId = threadId;

      // Use queueMicrotask instead of setTimeout for immediate but safe execution
      // This ensures React state has updated but doesn't create a race condition
      queueMicrotask(async () => {
        // Verify thread hasn't changed (user navigated away)
        if (latestRef.current.threadId !== currentThreadId) {
          return;
        }

        const latestMessages = latestRef.current.messages;
        const lastMessage = latestMessages.at(-1);
        if (lastMessage?.role === "assistant") {
          // We need to save this message because it now contains the tool result
          await threadApi.upsertMessage(lastMessage, currentThreadId);
        }
      });
    },
    [_addToolResult, threadId], // Removed sendMessage
  );

  const mounted = useMounted();

  const latestRef = useToRef({
    toolChoice,
    chatMode,
    model,
    allowedAppDefaultToolkit,
    allowedMcpServers,
    messages,
    threadList,
    threadId,
    mentions: threadMentions[threadId],
    threadImageToolModel,
    workingDirectory,
  });

  // Unified chat state - use ACP chat when an ACP agent is selected
  const unifiedMessages = isACPAgent ? acpChat.messages : messages;
  // Map ACP "initializing" status to "ready" for UI components (they don't understand "initializing")
  const unifiedStatus = isACPAgent
    ? (acpChat.status === "initializing" ? "ready" : acpChat.status)
    : status;
  const unifiedError = isACPAgent ? acpChat.error : error;

  // Unified sendMessage - routes to ACP or regular chat
  const unifiedSendMessage = useCallback(
    async (messageOrOptions: any) => {
      if (isACPAgent) {
        // For ACP agents, extract text content and send via ACP
        let content: string;
        if (typeof messageOrOptions === "string") {
          content = messageOrOptions;
        } else if (messageOrOptions?.parts) {
          // UIMessage format
          const textPart = messageOrOptions.parts.find((p: any) => p.type === "text");
          content = textPart?.text || "";
        } else if (messageOrOptions?.content) {
          content = messageOrOptions.content;
        } else {
          content = String(messageOrOptions);
        }
        await acpChat.sendMessage(content);
      } else {
        // Regular AI SDK chat
        sendMessage(messageOrOptions);
      }
    },
    [isACPAgent, acpChat, sendMessage]
  );

  // Unified stop
  const unifiedStop = useCallback(() => {
    if (isACPAgent) {
      acpChat.stop();
    } else {
      stop();
    }
  }, [isACPAgent, acpChat, stop]);

  // Check if ACP session is still initializing
  const isACPInitializing = isACPAgent && acpChat.status === "initializing";

  const isLoading = useMemo(
    () => unifiedStatus === "streaming" || unifiedStatus === "submitted" || isACPInitializing,
    [unifiedStatus, isACPInitializing],
  );

  const emptyMessage = useMemo(
    () => unifiedMessages.length === 0 && !unifiedError,
    [unifiedMessages.length, unifiedError],
  );

  const isInitialThreadEntry = useMemo(
    () =>
      initialMessages.length > 0 &&
      initialMessages.at(-1)?.id === unifiedMessages.at(-1)?.id,
    [unifiedMessages],
  );

  const isPendingToolCall = useMemo(() => {
    if (unifiedStatus != "ready") return false;
    const lastMessage = unifiedMessages.at(-1);
    if (lastMessage?.role != "assistant") return false;
    const lastPart = lastMessage.parts.at(-1);
    if (!lastPart) return false;
    if (!isToolUIPart(lastPart)) return false;
    if (lastPart.state?.startsWith("output")) return false;
    return true;
  }, [unifiedStatus, unifiedMessages]);

  const space = useMemo(() => {
    if (!isLoading || unifiedError) return false;
    const lastMessage = unifiedMessages.at(-1);
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
  }, [isLoading, unifiedMessages.at(-1), unifiedError]);

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
              {unifiedMessages.map((message, index) => {
                const isLastMessage = unifiedMessages.length - 1 === index;
                return (
                  <PreviewMessage
                    threadId={threadId}
                    messageIndex={index}
                    prevMessage={unifiedMessages[index - 1]}
                    key={message.id}
                    message={message}
                    status={unifiedStatus}
                    addToolResult={addToolResult}
                    isLoading={isLoading || isPendingToolCall}
                    isLastMessage={isLastMessage}
                    setMessages={isACPAgent ? acpChat.setMessages : setMessages}
                    sendMessage={unifiedSendMessage}
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

              {unifiedError && <ErrorMessage error={unifiedError} />}
              <div className="min-w-0 min-h-52" />
            </div>
          )}

          <div
            className={clsx(
              unifiedMessages.length > 0 && "absolute bottom-14",
              "w-full z-10",
            )}
          >
            <div className="max-w-3xl mx-auto relative flex justify-center items-center -top-2">
              <ScrollToBottomButton
                show={!isAtBottom && unifiedMessages.length > 0}
                onClick={scrollToBottom}
              />
            </div>

            <PromptInput
              input={input}
              threadId={threadId}
              sendMessage={unifiedSendMessage}
              setInput={setInput}
              isLoading={isLoading || isPendingToolCall}
              onStop={unifiedStop}
              onFocus={isFirstTime ? undefined : handleFocus}
            />
          </div>
          <DeleteThreadPopup
            threadId={threadId}
            onClose={() => setIsDeleteThreadPopupOpen(false)}
            open={isDeleteThreadPopupOpen}
          />
          {/* ACP Permission Dialog for coding agents */}
          <ACPPermissionDialog
            open={acpPermissionOpen}
            onOpenChange={setACPPermissionOpen}
            request={acpPermissionRequest}
            onRespond={handleACPPermissionRespond}
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
