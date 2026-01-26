import { AgentSummary } from "app-types/agent";
import { ChatMention, ChatModel, ChatThread } from "app-types/chat";
import { AllowedMCPServer, MCPServerInfo } from "app-types/mcp";
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
  currentThreadId: ChatThread["id"] | null;
  toolChoice: "auto" | "none" | "manual";
  chatMode: "regular" | "agent" | "rag";
  allowedMcpServers?: Record<string, AllowedMCPServer>;
  allowedAppDefaultToolkit?: AppDefaultToolkit[];
  generatingTitleThreadIds: string[];
  // Per-thread model tracking for restoring model when loading a thread
  threadChatModels: {
    [threadId: string]: ChatModel | undefined;
  };
  // Working directory for local file system operations
  workingDirectory: {
    path: string;
    name: string;
  } | null;
  // Working directory scope for file operations
  workingDirectoryMode: "local" | "worktree";
  // Per-thread working directory overrides (used when mode is "worktree")
  threadWorkingDirectories: {
    [threadId: string]: {
      path: string;
      name: string;
    };
  };
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
    defaultTab?: "all-files" | "changes"; // Default tab to open when theater opens
    // Session changes tracking (for Changes tab)
    sessionChanges?: {
      created: string[];
      modified: string[];
      deleted: string[];
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
  generatingTitleThreadIds: [],
  threadMentions: {},
  threadFiles: {},
  threadImageToolModel: {},
  threadPlans: {},
  threadContextUsage: {},
  threadChatModels: {},
  mcpList: [],
  agentList: [],
  currentThreadId: null,
  toolChoice: "auto",
  chatMode: "regular",
  allowedMcpServers: undefined,
  workingDirectory: null,
  workingDirectoryMode: "local",
  threadWorkingDirectories: {},
  openUserSettings: false,
  openBilling: false,
  openKnowledge: false,
  allowedAppDefaultToolkit: [
    AppDefaultToolkit.Visualization,
    AppDefaultToolkit.WebSearch,
    AppDefaultToolkit.Browser,
    AppDefaultToolkit.Desktop,
    AppDefaultToolkit.DataAnalysis,
    AppDefaultToolkit.Documents,
    AppDefaultToolkit.Research,
    AppDefaultToolkit.Memory,
  ],
  toolPresets: [],
  chatModel: undefined,
  openShortcutsPopup: false,
  openChatPreferences: false,
  mcpCustomizationPopup: undefined,
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
          // Preserve workingDirectory from persisted state
          workingDirectory:
            persisted.workingDirectory || currentState.workingDirectory || null,
          // Preserve workingDirectoryMode from persisted state
          workingDirectoryMode:
            persisted.workingDirectoryMode || currentState.workingDirectoryMode || "local",
          // Preserve per-thread working directories
          threadWorkingDirectories:
            persisted.threadWorkingDirectories ||
            currentState.threadWorkingDirectories ||
            {},
        };
      },
      partialize: (state) => ({
        chatModel: state.chatModel || initialState.chatModel,
        toolChoice: state.toolChoice || initialState.toolChoice,
        chatMode: state.chatMode || initialState.chatMode,
        allowedMcpServers:
          state.allowedMcpServers || initialState.allowedMcpServers,
        workingDirectory: state.workingDirectory || initialState.workingDirectory,
        workingDirectoryMode:
          state.workingDirectoryMode || initialState.workingDirectoryMode,
        threadWorkingDirectories: state.threadWorkingDirectories || {},
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

export function resolveWorkingDirectory(
  state: Pick<
    AppState,
    "workingDirectory" | "workingDirectoryMode" | "threadWorkingDirectories"
  >,
  threadId?: string | null,
) {
  const mode = state.workingDirectoryMode || "local";
  if (mode === "worktree" && threadId) {
    return (
      state.threadWorkingDirectories[threadId] || state.workingDirectory || null
    );
  }
  return state.workingDirectory || null;
}

export function getActiveWorkingDirectory(threadId?: string | null) {
  return resolveWorkingDirectory(appStore.getState(), threadId);
}

/**
 * Clean up thread-related state when a thread is deleted
 */
export function cleanupThreadState(threadId: string): void {
  appStore.setState((state) => {
    const {
      threadContextUsage,
      threadPlans,
      threadFiles,
      threadMentions,
      threadWorkingDirectories,
      threadChatModels,
    } = state;
    const newThreadContextUsage = { ...threadContextUsage };
    const newThreadPlans = { ...threadPlans };
    const newThreadFiles = { ...threadFiles };
    const newThreadMentions = { ...threadMentions };
    const newThreadWorkingDirectories = { ...threadWorkingDirectories };
    const newThreadChatModels = { ...threadChatModels };

    delete newThreadContextUsage[threadId];
    delete newThreadPlans[threadId];
    delete newThreadFiles[threadId];
    delete newThreadMentions[threadId];
    delete newThreadWorkingDirectories[threadId];
    delete newThreadChatModels[threadId];

    return {
      threadContextUsage: newThreadContextUsage,
      threadPlans: newThreadPlans,
      threadFiles: newThreadFiles,
      threadMentions: newThreadMentions,
      threadWorkingDirectories: newThreadWorkingDirectories,
      threadChatModels: newThreadChatModels,
    };
  });
}

export const useAppStore = appStore;
