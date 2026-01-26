/**
 * ACP (Agent Client Protocol) API for Renderer Process
 *
 * This module provides a type-safe API for interacting with ACP agents
 * from the renderer process via IPC.
 */

import type {
  ACPAgentStatus,
  ACPSession,
  ACPMessageChunk,
  ACPPermissionRequest,
  StartACPSessionRequest,
  SendACPPromptRequest,
  RespondToPermissionRequest,
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

// Preload returns a different shape for prompt results
interface PreloadPromptResult {
  content: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
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

// Type for the IPC API exposed by preload
interface ACPElectronAPI {
  listAgents: (forceRefresh?: boolean) => Promise<ACPAgentStatus[]>;
  getAgentStatus: (agentId: string) => Promise<ACPAgentStatus | undefined>;
  startAgent: (agentId: string) => Promise<void>;
  stopAgent: (agentId: string) => Promise<void>;
  createSession: (request: StartACPSessionRequest) => Promise<PreloadACPSession>;
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
    methodId: string
  ) => Promise<{ success: boolean; message?: string }>;
  respondPermission: (request: RespondToPermissionRequest) => Promise<void>;
  getInstalledAgents: () => Promise<ACPAgentStatus[]>;
  // Event listeners
  onAgentStarted: (callback: (data: { agentId: string }) => void) => () => void;
  onAgentExit: (
    callback: (data: { agentId: string; code: number | null }) => void
  ) => () => void;
  onAgentError: (
    callback: (data: { agentId: string; error: string }) => void
  ) => () => void;
  onAgentAuthenticated: (
    callback: (data: { agentId: string }) => void
  ) => () => void;
  onAuthRequired: (callback: (data: { agentId: string }) => void) => () => void;
  onSessionCreated: (callback: (data: PreloadSessionCreatedData) => void) => () => void;
  onMessageChunk: (callback: (chunk: ACPMessageChunk) => void) => () => void;
  onPermissionRequest: (
    callback: (request: PreloadPermissionRequest) => void
  ) => () => void;
}

// Get the ACP API from the window object
function getACPApi(): ACPElectronAPI | null {
  if (typeof window !== "undefined" && "electronAPI" in window) {
    const electronAPI = (window as { electronAPI?: { acp?: ACPElectronAPI } })
      .electronAPI;
    return electronAPI?.acp || null;
  }
  return null;
}

/**
 * List all available ACP agents and their status
 */
export async function listACPAgents(
  forceRefresh = false
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
  agentId: string
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
  mcpServers?: StartACPSessionRequest["mcpServers"]
): Promise<ACPSession> {
  const api = getACPApi();
  if (!api) throw new Error("ACP API not available");
  const preloadSession = await api.createSession({ agentId, workingDirectory, mcpServers });
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
 * This function returns basic info about the prompt request.
 */
export async function sendACPPrompt(
  agentId: string,
  sessionId: string,
  message: string,
  contextFiles?: SendACPPromptRequest["contextFiles"]
): Promise<{ content: string; usage?: { inputTokens: number; outputTokens: number } }> {
  const api = getACPApi();
  if (!api) throw new Error("ACP API not available");
  return api.prompt({ agentId, sessionId, message, contextFiles });
}

/**
 * Cancel an ongoing prompt
 */
export async function cancelACPPrompt(
  agentId: string,
  sessionId: string
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
  modelId: string
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
  value: string
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
  modeId: string
): Promise<void> {
  const api = getACPApi();
  if (!api) throw new Error("ACP API not available");
  return api.setSessionMode({ agentId, sessionId, modeId });
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
  methodId?: string
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
  rememberGlobally = false
): Promise<void> {
  const api = getACPApi();
  if (!api) throw new Error("ACP API not available");
  return api.respondPermission({ requestId, optionId, rememberGlobally });
}

/**
 * Subscribe to ACP agent started events
 */
export function onACPAgentStarted(
  callback: (data: { agentId: string }) => void
): () => void {
  const api = getACPApi();
  if (!api) return () => {};
  return api.onAgentStarted(callback);
}

/**
 * Subscribe to ACP agent exit events
 */
export function onACPAgentExit(
  callback: (data: { agentId: string; code: number | null }) => void
): () => void {
  const api = getACPApi();
  if (!api) return () => {};
  return api.onAgentExit(callback);
}

/**
 * Subscribe to ACP agent error events
 */
export function onACPAgentError(
  callback: (data: { agentId: string; error: string }) => void
): () => void {
  const api = getACPApi();
  if (!api) return () => {};
  return api.onAgentError(callback);
}

/**
 * Subscribe to ACP agent authenticated events
 */
export function onACPAgentAuthenticated(
  callback: (data: { agentId: string }) => void
): () => void {
  const api = getACPApi();
  if (!api) return () => {};
  return api.onAgentAuthenticated(callback);
}

/**
 * Subscribe to ACP auth required events
 */
export function onACPAuthRequired(
  callback: (data: { agentId: string }) => void
): () => void {
  const api = getACPApi();
  if (!api) return () => {};
  return api.onAuthRequired(callback);
}

/**
 * Subscribe to ACP session created events
 */
export function onACPSessionCreated(
  callback: (session: ACPSession) => void
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
  callback: (chunk: ACPMessageChunk) => void
): () => void {
  const api = getACPApi();
  if (!api) return () => {};
  return api.onMessageChunk(callback);
}

/**
 * Subscribe to ACP permission request events
 */
export function onACPPermissionRequest(
  callback: (request: ACPPermissionRequest) => void
): () => void {
  const api = getACPApi();
  if (!api) return () => {};
  // Convert preload permission request to ACPPermissionRequest format
  return api.onPermissionRequest((data) => {
    // Infer permission type from metadata or title
    const metadata = data.metadata || {};
    const permissionType = (metadata.permissionType as ACPPermissionRequest["permissionType"])
      || inferPermissionType(data.title);

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
      options: data.options.map(opt => ({
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
function inferPermissionType(title: string): ACPPermissionRequest["permissionType"] {
  // Guard against undefined/null/empty title
  if (!title || typeof title !== "string") {
    return "mcp_tool"; // Default fallback
  }

  const lowerTitle = title.toLowerCase();
  if (lowerTitle.includes("edit") || lowerTitle.includes("modify")) return "file_edit";
  if (lowerTitle.includes("create") || lowerTitle.includes("write")) return "file_create";
  if (lowerTitle.includes("delete") || lowerTitle.includes("remove")) return "file_delete";
  if (lowerTitle.includes("terminal") || lowerTitle.includes("command") || lowerTitle.includes("bash")) return "terminal";
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
  const grantWords = ["allow", "yes", "approve", "accept", "ok", "confirm", "grant"];
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
