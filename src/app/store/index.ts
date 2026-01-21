import { AgentSummary } from "app-types/agent";
import { ArchiveWithItemCount } from "app-types/archive";
import { ChatMention, ChatModel, ChatThread } from "app-types/chat";
import { AllowedMCPServer, MCPServerInfo } from "app-types/mcp";
import { WorkflowSummary } from "app-types/workflow";
import { OPENAI_VOICE } from "lib/ai/speech/open-ai/use-voice-chat.openai";
import { AppDefaultToolkit } from "lib/ai/tools";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface UploadedFile {
  id: string;
  url: string;
  name: string;
  mimeType: string;
  size: number;
  isUploading?: boolean;
  progress?: number;
  previewUrl?: string;
  abortController?: AbortController;
  dataUrl?: string; // Full data URL format: "data:image/png;base64,..."
}

// Plan task state for real-time updates
export interface PlanTask {
  id: string;
  description: string;
  status: "pending" | "in-progress" | "completed" | "failed" | "blocked";
  assignedAgent?: string;
}

// Context usage state for real-time token tracking
export interface ContextUsageState {
  usedTokens: number;
  limit: number;
  percentage: number;
  remaining: number;
  // Model info for dynamic limit recalculation
  provider?: string;
  model?: string;
  lastCompaction?: {
    compactedCount: number;
    tokensSaved: number;
    timestamp: number;
  };
}

// Operation types for granular logging
export type FragmentOperationType =
  | "bash" // Shell command execution
  | "file-write" // Writing a file
  | "file-read" // Reading a file
  | "install" // Installing dependencies
  | "ai-call" // AI model invocation
  | "local-exec" // Local code execution
  | "tool-call" // External tool invocation (MCP, system tools)
  | "info"; // General info

// Individual operation log entry
export interface FragmentOperation {
  type: FragmentOperationType;
  command?: string; // For bash commands
  filePath?: string; // For file operations
  content?: string; // For file content (workspace files)
  output?: string; // Command output or result
  status: "running" | "success" | "error";
  timestamp: number;
  durationMs?: number;
  // For tool calls
  toolName?: string;
  toolArgs?: Record<string, any>;
  toolResult?: any;
}

// Fragment progress state for real-time updates
export interface FragmentProgressData {
  stage:
    | "analyzing"
    | "template-selected"
    | "generating"
    | "installing"
    | "executing"
    | "editing"
    | "deploying"
    | "complete"
    | "error";
  message: string;
  template?: string;
  fragmentId?: string;
  previewUrl?: string;
  error?: string;
  codeChunk?: string;
  codeLength?: number;
  generatedCode?: string; // Accumulated code during generation
  timestamp?: number;
  // Granular operation logging
  operation?: FragmentOperation; // Current operation
  operations?: FragmentOperation[]; // All operations history
  // Workspace files tracking
  workspaceFiles?: { path: string; content: string; language?: string }[];
}

export interface PlanState {
  planId: string;
  request: string;
  tasks: PlanTask[];
  status: "planning" | "executing" | "completed" | "failed";
  progress: number;
}

export interface AppState {
  threadList: ChatThread[];
  mcpList: (MCPServerInfo & { id: string })[];
  agentList: AgentSummary[];
  workflowToolList: WorkflowSummary[];
  currentThreadId: ChatThread["id"] | null;
  toolChoice: "auto" | "none" | "manual";
  chatMode: "regular" | "agent";
  allowedMcpServers?: Record<string, AllowedMCPServer>;
  allowedAppDefaultToolkit?: AppDefaultToolkit[];
  generatingTitleThreadIds: string[];
  archiveList: ArchiveWithItemCount[];
  threadMentions: {
    [threadId: string]: ChatMention[];
  };
  threadFiles: {
    [threadId: string]: UploadedFile[];
  };
  threadImageToolModel: {
    [threadId: string]: string | undefined;
  };
  // Plan state keyed by threadId for real-time progress updates
  threadPlans: {
    [threadId: string]: PlanState | undefined;
  };
  // Context usage state keyed by threadId for token tracking
  threadContextUsage: {
    [threadId: string]: ContextUsageState | undefined;
  };
  // Fragment progress state keyed by toolCallId for real-time progress updates
  fragmentProgress: {
    [toolCallId: string]: FragmentProgressData | undefined;
  };
  toolPresets: {
    allowedMcpServers?: Record<string, AllowedMCPServer>;
    allowedAppDefaultToolkit?: AppDefaultToolkit[];
    name: string;
  }[];
  chatModel?: ChatModel;
  openShortcutsPopup: boolean;
  openChatPreferences: boolean;
  openUserSettings: boolean;
  openBilling: boolean;
  openKnowledge: boolean;
  mcpCustomizationPopup?: MCPServerInfo & { id: string };
  temporaryChat: {
    isOpen: boolean;
    instructions: string;
    chatModel?: ChatModel;
  };
  voiceChat: {
    isOpen: boolean;
    agentId?: string;
    options: {
      provider: string;
      providerOptions?: Record<string, any>;
    };
  };
  pendingThreadMention?: ChatMention;
  theaterMode: {
    isOpen: boolean;
    type?:
      | "app"
      | "file"
      | "chart"
      | "image"
      | "pdf"
      | "office"
      | "browser"
      | "desktop"
      | "research";
    content?: any;
    title?: string;
    // File metadata for Collabora editing (storageKey used as fileId)
    fileMetadata?: {
      storageKey?: string;
      name?: string;
      size?: number;
      mimeType?: string;
    };
    executionArtifacts?: any[]; // For File Explorer: List of all artifacts from the run
    threadArtifacts?: { [threadId: string]: any[] }; // Thread-scoped registry of artifacts
    filesVersion?: number; // Incremented when local files change, triggers re-fetch
    defaultTab?: "preview" | "files"; // Default tab to open when theater opens
    // Browser session state
    browserSession?: {
      sessionId: string;
      provider: "chrome-devtools" | "local-terminal";
      currentUrl?: string;
      replayUrl?: string;
    };
    // Desktop session state (local terminal)
    desktopSession?: {
      sessionId: string;
      streamUrl?: string;
      authKey?: string;
    };
    // Research task state
    researchTask?: {
      taskId: string;
      query: string;
      status: string;
    };
  };
}

export interface AppDispatch {
  mutate: (state: Mutate<AppState>) => void;
}

const initialState: AppState = {
  threadList: [],
  archiveList: [],
  generatingTitleThreadIds: [],
  threadMentions: {},
  threadFiles: {},
  threadImageToolModel: {},
  threadPlans: {},
  threadContextUsage: {},
  fragmentProgress: {},
  mcpList: [],
  agentList: [],
  workflowToolList: [],
  currentThreadId: null,
  toolChoice: "auto",
  chatMode: "regular",
  allowedMcpServers: undefined,
  openUserSettings: false,
  openBilling: false,
  openKnowledge: false,
  allowedAppDefaultToolkit: [
    AppDefaultToolkit.Visualization,
    AppDefaultToolkit.WebSearch,
    AppDefaultToolkit.Http,
    AppDefaultToolkit.Browser,
    AppDefaultToolkit.Desktop,
    AppDefaultToolkit.DataAnalysis,
    AppDefaultToolkit.Documents,
    AppDefaultToolkit.Research,
    AppDefaultToolkit.Fragments, // Autonomous app/dashboard/document generation
    AppDefaultToolkit.Memory,
  ],
  toolPresets: [],
  chatModel: undefined,
  openShortcutsPopup: false,
  openChatPreferences: false,
  mcpCustomizationPopup: undefined,
  temporaryChat: {
    isOpen: false,
    instructions: "",
  },
  voiceChat: {
    isOpen: false,
    options: {
      provider: "openai",
      providerOptions: {
        model: OPENAI_VOICE["Alloy"],
      },
    },
  },
  pendingThreadMention: undefined,
  theaterMode: {
    isOpen: false,
  },
};

export const appStore = create<AppState & AppDispatch>()(
  persist(
    (set) => ({
      ...initialState,
      mutate: set,
    }),
    {
      name: "mc-app-store-v2.0.5",
      // Merge function handles hydration - ensures defaults are applied when loading from storage
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<AppState>;
        // Ensure allowedAppDefaultToolkit has defaults if empty or missing
        let allowedAppDefaultToolkit = persisted.allowedAppDefaultToolkit;
        if (
          !allowedAppDefaultToolkit ||
          allowedAppDefaultToolkit.length === 0
        ) {
          allowedAppDefaultToolkit = initialState.allowedAppDefaultToolkit;
        } else {
          // Filter to only valid toolkit values and auto-enable new defaults
          const validStored = allowedAppDefaultToolkit.filter((v) =>
            Object.values(AppDefaultToolkit).includes(v),
          );
          const newToolkits = Object.values(AppDefaultToolkit).filter(
            (t) =>
              !allowedAppDefaultToolkit!.includes(t) &&
              initialState.allowedAppDefaultToolkit?.includes(t),
          );
          allowedAppDefaultToolkit = [...validStored, ...newToolkits];
        }

        // Clear invalid chatModel - let useChatModels hook set a valid one
        // This prevents showing gemini-3-flash-preview when no API key is configured
        const chatModel = undefined; // Always start with undefined, let useChatModels set a valid one

        return {
          ...currentState,
          ...persisted,
          allowedAppDefaultToolkit,
          chatModel, // Override persisted chatModel with undefined
          // Preserve threadPlans from persisted state to maintain plan progress across refreshes
          threadPlans: persisted.threadPlans || currentState.threadPlans || {},
          // Preserve threadContextUsage from persisted state to maintain context indicator across refreshes
          threadContextUsage:
            persisted.threadContextUsage ||
            currentState.threadContextUsage ||
            {},
        };
      },
      partialize: (state) => ({
        chatModel: state.chatModel || initialState.chatModel,
        toolChoice: state.toolChoice || initialState.toolChoice,
        chatMode: state.chatMode || initialState.chatMode,
        allowedMcpServers:
          state.allowedMcpServers || initialState.allowedMcpServers,
        // Ensure all valid toolkits are preserved AND new toolkits are auto-enabled
        allowedAppDefaultToolkit: (() => {
          const stored = state.allowedAppDefaultToolkit ?? [];
          const validStored = stored.filter((v) =>
            Object.values(AppDefaultToolkit).includes(v),
          );
          // Auto-enable any new toolkits that weren't in the stored list
          // This ensures users get new features like Fragments automatically
          const allToolkits = Object.values(AppDefaultToolkit);
          const newToolkits = allToolkits.filter(
            (t) =>
              !stored.includes(t) &&
              initialState.allowedAppDefaultToolkit?.includes(t),
          );
          return [...validStored, ...newToolkits];
        })(),
        temporaryChat: {
          ...initialState.temporaryChat,
          ...state.temporaryChat,
          isOpen: false,
        },
        toolPresets: state.toolPresets || initialState.toolPresets,
        voiceChat: {
          ...initialState.voiceChat,
          ...state.voiceChat,
          isOpen: false,
        },
        threadFiles: Object.entries(state.threadFiles || {}).reduce(
          (acc, [k, v]) => {
            acc[k] = v.map((f) => ({
              ...f,
              abortController: undefined,
              previewUrl: undefined,
              isUploading: false,
              progress: 100,
            }));
            return acc;
          },
          {} as Record<string, UploadedFile[]>,
        ),
        // Persist threadPlans to maintain plan state across page refreshes
        threadPlans: state.threadPlans || {},
        // Persist threadContextUsage to maintain context indicator across page refreshes
        threadContextUsage: state.threadContextUsage || {},
      }),
    },
  ),
);

/**
 * Clean up thread-related state when a thread is deleted
 */
export function cleanupThreadState(threadId: string): void {
  appStore.setState((state) => {
    const { threadContextUsage, threadPlans, threadFiles, threadMentions } =
      state;
    const newThreadContextUsage = { ...threadContextUsage };
    const newThreadPlans = { ...threadPlans };
    const newThreadFiles = { ...threadFiles };
    const newThreadMentions = { ...threadMentions };

    delete newThreadContextUsage[threadId];
    delete newThreadPlans[threadId];
    delete newThreadFiles[threadId];
    delete newThreadMentions[threadId];

    return {
      threadContextUsage: newThreadContextUsage,
      threadPlans: newThreadPlans,
      threadFiles: newThreadFiles,
      threadMentions: newThreadMentions,
    };
  });
}

export const useAppStore = appStore;
