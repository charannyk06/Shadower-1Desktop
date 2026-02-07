import { spawn, ChildProcess } from "child_process";
import { promisify } from "util";
import { exec } from "child_process";
import { existsSync, promises as fsPromises } from "fs";
import { homedir } from "os";
import { join } from "path";
import { EventEmitter } from "events";
import {
  ClientSideConnection,
  ndJsonStream,
  type Client,
  type Agent,
  type SessionNotification,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
} from "@agentclientprotocol/sdk";
import type {
  ACPAgentConfig,
  ACPAgentStatus,
  ACPAgentCapabilities,
  ACPSession,
  ACPSessionInfo,
  ACPSessionListRequest,
  ACPSessionListResponse,
  ACPMessageChunk,
  ACPMessageChunkType,
  ACPPermissionRequest,
  ACPPromptResult,
  ACPPlan,
  ACPTerminalInfo,
  ACPTerminalOutput,
  ACPTerminalExit,
  ACPAvailableCommand,
  ACPToolCallChunk,
} from "../../src/types/acp";
import { TOOL_NAME_META_KEY, SUBAGENT_TOOL_NAME } from "../../src/types/acp";
import {
  ACP_AGENT_CONFIGS,
  getAgentConfig,
  getAgentNpxConfig,
} from "./acp-agents";
import { getStoredPermission } from "./session-persistence";

const execAsync = promisify(exec);

// ============================================================================
// NODE.JS / NPX PATH RESOLUTION (for packaged Electron apps)
// ============================================================================

/**
 * Get common Node.js installation paths to add to PATH
 * Packaged Electron apps don't inherit user's shell PATH, so we need to manually add common paths
 */
function getNodePaths(): string[] {
  const home = homedir();
  const paths: string[] = [];

  if (process.platform === "win32") {
    // Windows Node.js installation paths
    paths.push(
      // npm global modules
      join(process.env.APPDATA || "", "npm"),
      join(home, "AppData", "Roaming", "npm"),
      // Node.js default installation paths
      "C:\\Program Files\\nodejs",
      "C:\\Program Files (x86)\\nodejs",
      join(home, "AppData", "Local", "Programs", "nodejs"),
      // nvm-windows
      join(process.env.NVM_HOME || "", ""),
      join(process.env.NVM_SYMLINK || "", ""),
      join(home, ".nvm"),
      // fnm (Fast Node Manager)
      join(process.env.FNM_MULTISHELL_PATH || "", ""),
      join(home, ".fnm", "aliases", "default", "bin"),
      // Volta
      join(process.env.VOLTA_HOME || "", "bin"),
      join(home, ".volta", "bin"),
      // pnpm
      join(home, "AppData", "Local", "pnpm"),
      // Scoop package manager
      join(home, "scoop", "shims"),
      join(home, "scoop", "apps", "nodejs", "current"),
      join(home, "scoop", "apps", "nodejs-lts", "current"),
      // Chocolatey package manager
      "C:\\ProgramData\\chocolatey\\bin",
      join(process.env.ChocolateyInstall || "C:\\ProgramData\\chocolatey", "bin"),
      // winget installed apps
      join(home, "AppData", "Local", "Microsoft", "WinGet", "Packages"),
      // Git for Windows (often includes node tools)
      "C:\\Program Files\\Git\\cmd",
      "C:\\Program Files\\Git\\bin",
    );
  } else {
    // Unix-like systems (macOS, Linux)
    paths.push(
      // Standard paths
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
      // npm global
      join(home, ".npm-global", "bin"),
      join(home, ".npm", "bin"),
      "/usr/local/lib/node_modules/.bin",
      // nvm
      join(home, ".nvm", "versions", "node"),
      // fnm
      join(process.env.FNM_MULTISHELL_PATH || "", "bin"),
      join(home, ".fnm", "aliases", "default", "bin"),
      // Volta
      join(process.env.VOLTA_HOME || "", "bin"),
      join(home, ".volta", "bin"),
      // pnpm
      join(home, ".local", "share", "pnpm"),
      // yarn
      join(home, ".yarn", "bin"),
    );

    // macOS specific
    if (process.platform === "darwin") {
      paths.push(
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
        "/opt/local/bin",
        // macOS default Node.js from pkg installer
        "/usr/local/lib/node_modules/.bin",
        // asdf version manager
        join(home, ".asdf", "shims"),
        // mise (formerly rtx) version manager
        join(home, ".local", "share", "mise", "shims"),
      );
    }

    // Linux specific
    if (process.platform === "linux") {
      paths.push(
        // Snap packages
        "/snap/bin",
        "/var/lib/snapd/snap/bin",
        // Flatpak
        join(home, ".local", "share", "flatpak", "exports", "bin"),
        "/var/lib/flatpak/exports/bin",
        // asdf version manager
        join(home, ".asdf", "shims"),
        // mise (formerly rtx) version manager
        join(home, ".local", "share", "mise", "shims"),
        // n (node version manager)
        join(home, "n", "bin"),
        // Linuxbrew
        join(home, ".linuxbrew", "bin"),
        "/home/linuxbrew/.linuxbrew/bin",
      );
    }
  }

  // Filter out empty paths and non-existent directories
  return paths.filter(p => p && existsSync(p));
}

/**
 * Build enhanced PATH environment with Node.js paths prepended
 */
function getEnhancedPath(): string {
  const nodePaths = getNodePaths();
  const currentPath = process.env.PATH || process.env.Path || "";
  const separator = process.platform === "win32" ? ";" : ":";

  // Prepend node paths to ensure they're found first
  return [...nodePaths, currentPath].join(separator);
}

/**
 * Resolve a command (like npx) to its full path
 * @param command - The command name (e.g., "npx", "claude")
 * @returns Full path to the command, or the original command if not found
 */
async function resolveCommandPath(command: string): Promise<string> {
  // First, check if it's already an absolute path
  if (existsSync(command)) {
    return command;
  }

  const home = homedir();
  const cmdSuffix = process.platform === "win32" ? ".cmd" : "";
  const exeSuffix = process.platform === "win32" ? ".exe" : "";

  // Build list of candidate paths
  const candidates: string[] = [];

  if (process.platform === "win32") {
    // Windows-specific paths
    candidates.push(
      join(process.env.APPDATA || "", "npm", `${command}${cmdSuffix}`),
      join(process.env.APPDATA || "", "npm", `${command}${exeSuffix}`),
      join(home, "AppData", "Roaming", "npm", `${command}${cmdSuffix}`),
      join(home, "AppData", "Roaming", "npm", `${command}${exeSuffix}`),
      `C:\\Program Files\\nodejs\\${command}${cmdSuffix}`,
      `C:\\Program Files\\nodejs\\${command}${exeSuffix}`,
      join(home, "AppData", "Local", "pnpm", `${command}${cmdSuffix}`),
      join(home, "AppData", "Local", "pnpm", `${command}${exeSuffix}`),
      join(home, ".volta", "bin", `${command}${cmdSuffix}`),
      join(home, ".volta", "bin", `${command}${exeSuffix}`),
    );
  } else {
    // Unix-like systems
    candidates.push(
      `/usr/local/bin/${command}`,
      `/usr/bin/${command}`,
      join(home, ".npm-global", "bin", command),
      join(home, ".npm", "bin", command),
      join(home, ".local", "share", "pnpm", command),
      join(home, ".volta", "bin", command),
      join(home, ".yarn", "bin", command),
    );

    if (process.platform === "darwin") {
      candidates.push(
        `/opt/homebrew/bin/${command}`,
        `/opt/local/bin/${command}`,
      );
    }
  }

  // Check each candidate
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      console.log(`[ACP] Resolved ${command} to: ${candidate}`);
      return candidate;
    }
  }

  // Try using which/where to find the command
  try {
    const whichCmd = process.platform === "win32" ? "where" : "which";
    const { stdout } = await execAsync(`${whichCmd} ${command}`, {
      timeout: 3000,
      env: { ...process.env, PATH: getEnhancedPath() },
    });
    const resolvedPath = stdout.trim().split("\n")[0];
    if (resolvedPath && existsSync(resolvedPath)) {
      console.log(`[ACP] Resolved ${command} via ${whichCmd}: ${resolvedPath}`);
      return resolvedPath;
    }
  } catch {
    // which/where failed
  }

  // Return original command as fallback
  console.log(`[ACP] Could not resolve ${command} to absolute path, using as-is`);
  return command;
}

// ============================================================================
// TOOL CALL STATUS MAPPING (ACP SDK compatibility)
// ============================================================================

/**
 * ACP SDK tool call status values (may be PascalCase or snake_case)
 * @internal Used for documentation and type safety in mapToolCallStatus
 */
// @ts-ignore - Type alias kept for documentation
type _ACPToolCallStatus =
  | "Pending"
  | "pending"
  | "InProgress"
  | "in_progress"
  | "Completed"
  | "completed"
  | "Failed"
  | "failed"
  | "Rejected"
  | "rejected"
  | "Canceled"
  | "canceled"
  | "cancelled"
  | "error";

/**
 * Normalized tool call status for UI
 */
type NormalizedToolStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * Map ACP SDK tool call status to normalized UI status
 * Handles both PascalCase and snake_case variants from ACP SDK
 */
function mapToolCallStatus(status?: string | null): NormalizedToolStatus {
  if (!status) return "pending";

  const normalized = status.toLowerCase().replace(/_/g, "");

  switch (normalized) {
    case "pending":
      return "pending";
    case "inprogress":
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "failed":
    case "error":
      return "failed";
    case "rejected":
    case "canceled":
    case "cancelled":
      return "cancelled";
    default:
      console.warn(
        `[ACP] Unknown tool call status: ${status}, defaulting to pending`,
      );
      return "pending";
  }
}

/**
 * Check if a tool call status indicates completion (success or failure)
 */
function isToolCallComplete(status?: string | null): boolean {
  if (!status) return false;
  const normalized = status.toLowerCase().replace(/_/g, "");
  return [
    "completed",
    "failed",
    "error",
    "rejected",
    "canceled",
    "cancelled",
  ].includes(normalized);
}

// ============================================================================
// STOP REASON MAPPING (ACP SDK compatibility)
// ============================================================================

/**
 * ACP SDK stop reason values
 * @internal Used for documentation and type safety in mapStopReason
 */
// @ts-ignore - Type alias kept for documentation
type _ACPStopReason =
  | "end_turn"
  | "EndTurn"
  | "tool_use"
  | "ToolUse"
  | "max_tokens"
  | "MaxTokens"
  | "cancelled"
  | "Cancelled"
  | "error"
  | "Error"
  | string;

/**
 * Normalized stop reason for UI
 */
type NormalizedStopReason =
  | "end_turn"
  | "tool_use"
  | "max_tokens"
  | "cancelled"
  | "error";

/**
 * Map ACP SDK stop reason to normalized format
 * Handles both snake_case and PascalCase variants
 */
function mapStopReason(stopReason?: string | null): NormalizedStopReason {
  if (!stopReason) return "end_turn";

  const normalized = stopReason.toLowerCase().replace(/_/g, "");

  switch (normalized) {
    case "endturn":
    case "end":
      return "end_turn";
    case "tooluse":
    case "tool":
      return "tool_use";
    case "maxtokens":
    case "max":
      return "max_tokens";
    case "cancelled":
    case "canceled":
    case "cancel":
      return "cancelled";
    case "error":
      return "error";
    default:
      console.warn(
        `[ACP] Unknown stop reason: ${stopReason}, defaulting to end_turn`,
      );
      return "end_turn";
  }
}

/**
 * Check if stop reason indicates the agent wants to use tools
 * @internal Utility function for potential future use
 */
// @ts-ignore - Utility function kept for future use
function _isToolUseStopReason(stopReason?: string | null): boolean {
  if (!stopReason) return false;
  const normalized = stopReason.toLowerCase().replace(/_/g, "");
  return normalized === "tooluse" || normalized === "tool";
}

/**
 * Check if stop reason indicates the agent reached max tokens
 * @internal Utility function for potential future use
 */
// @ts-ignore - Utility function kept for future use
function _isMaxTokensStopReason(stopReason?: string | null): boolean {
  if (!stopReason) return false;
  const normalized = stopReason.toLowerCase().replace(/_/g, "");
  return normalized === "maxtokens" || normalized === "max";
}

// ============================================================================
// DETECTION CACHE CONFIGURATION
// ============================================================================
const DETECTION_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache TTL
const DETECTION_POLLING_INTERVAL_MS = 30 * 1000; // 30 seconds default polling interval

// ============================================================================
// MCP SERVER VALIDATION
// ============================================================================

interface MCPServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface MCPValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate MCP server configurations before passing to agent
 */
function validateMCPServers(
  mcpServers: MCPServerConfig[] | undefined
): MCPValidationResult {
  const result: MCPValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
  };

  if (!mcpServers || mcpServers.length === 0) {
    return result;
  }

  for (const server of mcpServers) {
    // Validate name
    if (!server.name || server.name.trim() === "") {
      result.errors.push("MCP server missing name");
      result.valid = false;
      continue;
    }

    // Validate command
    if (!server.command || server.command.trim() === "") {
      result.errors.push(`MCP server "${server.name}" missing command`);
      result.valid = false;
      continue;
    }

    // Validate args are strings
    if (server.args) {
      if (!Array.isArray(server.args)) {
        result.errors.push(`MCP server "${server.name}": args must be an array`);
        result.valid = false;
      } else if (server.args.some((a) => typeof a !== "string")) {
        result.errors.push(
          `MCP server "${server.name}": all args must be strings`
        );
        result.valid = false;
      }
    }

    // Validate env is object with string values
    if (server.env) {
      if (typeof server.env !== "object" || Array.isArray(server.env)) {
        result.errors.push(
          `MCP server "${server.name}": env must be an object`
        );
        result.valid = false;
      } else {
        for (const [key, value] of Object.entries(server.env)) {
          if (typeof value !== "string") {
            result.errors.push(
              `MCP server "${server.name}": env.${key} must be a string`
            );
            result.valid = false;
          }
        }
      }
    }

    // Warning for common command issues
    if (
      server.command.includes(" ") &&
      !server.command.startsWith('"') &&
      !server.command.startsWith("'")
    ) {
      result.warnings.push(
        `MCP server "${server.name}": command contains spaces but isn't quoted`
      );
    }
  }

  return result;
}

// ============================================================================
// AGENTIC LOOP CONFIGURATION (Following Zed's patterns)
// ============================================================================
const MAX_RETRY_ATTEMPTS = 4;
const BASE_RETRY_DELAY_MS = 5000; // 5 seconds
const MAX_AGENTIC_LOOP_ITERATIONS = 50; // Safety limit
const AGENTIC_LOOP_DELAY_MS = 100; // Small delay between iterations
const TOOL_COMPLETION_TIMEOUT_MS = 60000; // 60 seconds timeout for tool completion

/**
 * Agentic loop state for a session
 */
interface AgenticLoopState {
  /** Whether the agentic loop is currently active */
  active: boolean;
  /** Current iteration count */
  iteration: number;
  /** Pending tool calls waiting for completion */
  pendingTools: Set<string>;
  /** Whether auto-resume is enabled */
  autoResume: boolean;
  /** Last stop reason received */
  lastStopReason: string | null;
  /** Retry attempt count for current turn */
  retryCount: number;
  /** Whether the loop was cancelled by user */
  cancelled: boolean;
  /** Timeout ID for tool completion - prevents stuck state */
  toolTimeoutId?: ReturnType<typeof setTimeout>;
  /** Flag indicating prompt returned with tool_use and is waiting for tools to complete */
  waitingForToolCompletion: boolean;
  /** Debounce timer for auto-resume to handle rapid tool completions */
  resumeDebounceId?: ReturnType<typeof setTimeout>;
}

/**
 * Active agent connection with its process and ACP connection
 */
interface ActiveAgent {
  config: ACPAgentConfig;
  process: ChildProcess;
  connection: ClientSideConnection;
  sessions: Map<string, ACPSession>;
  status: ACPAgentStatus;
  /** Agentic loop state per session */
  agenticLoopStates: Map<string, AgenticLoopState>;
  /** Agent capabilities from initialization */
  capabilities: ACPAgentCapabilities;
  /** Authentication methods from initialization */
  authMethods: Array<{ id: string; name: string; description?: string }>;
}

/**
 * Pending permission request waiting for user response
 */
interface PendingPermission {
  request: ACPPermissionRequest;
  resolve: (response: RequestPermissionResponse) => void;
  reject: (error: Error) => void;
  /** Extra metadata for permission persistence */
  metadata: {
    agentId: string;
    permissionType: string;
    toolName?: string;
    filePath?: string;
    options: Array<{ id: string; grants?: boolean }>;
  };
}

/**
 * Tracked file operation from a tool call
 * Used to emit file:changed events when file tools complete
 */
interface TrackedFileOperation {
  toolCallId: string;
  filePath: string;
  originalContent: string | null;
  isNewFile: boolean;
  operationType: "write" | "edit" | "create" | "delete";
  threadId?: string;
}

/**
 * ACP Agent Manager Service
 *
 * Manages the lifecycle of ACP coding agents:
 * - Auto-detection of installed agents
 * - Spawning agent processes
 * - ACP protocol communication
 * - Session management
 * - Permission handling
 */
export class ACPAgentManager extends EventEmitter {
  private agents: Map<string, ActiveAgent> = new Map();
  private pendingPermissions: Map<string, PendingPermission> = new Map();
  private detectedAgents: Map<string, ACPAgentStatus> = new Map();
  private detectionPromise: Promise<ACPAgentStatus[]> | null = null;
  /** Track file operations from tool calls to emit file:changed events */
  private trackedFileOperations: Map<string, TrackedFileOperation> = new Map();
  /** Map sessionId → threadId for attributing file changes to correct thread */
  private sessionThreadMap: Map<string, string> = new Map();
  /** Timestamp of last detection */
  private detectionTimestamp: number = 0;
  /** Polling interval ID for auto-detection */
  private pollingIntervalId: ReturnType<typeof setInterval> | null = null;
  /** Callback for polling updates */
  private pollingCallback: ((agents: ACPAgentStatus[]) => void) | null = null;

  // ============================================================================
  // AUTO-RECONNECT / ERROR RECOVERY
  // ============================================================================
  
  /** Track crashed sessions for auto-restart: agentId → { sessionIds, workingDirectory, retryCount } */
  private crashedSessions: Map<string, {
    sessions: Map<string, { workingDirectory: string; threadId?: string }>;
    retryCount: number;
    lastCrash: number;
  }> = new Map();
  
  /** Maximum retry attempts for auto-reconnect */
  private readonly MAX_RECONNECT_RETRIES = 3;
  
  /** Minimum delay between reconnect attempts (ms) */
  private readonly RECONNECT_DELAY_MS = 2000;
  
  /** Auto-reconnect enabled flag */
  private autoReconnectEnabled = true;

  /** Active terminal sessions for agents */
  private _terminals: Map<string, {
    id: string;
    process: ChildProcess;
    cwd: string;
    sessionId?: string;
    agentId: string;
  }> = new Map();

  constructor() {
    super();
  }

  /**
   * Enable or disable auto-reconnect for crashed agents
   */
  setAutoReconnect(enabled: boolean): void {
    this.autoReconnectEnabled = enabled;
    console.log(`[ACP] Auto-reconnect ${enabled ? "enabled" : "disabled"}`);
  }

  /**
   * Attempt to reconnect a crashed agent and restore sessions
   */
  private async _attemptReconnect(agentId: string): Promise<boolean> {
    if (!this.autoReconnectEnabled) {
      console.log(`[ACP] Auto-reconnect disabled, not reconnecting ${agentId}`);
      return false;
    }

    const crashInfo = this.crashedSessions.get(agentId);
    if (!crashInfo) {
      console.log(`[ACP] No crash info for ${agentId}, cannot reconnect`);
      return false;
    }

    if (crashInfo.retryCount >= this.MAX_RECONNECT_RETRIES) {
      console.error(`[ACP] Max reconnect retries (${this.MAX_RECONNECT_RETRIES}) reached for ${agentId}`);
      this.emit("agent-reconnect-failed", {
        agentId,
        reason: "max_retries_exceeded",
        retryCount: crashInfo.retryCount,
      });
      return false;
    }

    // Check if enough time has passed since last crash (exponential backoff)
    const backoffDelay = this.RECONNECT_DELAY_MS * Math.pow(2, crashInfo.retryCount);
    const timeSinceCrash = Date.now() - crashInfo.lastCrash;
    if (timeSinceCrash < backoffDelay) {
      console.log(`[ACP] Waiting for backoff (${backoffDelay - timeSinceCrash}ms remaining)`);
      setTimeout(() => this._attemptReconnect(agentId), backoffDelay - timeSinceCrash);
      return false;
    }

    crashInfo.retryCount++;
    console.log(`[ACP] Attempting reconnect for ${agentId} (attempt ${crashInfo.retryCount}/${this.MAX_RECONNECT_RETRIES})`);

    this.emit("agent-reconnecting", {
      agentId,
      attempt: crashInfo.retryCount,
      maxAttempts: this.MAX_RECONNECT_RETRIES,
    });

    try {
      // Restart the agent
      await this.startAgent(agentId);

      // Try to resume sessions
      const restoredSessions: string[] = [];
      for (const [sessionId, sessionInfo] of crashInfo.sessions) {
        try {
          // Try to resume the session
          const activeAgent = this.agents.get(agentId);
          if (activeAgent?.capabilities.sessionResume) {
            await this.resumeSession(agentId, sessionId, sessionInfo.workingDirectory);
            restoredSessions.push(sessionId);
          } else if (activeAgent?.capabilities.loadSession) {
            await this.loadSession(agentId, sessionId, sessionInfo.workingDirectory);
            restoredSessions.push(sessionId);
          }
        } catch (sessionError) {
          console.warn(`[ACP] Failed to restore session ${sessionId}:`, sessionError);
        }
      }

      console.log(`[ACP] Successfully reconnected ${agentId}, restored ${restoredSessions.length}/${crashInfo.sessions.size} sessions`);
      
      this.emit("agent-reconnected", {
        agentId,
        restoredSessions,
        totalSessions: crashInfo.sessions.size,
      });

      // Clear crash info on success
      this.crashedSessions.delete(agentId);
      return true;

    } catch (error) {
      console.error(`[ACP] Reconnect attempt ${crashInfo.retryCount} failed for ${agentId}:`, error);
      crashInfo.lastCrash = Date.now();
      
      // Schedule another attempt with backoff
      if (crashInfo.retryCount < this.MAX_RECONNECT_RETRIES) {
        const nextDelay = this.RECONNECT_DELAY_MS * Math.pow(2, crashInfo.retryCount);
        console.log(`[ACP] Scheduling retry in ${nextDelay}ms`);
        setTimeout(() => this._attemptReconnect(agentId), nextDelay);
      }
      
      return false;
    }
  }

  /**
   * Track a crashed agent for potential auto-reconnect
   */
  private _trackCrashedAgent(agentId: string, sessions: Map<string, ACPSession>): void {
    const sessionInfo = new Map<string, { workingDirectory: string; threadId?: string }>();
    
    for (const [sessionId, session] of sessions) {
      sessionInfo.set(sessionId, {
        workingDirectory: session.workingDirectory,
        threadId: this.sessionThreadMap.get(sessionId),
      });
    }

    const existing = this.crashedSessions.get(agentId);
    this.crashedSessions.set(agentId, {
      sessions: sessionInfo,
      retryCount: existing?.retryCount ?? 0,
      lastCrash: Date.now(),
    });

    console.log(`[ACP] Tracked crashed agent ${agentId} with ${sessionInfo.size} sessions for auto-reconnect`);
  }

  /**
   * Check if the detection cache has expired
   */
  private isCacheExpired(): boolean {
    return Date.now() - this.detectionTimestamp > DETECTION_CACHE_TTL_MS;
  }

  /**
   * Start auto-detection polling
   */
  startAutoDetectionPolling(
    callback: (agents: ACPAgentStatus[]) => void,
    intervalMs: number = DETECTION_POLLING_INTERVAL_MS,
  ): void {
    // Stop existing polling if any
    this.stopAutoDetectionPolling();

    console.log(`[ACP] Starting auto-detection polling (interval: ${intervalMs}ms)`);

    this.pollingCallback = callback;
    this.pollingIntervalId = setInterval(async () => {
      try {
        const agents = await this.detectInstalledAgents(true);
        if (this.pollingCallback) {
          this.pollingCallback(agents);
        }
      } catch (error) {
        console.warn("[ACP] Auto-detection polling error:", error);
      }
    }, intervalMs);
  }

  /**
   * Stop auto-detection polling
   */
  stopAutoDetectionPolling(): void {
    if (this.pollingIntervalId) {
      clearInterval(this.pollingIntervalId);
      this.pollingIntervalId = null;
      this.pollingCallback = null;
      console.log("[ACP] Auto-detection polling stopped");
    }
  }

  /**
   * Check if a tool kind/name indicates a file operation
   */
  private _isFileOperationTool(
    kind?: string | null,
    name?: string | null,
  ): boolean {
    // Check tool kind
    if (kind) {
      const k = kind.toLowerCase();
      if (
        k.includes("file") ||
        k.includes("edit") ||
        k.includes("write") ||
        k.includes("create") ||
        k === "str_replace_editor" ||
        k === "text_editor"
      ) {
        return true;
      }
    }

    // Check tool name (common file operation tool names)
    if (name) {
      const n = name.toLowerCase();
      if (
        n.includes("write") ||
        n.includes("edit") ||
        n.includes("file") ||
        n.includes("create") ||
        n.includes("str_replace") ||
        n.includes("patch") ||
        n.includes("save") ||
        n.includes("multieditnew") ||
        n === "edit" ||
        n === "write" ||
        n === "create"
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Extract file path from tool input
   */
  private _extractFilePathFromToolInput(
    input: unknown,
    toolName?: string,
  ): string | null {
    if (!input || typeof input !== "object") return null;

    const inp = input as Record<string, unknown>;

    // Common patterns for file paths in tool inputs
    // Check various field names that tools use
    const pathFields = [
      "path",
      "file_path",
      "filePath",
      "file",
      "filename",
      "target",
      "destination",
    ];

    for (const field of pathFields) {
      if (typeof inp[field] === "string" && inp[field]) {
        return inp[field] as string;
      }
    }

    // For str_replace_editor/text_editor tools, path is a key parameter
    if (toolName?.toLowerCase().includes("editor") && inp.path) {
      return inp.path as string;
    }

    return null;
  }

  /**
   * Track a file operation when a file tool call starts
   */
  private async _trackFileOperationStart(
    toolCallId: string,
    toolKind: string | undefined,
    toolInput: unknown,
    toolName?: string,
    locations?: Array<{ path: string; line?: number }>,
    content?: unknown[],
    sessionId?: string,
  ): Promise<void> {
    // Get file paths from various sources
    const filePaths: string[] = [];

    // 1. From tool input
    const inputPath = this._extractFilePathFromToolInput(toolInput, toolName);
    if (inputPath) {
      filePaths.push(inputPath);
    }

    // 2. From locations array
    if (locations && Array.isArray(locations)) {
      for (const loc of locations) {
        if (loc.path && !filePaths.includes(loc.path)) {
          filePaths.push(loc.path);
        }
      }
    }

    // 3. From content diffs
    if (content && Array.isArray(content)) {
      for (const item of content) {
        const contentItem = item as {
          toolCallContent?: string;
          type?: string;
          diff?: { path: string; content: string };
        };
        if (
          (contentItem.toolCallContent === "diff" ||
            contentItem.type === "diff") &&
          contentItem.diff?.path
        ) {
          if (!filePaths.includes(contentItem.diff.path)) {
            filePaths.push(contentItem.diff.path);
          }
        }
      }
    }

    // If no file paths found, check if this is a file operation tool
    if (filePaths.length === 0) {
      if (this._isFileOperationTool(toolKind, toolName)) {
        console.log(
          `[ACP] File operation tool detected but no file path found:`,
          { kind: toolKind, name: toolName, input: toolInput },
        );
      }
      return;
    }

    // Track each file
    for (const filePath of filePaths) {
      // Read original content before the operation
      let originalContent: string | null = null;
      let isNewFile = false;
      try {
        originalContent = await fsPromises.readFile(filePath, "utf-8");
      } catch {
        // File doesn't exist, it will be created
        isNewFile = true;
      }

      const kind = (toolKind || "").toLowerCase();
      let operationType: TrackedFileOperation["operationType"] = "write";
      if (kind.includes("edit") || kind.includes("replace")) {
        operationType = "edit";
      } else if (kind.includes("create")) {
        operationType = "create";
      } else if (kind.includes("delete")) {
        operationType = "delete";
      }

      // Use a unique key combining toolCallId and filePath
      const trackingKey = `${toolCallId}:${filePath}`;
      this.trackedFileOperations.set(trackingKey, {
        toolCallId,
        filePath,
        originalContent,
        isNewFile,
        operationType,
        threadId: sessionId ? this.sessionThreadMap.get(sessionId) : undefined,
      });

      console.log(
        `[ACP] Tracking file operation: ${trackingKey} (${operationType}, isNew: ${isNewFile})`,
      );
    }
  }

  /**
   * Emit file:changed event when a file tool completes
   */
  private async _emitFileChangeOnToolComplete(
    toolCallId: string,
    status: string,
  ): Promise<void> {
    // Only emit if tool completed successfully
    if (!isToolCallComplete(status)) return;

    // Find all tracked operations for this tool call
    const trackedOps: TrackedFileOperation[] = [];
    const keysToDelete: string[] = [];

    for (const [key, tracked] of this.trackedFileOperations.entries()) {
      if (tracked.toolCallId === toolCallId) {
        trackedOps.push(tracked);
        keysToDelete.push(key);
      }
    }

    if (trackedOps.length === 0) return;

    // Clean up tracking
    for (const key of keysToDelete) {
      this.trackedFileOperations.delete(key);
    }

    // Emit events for each tracked file
    for (const tracked of trackedOps) {
      // Read the new content
      let newContent: string;
      let fileStatus: "created" | "modified" | "deleted" = "modified";

      try {
        newContent = await fsPromises.readFile(tracked.filePath, "utf-8");
        fileStatus = tracked.isNewFile ? "created" : "modified";
      } catch {
        // File was deleted or doesn't exist
        if (tracked.operationType === "delete") {
          fileStatus = "deleted";
          newContent = "";
        } else {
          // File operation might have failed, skip
          console.log(
            `[ACP] File not found after operation, skipping change event: ${tracked.filePath}`,
          );
          continue;
        }
      }

      // Skip if content hasn't changed
      if (fileStatus === "modified" && newContent === tracked.originalContent) {
        console.log(
          `[ACP] File content unchanged, skipping change event: ${tracked.filePath}`,
        );
        continue;
      }

      const fileChangeEvent = {
        filePath: tracked.filePath,
        filename: require("path").basename(tracked.filePath),
        status: fileStatus,
        originalContent: tracked.originalContent,
        newContent: newContent,
        timestamp: Date.now(),
        threadId: tracked.threadId,
      };

      console.log(
        `[ACP] Emitting file:changed event: ${tracked.filePath} (${fileStatus}) thread: ${tracked.threadId}`,
      );

      // Send to all renderer windows
      const { BrowserWindow } = require("electron");
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send("file:changed", fileChangeEvent);
        }
      }
    }
  }

  /**
   * Detect all installed ACP agents
   * @param forceRefresh - If true, bypass cache and force fresh detection
   */
  async detectInstalledAgents(forceRefresh = false): Promise<ACPAgentStatus[]> {
    // Check if we need to refresh (cache expired or forced)
    const needsRefresh = forceRefresh || this.isCacheExpired() || this.detectedAgents.size === 0;

    // Return cached results if available and not forcing refresh
    if (!needsRefresh && this.detectionPromise) {
      console.log("[ACP] Returning cached agent detection results");
      return this.detectionPromise;
    }

    // If we have cached results but cache is expired, still return them while refreshing in background
    if (!forceRefresh && this.detectedAgents.size > 0 && this.isCacheExpired()) {
      console.log("[ACP] Cache expired, refreshing in background while returning cached results");
      // Start background refresh
      this._detectAgents().catch((err) =>
        console.warn("[ACP] Background detection refresh failed:", err),
      );
      return Array.from(this.detectedAgents.values());
    }

    console.log(`[ACP] Running agent detection (forceRefresh: ${forceRefresh})`);
    this.detectionPromise = this._detectAgents();
    return this.detectionPromise;
  }

  private async _detectAgents(): Promise<ACPAgentStatus[]> {
    const startTime = Date.now();

    const results = await Promise.all(
      ACP_AGENT_CONFIGS.map((config) => this.checkAgentInstalled(config)),
    );

    // Update cache
    for (const status of results) {
      this.detectedAgents.set(status.id, status);
    }

    // Update timestamp
    this.detectionTimestamp = Date.now();

    const elapsed = Date.now() - startTime;
    const installed = results.filter((r) => r.installed).length;
    console.log(`[ACP] Detection completed in ${elapsed}ms: ${installed}/${results.length} agents installed`);

    return results;
  }

  /**
   * Check if authentication credentials exist for an agent
   */
  private checkAuthenticationExists(config: ACPAgentConfig): boolean {
    if (!config.authPaths || config.authPaths.length === 0) {
      // No auth paths defined, assume not authenticated
      return false;
    }

    const home = homedir();
    // Check if ANY of the auth paths exist
    for (const authPath of config.authPaths) {
      const fullPath = join(home, authPath);
      if (existsSync(fullPath)) {
        console.log(`[ACP] Auth detected for ${config.id}: ${fullPath}`);
        return true;
      }
    }

    console.log(
      `[ACP] No auth found for ${config.id}, checked: ${config.authPaths.join(", ")}`,
    );
    return false;
  }

  /**
   * Check if a specific agent is installed using multiple detection strategies
   */
  private async checkAgentInstalled(
    config: ACPAgentConfig,
  ): Promise<ACPAgentStatus> {
    const baseStatus: ACPAgentStatus = {
      id: config.id,
      installed: false,
      authenticated: false,
      running: this.agents.has(config.id),
    };

    // Strategy 1: Try direct version command
    try {
      const { stdout } = await execAsync(
        `${config.detectCommand} ${config.detectArgs.join(" ")}`,
        { timeout: 5000 },
      );

      const versionMatch = stdout.match(/(\d+\.\d+\.\d+)/);
      const version = versionMatch ? versionMatch[1] : undefined;
      const authenticated = this.checkAuthenticationExists(config);

      console.log(`[ACP] Agent ${config.id} detected via direct command, version: ${version || "unknown"}`);
      return {
        ...baseStatus,
        installed: true,
        version,
        authenticated,
      };
    } catch {
      // Direct command failed, try fallback strategies
    }

    // Strategy 2: Try which/where command to check if command exists in PATH
    try {
      const whichCommand = process.platform === "win32" ? "where" : "which";
      const { stdout } = await execAsync(`${whichCommand} ${config.detectCommand}`, {
        timeout: 3000,
      });

      if (stdout.trim()) {
        // Command exists in PATH, try to get version
        try {
          const { stdout: versionOut } = await execAsync(
            `${stdout.trim().split("\n")[0]} ${config.detectArgs.join(" ")}`,
            { timeout: 5000 },
          );
          const versionMatch = versionOut.match(/(\d+\.\d+\.\d+)/);
          const version = versionMatch ? versionMatch[1] : undefined;
          const authenticated = this.checkAuthenticationExists(config);

          console.log(`[ACP] Agent ${config.id} detected via ${whichCommand}, version: ${version || "unknown"}`);
          return {
            ...baseStatus,
            installed: true,
            version,
            authenticated,
          };
        } catch {
          // Version command failed but command exists
          const authenticated = this.checkAuthenticationExists(config);
          console.log(`[ACP] Agent ${config.id} detected via ${whichCommand} (version unknown)`);
          return {
            ...baseStatus,
            installed: true,
            authenticated,
          };
        }
      }
    } catch {
      // which/where command failed
    }

    // Strategy 3: Check common global install locations
    const globalPaths = this.getGlobalInstallPaths(config.detectCommand);
    for (const binPath of globalPaths) {
      if (existsSync(binPath)) {
        try {
          const { stdout } = await execAsync(
            `"${binPath}" ${config.detectArgs.join(" ")}`,
            { timeout: 5000 },
          );
          const versionMatch = stdout.match(/(\d+\.\d+\.\d+)/);
          const version = versionMatch ? versionMatch[1] : undefined;
          const authenticated = this.checkAuthenticationExists(config);

          console.log(`[ACP] Agent ${config.id} detected at ${binPath}, version: ${version || "unknown"}`);
          return {
            ...baseStatus,
            installed: true,
            version,
            authenticated,
          };
        } catch {
          // Binary exists but version check failed, still count as installed
          const authenticated = this.checkAuthenticationExists(config);
          console.log(`[ACP] Agent ${config.id} detected at ${binPath} (version unknown)`);
          return {
            ...baseStatus,
            installed: true,
            authenticated,
          };
        }
      }
    }

    // Strategy 4: Try npx with --no flag (checks if package is available locally without downloading)
    const npxConfig = getAgentNpxConfig(config.id);
    if (npxConfig && npxConfig.args && npxConfig.args.length > 0) {
      const packageName = npxConfig.args.find((arg) => arg.startsWith("@") || !arg.startsWith("-"));
      if (packageName) {
        try {
          // Check if package is installed globally or locally
          const { stdout } = await execAsync(`npm list -g ${packageName} --depth=0`, {
            timeout: 5000,
          });
          if (stdout.includes(packageName)) {
            const authenticated = this.checkAuthenticationExists(config);
            console.log(`[ACP] Agent ${config.id} detected via npm global list`);
            return {
              ...baseStatus,
              installed: true,
              authenticated,
            };
          }
        } catch {
          // npm list failed
        }

        // Check if it's a valid npm package that can be run via npx
        try {
          const { stdout } = await execAsync(`npm view ${packageName} version`, {
            timeout: 10000,
          });
          if (stdout.trim()) {
            const authenticated = this.checkAuthenticationExists(config);
            console.log(`[ACP] Agent ${config.id} available via npx (package: ${packageName})`);
            return {
              ...baseStatus,
              installed: true,
              authenticated,
              // NPX will download on first use
            };
          }
        } catch {
          // Package not available in npm registry
        }
      }
    }

    console.log(`[ACP] Agent ${config.id} not detected`);
    return baseStatus;
  }

  /**
   * Get common global install paths for a command
   */
  private getGlobalInstallPaths(command: string): string[] {
    const home = homedir();
    const paths: string[] = [];

    if (process.platform === "win32") {
      // Windows global paths
      paths.push(
        join(process.env.APPDATA || "", "npm", `${command}.cmd`),
        join(process.env.APPDATA || "", "npm", command),
        join(home, "AppData", "Roaming", "npm", `${command}.cmd`),
      );
    } else {
      // Unix-like global paths
      paths.push(
        // npm global
        join(home, ".npm-global", "bin", command),
        join(home, ".npm", "bin", command),
        `/usr/local/bin/${command}`,
        `/usr/bin/${command}`,
        // pnpm global
        join(home, ".local", "share", "pnpm", command),
        // yarn global
        join(home, ".yarn", "bin", command),
        join(home, ".config", "yarn", "global", "node_modules", ".bin", command),
        // nvm paths
        join(home, ".nvm", "versions", "node", "*", "bin", command),
      );

      // macOS specific
      if (process.platform === "darwin") {
        paths.push(
          `/opt/homebrew/bin/${command}`,
          `/opt/local/bin/${command}`,
        );
      }
    }

    return paths;
  }

  /**
   * Get the status of a specific agent
   */
  getAgentStatus(agentId: string): ACPAgentStatus | undefined {
    // Check if agent is running
    const activeAgent = this.agents.get(agentId);
    if (activeAgent) {
      return activeAgent.status;
    }

    // Return cached detection status
    return this.detectedAgents.get(agentId);
  }

  /**
   * Get all agent statuses
   */
  getAllAgentStatuses(): ACPAgentStatus[] {
    return Array.from(this.detectedAgents.values());
  }

  /**
   * Start an agent process and establish ACP connection
   */
  async startAgent(agentId: string): Promise<void> {
    // Check if already running
    if (this.agents.has(agentId)) {
      return;
    }

    const config = getAgentConfig(agentId);
    if (!config) {
      throw new Error(`Unknown agent: ${agentId}`);
    }

    // Check if installed
    const status = await this.checkAgentInstalled(config);
    if (!status.installed) {
      // Try npx config
      const npxConfig = getAgentNpxConfig(agentId);
      if (npxConfig) {
        return this._startAgentWithConfig(npxConfig);
      }
      throw new Error(`Agent ${agentId} is not installed`);
    }

    return this._startAgentWithConfig(config);
  }

  private async _startAgentWithConfig(config: ACPAgentConfig): Promise<void> {
    console.log(
      `[ACP] Starting agent ${config.id}: ${config.command} ${config.args.join(" ")}`,
    );

    // Resolve command to absolute path (critical for packaged Electron apps)
    const resolvedCommand = await resolveCommandPath(config.command);
    console.log(`[ACP] Resolved command: ${config.command} -> ${resolvedCommand}`);

    // Build enhanced environment with Node.js paths
    const enhancedEnv = {
      ...process.env,
      PATH: getEnhancedPath(),
      ...config.env,
    };

    // On Windows, .cmd files need special handling
    const isWindows = process.platform === "win32";
    const isCmdFile = resolvedCommand.endsWith(".cmd");
    const isPs1File = resolvedCommand.endsWith(".ps1");

    let agentProcess: ChildProcess;

    if (isWindows && isPs1File) {
      // For PowerShell scripts, use pwsh (PowerShell Core) or powershell
      const psArgs = [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy", "Bypass",
        "-File", resolvedCommand,
        ...config.args
      ];
      // Prefer PowerShell Core (pwsh) if available, fall back to Windows PowerShell
      const psCommand = existsSync("C:\\Program Files\\PowerShell\\7\\pwsh.exe") 
        ? "C:\\Program Files\\PowerShell\\7\\pwsh.exe"
        : "powershell.exe";
      console.log(`[ACP] Windows PowerShell spawn: ${psCommand} ${psArgs.join(" ")}`);
      agentProcess = spawn(psCommand, psArgs, {
        stdio: ["pipe", "pipe", "pipe"],
        env: enhancedEnv,
        windowsHide: true,
      });
    } else if (isWindows && isCmdFile) {
      // For .cmd files on Windows, try cmd.exe first, fall back to PowerShell
      const cmdArgs = ["/c", `"${resolvedCommand}"`, ...config.args];
      console.log(`[ACP] Windows cmd spawn: cmd.exe ${cmdArgs.join(" ")}`);
      try {
        agentProcess = spawn("cmd.exe", cmdArgs, {
          stdio: ["pipe", "pipe", "pipe"],
          env: enhancedEnv,
          windowsVerbatimArguments: true,
          windowsHide: true,
        });
      } catch (cmdError) {
        // Fall back to PowerShell if cmd.exe fails
        console.warn(`[ACP] cmd.exe failed, falling back to PowerShell:`, cmdError);
        const psArgs = [
          "-NoProfile",
          "-NonInteractive", 
          "-Command",
          `& "${resolvedCommand}" ${config.args.map(a => `"${a}"`).join(" ")}`
        ];
        agentProcess = spawn("powershell.exe", psArgs, {
          stdio: ["pipe", "pipe", "pipe"],
          env: enhancedEnv,
          windowsHide: true,
        });
      }
    } else if (isWindows) {
      // For .exe or other executables on Windows
      agentProcess = spawn(resolvedCommand, config.args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: enhancedEnv,
        windowsHide: true,
      });
    } else {
      // For non-Windows (macOS, Linux), spawn directly
      agentProcess = spawn(resolvedCommand, config.args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: enhancedEnv,
      });
    }

    // Collect stderr for error messages
    let stderrBuffer = "";

    // Create a promise that rejects on early process exit/error
    let earlyExitReject: (error: Error) => void;
    const earlyExitPromise = new Promise<never>((_resolve, reject) => {
      earlyExitReject = reject;
    });

    // Handle process errors
    agentProcess.on("error", (error) => {
      console.error(`[ACP] Agent ${config.id} process error:`, error);
      this.emit("agent-error", {
        agentId: config.id,
        error: error.message,
        stderr: stderrBuffer,
      });
      this._cleanupAgent(config.id);
      earlyExitReject(new Error(`Failed to start agent: ${error.message}`));
    });

    agentProcess.on("exit", (code, signal) => {
      const exitMsg = `Agent ${config.id} exited with code ${code}, signal ${signal}`;
      console.log(`[ACP] ${exitMsg}`);
      if (stderrBuffer) {
        console.error(`[ACP] Stderr output:\n${stderrBuffer}`);
      }
      
      // Check if this was an unexpected crash (non-zero exit, signal, or has active sessions)
      const activeAgent = this.agents.get(config.id);
      const wasUnexpectedCrash = (code !== 0 || signal !== null) && 
        activeAgent && activeAgent.sessions.size > 0;
      
      if (wasUnexpectedCrash) {
        // Track for auto-reconnect before cleanup
        this._trackCrashedAgent(config.id, activeAgent.sessions);
      }
      
      this.emit("agent-exit", {
        agentId: config.id,
        code,
        signal,
        stderr: stderrBuffer,
        wasUnexpectedCrash,
        willAttemptReconnect: wasUnexpectedCrash && this.autoReconnectEnabled,
      });
      
      this._cleanupAgent(config.id);

      // Create a more informative error message
      let errorMsg = exitMsg;
      if (stderrBuffer.trim()) {
        errorMsg = `${exitMsg}\n\nError details:\n${stderrBuffer.trim()}`;
      }
      earlyExitReject(new Error(errorMsg));
      
      // Attempt auto-reconnect if this was an unexpected crash
      if (wasUnexpectedCrash && this.autoReconnectEnabled) {
        console.log(`[ACP] Scheduling auto-reconnect for crashed agent ${config.id}`);
        setTimeout(() => this._attemptReconnect(config.id), this.RECONNECT_DELAY_MS);
      }
    });

    // Collect stderr for error reporting
    agentProcess.stderr?.on("data", (data) => {
      const text = data.toString();
      stderrBuffer += text;
      console.error(`[ACP] Agent ${config.id} stderr:`, text);
    });

    // Create the ACP stream from stdin/stdout
    const stream = ndJsonStream(
      new WritableStream({
        write(chunk) {
          agentProcess.stdin?.write(chunk);
        },
      }),
      new ReadableStream({
        start(controller) {
          agentProcess.stdout?.on("data", (chunk: Buffer) => {
            controller.enqueue(chunk);
          });
          agentProcess.stdout?.on("end", () => {
            controller.close();
          });
        },
      }),
    );

    // Create the client-side connection
    const connection = new ClientSideConnection(
      (agent: Agent) => this._createClient(config.id, agent),
      stream,
    );

    // Store the active agent with default capabilities
    const activeAgent: ActiveAgent = {
      config,
      process: agentProcess,
      connection,
      sessions: new Map(),
      status: {
        id: config.id,
        installed: true,
        authenticated: false,
        running: true,
      },
      agenticLoopStates: new Map(),
      capabilities: {
        loadSession: false,
        sessionList: false,
        sessionResume: false,
      },
      authMethods: [],
    };

    this.agents.set(config.id, activeAgent);

    // Initialize the connection - race with early exit to ensure promise resolves
    try {
      const initPromise = connection.initialize({
        protocolVersion: 1,
        clientInfo: {
          name: "Belgrade/Shadower",
          version: "1.0.0",
        },
        clientCapabilities: {
          // Filesystem capabilities - client handles these to track file changes
          // This enables the writeTextFile handler which emits file:changed events
          fs: {
            readTextFile: true,
            writeTextFile: true,
          },
          // Terminal capability - agent handles this internally
          terminal: true,
          // Declare support for terminal output streaming via _meta field
          _meta: {
            terminal_output: true,
            "terminal-auth": true,
          },
        },
      });

      // Race initialization with early exit - if process dies, we reject immediately
      const initResponse = await Promise.race([initPromise, earlyExitPromise]);

      console.log(`[ACP] Agent ${config.id} initialized:`, initResponse);

      // Store auth methods for later use
      activeAgent.authMethods = (initResponse.authMethods || []).map((m) => ({
        id: m.id,
        name: m.name,
        description: m.description ?? undefined,
      }));

      // Update status with capabilities
      activeAgent.status.authenticated =
        !initResponse.authMethods || initResponse.authMethods.length === 0;

      // Extract agent capabilities from initialization response
      const agentCaps = initResponse.agentCapabilities as
        | {
            loadSession?: boolean;
            sessionCapabilities?: {
              list?: boolean;
              resume?: boolean;
            };
            prompt?: {
              image?: boolean;
              audio?: boolean;
              embeddedContext?: boolean;
            };
          }
        | undefined;

      activeAgent.capabilities = {
        loadSession: agentCaps?.loadSession ?? false,
        sessionList: agentCaps?.sessionCapabilities?.list ?? false,
        sessionResume: agentCaps?.sessionCapabilities?.resume ?? false,
        prompt: agentCaps?.prompt,
      };

      // Also store in status for easy access
      activeAgent.status.capabilities = activeAgent.capabilities;

      this.emit("agent-started", {
        agentId: config.id,
        capabilities: initResponse,
        parsedCapabilities: activeAgent.capabilities,
      });
    } catch (error) {
      console.error(`[ACP] Failed to initialize agent ${config.id}:`, error);
      this._cleanupAgent(config.id);
      throw error;
    }
  }

  /**
   * Create the ACP client implementation for handling agent requests
   */
  private _createClient(agentId: string, _agent: Agent): Client {
    return {
      // Handle session updates (streaming messages)
      sessionUpdate: async (params: SessionNotification) => {
        console.log(
          `[ACP] sessionUpdate received for ${agentId}:`,
          JSON.stringify(params, null, 2),
        );
        this.emit("session-update", { agentId, ...params });

        // Convert to message chunks for the UI
        if (params.update) {
          console.log(
            `[ACP] Processing update:`,
            JSON.stringify(params.update, null, 2),
          );
          const updateType = (params.update as { sessionUpdate?: string })
            .sessionUpdate;

          // Track tool calls for the agentic loop
          if (updateType === "tool_call") {
            const toolCall = params.update as {
              toolCallId?: string;
              id?: string;
              status?: string;
              kind?: string;
              title?: string;
              rawInput?: unknown;
              input?: unknown;
              meta?: Record<string, unknown>;
              locations?: Array<{ path: string; line?: number }>;
              content?: unknown[];
            };
            const toolCallId = toolCall.toolCallId || toolCall.id;
            if (toolCallId) {
              this.trackToolCall(agentId, params.sessionId, toolCallId);

              // Track file operations to emit file:changed events when complete
              const toolInput = toolCall.rawInput ?? toolCall.input;
              const toolName =
                toolCall.title || this._extractToolName(toolCall.meta);
              this._trackFileOperationStart(
                toolCallId,
                toolCall.kind,
                toolInput,
                toolName,
                toolCall.locations,
                toolCall.content,
                params.sessionId,
              ).catch((err) =>
                console.error(`[ACP] Failed to track file operation:`, err),
              );
            }

            // Handle terminal creation from meta field (Feature 3)
            const meta = toolCall.meta;
            if (meta?.terminal_info) {
              const terminalInfo = meta.terminal_info as {
                terminal_id?: string;
                cwd?: string;
              };
              this.emit("terminal-created", {
                agentId,
                sessionId: params.sessionId,
                terminalId: terminalInfo.terminal_id,
                cwd: terminalInfo.cwd,
                label: (params.update as any).title,
              } as ACPTerminalInfo & { agentId: string; sessionId: string });
            }
          }

          // Track tool completion for the agentic loop
          if (updateType === "tool_call_update") {
            const toolUpdate = params.update as {
              toolCallId?: string;
              status?: string;
              meta?: Record<string, unknown>;
            };

            // Handle terminal output from meta field (Feature 3)
            const meta = toolUpdate.meta;
            if (meta?.terminal_output) {
              const terminalOutput = meta.terminal_output as {
                terminal_id?: string;
                data?: string;
              };
              this.emit("terminal-output", {
                agentId,
                sessionId: params.sessionId,
                terminalId: terminalOutput.terminal_id,
                data: terminalOutput.data,
              } as ACPTerminalOutput & { agentId: string; sessionId: string });
            }

            // Handle terminal exit from meta field (Feature 3)
            if (meta?.terminal_exit) {
              const terminalExit = meta.terminal_exit as {
                terminal_id?: string;
                exit_code?: number;
                signal?: string;
              };
              this.emit("terminal-exit", {
                agentId,
                sessionId: params.sessionId,
                terminalId: terminalExit.terminal_id,
                exitCode: terminalExit.exit_code,
                signal: terminalExit.signal,
              } as ACPTerminalExit & { agentId: string; sessionId: string });
            }

            if (
              toolUpdate.toolCallId &&
              isToolCallComplete(toolUpdate.status)
            ) {
              this.completeToolCall(
                agentId,
                params.sessionId,
                toolUpdate.toolCallId,
              );

              // Emit file:changed event if this was a file operation
              this._emitFileChangeOnToolComplete(
                toolUpdate.toolCallId,
                toolUpdate.status || "",
              ).catch((err) =>
                console.error(`[ACP] Failed to emit file change:`, err),
              );
            }
          }

          // Handle available commands update (Feature 4)
          if (updateType === "available_commands_update") {
            const commandsUpdate = params.update as {
              availableCommands?: ACPAvailableCommand[];
            };
            this.emit("commands-update", {
              agentId,
              sessionId: params.sessionId,
              commands: commandsUpdate.availableCommands || [],
            });
          }

          // Handle session info update (Feature 6)
          if (updateType === "session_info_update") {
            const infoUpdate = params.update as {
              title?: string;
              meta?: Record<string, unknown>;
            };
            this.emit("session-info-update", {
              agentId,
              sessionId: params.sessionId,
              title: infoUpdate.title,
              meta: infoUpdate.meta,
            });
          }

          // Handle current mode update
          if (updateType === "current_mode_update") {
            const modeUpdate = params.update as {
              currentModeId?: string;
              availableModes?: Array<{ id: string; name: string }>;
            };
            this.emit("session-mode-update", {
              agentId,
              sessionId: params.sessionId,
              currentModeId: modeUpdate.currentModeId,
              availableModes: modeUpdate.availableModes,
            });
            // Update local session state
            const activeAgent = this.agents.get(agentId);
            const session = activeAgent?.sessions.get(params.sessionId);
            if (session && modeUpdate.currentModeId) {
              session.currentMode = modeUpdate.currentModeId;
            }
            // Skip emitting as message chunk - this is session state, not content
            return;
          }

          // Handle config option update
          if (updateType === "config_option_update") {
            const configUpdate = params.update as {
              configOptions?: Array<{
                id: string;
                name: string;
                type: string;
                value?: string | boolean;
              }>;
            };
            this.emit("session-config-update", {
              agentId,
              sessionId: params.sessionId,
              configOptions: configUpdate.configOptions,
            });
            // Update local session state
            const activeAgent = this.agents.get(agentId);
            const session = activeAgent?.sessions.get(params.sessionId);
            if (session && configUpdate.configOptions) {
              session.configOptions = configUpdate.configOptions as any;
            }
            // Skip emitting as message chunk - this is session state, not content
            return;
          }

          // Handle model update
          if (
            updateType === "model_update" ||
            updateType === "session_model_update"
          ) {
            const modelUpdate = params.update as {
              currentModelId?: string;
              availableModels?: Array<{ modelId: string; name: string }>;
            };
            this.emit("session-model-update", {
              agentId,
              sessionId: params.sessionId,
              currentModelId: modelUpdate.currentModelId,
              availableModels: modelUpdate.availableModels,
            });
            // Update local session state
            const activeAgent = this.agents.get(agentId);
            const session = activeAgent?.sessions.get(params.sessionId);
            if (session?.models && modelUpdate.currentModelId) {
              session.models = {
                ...session.models,
                currentModelId: modelUpdate.currentModelId,
              };
            }
            // Skip emitting as message chunk - this is session state, not content
            return;
          }

          const chunk: ACPMessageChunk = {
            sessionId: params.sessionId,
            agentId,
            messageId: (params.update as any).messageId || crypto.randomUUID(),
            type: this._getChunkType(params.update),
            content: this._getChunkContent(params.update),
            role: updateType === "user_message_chunk" ? "user" : "assistant",
          };
          console.log(
            `[ACP] Emitting message-chunk:`,
            JSON.stringify(chunk, null, 2),
          );
          this.emit("message-chunk", chunk);
        } else {
          console.log(
            `[ACP] sessionUpdate has no update field, keys:`,
            Object.keys(params),
          );
        }
      },

      // Handle permission requests
      requestPermission: async (
        params: RequestPermissionRequest,
      ): Promise<RequestPermissionResponse> => {
        const permissionType = this._mapToolKindToPermissionType(
          params.toolCall?.kind
        );
        const toolName = params.toolCall?.title ?? undefined;
        // Extract file path from toolCall if available (type assertion needed as location is optional)
        const toolCallWithLocation = params.toolCall as { location?: { path?: string } } | undefined;
        const filePath = toolCallWithLocation?.location?.path ?? undefined;

        // Check for stored permission (auto-approval)
        const storedPermission = getStoredPermission(
          agentId,
          permissionType,
          toolName,
          filePath
        );

        if (storedPermission && storedPermission.granted) {
          console.log(
            `[ACP] Auto-approving stored permission for ${agentId}: ${permissionType}`
          );
          return {
            outcome: {
              outcome: "selected",
              optionId: storedPermission.optionId,
            },
          };
        }

        const requestId = crypto.randomUUID();

        // Convert SDK PermissionOption to our format
        // SDK uses: optionId, name, kind (allow_once | allow_always | reject_once | reject_always)
        const permissionRequest: ACPPermissionRequest = {
          requestId,
          agentId,
          sessionId: params.sessionId,
          permissionType,
          toolCallId: params.toolCall?.toolCallId,
          description: params.toolCall?.title || "Permission requested",
          options: params.options.map((opt) => ({
            id: opt.optionId,
            label: opt.name,
            grants: opt.kind === "allow_once" || opt.kind === "allow_always",
          })),
        };

        // Emit event for UI to show dialog
        this.emit("permission-request", permissionRequest);

        // Wait for user response
        return new Promise((resolve, reject) => {
          this.pendingPermissions.set(requestId, {
            request: permissionRequest,
            resolve,
            reject,
            // Store metadata for permission persistence
            metadata: {
              agentId,
              permissionType,
              toolName,
              filePath,
              options: permissionRequest.options.map((o) => ({
                id: o.id,
                grants: o.grants,
              })),
            },
          });

          // Timeout after 3 minutes (reduced from 5 for better UX)
          // User should respond promptly to permission requests
          setTimeout(
            () => {
              if (this.pendingPermissions.has(requestId)) {
                this.pendingPermissions.delete(requestId);
                console.warn(
                  `[ACP] Permission request ${requestId} timed out after 3 minutes`,
                );
                reject(
                  new Error(
                    "Permission request timed out after 3 minutes. Please try again.",
                  ),
                );
              }
            },
            3 * 60 * 1000,
          );
        });
      },

      // File system operations - implement these for agents that need them
      readTextFile: async (params) => {
        console.log(`[ACP] readTextFile request:`, params.path);
        try {
          const content = await fsPromises.readFile(params.path, "utf-8");

          // Handle line and limit parameters if provided
          if (params.line || params.limit) {
            const lines = content.split("\n");
            const startLine = params.line ? params.line - 1 : 0; // Convert to 0-based
            const endLine = params.limit
              ? startLine + params.limit
              : lines.length;
            return { content: lines.slice(startLine, endLine).join("\n") };
          }

          return { content };
        } catch (error) {
          console.error(`[ACP] Failed to read file ${params.path}:`, error);
          throw error;
        }
      },

      writeTextFile: async (params) => {
        console.log(`[ACP] writeTextFile request:`, params.path);
        try {
          // Read original content for diff tracking
          let originalContent: string | null = null;
          let isNewFile = false;
          try {
            originalContent = await fsPromises.readFile(params.path, "utf-8");
          } catch {
            // File doesn't exist, it's a new file
            isNewFile = true;
          }

          // Write the file
          await fsPromises.writeFile(params.path, params.content, "utf-8");

          // Emit file change event for diff tracking
          const { BrowserWindow } = require("electron");
          // Look up threadId from this agent's active sessions.
          // Note: The tool handler API doesn't expose which session triggered the
          // call, so we iterate sessions and take the first match. For agents with
          // multiple concurrent sessions across threads this may be imprecise.
          const activeAgent = this.agents.get(agentId);
          let threadId: string | undefined;
          if (activeAgent) {
            for (const sessionId of activeAgent.sessions.keys()) {
              threadId = this.sessionThreadMap.get(sessionId);
              if (threadId) break;
            }
          }

          const fileChangeEvent = {
            filePath: params.path,
            filename: require("path").basename(params.path),
            status: isNewFile ? "created" : "modified",
            originalContent: originalContent,
            newContent: params.content,
            timestamp: Date.now(),
            threadId,
          };

          for (const win of BrowserWindow.getAllWindows()) {
            if (!win.isDestroyed()) {
              win.webContents.send("file:changed", fileChangeEvent);
            }
          }

          return {};
        } catch (error) {
          console.error(`[ACP] Failed to write file ${params.path}:`, error);
          throw error;
        }
      },

      // Terminal operations - spawn shell process and stream output
      createTerminal: async (params) => {
        console.log(`[ACP] createTerminal request:`, params);

        // Generate terminal ID
        const terminalId = crypto.randomUUID();
        // Look up session working directory from the agent's active sessions
        const activeAgentForTerminal = this.agents.get(agentId);
        const activeSession = activeAgentForTerminal?.sessions.values().next().value;
        const cwd = params.cwd || (activeSession as { workingDirectory?: string })?.workingDirectory || process.cwd();

        // Build environment from params.env array if provided
        const envOverrides: Record<string, string> = {};
        if (params.env) {
          for (const e of params.env) {
            envOverrides[e.name] = e.value;
          }
        }

        try {
          const terminalProcess = spawn(params.command, params.args || [], {
            cwd,
            env: { ...process.env, TERM: "xterm-256color", ...envOverrides },
            stdio: ["pipe", "pipe", "pipe"],
          });

          // Store terminal in tracking map
          const terminalInfo = {
            id: terminalId,
            process: terminalProcess,
            cwd,
            sessionId: params.sessionId,
            agentId,
          };
          this._terminals.set(terminalId, terminalInfo);

          // Stream stdout
          terminalProcess.stdout?.on("data", (data: Buffer) => {
            this.emit("terminal-output", {
              agentId,
              sessionId: params.sessionId,
              terminalId,
              data: data.toString(),
            });
          });

          // Stream stderr
          terminalProcess.stderr?.on("data", (data: Buffer) => {
            this.emit("terminal-output", {
              agentId,
              sessionId: params.sessionId,
              terminalId,
              data: data.toString(),
            });
          });

          // Handle exit
          terminalProcess.on("exit", (code, signal) => {
            this.emit("terminal-exit", {
              agentId,
              sessionId: params.sessionId,
              terminalId,
              exitCode: code ?? undefined,
              signal: signal ?? undefined,
            });
            this._terminals.delete(terminalId);
          });

          // Handle errors
          terminalProcess.on("error", (err) => {
            console.error(`[ACP] Terminal ${terminalId} error:`, err);
            this.emit("terminal-exit", {
              agentId,
              sessionId: params.sessionId,
              terminalId,
              exitCode: 1,
            });
            this._terminals.delete(terminalId);
          });

          // Emit terminal created event
          this.emit("terminal-created", {
            agentId,
            sessionId: params.sessionId,
            terminalId,
            cwd,
          });

          console.log(`[ACP] Terminal ${terminalId} created successfully`);
          return { terminalId };
        } catch (error) {
          console.error(`[ACP] Failed to create terminal:`, error);
          throw error;
        }
      },
    };
  }

  private _getChunkType(
    update: SessionNotification["update"],
  ): ACPMessageChunkType {
    if (!update) return "text";

    // SessionUpdate has a discriminator field 'sessionUpdate'
    const updateType = (update as { sessionUpdate?: string }).sessionUpdate;

    switch (updateType) {
      case "agent_message_chunk":
      case "user_message_chunk":
        return "text";
      case "agent_thought_chunk":
        return "thinking";
      case "tool_call":
        return "tool_call";
      case "tool_call_update":
        return "tool_result";
      // Feature 1: Plan updates
      case "plan":
        return "plan";
      // Feature 4: Available commands update
      case "available_commands_update":
        return "commands_update";
      // Feature 6: Session info update
      case "session_info_update":
        return "session_info";
      // Feature 3: Terminal updates (when sent as standalone)
      case "terminal_output":
        return "terminal_output";
      case "terminal_exit":
        return "terminal_exit";
      // Session state updates - these are handled via events, not message chunks
      // Return null type to skip chunk emission (handled separately)
      case "current_mode_update":
      case "config_option_update":
      case "model_update":
      case "session_model_update":
        // These are session state updates, not message content
        // They're emitted as separate events, return text to avoid breaking
        return "text";
      default:
        // Unknown update type, log it
        console.log(`[ACP] Unknown sessionUpdate type: ${updateType}`);
        return "text";
    }
  }

  /**
   * Extract tool name from meta field (Feature 5: Subagent support)
   */
  private _extractToolName(meta?: Record<string, unknown>): string | undefined {
    return meta?.[TOOL_NAME_META_KEY] as string | undefined;
  }

  /**
   * Check if a tool call is a subagent spawn (Feature 5)
   */
  private _isSubagentToolCall(toolKind?: string, toolName?: string): boolean {
    return toolKind === "other" && toolName === SUBAGENT_TOOL_NAME;
  }

  /**
   * Parse ACP ToolCall content array into structured content blocks
   * Content can contain: text, diffs, terminal output, subagent threads
   */
  private _parseToolCallContent(content?: unknown[]): {
    content: Array<{
      type: "text" | "diff" | "terminal" | "subagent";
      text?: string;
      diff?: { path: string; content: string };
      terminalId?: string;
      terminalOutput?: string;
    }>;
    types: string[];
  } {
    if (!content || !Array.isArray(content) || content.length === 0) {
      return { content: [], types: [] };
    }

    const parsedContent: Array<{
      type: "text" | "diff" | "terminal" | "subagent";
      text?: string;
      diff?: { path: string; content: string };
      terminalId?: string;
      terminalOutput?: string;
    }> = [];
    const types: string[] = [];

    for (const item of content) {
      if (!item || typeof item !== "object") continue;

      const contentItem = item as {
        toolCallContent?: string;
        text?: string;
        type?: string;
        diff?: { path: string; content: string };
        terminalId?: string;
        terminalOutput?: string;
        data?: string;
      };

      // Determine content type from ACP SDK format
      const contentType = contentItem.toolCallContent || contentItem.type;

      switch (contentType) {
        case "text":
          if (contentItem.text) {
            parsedContent.push({ type: "text", text: contentItem.text });
            if (!types.includes("text")) types.push("text");
          }
          break;
        case "diff":
          if (contentItem.diff) {
            parsedContent.push({ type: "diff", diff: contentItem.diff });
            if (!types.includes("diff")) types.push("diff");
          }
          break;
        case "terminal":
        case "terminal_output":
          parsedContent.push({
            type: "terminal",
            terminalId: contentItem.terminalId,
            terminalOutput: contentItem.terminalOutput || contentItem.data,
          });
          if (!types.includes("terminal")) types.push("terminal");
          break;
        case "subagent":
        case "subagent_thread":
          parsedContent.push({ type: "subagent" });
          if (!types.includes("subagent")) types.push("subagent");
          break;
        default:
          // Try to extract text from unknown format
          if (contentItem.text) {
            parsedContent.push({ type: "text", text: contentItem.text });
            if (!types.includes("text")) types.push("text");
          }
          break;
      }
    }

    return { content: parsedContent, types };
  }

  private _getChunkContent(
    update: SessionNotification["update"],
  ): string | ACPMessageChunk["content"] {
    if (!update) return "";

    // SessionUpdate has a discriminator field 'sessionUpdate'
    const updateType = (update as { sessionUpdate?: string }).sessionUpdate;
    // ContentChunk types have 'content' field which is a ContentBlock
    const contentBlock = (
      update as { content?: { type?: string; text?: string } }
    ).content;

    switch (updateType) {
      case "agent_message_chunk":
      case "user_message_chunk":
      case "agent_thought_chunk":
        // ContentBlock can be { type: "text", text: "..." }
        if (contentBlock?.type === "text" && contentBlock.text) {
          return contentBlock.text;
        }
        // Fallback: try to extract text from content directly
        if (typeof contentBlock === "string") {
          return contentBlock;
        }
        return "";

      case "tool_call": {
        // ToolCall type from ACP SDK:
        // - toolCallId: unique identifier (not 'id')
        // - title: human-readable title (main tool name)
        // - rawInput: tool input parameters
        // - kind: tool category
        // - status: execution status
        // - content, locations: additional data (diffs, text blocks, terminal output)
        // - meta: additional metadata (Feature 5: contains tool_name for subagent)
        const toolCall = update as {
          toolCallId?: string;
          id?: string; // Legacy fallback
          title?: string;
          name?: string; // Legacy fallback
          rawInput?: unknown;
          input?: unknown; // Legacy fallback
          kind?: string;
          status?: string;
          content?: unknown[];
          locations?: Array<{ path: string; line?: number }>;
          meta?: Record<string, unknown>;
        };
        // Get tool call ID - prefer toolCallId (ACP standard), fall back to id
        const toolId = toolCall.toolCallId || toolCall.id || "";
        // Get tool name from meta (Feature 5: subagent detection)
        const toolNameFromMeta = this._extractToolName(toolCall.meta);
        // Get display name - prefer title (ACP standard), fall back to meta tool_name, then name, then kind
        const toolDisplayName =
          toolCall.title ||
          toolNameFromMeta ||
          toolCall.name ||
          toolCall.kind ||
          "";
        // Get input from rawInput (ACP SDK standard) or input (legacy fallback)
        // Gemini models may send arguments as a JSON string - parse it
        let toolInput = toolCall.rawInput ?? toolCall.input;
        if (typeof toolInput === "string") {
          try {
            toolInput = JSON.parse(toolInput);
          } catch {
            // If parsing fails, keep as string
          }
        }
        // Detect if this is a subagent tool call (Feature 5)
        const isSubagent = this._isSubagentToolCall(
          toolCall.kind,
          toolNameFromMeta,
        );

        // Map tool status using the normalized mapping function
        const toolStatus = mapToolCallStatus(toolCall.status);

        // Parse tool call content array (diffs, text blocks, terminal output)
        const parsedContent = this._parseToolCallContent(toolCall.content);

        console.log("[ACP] Tool call received:", {
          toolCallId: toolCall.toolCallId,
          id: toolCall.id,
          title: toolCall.title,
          name: toolCall.name,
          kind: toolCall.kind,
          status: toolCall.status,
          mappedStatus: toolStatus,
          toolNameFromMeta,
          isSubagent,
          resolvedId: toolId,
          resolvedName: toolDisplayName,
          hasRawInput: toolCall.rawInput !== undefined,
          hasInput: toolCall.input !== undefined,
          inputValue: toolInput,
          hasContent: (toolCall.content?.length ?? 0) > 0,
          contentTypes: parsedContent.types,
        });
        return {
          id: toolId,
          name: toolDisplayName,
          input: toolInput as Record<string, unknown> | undefined,
          state: toolStatus === "pending" ? "running" : toolStatus,
          toolName: toolNameFromMeta,
          isSubagent,
          kind: toolCall.kind,
          // Include parsed content for richer tool call display
          content:
            parsedContent.content.length > 0
              ? parsedContent.content
              : undefined,
          locations: toolCall.locations,
        };
      }

      case "tool_call_update": {
        // ToolCallUpdate from ACP SDK: toolCallId, title, status, rawOutput, rawInput, content
        const toolUpdate = update as {
          toolCallId?: string;
          title?: string;
          status?: string;
          rawOutput?: unknown;
          message?: string; // Legacy fallback
          content?: unknown[];
          meta?: Record<string, unknown>;
        };
        // Map tool status using normalized mapping function
        const toolState = mapToolCallStatus(toolUpdate.status);

        // Get output from rawOutput (ACP SDK standard) or message (legacy fallback)
        // Gemini models may send output as a JSON string - parse it
        let toolOutput = toolUpdate.rawOutput ?? toolUpdate.message;
        if (typeof toolOutput === "string") {
          try {
            toolOutput = JSON.parse(toolOutput);
          } catch {
            // If parsing fails, keep as string
          }
        }
        // Extract tool name from meta (Feature 5)
        const toolNameFromMeta = this._extractToolName(toolUpdate.meta);

        console.log("[ACP] Tool call update received:", {
          toolCallId: toolUpdate.toolCallId,
          title: toolUpdate.title,
          status: toolUpdate.status,
          mappedStatus: toolState,
          hasRawOutput: toolUpdate.rawOutput !== undefined,
          outputType: typeof toolOutput,
          toolNameFromMeta,
        });
        return {
          id: toolUpdate.toolCallId || "",
          name: toolUpdate.title || "",
          output: toolOutput as Record<string, unknown> | undefined,
          state: toolState,
          toolName: toolNameFromMeta,
        } as ACPToolCallChunk;
      }

      // Feature 1: Plan updates
      case "plan": {
        const planUpdate = update as { plan?: ACPPlan };
        return (
          planUpdate.plan || {
            planId: "",
            steps: [],
            status: "pending" as const,
          }
        );
      }

      // Feature 4: Available commands update
      case "available_commands_update": {
        const commandsUpdate = update as {
          availableCommands?: ACPAvailableCommand[];
        };
        return commandsUpdate.availableCommands || [];
      }

      // Feature 6: Session info update
      case "session_info_update": {
        const infoUpdate = update as {
          title?: string;
          meta?: Record<string, unknown>;
        };
        return {
          agentId: "", // Will be filled in by caller
          sessionId: "", // Will be filled in by caller
          title: infoUpdate.title,
          meta: infoUpdate.meta,
        };
      }

      // Feature 3: Terminal output (when sent as standalone update)
      // Handle both camelCase and snake_case field names for ACP SDK compatibility
      case "terminal_output": {
        const terminalOutput = update as {
          terminalId?: string;
          terminal_id?: string;
          data?: string;
        };
        return {
          terminalId:
            terminalOutput.terminalId || terminalOutput.terminal_id || "",
          data: terminalOutput.data || "",
        } as ACPTerminalOutput;
      }

      // Feature 3: Terminal exit (when sent as standalone update)
      // Handle both camelCase and snake_case field names for ACP SDK compatibility
      case "terminal_exit": {
        const terminalExit = update as {
          terminalId?: string;
          terminal_id?: string;
          exitCode?: number;
          exit_code?: number;
          signal?: string;
        };
        return {
          terminalId: terminalExit.terminalId || terminalExit.terminal_id || "",
          exitCode: terminalExit.exitCode ?? terminalExit.exit_code,
          signal: terminalExit.signal,
        } as ACPTerminalExit;
      }

      default:
        // Try to extract any text content
        if (contentBlock?.text) {
          return contentBlock.text;
        }
        return "";
    }
  }

  private _mapToolKindToPermissionType(
    toolKind?: string | null,
  ): ACPPermissionRequest["permissionType"] {
    // Map ACP SDK ToolKind to our permission type
    if (!toolKind) {
      console.log(
        "[ACP] No toolKind provided, defaulting to 'terminal' permission type",
      );
      return "terminal";
    }
    const kind = toolKind.toLowerCase();
    if (
      kind.includes("file") ||
      kind.includes("edit") ||
      kind.includes("write")
    ) {
      return "file_edit";
    }
    if (kind.includes("create")) {
      return "file_create";
    }
    if (kind.includes("delete")) {
      return "file_delete";
    }
    if (kind.includes("mcp")) {
      return "mcp_tool";
    }
    // Log unknown tool kinds for debugging
    console.log(
      `[ACP] Unknown toolKind "${toolKind}", defaulting to 'terminal' permission type`,
    );
    return "terminal";
  }

  /**
   * Get permission request details for persistence
   * Returns metadata about the permission request before it's resolved
   */
  getPermissionRequestDetails(requestId: string): {
    agentId: string;
    permissionType: string;
    toolName?: string;
    filePath?: string;
    options: Array<{ id: string; grants?: boolean }>;
  } | null {
    const pending = this.pendingPermissions.get(requestId);
    if (!pending) {
      return null;
    }
    return pending.metadata;
  }

  /**
   * Respond to a permission request
   */
  respondToPermission(requestId: string, optionId: string): void {
    const pending = this.pendingPermissions.get(requestId);
    if (!pending) {
      console.warn(`[ACP] No pending permission request: ${requestId}`);
      return;
    }

    this.pendingPermissions.delete(requestId);

    // Find the option
    const option = pending.request.options.find((o) => o.id === optionId);
    if (!option) {
      pending.reject(new Error(`Unknown option: ${optionId}`));
      return;
    }

    pending.resolve({
      outcome: {
        outcome: "selected",
        optionId: optionId,
      },
    });
  }

  /**
   * Create a new session with an agent
   */
  async createSession(
    agentId: string,
    workingDirectory: string,
    mcpServers?: Array<{
      name: string;
      command: string;
      args?: string[];
      env?: Record<string, string>;
    }>,
    threadId?: string,
  ): Promise<ACPSession> {
    const activeAgent = this.agents.get(agentId);
    if (!activeAgent) {
      // Try to start the agent first
      await this.startAgent(agentId);
      return this.createSession(agentId, workingDirectory, mcpServers, threadId);
    }

    // Validate MCP servers before creating session
    const validation = validateMCPServers(mcpServers);
    if (!validation.valid) {
      const errorMsg = `Invalid MCP server configuration:\n${validation.errors.join("\n")}`;
      console.error(`[ACP] ${errorMsg}`);
      throw new Error(errorMsg);
    }
    if (validation.warnings.length > 0) {
      console.warn(
        `[ACP] MCP server warnings:\n${validation.warnings.join("\n")}`
      );
    }

    try {
      // ACP spec uses 'cwd' not 'workingDirectory'
      // MCP servers use McpServerStdio format (flat structure, not nested transport)
      const response = await activeAgent.connection.newSession({
        cwd: workingDirectory,
        mcpServers: (mcpServers || []).map((s) => ({
          mcpServer: "stdio" as const,
          name: s.name,
          command: s.command,
          args: s.args || [],
          // Convert env object to array format expected by ACP SDK
          env: Object.entries(s.env || {}).map(([name, value]) => ({
            name,
            value,
          })),
        })),
      });

      const session: ACPSession = {
        sessionId: response.sessionId,
        agentId,
        workingDirectory,
        createdAt: new Date(),
        availableModes: response.modes?.availableModes?.map((m) => m.id),
        currentMode: response.modes?.currentModeId,
        configOptions:
          (response.configOptions as ACPSession["configOptions"]) ?? null,
        models: (response.models as ACPSession["models"]) ?? null,
      };

      activeAgent.sessions.set(response.sessionId, session);
      if (threadId) {
        this.sessionThreadMap.set(response.sessionId, threadId);
      }
      this.emit("session-created", session);

      return session;
    } catch (error: unknown) {
      // Check if auth is required
      const err = error as { code?: number };
      if (err.code === -32001) {
        // Auth required error
        activeAgent.status.authenticated = false;
        this.emit("auth-required", {
          agentId,
          methods: activeAgent.authMethods,
        });
        throw new Error(`Agent ${agentId} requires authentication`);
      }
      throw error;
    }
  }

  /**
   * Set the active session mode
   */
  async setSessionMode(
    agentId: string,
    sessionId: string,
    modeId: string,
  ): Promise<void> {
    const activeAgent = this.agents.get(agentId);
    if (!activeAgent) {
      throw new Error(`Agent ${agentId} is not running`);
    }

    await activeAgent.connection.setSessionMode({ sessionId, modeId });

    const session = activeAgent.sessions.get(sessionId);
    if (session) {
      session.currentMode = modeId;
    }
  }

  // ============================================================================
  // SESSION LIST/LOAD/RESUME METHODS (Feature 2)
  // ============================================================================

  /**
   * Get agent capabilities
   */
  getAgentCapabilities(agentId: string): ACPAgentCapabilities | undefined {
    const activeAgent = this.agents.get(agentId);
    return activeAgent?.capabilities;
  }

  /**
   * List available sessions for an agent
   * Requires agent to support session list capability
   */
  async listSessions(
    agentId: string,
    request?: ACPSessionListRequest,
  ): Promise<ACPSessionListResponse> {
    const activeAgent = this.agents.get(agentId);
    if (!activeAgent) {
      throw new Error(`Agent ${agentId} is not running`);
    }

    if (!activeAgent.capabilities.sessionList) {
      console.warn(`[ACP] Agent ${agentId} does not support session listing`);
      return { sessions: [] };
    }

    try {
      // Use the ACP connection to list sessions
      // Note: This method may not exist in all SDK versions, so we cast to any
      const connection = activeAgent.connection as any;
      if (typeof connection.listSessions !== "function") {
        console.warn(`[ACP] listSessions not available on connection`);
        return { sessions: [] };
      }

      const response = await connection.listSessions({
        cwd: request?.cwd,
        cursor: request?.cursor,
      });

      const sessions: ACPSessionInfo[] = (response.sessions || []).map(
        (s: any) => ({
          sessionId: s.sessionId,
          cwd: s.cwd,
          title: s.title,
          updatedAt: s.updatedAt ? new Date(s.updatedAt) : undefined,
          meta: s.meta,
        }),
      );

      return {
        sessions,
        nextCursor: response.nextCursor,
        meta: response.meta,
      };
    } catch (error) {
      console.error(`[ACP] Failed to list sessions for ${agentId}:`, error);
      throw error;
    }
  }

  /**
   * Load an existing session (with history replay)
   * Requires agent to support load session capability
   */
  async loadSession(
    agentId: string,
    sessionId: string,
    workingDirectory: string,
    mcpServers?: Array<{
      name: string;
      command: string;
      args?: string[];
      env?: Record<string, string>;
    }>,
  ): Promise<ACPSession> {
    const activeAgent = this.agents.get(agentId);
    if (!activeAgent) {
      // Try to start the agent first
      await this.startAgent(agentId);
      return this.loadSession(agentId, sessionId, workingDirectory, mcpServers);
    }

    if (!activeAgent.capabilities.loadSession) {
      throw new Error(`Agent ${agentId} does not support loading sessions`);
    }

    try {
      // Use the ACP connection to load session
      const connection = activeAgent.connection as any;
      if (typeof connection.loadSession !== "function") {
        throw new Error("loadSession not available on connection");
      }

      const response = await connection.loadSession({
        sessionId,
        cwd: workingDirectory,
        mcpServers: (mcpServers || []).map((s) => ({
          mcpServer: "stdio" as const,
          name: s.name,
          command: s.command,
          args: s.args || [],
          env: Object.entries(s.env || {}).map(([name, value]) => ({
            name,
            value,
          })),
        })),
      });

      const session: ACPSession = {
        sessionId: response.sessionId,
        agentId,
        workingDirectory,
        createdAt: new Date(),
        availableModes: response.modes?.availableModes?.map((m: any) => m.id),
        currentMode: response.modes?.currentModeId,
        configOptions: response.configOptions ?? null,
        models: response.models ?? null,
      };

      activeAgent.sessions.set(response.sessionId, session);
      this.emit("session-loaded", session);

      return session;
    } catch (error) {
      console.error(`[ACP] Failed to load session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Resume an existing session (without history replay)
   * Requires agent to support resume session capability
   */
  async resumeSession(
    agentId: string,
    sessionId: string,
    workingDirectory: string,
    mcpServers?: Array<{
      name: string;
      command: string;
      args?: string[];
      env?: Record<string, string>;
    }>,
  ): Promise<ACPSession> {
    const activeAgent = this.agents.get(agentId);
    if (!activeAgent) {
      // Try to start the agent first
      await this.startAgent(agentId);
      return this.resumeSession(
        agentId,
        sessionId,
        workingDirectory,
        mcpServers,
      );
    }

    if (!activeAgent.capabilities.sessionResume) {
      throw new Error(`Agent ${agentId} does not support resuming sessions`);
    }

    try {
      // Use the ACP connection to resume session
      const connection = activeAgent.connection as any;
      if (typeof connection.resumeSession !== "function") {
        throw new Error("resumeSession not available on connection");
      }

      const response = await connection.resumeSession({
        sessionId,
        cwd: workingDirectory,
        mcpServers: (mcpServers || []).map((s) => ({
          mcpServer: "stdio" as const,
          name: s.name,
          command: s.command,
          args: s.args || [],
          env: Object.entries(s.env || {}).map(([name, value]) => ({
            name,
            value,
          })),
        })),
      });

      const session: ACPSession = {
        sessionId: response.sessionId,
        agentId,
        workingDirectory,
        createdAt: new Date(),
        availableModes: response.modes?.availableModes?.map((m: any) => m.id),
        currentMode: response.modes?.currentModeId,
        configOptions: response.configOptions ?? null,
        models: response.models ?? null,
      };

      activeAgent.sessions.set(response.sessionId, session);
      this.emit("session-resumed", session);

      return session;
    } catch (error) {
      console.error(`[ACP] Failed to resume session ${sessionId}:`, error);
      throw error;
    }
  }

  // ============================================================================
  // AGENTIC LOOP METHODS (Following Zed's patterns)
  // ============================================================================

  /**
   * Get or create agentic loop state for a session
   */
  private getOrCreateAgenticLoopState(
    activeAgent: ActiveAgent,
    sessionId: string,
  ): AgenticLoopState {
    let state = activeAgent.agenticLoopStates.get(sessionId);
    if (!state) {
      state = {
        active: false,
        iteration: 0,
        pendingTools: new Set(),
        autoResume: true, // Enable auto-resume by default (true agentic behavior)
        lastStopReason: null,
        retryCount: 0,
        cancelled: false,
        waitingForToolCompletion: false, // Used to fix race condition between tool completion and stop reason
      };
      activeAgent.agenticLoopStates.set(sessionId, state);
    }
    return state;
  }

  /**
   * Track a tool call as pending
   */
  private trackToolCall(
    agentId: string,
    sessionId: string,
    toolCallId: string,
  ): void {
    const activeAgent = this.agents.get(agentId);
    if (!activeAgent) return;

    const state = this.getOrCreateAgenticLoopState(activeAgent, sessionId);
    state.pendingTools.add(toolCallId);
    console.log(
      `[ACP] Tracking tool ${toolCallId} for session ${sessionId}, pending: ${state.pendingTools.size}`,
    );
  }

  /**
   * Mark a tool call as completed
   * Uses waitingForToolCompletion flag to fix race condition where tools complete
   * before the stop_reason is set from the prompt response
   */
  private completeToolCall(
    agentId: string,
    sessionId: string,
    toolCallId: string,
  ): void {
    const activeAgent = this.agents.get(agentId);
    if (!activeAgent) return;

    const state = this.getOrCreateAgenticLoopState(activeAgent, sessionId);
    state.pendingTools.delete(toolCallId);
    console.log(
      `[ACP] Completed tool ${toolCallId} for session ${sessionId}, pending: ${state.pendingTools.size}`,
    );

    // Clear any existing debounce timer
    if (state.resumeDebounceId) {
      clearTimeout(state.resumeDebounceId);
      state.resumeDebounceId = undefined;
    }

    // Check if we should auto-resume
    // Uses waitingForToolCompletion flag instead of checking lastStopReason
    // This fixes the race condition where tools complete before stop_reason is set
    if (
      state.active &&
      state.autoResume &&
      state.pendingTools.size === 0 &&
      state.waitingForToolCompletion &&
      !state.cancelled
    ) {
      // Clear the tool completion timeout since all tools finished
      if (state.toolTimeoutId) {
        clearTimeout(state.toolTimeoutId);
        state.toolTimeoutId = undefined;
      }

      // Debounce to handle rapid tool completions (50ms)
      state.resumeDebounceId = setTimeout(() => {
        // Double-check state hasn't changed during debounce
        if (
          state.active &&
          state.autoResume &&
          state.pendingTools.size === 0 &&
          state.waitingForToolCompletion &&
          !state.cancelled
        ) {
          console.log(
            `[ACP] All tools complete, auto-resuming session ${sessionId}`,
          );
          state.waitingForToolCompletion = false; // Reset flag before resuming
          this._autoResumeSession(agentId, sessionId);
        }
      }, 50);
    }
  }

  /**
   * Auto-resume a session after tool completion (the core agentic loop)
   * This is what makes the agent truly agentic - it continues until end_turn
   */
  private async _autoResumeSession(
    agentId: string,
    sessionId: string,
  ): Promise<void> {
    const activeAgent = this.agents.get(agentId);
    if (!activeAgent) return;

    const state = this.getOrCreateAgenticLoopState(activeAgent, sessionId);

    // Clear any pending tool timeout since we're resuming
    if (state.toolTimeoutId) {
      clearTimeout(state.toolTimeoutId);
      state.toolTimeoutId = undefined;
    }

    // Safety checks
    if (state.cancelled) {
      console.log(`[ACP] Session ${sessionId} was cancelled, not resuming`);
      state.active = false;
      // Emit done so frontend can transition out of streaming state
      this.emit("message-chunk", {
        sessionId,
        agentId,
        messageId: crypto.randomUUID(),
        type: "text",
        content: "",
        done: true,
      } as ACPMessageChunk);
      return;
    }

    if (state.iteration >= MAX_AGENTIC_LOOP_ITERATIONS) {
      console.warn(
        `[ACP] Session ${sessionId} reached max iterations (${MAX_AGENTIC_LOOP_ITERATIONS}), stopping`,
      );
      state.active = false;
      this.emit("message-chunk", {
        sessionId,
        agentId,
        messageId: crypto.randomUUID(),
        type: "text",
        content: `\n\n[Agent reached maximum iteration limit (${MAX_AGENTIC_LOOP_ITERATIONS}). Please continue manually if needed.]`,
        done: true,
      } as ACPMessageChunk);
      return;
    }

    // Small delay to prevent tight loops
    await new Promise((resolve) => setTimeout(resolve, AGENTIC_LOOP_DELAY_MS));

    // Resume with "Continue where you left off" message (following Zed's pattern)
    console.log(
      `[ACP] Auto-resuming session ${sessionId}, iteration ${state.iteration + 1}`,
    );
    state.iteration++;

    try {
      // Send a resume prompt - this is the key agentic behavior
      const resumeMessage =
        "Continue where you left off. Complete the remaining tasks.";
      await this.sendPrompt(agentId, sessionId, resumeMessage);
    } catch (error) {
      console.error(
        `[ACP] Auto-resume failed for session ${sessionId}:`,
        error,
      );

      // Retry with exponential backoff
      if (state.retryCount < MAX_RETRY_ATTEMPTS) {
        state.retryCount++;
        const delay = BASE_RETRY_DELAY_MS * Math.pow(2, state.retryCount - 1);
        console.log(
          `[ACP] Retrying in ${delay}ms (attempt ${state.retryCount}/${MAX_RETRY_ATTEMPTS})`,
        );

        this.emit("message-chunk", {
          sessionId,
          agentId,
          messageId: crypto.randomUUID(),
          type: "text",
          content: `\n[Retrying in ${delay / 1000}s... (attempt ${state.retryCount}/${MAX_RETRY_ATTEMPTS})]`,
        } as ACPMessageChunk);

        await new Promise((resolve) => setTimeout(resolve, delay));
        try {
          await this._autoResumeSession(agentId, sessionId);
        } catch (retryError) {
          console.error(
            `[ACP] Retry also failed for session ${sessionId}:`,
            retryError,
          );
          state.active = false;
          this.emit("message-chunk", {
            sessionId,
            agentId,
            messageId: crypto.randomUUID(),
            type: "error",
            content: `Agent retry failed: ${retryError instanceof Error ? retryError.message : String(retryError)}`,
            done: true,
          } as ACPMessageChunk);
        }
      } else {
        console.error(
          `[ACP] Max retry attempts reached for session ${sessionId}`,
        );
        state.active = false;
        this.emit("message-chunk", {
          sessionId,
          agentId,
          messageId: crypto.randomUUID(),
          type: "error",
          content: `Agent failed after ${MAX_RETRY_ATTEMPTS} retry attempts: ${error instanceof Error ? error.message : String(error)}`,
          done: true,
        } as ACPMessageChunk);
      }
    }
  }

  /**
   * Enable/disable auto-resume for a session
   */
  setAutoResume(agentId: string, sessionId: string, enabled: boolean): void {
    const activeAgent = this.agents.get(agentId);
    if (!activeAgent) return;

    const state = this.getOrCreateAgenticLoopState(activeAgent, sessionId);
    state.autoResume = enabled;
    console.log(
      `[ACP] Auto-resume ${enabled ? "enabled" : "disabled"} for session ${sessionId}`,
    );
  }

  /**
   * Get agentic loop status for a session
   */
  getAgenticLoopStatus(
    agentId: string,
    sessionId: string,
  ): {
    active: boolean;
    iteration: number;
    pendingTools: number;
    autoResume: boolean;
  } | null {
    const activeAgent = this.agents.get(agentId);
    if (!activeAgent) return null;

    const state = activeAgent.agenticLoopStates.get(sessionId);
    if (!state) return null;

    return {
      active: state.active,
      iteration: state.iteration,
      pendingTools: state.pendingTools.size,
      autoResume: state.autoResume,
    };
  }

  /**
   * Set the active session model (ACP experimental)
   */
  async setSessionModel(
    agentId: string,
    sessionId: string,
    modelId: string,
  ): Promise<void> {
    const activeAgent = this.agents.get(agentId);
    if (!activeAgent) {
      throw new Error(`Agent ${agentId} is not running`);
    }

    await activeAgent.connection.unstable_setSessionModel({
      sessionId,
      modelId,
    });

    const session = activeAgent.sessions.get(sessionId);
    if (session?.models) {
      session.models = {
        ...session.models,
        currentModelId: modelId,
      };
    }
  }

  /**
   * Set a session config option (ACP experimental)
   */
  async setSessionConfigOption(
    agentId: string,
    sessionId: string,
    configId: string,
    value: string,
  ): Promise<{ configOptions: ACPSession["configOptions"] }> {
    const activeAgent = this.agents.get(agentId);
    if (!activeAgent) {
      throw new Error(`Agent ${agentId} is not running`);
    }

    const response =
      await activeAgent.connection.unstable_setSessionConfigOption({
        sessionId,
        configId,
        value,
      });

    const session = activeAgent.sessions.get(sessionId);
    if (session) {
      session.configOptions =
        (response.configOptions as ACPSession["configOptions"]) ?? null;
    }

    return {
      configOptions:
        (response.configOptions as ACPSession["configOptions"]) ?? null,
    };
  }

  /**
   * Update session context (working directory)
   * Note: The ACP SDK may not support dynamic cwd updates, so this method
   * updates the local session state. For the model to be fully aware of
   * the new working directory, a session recreate may be necessary.
   *
   * @param agentId - The agent ID
   * @param sessionId - The session ID
   * @param context - The context to update (currently supports workingDirectory)
   * @returns The updated session info
   */
  async updateSessionContext(
    agentId: string,
    sessionId: string,
    context: { workingDirectory?: string },
  ): Promise<{
    sessionId: string;
    workingDirectory?: string;
    contextUpdated: boolean;
  }> {
    const activeAgent = this.agents.get(agentId);
    if (!activeAgent) {
      throw new Error(`Agent ${agentId} is not running`);
    }

    const session = activeAgent.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found for agent ${agentId}`);
    }

    let contextUpdated = false;

    // Update working directory in session state
    if (
      context.workingDirectory &&
      context.workingDirectory !== session.workingDirectory
    ) {
      console.log(
        `[ACP] Updating session ${sessionId} working directory:`,
        session.workingDirectory,
        "->",
        context.workingDirectory,
      );
      session.workingDirectory = context.workingDirectory;
      contextUpdated = true;

      // Emit event for UI to update
      this.emit("session-context-updated", {
        agentId,
        sessionId,
        workingDirectory: context.workingDirectory,
      });
    }

    return {
      sessionId,
      workingDirectory: session.workingDirectory,
      contextUpdated,
    };
  }

  /**
   * Send a prompt to an agent session
   * This implements the agentic loop - the agent will continue until end_turn
   */
  async sendPrompt(
    agentId: string,
    sessionId: string,
    message: string,
    contextFiles?: Array<{ path: string; content?: string }>,
    options?: { autoResume?: boolean; isResumePrompt?: boolean },
  ): Promise<ACPPromptResult> {
    const activeAgent = this.agents.get(agentId);
    if (!activeAgent) {
      throw new Error(`Agent ${agentId} is not running`);
    }

    // Initialize agentic loop state
    const loopState = this.getOrCreateAgenticLoopState(activeAgent, sessionId);

    // If this is a new prompt (not a resume), reset the loop state
    if (!options?.isResumePrompt) {
      loopState.iteration = 0;
      loopState.retryCount = 0;
      loopState.cancelled = false;
      loopState.pendingTools.clear();
      loopState.waitingForToolCompletion = false;
      if (loopState.resumeDebounceId) {
        clearTimeout(loopState.resumeDebounceId);
        loopState.resumeDebounceId = undefined;
      }
    }

    // Start the agentic loop
    loopState.active = true;

    // Configure auto-resume if specified
    if (options?.autoResume !== undefined) {
      loopState.autoResume = options.autoResume;
    }

    let session = activeAgent.sessions.get(sessionId);
    // If session not found but agent is running, try to recreate it
    // This handles the case where the agent restarted and lost sessions
    if (!session) {
      console.log(
        `[ACP] Session ${sessionId} not found for agent ${agentId}, attempting to recreate...`,
      );
      // Try to find any existing session for this agent to get working directory
      // If no sessions exist, we'll need to use a default working directory
      const existingSession = Array.from(activeAgent.sessions.values())[0];
      const workingDirectory =
        existingSession?.workingDirectory || process.cwd();

      try {
        // Recreate the session with the same working directory
        const newSession = await this.createSession(agentId, workingDirectory);
        console.log(
          `[ACP] Recreated session: ${newSession.sessionId} (original: ${sessionId})`,
        );
        // Use the new session ID
        session = newSession;
        // Update the sessionId in the activeAgent.sessions map
        activeAgent.sessions.set(newSession.sessionId, newSession);
        // Emit event so frontend can update its session reference
        this.emit("session-recreated", {
          agentId,
          oldSessionId: sessionId,
          newSession,
        });
      } catch (recreateError) {
        console.error(
          `[ACP] Failed to recreate session for agent ${agentId}:`,
          recreateError,
        );
        loopState.active = false;
        throw new Error(
          `Session ${sessionId} not found and could not be recreated: ${recreateError instanceof Error ? recreateError.message : String(recreateError)}`,
        );
      }
    }

    try {
      // Build the prompt as Array<ContentBlock> per ACP spec
      const promptBlocks: Array<{ type: "text"; text: string }> = [
        {
          type: "text",
          text: message,
        },
      ];

      // Add context files as additional text blocks
      if (contextFiles && contextFiles.length > 0) {
        for (const f of contextFiles) {
          promptBlocks.push({
            type: "text",
            text: `File: ${f.path}\n\`\`\`\n${f.content || "[content not loaded]"}\n\`\`\``,
          });
        }
      }

      // Use the session's sessionId (which might be different if we recreated it)
      const actualSessionId = session.sessionId;

      console.log(
        `[ACP] Sending prompt to session ${actualSessionId}, iteration ${loopState.iteration}, autoResume: ${loopState.autoResume}`,
      );

      const response = await activeAgent.connection.prompt({
        sessionId: actualSessionId,
        prompt: promptBlocks,
      });

      // Normalize the stop reason using our mapping function
      const normalizedStopReason = mapStopReason(response.stopReason);

      // Track the stop reason for agentic loop decisions
      loopState.lastStopReason = normalizedStopReason;

      console.log(
        `[ACP] Prompt response stopReason: ${response.stopReason} (normalized: ${normalizedStopReason}), pendingTools: ${loopState.pendingTools.size}`,
      );

      // Handle the stop reason according to ACP protocol spec:
      // Valid ACP stop reasons: end_turn, max_tokens, cancelled, refusal, error
      // NOTE: "tool_use" is NOT a valid ACP stop reason - it's from Anthropic's API.
      // In proper ACP, the agent handles tool calls internally and returns end_turn when done.
      //
      // If we receive "tool_use", the agent is not properly implementing ACP agentic loop.
      // We'll handle it gracefully by checking for pending tools and auto-resuming if needed.

      if (normalizedStopReason === "end_turn") {
        // Agent is truly finished - emit done and end the loop
        console.log(
          `[ACP] Agent finished (end_turn) for session ${actualSessionId}`,
        );
        loopState.active = false;
        this.emit("message-chunk", {
          sessionId: actualSessionId,
          agentId,
          messageId: crypto.randomUUID(),
          type: "text",
          content: "",
          done: true,
        } as ACPMessageChunk);
      } else if (normalizedStopReason === "tool_use") {
        // NOTE: tool_use is not a valid ACP stop reason but some providers return it.
        // Check if we have pending tools - if so, wait for them. Otherwise, treat as done.
        console.log(
          `[ACP] Received tool_use stop reason for session ${actualSessionId}, pending tools: ${loopState.pendingTools.size}`,
        );

        // Set the waitingForToolCompletion flag - this fixes race condition where
        // tools may complete before this code runs
        loopState.waitingForToolCompletion = true;

        if (loopState.pendingTools.size > 0 && loopState.autoResume) {
          // We have pending tools and auto-resume is enabled - wait for tools to complete
          console.log(
            `[ACP] Waiting for ${loopState.pendingTools.size} pending tools to complete`,
          );

          // Set a timeout to prevent stuck state if tools don't complete
          if (loopState.toolTimeoutId) {
            clearTimeout(loopState.toolTimeoutId);
          }
          loopState.toolTimeoutId = setTimeout(() => {
            // If we're still waiting for tools after timeout, emit done to prevent stuck chat
            if (loopState.active && loopState.pendingTools.size > 0) {
              console.warn(
                `[ACP] Tool completion timeout for session ${actualSessionId}, pending tools: ${Array.from(loopState.pendingTools).join(", ")}`,
              );
              loopState.active = false;
              loopState.waitingForToolCompletion = false;
              loopState.pendingTools.clear();
              this.emit("message-chunk", {
                sessionId: actualSessionId,
                agentId,
                messageId: crypto.randomUUID(),
                type: "text",
                content:
                  "\n\n[Tool execution timed out. The agent's response may be incomplete.]",
                done: true,
              } as ACPMessageChunk);
            }
          }, TOOL_COMPLETION_TIMEOUT_MS);

          // Don't emit done - completeToolCall will trigger auto-resume when all tools finish
        } else if (loopState.autoResume && loopState.pendingTools.size === 0) {
          // No pending tools but auto-resume is on - tools already completed before stop_reason
          // Auto-resume immediately
          console.log(
            `[ACP] No pending tools detected (already completed), auto-resuming immediately`,
          );
          loopState.waitingForToolCompletion = false; // Reset since we're resuming now
          setTimeout(
            () => this._autoResumeSession(agentId, actualSessionId),
            AGENTIC_LOOP_DELAY_MS,
          );
        } else {
          // Auto-resume is disabled or something unexpected - emit done to prevent stuck state
          console.log(
            `[ACP] Auto-resume disabled or unexpected state - emitting done to prevent stuck chat`,
          );
          loopState.active = false;
          loopState.waitingForToolCompletion = false; // Reset flag
          this.emit("message-chunk", {
            sessionId: actualSessionId,
            agentId,
            messageId: crypto.randomUUID(),
            type: "text",
            content: "",
            done: true,
          } as ACPMessageChunk);
        }
      } else if (normalizedStopReason === "max_tokens") {
        // Ran out of tokens mid-response - auto-resume to continue
        console.log(
          `[ACP] Max tokens reached, auto-resuming session ${actualSessionId}`,
        );
        if (loopState.autoResume && !loopState.cancelled) {
          setTimeout(
            () => this._autoResumeSession(agentId, actualSessionId),
            AGENTIC_LOOP_DELAY_MS,
          );
        } else {
          loopState.active = false;
          this.emit("message-chunk", {
            sessionId: actualSessionId,
            agentId,
            messageId: crypto.randomUUID(),
            type: "text",
            content:
              "\n\n[Response truncated due to token limit. Auto-resume is disabled.]",
            done: true,
          } as ACPMessageChunk);
        }
      } else {
        // cancelled, refusal, error, or unknown - stop the loop and emit done
        console.log(`[ACP] Agent stopped with reason: ${normalizedStopReason}`);
        loopState.active = false;
        this.emit("message-chunk", {
          sessionId: actualSessionId,
          agentId,
          messageId: crypto.randomUUID(),
          type: "text",
          content: "",
          done: true,
        } as ACPMessageChunk);
      }

      return {
        sessionId: actualSessionId,
        stopReason: normalizedStopReason,
        error: undefined,
      };
    } catch (error) {
      // Extract a proper error message
      let errorMessage: string;
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === "object" && error !== null) {
        // Handle ACP error objects that may have structured data
        const errObj = error as Record<string, unknown>;
        if (typeof errObj.message === "string") {
          errorMessage = errObj.message;
        } else if (typeof errObj.error === "string") {
          errorMessage = errObj.error;
        } else {
          errorMessage = JSON.stringify(error);
        }
      } else {
        errorMessage = String(error);
      }

      console.error(
        `[ACPAgentService] Prompt error for session ${sessionId}:`,
        errorMessage,
      );

      // Clear any pending tool timeout
      if (loopState.toolTimeoutId) {
        clearTimeout(loopState.toolTimeoutId);
        loopState.toolTimeoutId = undefined;
      }

      // Mark loop as inactive on error
      loopState.active = false;

      // Emit error chunk - use session's actual ID (may differ after recreation)
      const emitSessionId = session?.sessionId ?? sessionId;
      this.emit("message-chunk", {
        sessionId: emitSessionId,
        agentId,
        messageId: crypto.randomUUID(),
        type: "error",
        content: errorMessage,
        done: true,
      } as ACPMessageChunk);

      return {
        sessionId: emitSessionId,
        stopReason: "error",
        error: errorMessage,
      };
    }
  }

  /**
   * Cancel an ongoing prompt and stop the agentic loop
   */
  async cancelPrompt(agentId: string, sessionId: string): Promise<void> {
    const activeAgent = this.agents.get(agentId);
    if (!activeAgent) {
      return;
    }

    // Stop the agentic loop
    const loopState = activeAgent.agenticLoopStates.get(sessionId);
    if (loopState) {
      loopState.cancelled = true;
      loopState.active = false;
      loopState.pendingTools.clear();

      // Clear any pending tool timeout
      if (loopState.toolTimeoutId) {
        clearTimeout(loopState.toolTimeoutId);
        loopState.toolTimeoutId = undefined;
      }

      console.log(`[ACP] Cancelled agentic loop for session ${sessionId}`);
    }

    await activeAgent.connection.cancel({ sessionId });
  }

  /**
   * Authenticate with an agent
   */
  async authenticate(
    agentId: string,
    methodId: string,
  ): Promise<{ success: boolean; message?: string }> {
    const activeAgent = this.agents.get(agentId);
    if (!activeAgent) {
      throw new Error(`Agent ${agentId} is not running`);
    }

    try {
      await activeAgent.connection.authenticate({ methodId });
      activeAgent.status.authenticated = true;
      this.emit("agent-authenticated", { agentId });
      return { success: true };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Stop an agent
   */
  async stopAgent(agentId: string): Promise<void> {
    const activeAgent = this.agents.get(agentId);
    if (!activeAgent) {
      return;
    }

    // Kill the process
    activeAgent.process.kill();
    this._cleanupAgent(agentId);
  }

  /**
   * Stop all agents
   */
  async stopAllAgents(): Promise<void> {
    for (const agentId of this.agents.keys()) {
      await this.stopAgent(agentId);
    }
  }

  private _cleanupAgent(agentId: string): void {
    const activeAgent = this.agents.get(agentId);
    if (activeAgent) {
      // Clean up terminals associated with this agent
      for (const [termId, terminal] of this._terminals.entries()) {
        if (terminal.agentId === agentId) {
          try {
            terminal.process.kill();
          } catch (err) {
            console.warn(`[ACP] Failed to kill terminal ${termId}:`, err);
          }
          this._terminals.delete(termId);
        }
      }

      // Clean up sessionThreadMap entries before clearing sessions
      for (const sessionId of activeAgent.sessions.keys()) {
        this.sessionThreadMap.delete(sessionId);
      }
      // Clear sessions
      activeAgent.sessions.clear();

      // Update status
      const status = this.detectedAgents.get(agentId);
      if (status) {
        status.running = false;
      }
    }

    this.agents.delete(agentId);
  }
}

// Singleton instance
let acpAgentManager: ACPAgentManager | null = null;

export function getACPAgentManager(): ACPAgentManager {
  if (!acpAgentManager) {
    acpAgentManager = new ACPAgentManager();
  }
  return acpAgentManager;
}
