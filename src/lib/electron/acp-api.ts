/**
 * ACP (Agent Client Protocol) API for Renderer Process
 *
 * This module provides a type-safe API for interacting with ACP agents
 * from the renderer process via IPC.
 */

import type {
  ACPAgentStatus,
  ACPSession,
  ACPPromptResult,
  ACPMessageChunk,
  ACPPermissionRequest,
  StartACPSessionRequest,
  SendACPPromptRequest,
  RespondToPermissionRequest,
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

// Type for the IPC API exposed by preload
interface ACPElectronAPI {
  listAgents: (forceRefresh?: boolean) => Promise<ACPAgentStatus[]>;
  getAgentStatus: (agentId: string) => Promise<ACPAgentStatus | undefined>;
  startAgent: (agentId: string) => Promise<void>;
  stopAgent: (agentId: string) => Promise<void>;
  createSession: (request: StartACPSessionRequest) => Promise<ACPSession>;
  prompt: (request: SendACPPromptRequest) => Promise<ACPPromptResult>;
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
    callback: (data: { agentId: string; code: number; signal: string }) => void
  ) => () => void;
  onAgentError: (
    callback: (data: { agentId: string; error: Error }) => void
  ) => () => void;
  onAgentAuthenticated: (
    callback: (data: { agentId: string }) => void
  ) => () => void;
  onAuthRequired: (callback: (data: { agentId: string }) => void) => () => void;
  onSessionCreated: (callback: (session: ACPSession) => void) => () => void;
  onMessageChunk: (callback: (chunk: ACPMessageChunk) => void) => () => void;
  onPermissionRequest: (
    callback: (request: ACPPermissionRequest) => void
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
  return api.createSession({ agentId, workingDirectory, mcpServers });
}

/**
 * Send a prompt to an ACP agent session
 */
export async function sendACPPrompt(
  agentId: string,
  sessionId: string,
  message: string,
  contextFiles?: SendACPPromptRequest["contextFiles"]
): Promise<ACPPromptResult> {
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
  callback: (data: { agentId: string; code: number; signal: string }) => void
): () => void {
  const api = getACPApi();
  if (!api) return () => {};
  return api.onAgentExit(callback);
}

/**
 * Subscribe to ACP agent error events
 */
export function onACPAgentError(
  callback: (data: { agentId: string; error: Error }) => void
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
  return api.onSessionCreated(callback);
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
  return api.onPermissionRequest(callback);
}
