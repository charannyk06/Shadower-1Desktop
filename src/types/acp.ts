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
  SessionConfigSelectGroup,
  SessionConfigSelectOption,
  ModelInfo,
  PromptRequest,
  PromptResponse,
  SessionNotification,
  RequestPermissionRequest,
  RequestPermissionResponse,
  AuthenticateRequest,
  AuthenticateResponse,
  CancelNotification,
  StopReason,
  ToolCallContent,
  TextContent,
  ContentBlock,
} from "@agentclientprotocol/sdk";

// Session config select types (local definitions to avoid SDK dependency issues)
export interface LocalSessionConfigSelectOption {
  value: string;
  name: string;
  description?: string;
}

export interface LocalSessionConfigSelectGroup {
  name: string;
  options: LocalSessionConfigSelectOption[];
}

// Session config option type (fallback if not exported by SDK)
export interface SessionConfigOption {
  id: string;
  name: string;
  label?: string;
  type: "select" | "toggle" | "text";
  value?: string | boolean;
  currentValue?: string;
  category?: string;
  options?: LocalSessionConfigSelectOption[] | LocalSessionConfigSelectGroup[];
}

// Session model info type
export interface SessionModelInfo {
  modelId: string;
  name: string;
  description?: string;
}

// Session model state type (fallback if not exported by SDK)
export interface SessionModelState {
  modelId?: string;
  modelName?: string;
  provider?: string;
  currentModelId?: string;
  availableModels?: SessionModelInfo[];
}

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
  /** Paths to check for authentication (relative to home dir, e.g., ".claude/.anthropic") */
  authPaths?: string[];
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
  /** Agent capabilities (available after agent is started) */
  capabilities?: ACPAgentCapabilities;
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
  /** Session config options (model/thought level/etc) */
  configOptions?: SessionConfigOption[] | null;
  /** Session model state */
  models?: SessionModelState | null;
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
  permissionType:
    | "file_edit"
    | "file_create"
    | "file_delete"
    | "terminal"
    | "mcp_tool";
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
 * All possible message chunk types
 */
export type ACPMessageChunkType =
  | "text"
  | "thinking"
  | "tool_call"
  | "tool_result"
  | "error"
  | "plan"
  | "terminal_output"
  | "terminal_exit"
  | "commands_update"
  | "session_info";

/**
 * Message chunk from an ACP agent
 */
export interface ACPMessageChunk {
  /** Session ID */
  sessionId: string;
  /** Agent ID */
  agentId: string;
  /** Role of the sender (if available) */
  role?: "user" | "assistant";
  /** Message ID */
  messageId: string;
  /** Content type */
  type: ACPMessageChunkType;
  /** Content data */
  content:
    | string
    | ACPToolCallChunk
    | ACPPlan
    | ACPTerminalOutput
    | ACPTerminalExit
    | ACPAvailableCommand[]
    | ACPSessionInfoUpdateEvent;
  /** Whether this is the final chunk */
  done?: boolean;
}

/**
 * Tool call content block from ACP
 */
export interface ACPToolCallContentBlock {
  type: "text" | "diff" | "terminal" | "subagent";
  text?: string;
  diff?: { path: string; content: string };
  terminalId?: string;
  terminalOutput?: string;
}

/**
 * Tool call location from ACP
 */
export interface ACPToolCallLocation {
  path: string;
  line?: number;
}

/**
 * Tool call information in a message chunk
 */
export interface ACPToolCallChunk {
  /** Tool call ID */
  id: string;
  /** Tool name (display title) */
  name: string;
  /** Tool input (may be partial) */
  input?: Record<string, unknown>;
  /** Tool output if completed */
  output?: string | Record<string, unknown>;
  /** Current state */
  state: "pending" | "running" | "completed" | "failed" | "cancelled";
  /** The programmatic tool name from meta (if available) */
  toolName?: string;
  /** Whether this is a subagent tool call */
  isSubagent?: boolean;
  /** Subagent session ID (if this is a subagent and session was created) */
  subagentSessionId?: string;
  /** Tool kind from ACP */
  kind?: string;
  /** Parsed content blocks (diffs, text, terminal output) */
  content?: ACPToolCallContentBlock[];
  /** File locations referenced by the tool call */
  locations?: ACPToolCallLocation[];
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

/**
 * IPC request to set ACP session model
 */
export interface SetACPSessionModelRequest {
  agentId: string;
  sessionId: string;
  modelId: string;
}

/**
 * IPC request to set ACP session config option
 */
export interface SetACPSessionConfigOptionRequest {
  agentId: string;
  sessionId: string;
  configId: string;
  value: string;
}

/**
 * IPC request to set ACP session mode
 */
export interface SetACPSessionModeRequest {
  agentId: string;
  sessionId: string;
  modeId: string;
}

// ============================================================================
// PLAN TYPES (Feature 1)
// ============================================================================

/**
 * Plan from an ACP agent representing a multi-step task
 */
export interface ACPPlan {
  /** Unique plan identifier */
  planId: string;
  /** Plan title/summary */
  title?: string;
  /** Steps in the plan */
  steps: ACPPlanStep[];
  /** Overall plan status */
  status: "pending" | "in_progress" | "completed" | "failed";
}

/**
 * Individual step in an ACP plan
 */
export interface ACPPlanStep {
  /** Step identifier */
  id: string;
  /** Step description */
  description: string;
  /** Step execution status */
  status: "pending" | "in_progress" | "completed" | "failed";
}

// ============================================================================
// SESSION LIST/LOAD/RESUME TYPES (Feature 2)
// ============================================================================

/**
 * Information about an existing ACP session
 */
export interface ACPSessionInfo {
  /** Session ID */
  sessionId: string;
  /** Working directory for the session */
  cwd?: string;
  /** Session title (may be generated from first message) */
  title?: string;
  /** When the session was last updated */
  updatedAt?: Date;
  /** Additional session metadata */
  meta?: Record<string, unknown>;
}

/**
 * Request to list available sessions
 */
export interface ACPSessionListRequest {
  /** Filter by working directory */
  cwd?: string;
  /** Pagination cursor */
  cursor?: string;
}

/**
 * Response from listing sessions
 */
export interface ACPSessionListResponse {
  /** List of sessions */
  sessions: ACPSessionInfo[];
  /** Cursor for next page (if more results available) */
  nextCursor?: string;
  /** Additional response metadata */
  meta?: Record<string, unknown>;
}

/**
 * Request to load an existing session
 */
export interface LoadACPSessionRequest {
  agentId: string;
  sessionId: string;
  workingDirectory: string;
  mcpServers?: Array<{
    name: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
  }>;
}

/**
 * Request to resume an existing session (without history replay)
 */
export interface ResumeACPSessionRequest {
  agentId: string;
  sessionId: string;
  workingDirectory: string;
  mcpServers?: Array<{
    name: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
  }>;
}

/**
 * Agent capabilities reported during initialization
 */
export interface ACPAgentCapabilities {
  /** Whether the agent supports loading existing sessions */
  loadSession: boolean;
  /** Whether the agent supports listing sessions */
  sessionList: boolean;
  /** Whether the agent supports resuming sessions */
  sessionResume: boolean;
  /** Prompt capabilities */
  prompt?: {
    image?: boolean;
    audio?: boolean;
    embeddedContext?: boolean;
  };
}

// ============================================================================
// TERMINAL STREAMING TYPES (Feature 3)
// ============================================================================

/**
 * Information about a terminal created by an agent
 */
export interface ACPTerminalInfo {
  /** Terminal identifier */
  terminalId: string;
  /** Working directory for the terminal */
  cwd?: string;
  /** Display label for the terminal */
  label?: string;
}

/**
 * Terminal output data streamed from an agent
 */
export interface ACPTerminalOutput {
  /** Terminal identifier */
  terminalId: string;
  /** Output data (may be partial) */
  data: string;
}

/**
 * Terminal exit event from an agent
 */
export interface ACPTerminalExit {
  /** Terminal identifier */
  terminalId: string;
  /** Exit code (if available) */
  exitCode?: number;
  /** Signal that caused exit (if applicable) */
  signal?: string;
}

/**
 * Terminal event emitted by the ACP service
 */
export interface ACPTerminalEvent {
  /** Agent ID */
  agentId: string;
  /** Session ID */
  sessionId: string;
  /** Terminal ID */
  terminalId: string;
  /** Event type */
  type: "created" | "output" | "exit";
  /** Terminal info (for created event) */
  info?: ACPTerminalInfo;
  /** Output data (for output event) */
  data?: string;
  /** Exit info (for exit event) */
  exit?: {
    exitCode?: number;
    signal?: string;
  };
}

// ============================================================================
// AVAILABLE COMMANDS TYPES (Feature 4)
// ============================================================================

/**
 * A command available in the current session
 */
export interface ACPAvailableCommand {
  /** Command identifier */
  id: string;
  /** Command name */
  name: string;
  /** Command description */
  description?: string;
  /** Command arguments */
  arguments?: ACPCommandArgument[];
}

/**
 * Argument for an available command
 */
export interface ACPCommandArgument {
  /** Argument name */
  name: string;
  /** Argument description */
  description?: string;
  /** Whether the argument is required */
  required?: boolean;
}

/**
 * Event when available commands are updated
 */
export interface ACPCommandsUpdateEvent {
  /** Agent ID */
  agentId: string;
  /** Session ID */
  sessionId: string;
  /** Updated list of available commands */
  commands: ACPAvailableCommand[];
}

// ============================================================================
// SUBAGENT TYPES (Feature 5)
// ============================================================================

/**
 * Meta key used to store the tool's programmatic name
 * This is a workaround since ACP's ToolCall doesn't have a dedicated name field
 */
export const TOOL_NAME_META_KEY = "tool_name";

/**
 * The tool name for subagent spawning
 */
export const SUBAGENT_TOOL_NAME = "subagent";

/**
 * Extended tool call chunk with subagent information
 */
export interface ACPSubagentToolCall extends ACPToolCallChunk {
  /** Whether this tool call is spawning a subagent */
  isSubagent: true;
  /** Session ID of the spawned subagent (if available) */
  subagentSessionId?: string;
  /** The programmatic tool name from meta */
  toolName?: string;
}

/**
 * Type guard to check if a tool call is a subagent spawn
 */
export function isSubagentToolCall(
  toolCall: ACPToolCallChunk,
): toolCall is ACPSubagentToolCall {
  return (
    "isSubagent" in toolCall &&
    (toolCall as ACPSubagentToolCall).isSubagent === true
  );
}

// ============================================================================
// SESSION INFO UPDATE TYPES (Feature 6)
// ============================================================================

/**
 * Event when session info is updated (e.g., title change)
 */
export interface ACPSessionInfoUpdateEvent {
  /** Agent ID */
  agentId: string;
  /** Session ID */
  sessionId: string;
  /** Updated title */
  title?: string;
  /** Updated metadata */
  meta?: Record<string, unknown>;
}
