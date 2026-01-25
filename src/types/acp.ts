/**
 * ACP (Agent Client Protocol) Types for Belgrade/Shadower
 *
 * These types define the interfaces for integrating external coding agents
 * like Claude Code, Codex CLI, and Gemini CLI into the application.
 */

// Re-export essential types from the SDK
export type {
  InitializeRequest,
  InitializeResponse,
  NewSessionRequest,
  NewSessionResponse,
  PromptRequest,
  PromptResponse,
  SessionNotification,
  RequestPermissionRequest,
  RequestPermissionResponse,
  AuthenticateRequest,
  AuthenticateResponse,
  CancelNotification,
  StopReason,
  MessageContent,
  ToolCallContent,
  TextContent,
  ThinkingContent,
} from "@agentclientprotocol/sdk";

/**
 * Configuration for an ACP agent
 */
export interface ACPAgentConfig {
  /** Unique identifier for the agent */
  id: string;
  /** Display name shown in UI */
  name: string;
  /** Command to execute the agent */
  command: string;
  /** Arguments to pass to the command */
  args: string[];
  /** Environment variables to set */
  env?: Record<string, string>;
  /** Supported authentication methods */
  authMethods: ("LOGIN" | "API_KEY")[];
  /** Agent capabilities */
  capabilities: ("filesystem" | "terminal" | "mcp")[];
  /** Provider for icon display (maps to existing icons) */
  iconProvider: "anthropic" | "openai" | "google";
  /** Command to check if agent is installed */
  detectCommand: string;
  /** Arguments for detection command */
  detectArgs: string[];
}

/**
 * Status of an ACP agent
 */
export interface ACPAgentStatus {
  /** Agent identifier */
  id: string;
  /** Whether the agent CLI is installed */
  installed: boolean;
  /** Whether the agent is authenticated */
  authenticated: boolean;
  /** Current running state */
  running: boolean;
  /** Error message if any */
  error?: string;
  /** Agent version if available */
  version?: string;
}

/**
 * ACP session information
 */
export interface ACPSession {
  /** Session ID from the agent */
  sessionId: string;
  /** Agent ID this session belongs to */
  agentId: string;
  /** Working directory for the session */
  workingDirectory: string;
  /** When the session was created */
  createdAt: Date;
  /** Available modes for this session */
  availableModes?: string[];
  /** Current mode */
  currentMode?: string;
}

/**
 * Permission request from an agent
 */
export interface ACPPermissionRequest {
  /** Unique ID for this permission request */
  requestId: string;
  /** Agent requesting permission */
  agentId: string;
  /** Session ID */
  sessionId: string;
  /** Type of permission being requested */
  permissionType: "file_edit" | "file_create" | "file_delete" | "terminal" | "mcp_tool";
  /** Tool call ID if applicable */
  toolCallId?: string;
  /** Description of what's being requested */
  description: string;
  /** File path if file operation */
  filePath?: string;
  /** Diff preview for file edits */
  diff?: string;
  /** Terminal command if terminal operation */
  command?: string;
  /** Available response options */
  options: ACPPermissionOption[];
}

/**
 * Permission option that can be selected
 */
export interface ACPPermissionOption {
  /** Option identifier */
  id: string;
  /** Display label */
  label: string;
  /** Whether this grants permission */
  grants: boolean;
  /** Whether this should be remembered globally */
  remember?: boolean;
}

/**
 * Stored global permission
 */
export interface ACPStoredPermission {
  /** Agent ID */
  agentId: string;
  /** Permission type */
  permissionType: string;
  /** Tool name if applicable */
  toolName?: string;
  /** File pattern if applicable (glob) */
  filePattern?: string;
  /** When the permission was granted */
  grantedAt: Date;
}

/**
 * Message chunk from an ACP agent
 */
export interface ACPMessageChunk {
  /** Session ID */
  sessionId: string;
  /** Agent ID */
  agentId: string;
  /** Message ID */
  messageId: string;
  /** Content type */
  type: "text" | "thinking" | "tool_call" | "tool_result" | "error";
  /** Content data */
  content: string | ACPToolCallChunk;
  /** Whether this is the final chunk */
  done?: boolean;
}

/**
 * Tool call information in a message chunk
 */
export interface ACPToolCallChunk {
  /** Tool call ID */
  id: string;
  /** Tool name */
  name: string;
  /** Tool input (may be partial) */
  input?: Record<string, unknown>;
  /** Tool output if completed */
  output?: string;
  /** Current state */
  state: "pending" | "running" | "completed" | "failed" | "cancelled";
}

/**
 * Result of an ACP prompt
 */
export interface ACPPromptResult {
  /** Session ID */
  sessionId: string;
  /** Stop reason */
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "cancelled" | "error";
  /** Error message if stopReason is "error" */
  error?: string;
}

/**
 * Agent model info for the model selector
 */
export interface ACPAgentModel {
  /** Agent ID (used as model name) */
  name: string;
  /** Display name */
  displayName: string;
  /** Flag to identify as ACP agent */
  isACPAgent: true;
  /** Provider for icon (anthropic, openai, google) */
  acpProvider: "anthropic" | "openai" | "google";
  /** Whether tool calls are unsupported (always false for ACP agents) */
  isToolCallUnsupported: false;
  /** Whether image input is unsupported */
  isImageInputUnsupported: boolean;
  /** Supported file MIME types */
  supportedFileMimeTypes: string[];
  /** Agent is a reasoning model (for display purposes) */
  isReasoningModel: boolean;
  /** Workflow generation support */
  workflowGenerationSupport: "none";
}

/**
 * IPC request to start an ACP session
 */
export interface StartACPSessionRequest {
  agentId: string;
  workingDirectory: string;
  mcpServers?: Array<{
    name: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
  }>;
}

/**
 * IPC request to send a prompt to an ACP agent
 */
export interface SendACPPromptRequest {
  agentId: string;
  sessionId: string;
  message: string;
  contextFiles?: Array<{
    path: string;
    content?: string;
  }>;
}

/**
 * IPC request to respond to a permission request
 */
export interface RespondToPermissionRequest {
  requestId: string;
  optionId: string;
  rememberGlobally?: boolean;
}
