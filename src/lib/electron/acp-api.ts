/**
 * ACP (Agent Client Protocol) API for Renderer Process
 *
 * This module provides a type-safe API for interacting with ACP agents
 * from the renderer process via IPC.
 */

import type {
  ACPAgentStatus,
  ACPAgentCapabilities,
  ACPSession,
  ACPSessionListRequest,
  ACPSessionListResponse,
  ACPMessageChunk,
  ACPPermissionRequest,
  ACPAvailableCommand,
  ACPSessionInfoUpdateEvent,
  StartACPSessionRequest,
  SendACPPromptRequest,
  RespondToPermissionRequest,
  LoadACPSessionRequest,
  ResumeACPSessionRequest,
  SessionConfigOption,
  SessionModelState,
} from "@/types/acp";

/**
 * Display names for ACP agents
 */
export const AGENT_DISPLAY_NAMES: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  gemini: "Gemini CLI",
};

/**
 * Provider mapping for icons (maps to existing ModelProviderIcon)
 */
export const AGENT_ICON_PROVIDERS: Record<
  string,
  "anthropic" | "openai" | "google"
> = {
  "claude-code": "anthropic",
  codex: "openai",
  gemini: "google",
};

// Preload returns the full ACPSession from IPC
// Note: The IPC handler returns ACPSession which has sessionId, not id
interface PreloadACPSession {
  sessionId: string;
  agentId: string;
  workingDirectory?: string;
  createdAt: Date;
  availableModes?: string[];
  currentMode?: string;
  configOptions?: SessionConfigOption[] | null;
  models?: SessionModelState | null;
}

// Preload returns ACPPromptResult shape for prompt results
interface PreloadPromptResult {
  sessionId: string;
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "cancelled" | "error";
  error?: string;
}

// Session data from session-created event
interface PreloadSessionCreatedData {
  agentId: string;
  session: PreloadACPSession;
}

// Permission request shape from preload
interface PreloadPermissionRequest {
  agentId: string;
  sessionId: string;
  requestId: string;
  title: string;
  description?: string;
  options: Array<{
    id: string;
    label: string;
    description?: string;
    isDefault?: boolean;
  }>;
  metadata?: Record<string, unknown>;
}

/**
 * Agentic loop status returned from the backend
 */
export interface AgenticLoopStatus {
  active: boolean;
  iteration: number;
  pendingTools: number;
  autoResume: boolean;
}

// Type for the IPC API exposed by preload
interface ACPElectronAPI {
  listAgents: (forceRefresh?: boolean) => Promise<ACPAgentStatus[]>;
  getAgentStatus: (agentId: string) => Promise<ACPAgentStatus | undefined>;
  startAgent: (agentId: string) => Promise<void>;
  stopAgent: (agentId: string) => Promise<void>;
  createSession: (
    request: StartACPSessionRequest,
  ) => Promise<PreloadACPSession>;
  setSessionModel: (request: {
    agentId: string;
    sessionId: string;
    modelId: string;
  }) => Promise<void>;
  setSessionConfigOption: (request: {
    agentId: string;
    sessionId: string;
    configId: string;
    value: string;
  }) => Promise<{ configOptions?: SessionConfigOption[] | null }>;
  setSessionMode: (request: {
    agentId: string;
    sessionId: string;
    modeId: string;
  }) => Promise<void>;
  prompt: (request: SendACPPromptRequest) => Promise<PreloadPromptResult>;
  cancel: (agentId: string, sessionId: string) => Promise<void>;
  authenticate: (
    agentId: string,
    methodId: string,
  ) => Promise<{ success: boolean; message?: string }>;
  respondPermission: (request: RespondToPermissionRequest) => Promise<void>;
  getInstalledAgents: () => Promise<ACPAgentStatus[]>;
  // Agentic loop controls
  setAutoResume: (
    agentId: string,
    sessionId: string,
    enabled: boolean,
  ) => Promise<void>;
  getAgenticLoopStatus: (
    agentId: string,
    sessionId: string,
  ) => Promise<AgenticLoopStatus | null>;

  // Session context update
  updateSessionContext: (
    agentId: string,
    sessionId: string,
    context: { workingDirectory?: string },
  ) => Promise<{
    sessionId: string;
    workingDirectory?: string;
    contextUpdated: boolean;
  }>;

  // Feature 2: Session list/load/resume and capabilities
  getAgentCapabilities: (
    agentId: string,
  ) => Promise<ACPAgentCapabilities | undefined>;
  listSessions: (
    agentId: string,
    request?: ACPSessionListRequest,
  ) => Promise<ACPSessionListResponse>;
  loadSession: (request: LoadACPSessionRequest) => Promise<PreloadACPSession>;
  resumeSession: (
    request: ResumeACPSessionRequest,
  ) => Promise<PreloadACPSession>;

  // Event listeners
  onAgentStarted: (callback: (data: { agentId: string }) => void) => () => void;
  onAgentExit: (
    callback: (data: { agentId: string; code: number | null }) => void,
  ) => () => void;
  onAgentError: (
    callback: (data: { agentId: string; error: string }) => void,
  ) => () => void;
  onAgentAuthenticated: (
    callback: (data: { agentId: string }) => void,
  ) => () => void;
  onAuthRequired: (
    callback: (data: {
      agentId: string;
      methods: Array<{ id: string; name: string; description?: string }>;
    }) => void,
  ) => () => void;
  onSessionCreated: (
    callback: (data: PreloadSessionCreatedData) => void,
  ) => () => void;
  onMessageChunk: (callback: (chunk: ACPMessageChunk) => void) => () => void;
  onPermissionRequest: (
    callback: (request: PreloadPermissionRequest) => void,
  ) => () => void;

  // Feature 2: Session load/resume events
  onSessionLoaded?: (callback: (session: ACPSession) => void) => () => void;
  onSessionResumed?: (callback: (session: ACPSession) => void) => () => void;
  onSessionRecreated?: (
    callback: (data: {
      agentId: string;
      oldSessionId: string;
      newSession: ACPSession;
    }) => void,
  ) => () => void;
  onSessionContextUpdated?: (
    callback: (data: {
      agentId: string;
      sessionId: string;
      workingDirectory?: string;
    }) => void,
  ) => () => void;

  // Feature 3: Terminal events
  onTerminalCreated?: (
    callback: (data: {
      agentId: string;
      sessionId: string;
      terminalId: string;
      cwd?: string;
      label?: string;
    }) => void,
  ) => () => void;
  onTerminalOutput?: (
    callback: (data: {
      agentId: string;
      sessionId: string;
      terminalId: string;
      data: string;
    }) => void,
  ) => () => void;
  onTerminalExit?: (
    callback: (data: {
      agentId: string;
      sessionId: string;
      terminalId: string;
      exitCode?: number;
      signal?: string;
    }) => void,
  ) => () => void;

  // Feature 4: Commands update event
  onCommandsUpdate?: (
    callback: (data: {
      agentId: string;
      sessionId: string;
      commands: ACPAvailableCommand[];
    }) => void,
  ) => () => void;

  // Feature 6: Session info update event
  onSessionInfoUpdate?: (
    callback: (data: ACPSessionInfoUpdateEvent) => void,
  ) => () => void;

  // Session mode update event
  onSessionModeUpdate?: (
    callback: (data: {
      agentId: string;
      sessionId: string;
      currentModeId?: string;
      availableModes?: Array<{ id: string; name: string }>;
    }) => void,
  ) => () => void;

  // Session model update event
  onSessionModelUpdate?: (
    callback: (data: {
      agentId: string;
      sessionId: string;
      currentModelId?: string;
      availableModels?: Array<{ modelId: string; name: string }>;
    }) => void,
  ) => () => void;

  // Session config update event
  onSessionConfigUpdate?: (
    callback: (data: {
      agentId: string;
      sessionId: string;
      configOptions?: Array<{
        id: string;
        name: string;
        type: string;
        value?: string | boolean;
      }>;
    }) => void,
  ) => () => void;

  // Auto-detection methods
  autoDetect?: () => Promise<ACPAgentStatus[]>;
  startAutoDetectPolling?: (intervalMs?: number) => Promise<{ success: boolean }>;
  stopAutoDetectPolling?: () => Promise<{ success: boolean }>;

  // Auto-detection events
  onAgentsDetected?: (
    callback: (data: { agents: ACPAgentStatus[]; timestamp: number }) => void,
  ) => () => void;
  onAgentsUpdated?: (
    callback: (data: { agents: ACPAgentStatus[]; timestamp: number }) => void,
  ) => () => void;
}

// Get the ACP API from the window object
function getACPApi(): ACPElectronAPI | null {
  if (typeof window !== "undefined" && "electronAPI" in window) {
    const electronAPI = (
      window as unknown as { electronAPI?: { acp?: ACPElectronAPI } }
    ).electronAPI;
    return electronAPI?.acp || null;
  }
  return null;
}

/**
 * List all available ACP agents and their status
 */
export async function listACPAgents(
  forceRefresh = false,
): Promise<ACPAgentStatus[]> {
  const api = getACPApi();
  if (!api) {
    console.warn("[ACP] API not available - not in Electron environment");
    return [];
  }
  return api.listAgents(forceRefresh);
}

/**
 * Get the status of a specific agent
 */
export async function getACPAgentStatus(
  agentId: string,
): Promise<ACPAgentStatus | undefined> {
  const api = getACPApi();
  if (!api) return undefined;
  return api.getAgentStatus(agentId);
}

/**
 * Get all installed ACP agents (for model selector)
 */
export async function getInstalledACPAgents(): Promise<ACPAgentStatus[]> {
  const api = getACPApi();
  if (!api) return [];
  return api.getInstalledAgents();
}

/**
 * Start an ACP agent
 */
export async function startACPAgent(agentId: string): Promise<void> {
  const api = getACPApi();
  if (!api) throw new Error("ACP API not available");
  return api.startAgent(agentId);
}

/**
 * Stop an ACP agent
 */
export async function stopACPAgent(agentId: string): Promise<void> {
  const api = getACPApi();
  if (!api) throw new Error("ACP API not available");
  return api.stopAgent(agentId);
}

/**
 * Create a new session with an ACP agent
 */
export async function createACPSession(
  agentId: string,
  workingDirectory: string,
  mcpServers?: StartACPSessionRequest["mcpServers"],
  threadId?: string,
): Promise<ACPSession> {
  const api = getACPApi();
  if (!api) throw new Error("ACP API not available");
  const preloadSession = await api.createSession({
    agentId,
    workingDirectory,
    mcpServers,
    threadId,
  });
  // The IPC returns ACPSession directly with sessionId (not id)
  return {
    sessionId: preloadSession.sessionId,
    agentId: preloadSession.agentId,
    workingDirectory: preloadSession.workingDirectory || workingDirectory,
    createdAt: preloadSession.createdAt,
    availableModes: preloadSession.availableModes,
    currentMode: preloadSession.currentMode,
    configOptions: preloadSession.configOptions ?? null,
    models: preloadSession.models ?? null,
  };
}

/**
 * Send a prompt to an ACP agent session.
 * Note: The actual response content comes through streaming events (onACPMessageChunk).
 * This function returns the prompt result with stop reason.
 */
export async function sendACPPrompt(
  agentId: string,
  sessionId: string,
  message: string,
  contextFiles?: SendACPPromptRequest["contextFiles"],
): Promise<{
  sessionId: string;
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "cancelled" | "error";
  error?: string;
}> {
  const api = getACPApi();
  if (!api) throw new Error("ACP API not available");
  return api.prompt({ agentId, sessionId, message, contextFiles });
}

/**
 * Cancel an ongoing prompt
 */
export async function cancelACPPrompt(
  agentId: string,
  sessionId: string,
): Promise<void> {
  const api = getACPApi();
  if (!api) throw new Error("ACP API not available");
  return api.cancel(agentId, sessionId);
}

/**
 * Set ACP session model (experimental)
 */
export async function setACPSessionModel(
  agentId: string,
  sessionId: string,
  modelId: string,
): Promise<void> {
  const api = getACPApi();
  if (!api) throw new Error("ACP API not available");
  return api.setSessionModel({ agentId, sessionId, modelId });
}

/**
 * Set ACP session config option (experimental)
 */
export async function setACPSessionConfigOption(
  agentId: string,
  sessionId: string,
  configId: string,
  value: string,
): Promise<{ configOptions?: SessionConfigOption[] | null }> {
  const api = getACPApi();
  if (!api) throw new Error("ACP API not available");
  return api.setSessionConfigOption({ agentId, sessionId, configId, value });
}

/**
 * Set ACP session mode
 */
export async function setACPSessionMode(
  agentId: string,
  sessionId: string,
  modeId: string,
): Promise<void> {
  const api = getACPApi();
  if (!api) throw new Error("ACP API not available");
  return api.setSessionMode({ agentId, sessionId, modeId });
}

// ============================================================================
// AGENTIC LOOP CONTROLS
// ============================================================================

/**
 * Set auto-resume mode for a session.
 * When enabled (default), the agent will automatically continue after tool completion.
 * This is what makes the agent truly "agentic" - it keeps working until the task is complete.
 */
export async function setACPAutoResume(
  agentId: string,
  sessionId: string,
  enabled: boolean,
): Promise<void> {
  const api = getACPApi();
  if (!api) throw new Error("ACP API not available");
  if (!api.setAutoResume) {
    console.warn("[ACP] setAutoResume not available in preload");
    return;
  }
  return api.setAutoResume(agentId, sessionId, enabled);
}

/**
 * Get the current agentic loop status for a session
 */
export async function getACPAgenticLoopStatus(
  agentId: string,
  sessionId: string,
): Promise<AgenticLoopStatus | null> {
  const api = getACPApi();
  if (!api) return null;
  if (!api.getAgenticLoopStatus) {
    console.warn("[ACP] getAgenticLoopStatus not available in preload");
    return null;
  }
  return api.getAgenticLoopStatus(agentId, sessionId);
}

// ============================================================================
// SESSION CONTEXT UPDATE
// ============================================================================

/**
 * Update session context (e.g., working directory).
 * Note: For full model awareness, session recreation may be preferred.
 * This method updates the local session state.
 *
 * @param agentId - The agent ID
 * @param sessionId - The session ID
 * @param context - The context to update (currently supports workingDirectory)
 * @returns The updated session info
 */
export async function updateACPSessionContext(
  agentId: string,
  sessionId: string,
  context: { workingDirectory?: string },
): Promise<{
  sessionId: string;
  workingDirectory?: string;
  contextUpdated: boolean;
}> {
  const api = getACPApi();
  if (!api) throw new Error("ACP API not available");
  if (!api.updateSessionContext) {
    console.warn("[ACP] updateSessionContext not available in preload");
    return { sessionId, workingDirectory: undefined, contextUpdated: false };
  }
  return api.updateSessionContext(agentId, sessionId, context);
}

// ============================================================================
// SESSION LIST/LOAD/RESUME (Feature 2)
// ============================================================================

/**
 * Get agent capabilities (loadSession, sessionList, sessionResume support)
 */
export async function getACPAgentCapabilities(
  agentId: string,
): Promise<ACPAgentCapabilities | undefined> {
  const api = getACPApi();
  if (!api) return undefined;
  if (!api.getAgentCapabilities) {
    console.warn("[ACP] getAgentCapabilities not available in preload");
    return undefined;
  }
  return api.getAgentCapabilities(agentId);
}

/**
 * List available sessions for an agent
 * Requires agent to support session list capability
 */
export async function listACPSessions(
  agentId: string,
  request?: ACPSessionListRequest,
): Promise<ACPSessionListResponse> {
  const api = getACPApi();
  if (!api) return { sessions: [] };
  if (!api.listSessions) {
    console.warn("[ACP] listSessions not available in preload");
    return { sessions: [] };
  }
  return api.listSessions(agentId, request);
}

/**
 * Load an existing session with history replay
 * Requires agent to support load session capability
 */
export async function loadACPSession(
  agentId: string,
  sessionId: string,
  workingDirectory: string,
  mcpServers?: LoadACPSessionRequest["mcpServers"],
): Promise<ACPSession> {
  const api = getACPApi();
  if (!api) throw new Error("ACP API not available");
  if (!api.loadSession) {
    throw new Error("loadSession not available in preload");
  }
  const preloadSession = await api.loadSession({
    agentId,
    sessionId,
    workingDirectory,
    mcpServers,
  });
  return {
    sessionId: preloadSession.sessionId,
    agentId: preloadSession.agentId,
    workingDirectory: preloadSession.workingDirectory || workingDirectory,
    createdAt: preloadSession.createdAt,
    availableModes: preloadSession.availableModes,
    currentMode: preloadSession.currentMode,
    configOptions: preloadSession.configOptions ?? null,
    models: preloadSession.models ?? null,
  };
}

/**
 * Resume an existing session without history replay
 * Requires agent to support resume session capability
 */
export async function resumeACPSession(
  agentId: string,
  sessionId: string,
  workingDirectory: string,
  mcpServers?: ResumeACPSessionRequest["mcpServers"],
): Promise<ACPSession> {
  const api = getACPApi();
  if (!api) throw new Error("ACP API not available");
  if (!api.resumeSession) {
    throw new Error("resumeSession not available in preload");
  }
  const preloadSession = await api.resumeSession({
    agentId,
    sessionId,
    workingDirectory,
    mcpServers,
  });
  return {
    sessionId: preloadSession.sessionId,
    agentId: preloadSession.agentId,
    workingDirectory: preloadSession.workingDirectory || workingDirectory,
    createdAt: preloadSession.createdAt,
    availableModes: preloadSession.availableModes,
    currentMode: preloadSession.currentMode,
    configOptions: preloadSession.configOptions ?? null,
    models: preloadSession.models ?? null,
  };
}

/**
 * Default auth method IDs for each agent
 * These match what the ACP adapters return in authMethods
 */
const AGENT_AUTH_METHOD_IDS: Record<string, string> = {
  "claude-code": "claude-login",
  codex: "login",
  gemini: "login",
};

/**
 * Authenticate with an ACP agent
 */
export async function authenticateACPAgent(
  agentId: string,
  methodId?: string,
): Promise<{ success: boolean; message?: string }> {
  const api = getACPApi();
  if (!api) throw new Error("ACP API not available");

  // Use agent-specific default method ID if not provided
  const actualMethodId = methodId || AGENT_AUTH_METHOD_IDS[agentId] || "login";
  return api.authenticate(agentId, actualMethodId);
}

/**
 * Respond to a permission request
 */
export async function respondToACPPermission(
  requestId: string,
  optionId: string,
  rememberGlobally = false,
): Promise<void> {
  const api = getACPApi();
  if (!api) throw new Error("ACP API not available");
  return api.respondPermission({ requestId, optionId, rememberGlobally });
}

/**
 * Subscribe to ACP agent started events
 */
export function onACPAgentStarted(
  callback: (data: { agentId: string }) => void,
): () => void {
  const api = getACPApi();
  if (!api) return () => {};
  return api.onAgentStarted(callback);
}

/**
 * Subscribe to ACP agent exit events
 */
export function onACPAgentExit(
  callback: (data: { agentId: string; code: number | null }) => void,
): () => void {
  const api = getACPApi();
  if (!api) return () => {};
  return api.onAgentExit(callback);
}

/**
 * Subscribe to ACP agent error events
 */
export function onACPAgentError(
  callback: (data: { agentId: string; error: string }) => void,
): () => void {
  const api = getACPApi();
  if (!api) return () => {};
  return api.onAgentError(callback);
}

/**
 * Subscribe to ACP agent authenticated events
 */
export function onACPAgentAuthenticated(
  callback: (data: { agentId: string }) => void,
): () => void {
  const api = getACPApi();
  if (!api) return () => {};
  return api.onAgentAuthenticated(callback);
}

/**
 * Subscribe to ACP auth required events
 */
export function onACPAuthRequired(
  callback: (data: {
    agentId: string;
    methods: Array<{ id: string; name: string; description?: string }>;
  }) => void,
): () => void {
  const api = getACPApi();
  if (!api) return () => {};
  return api.onAuthRequired(callback);
}

/**
 * Subscribe to ACP session created events
 */
export function onACPSessionCreated(
  callback: (session: ACPSession) => void,
): () => void {
  const api = getACPApi();
  if (!api) return () => {};
  // The session event returns ACPSession with sessionId (not id)
  return api.onSessionCreated((data) => {
    const session: ACPSession = {
      sessionId: data.session.sessionId,
      agentId: data.session.agentId,
      workingDirectory: data.session.workingDirectory || "",
      createdAt: data.session.createdAt,
      availableModes: data.session.availableModes,
      currentMode: data.session.currentMode,
      configOptions: data.session.configOptions ?? null,
      models: data.session.models ?? null,
    };
    callback(session);
  });
}

/**
 * Subscribe to ACP message chunk events (streaming)
 */
export function onACPMessageChunk(
  callback: (chunk: ACPMessageChunk) => void,
): () => void {
  const api = getACPApi();
  if (!api) return () => {};
  return api.onMessageChunk(callback);
}

/**
 * Subscribe to ACP permission request events
 */
export function onACPPermissionRequest(
  callback: (request: ACPPermissionRequest) => void,
): () => void {
  const api = getACPApi();
  if (!api) return () => {};
  // Convert preload permission request to ACPPermissionRequest format
  return api.onPermissionRequest((data) => {
    // Infer permission type from metadata or title
    const metadata = data.metadata || {};
    const permissionType =
      (metadata.permissionType as ACPPermissionRequest["permissionType"]) ||
      inferPermissionType(data.title);

    const request: ACPPermissionRequest = {
      requestId: data.requestId,
      agentId: data.agentId,
      sessionId: data.sessionId,
      permissionType,
      description: data.description || data.title,
      filePath: metadata.filePath as string | undefined,
      toolCallId: metadata.toolCallId as string | undefined,
      diff: metadata.diff as string | undefined,
      command: metadata.command as string | undefined,
      options: data.options.map((opt) => ({
        id: opt.id,
        label: opt.label,
        // Infer grants based on option id/label - "allow", "yes", "approve" grant permission
        grants: inferGrantsFromOption(opt.id, opt.label),
        remember: opt.isDefault,
      })),
    };
    callback(request);
  });
}

/**
 * Infer permission type from title string
 */
function inferPermissionType(
  title: string,
): ACPPermissionRequest["permissionType"] {
  // Guard against undefined/null/empty title
  if (!title || typeof title !== "string") {
    return "mcp_tool"; // Default fallback
  }

  const lowerTitle = title.toLowerCase();
  if (lowerTitle.includes("edit") || lowerTitle.includes("modify"))
    return "file_edit";
  if (lowerTitle.includes("create") || lowerTitle.includes("write"))
    return "file_create";
  if (lowerTitle.includes("delete") || lowerTitle.includes("remove"))
    return "file_delete";
  if (
    lowerTitle.includes("terminal") ||
    lowerTitle.includes("command") ||
    lowerTitle.includes("bash")
  )
    return "terminal";
  return "mcp_tool"; // Default fallback
}

/**
 * Infer whether an option grants permission based on its id/label
 */
function inferGrantsFromOption(id: string, label: string): boolean {
  // Guard against undefined/null values
  const safeId = id || "";
  const safeLabel = label || "";
  const lower = (safeId + safeLabel).toLowerCase();
  // Grant options typically contain these words
  const grantWords = [
    "allow",
    "yes",
    "approve",
    "accept",
    "ok",
    "confirm",
    "grant",
  ];
  // Deny options typically contain these words
  const denyWords = ["deny", "no", "reject", "cancel", "decline", "block"];

  for (const word of grantWords) {
    if (lower.includes(word)) return true;
  }
  for (const word of denyWords) {
    if (lower.includes(word)) return false;
  }
  // Default to false for unknown options
  return false;
}

// ============================================================================
// NEW EVENT SUBSCRIPTIONS (Features 2, 3, 4, 6)
// ============================================================================

/**
 * Subscribe to ACP session loaded events (Feature 2)
 */
export function onACPSessionLoaded(
  callback: (session: ACPSession) => void,
): () => void {
  const api = getACPApi();
  if (!api || !api.onSessionLoaded) return () => {};
  return api.onSessionLoaded(callback);
}

/**
 * Subscribe to ACP session resumed events (Feature 2)
 */
export function onACPSessionResumed(
  callback: (session: ACPSession) => void,
): () => void {
  const api = getACPApi();
  if (!api || !api.onSessionResumed) return () => {};
  return api.onSessionResumed(callback);
}

/**
 * Subscribe to ACP session recreated events (Feature 2)
 * Emitted when a session is recreated after agent restart
 */
export function onACPSessionRecreated(
  callback: (data: {
    agentId: string;
    oldSessionId: string;
    newSession: ACPSession;
  }) => void,
): () => void {
  const api = getACPApi();
  if (!api || !api.onSessionRecreated) return () => {};
  return api.onSessionRecreated(callback);
}

/**
 * Subscribe to ACP session context updated events
 * Emitted when session context (e.g., working directory) is updated
 */
export function onACPSessionContextUpdated(
  callback: (data: {
    agentId: string;
    sessionId: string;
    workingDirectory?: string;
  }) => void,
): () => void {
  const api = getACPApi();
  if (!api || !api.onSessionContextUpdated) return () => {};
  return api.onSessionContextUpdated(callback);
}

/**
 * Subscribe to ACP terminal created events (Feature 3)
 */
export function onACPTerminalCreated(
  callback: (data: {
    agentId: string;
    sessionId: string;
    terminalId: string;
    cwd?: string;
    label?: string;
  }) => void,
): () => void {
  const api = getACPApi();
  if (!api || !api.onTerminalCreated) return () => {};
  return api.onTerminalCreated(callback);
}

/**
 * Subscribe to ACP terminal output events (Feature 3)
 */
export function onACPTerminalOutput(
  callback: (data: {
    agentId: string;
    sessionId: string;
    terminalId: string;
    data: string;
  }) => void,
): () => void {
  const api = getACPApi();
  if (!api || !api.onTerminalOutput) return () => {};
  return api.onTerminalOutput(callback);
}

/**
 * Subscribe to ACP terminal exit events (Feature 3)
 */
export function onACPTerminalExit(
  callback: (data: {
    agentId: string;
    sessionId: string;
    terminalId: string;
    exitCode?: number;
    signal?: string;
  }) => void,
): () => void {
  const api = getACPApi();
  if (!api || !api.onTerminalExit) return () => {};
  return api.onTerminalExit(callback);
}

/**
 * Subscribe to ACP commands update events (Feature 4)
 */
export function onACPCommandsUpdate(
  callback: (data: {
    agentId: string;
    sessionId: string;
    commands: ACPAvailableCommand[];
  }) => void,
): () => void {
  const api = getACPApi();
  if (!api || !api.onCommandsUpdate) return () => {};
  return api.onCommandsUpdate(callback);
}

/**
 * Subscribe to ACP session info update events (Feature 6)
 */
export function onACPSessionInfoUpdate(
  callback: (data: ACPSessionInfoUpdateEvent) => void,
): () => void {
  const api = getACPApi();
  if (!api || !api.onSessionInfoUpdate) return () => {};
  return api.onSessionInfoUpdate(callback);
}

/**
 * Subscribe to ACP session mode update events
 */
export function onACPSessionModeUpdate(
  callback: (data: {
    agentId: string;
    sessionId: string;
    currentModeId?: string;
    availableModes?: Array<{ id: string; name: string }>;
  }) => void,
): () => void {
  const api = getACPApi();
  if (!api || !api.onSessionModeUpdate) return () => {};
  return api.onSessionModeUpdate(callback);
}

/**
 * Subscribe to ACP session model update events
 */
export function onACPSessionModelUpdate(
  callback: (data: {
    agentId: string;
    sessionId: string;
    currentModelId?: string;
    availableModels?: Array<{ modelId: string; name: string }>;
  }) => void,
): () => void {
  const api = getACPApi();
  if (!api || !api.onSessionModelUpdate) return () => {};
  return api.onSessionModelUpdate(callback);
}

/**
 * Subscribe to ACP session config update events
 */
export function onACPSessionConfigUpdate(
  callback: (data: {
    agentId: string;
    sessionId: string;
    configOptions?: Array<{
      id: string;
      name: string;
      type: string;
      value?: string | boolean;
    }>;
  }) => void,
): () => void {
  const api = getACPApi();
  if (!api || !api.onSessionConfigUpdate) return () => {};
  return api.onSessionConfigUpdate(callback);
}

// ============================================================================
// AUTO-DETECTION API (Zero-Config Agent Support)
// ============================================================================

/**
 * Force refresh ACP agent detection.
 * This will re-scan for installed agents (Claude Code, Codex, Gemini CLI).
 * Useful after installing a new agent or when agents aren't appearing.
 */
export async function autoDetectACPAgents(): Promise<ACPAgentStatus[]> {
  const api = getACPApi();
  if (!api || !api.autoDetect) {
    console.warn("[ACP] autoDetect not available in preload");
    return [];
  }
  return api.autoDetect();
}

/**
 * Start background polling for ACP agent detection.
 * This will periodically check for newly installed agents and
 * emit events when agents are detected/updated.
 *
 * @param intervalMs Polling interval in milliseconds (default: 30s)
 */
export async function startACPAutoDetectPolling(
  intervalMs?: number,
): Promise<{ success: boolean }> {
  const api = getACPApi();
  if (!api || !api.startAutoDetectPolling) {
    console.warn("[ACP] startAutoDetectPolling not available in preload");
    return { success: false };
  }
  return api.startAutoDetectPolling(intervalMs);
}

/**
 * Stop background polling for ACP agent detection.
 */
export async function stopACPAutoDetectPolling(): Promise<{ success: boolean }> {
  const api = getACPApi();
  if (!api || !api.stopAutoDetectPolling) {
    console.warn("[ACP] stopAutoDetectPolling not available in preload");
    return { success: false };
  }
  return api.stopAutoDetectPolling();
}

/**
 * Subscribe to ACP agents detected events (emitted at startup)
 */
export function onACPAgentsDetected(
  callback: (data: { agents: ACPAgentStatus[]; timestamp: number }) => void,
): () => void {
  const api = getACPApi();
  if (!api || !api.onAgentsDetected) return () => {};
  return api.onAgentsDetected(callback);
}

/**
 * Subscribe to ACP agents updated events (emitted during polling)
 */
export function onACPAgentsUpdated(
  callback: (data: { agents: ACPAgentStatus[]; timestamp: number }) => void,
): () => void {
  const api = getACPApi();
  if (!api || !api.onAgentsUpdated) return () => {};
  return api.onAgentsUpdated(callback);
}
