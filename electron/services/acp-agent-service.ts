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
  ACPSession,
  ACPMessageChunk,
  ACPPermissionRequest,
  ACPPromptResult,
} from "../../src/types/acp";
import {
  ACP_AGENT_CONFIGS,
  getAgentConfig,
  getAgentNpxConfig,
} from "./acp-agents";

const execAsync = promisify(exec);

/**
 * Active agent connection with its process and ACP connection
 */
interface ActiveAgent {
  config: ACPAgentConfig;
  process: ChildProcess;
  connection: ClientSideConnection;
  sessions: Map<string, ACPSession>;
  status: ACPAgentStatus;
}

/**
 * Pending permission request waiting for user response
 */
interface PendingPermission {
  request: ACPPermissionRequest;
  resolve: (response: RequestPermissionResponse) => void;
  reject: (error: Error) => void;
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

  constructor() {
    super();
  }

  /**
   * Detect all installed ACP agents
   */
  async detectInstalledAgents(
    forceRefresh = false
  ): Promise<ACPAgentStatus[]> {
    // Return cached results if available and not forcing refresh
    if (!forceRefresh && this.detectionPromise) {
      return this.detectionPromise;
    }

    this.detectionPromise = this._detectAgents();
    return this.detectionPromise;
  }

  private async _detectAgents(): Promise<ACPAgentStatus[]> {
    const results = await Promise.all(
      ACP_AGENT_CONFIGS.map((config) => this.checkAgentInstalled(config))
    );

    // Cache results
    for (const status of results) {
      this.detectedAgents.set(status.id, status);
    }

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

    console.log(`[ACP] No auth found for ${config.id}, checked: ${config.authPaths.join(", ")}`);
    return false;
  }

  /**
   * Check if a specific agent is installed
   */
  private async checkAgentInstalled(
    config: ACPAgentConfig
  ): Promise<ACPAgentStatus> {
    const baseStatus: ACPAgentStatus = {
      id: config.id,
      installed: false,
      authenticated: false,
      running: this.agents.has(config.id),
    };

    try {
      // Try to run the version command
      const { stdout } = await execAsync(
        `${config.detectCommand} ${config.detectArgs.join(" ")}`,
        { timeout: 5000 }
      );

      // Extract version from output
      const versionMatch = stdout.match(/(\d+\.\d+\.\d+)/);
      const version = versionMatch ? versionMatch[1] : undefined;

      // Check if authentication credentials exist
      const authenticated = this.checkAuthenticationExists(config);

      return {
        ...baseStatus,
        installed: true,
        version,
        authenticated,
      };
    } catch (_error) {
      // Agent not installed via direct command, try npx
      const npxConfig = getAgentNpxConfig(config.id);
      if (npxConfig) {
        try {
          // Check if the npm package exists (don't actually run it)
          await execAsync(`npm view ${npxConfig.args[0]} version`, {
            timeout: 10000,
          });

          // Check if authentication credentials exist
          const authenticated = this.checkAuthenticationExists(config);

          return {
            ...baseStatus,
            installed: true,
            authenticated,
            // NPX will download on first use
          };
        } catch {
          // Package not available
        }
      }

      return baseStatus;
    }
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
      `[ACP] Starting agent ${config.id}: ${config.command} ${config.args.join(" ")}`
    );

    // Spawn the agent process
    const agentProcess = spawn(config.command, config.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...config.env },
    });

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
      this.emit("agent-exit", {
        agentId: config.id,
        code,
        signal,
        stderr: stderrBuffer,
      });
      this._cleanupAgent(config.id);

      // Create a more informative error message
      let errorMsg = exitMsg;
      if (stderrBuffer.trim()) {
        errorMsg = `${exitMsg}\n\nError details:\n${stderrBuffer.trim()}`;
      }
      earlyExitReject(new Error(errorMsg));
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
      })
    );

    // Create the client-side connection
    const connection = new ClientSideConnection(
      (agent: Agent) => this._createClient(config.id, agent),
      stream
    );

    // Store the active agent
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
          // Filesystem capabilities - agent handles these internally
          // but we need to declare them for the ACP protocol
          fs: {
            readTextFile: false,
            writeTextFile: false,
          },
          // Terminal capability - agent handles this internally
          terminal: true,
        },
      });

      // Race initialization with early exit - if process dies, we reject immediately
      const initResponse = await Promise.race([initPromise, earlyExitPromise]);

      console.log(`[ACP] Agent ${config.id} initialized:`, initResponse);

      // Update status with capabilities
      activeAgent.status.authenticated =
        !initResponse.authMethods ||
        initResponse.authMethods.length === 0;

      this.emit("agent-started", { agentId: config.id, capabilities: initResponse });
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
        console.log(`[ACP] sessionUpdate received for ${agentId}:`, JSON.stringify(params, null, 2));
        this.emit("session-update", { agentId, ...params });

        // Convert to message chunks for the UI
        if (params.update) {
          console.log(`[ACP] Processing update:`, JSON.stringify(params.update, null, 2));
          const updateType = (params.update as { sessionUpdate?: string }).sessionUpdate;
          const chunk: ACPMessageChunk = {
            sessionId: params.sessionId,
            agentId,
            messageId: (params.update as any).messageId || crypto.randomUUID(),
            type: this._getChunkType(params.update),
            content: this._getChunkContent(params.update),
            role: updateType === "user_message_chunk" ? "user" : "assistant",
          };
          console.log(`[ACP] Emitting message-chunk:`, JSON.stringify(chunk, null, 2));
          this.emit("message-chunk", chunk);
        } else {
          console.log(`[ACP] sessionUpdate has no update field, keys:`, Object.keys(params));
        }
      },

      // Handle permission requests
      requestPermission: async (
        params: RequestPermissionRequest
      ): Promise<RequestPermissionResponse> => {
        const requestId = crypto.randomUUID();

        // Convert SDK PermissionOption to our format
        // SDK uses: optionId, name, kind (allow_once | allow_always | reject_once | reject_always)
        const permissionRequest: ACPPermissionRequest = {
          requestId,
          agentId,
          sessionId: params.sessionId,
          permissionType: this._mapToolKindToPermissionType(params.toolCall?.kind),
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
          });

          // Timeout after 3 minutes (reduced from 5 for better UX)
          // User should respond promptly to permission requests
          setTimeout(() => {
            if (this.pendingPermissions.has(requestId)) {
              this.pendingPermissions.delete(requestId);
              console.warn(`[ACP] Permission request ${requestId} timed out after 3 minutes`);
              reject(new Error("Permission request timed out after 3 minutes. Please try again."));
            }
          }, 3 * 60 * 1000);
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
            const endLine = params.limit ? startLine + params.limit : lines.length;
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
          await fsPromises.writeFile(params.path, params.content, "utf-8");
          return { success: true };
        } catch (error) {
          console.error(`[ACP] Failed to write file ${params.path}:`, error);
          throw error;
        }
      },

      // Terminal operations (optional - agent handles its own)
      createTerminal: async (_params) => {
        throw new Error("Terminal operations handled by agent");
      },
    };
  }

  private _getChunkType(
    update: SessionNotification["update"]
  ): ACPMessageChunk["type"] {
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
      default:
        // Unknown update type, log it
        console.log(`[ACP] Unknown sessionUpdate type: ${updateType}`);
        return "text";
    }
  }

  private _getChunkContent(
    update: SessionNotification["update"]
  ): string | ACPMessageChunk["content"] {
    if (!update) return "";

    // SessionUpdate has a discriminator field 'sessionUpdate'
    const updateType = (update as { sessionUpdate?: string }).sessionUpdate;
    // ContentChunk types have 'content' field which is a ContentBlock
    const contentBlock = (update as { content?: { type?: string; text?: string } }).content;

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
        // ToolCall type: id, name, input, kind, title
        // Claude Code SDK may send tool name in either 'name' or 'title' field
        const toolCall = update as {
          id?: string;
          name?: string;
          input?: unknown;
          title?: string;
          kind?: string;
        };
        // Use name, fall back to title, then extract from kind if available
        const toolName = toolCall.name || toolCall.title || toolCall.kind || "";
        console.log("[ACP] Tool call received:", { id: toolCall.id, name: toolCall.name, title: toolCall.title, kind: toolCall.kind, resolvedName: toolName });
        return {
          id: toolCall.id || "",
          name: toolName,
          input: toolCall.input as Record<string, unknown> | undefined,
          state: "running",
        };
      }

      case "tool_call_update": {
        // ToolCallUpdate: toolCallId, title, status, message
        const toolUpdate = update as {
          toolCallId?: string;
          title?: string;
          status?: string;
          message?: string;
        };
        return {
          id: toolUpdate.toolCallId || "",
          name: toolUpdate.title || "",
          output: toolUpdate.message,
          state: toolUpdate.status === "completed" ? "completed" : "running",
        };
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
    toolKind?: string | null
  ): ACPPermissionRequest["permissionType"] {
    // Map ACP SDK ToolKind to our permission type
    if (!toolKind) {
      console.log("[ACP] No toolKind provided, defaulting to 'terminal' permission type");
      return "terminal";
    }
    const kind = toolKind.toLowerCase();
    if (kind.includes("file") || kind.includes("edit") || kind.includes("write")) {
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
    console.log(`[ACP] Unknown toolKind "${toolKind}", defaulting to 'terminal' permission type`);
    return "terminal";
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
    }>
  ): Promise<ACPSession> {
    const activeAgent = this.agents.get(agentId);
    if (!activeAgent) {
      // Try to start the agent first
      await this.startAgent(agentId);
      return this.createSession(agentId, workingDirectory, mcpServers);
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
          env: Object.entries(s.env || {}).map(([name, value]) => ({ name, value })),
        })),
      });

      const session: ACPSession = {
        sessionId: response.sessionId,
        agentId,
        workingDirectory,
        createdAt: new Date(),
        availableModes: response.modes?.availableModes?.map((m) => m.id),
        currentMode: response.modes?.currentModeId,
        configOptions: response.configOptions ?? null,
        models: response.models ?? null,
      };

      activeAgent.sessions.set(response.sessionId, session);
      this.emit("session-created", session);

      return session;
    } catch (error: unknown) {
      // Check if auth is required
      const err = error as { code?: number };
      if (err.code === -32001) {
        // Auth required error
        activeAgent.status.authenticated = false;
        this.emit("auth-required", { agentId });
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
      session.configOptions = response.configOptions ?? null;
    }

    return { configOptions: response.configOptions ?? null };
  }

  /**
   * Send a prompt to an agent session
   */
  async sendPrompt(
    agentId: string,
    sessionId: string,
    message: string,
    contextFiles?: Array<{ path: string; content?: string }>
  ): Promise<ACPPromptResult> {
    const activeAgent = this.agents.get(agentId);
    if (!activeAgent) {
      throw new Error(`Agent ${agentId} is not running`);
    }

    const session = activeAgent.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
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

      const response = await activeAgent.connection.prompt({
        sessionId,
        prompt: promptBlocks,
      });

      // Emit a done chunk to signal completion to the UI
      this.emit("message-chunk", {
        sessionId,
        agentId,
        messageId: crypto.randomUUID(),
        type: "text",
        content: "",
        done: true,
      } as ACPMessageChunk);

      return {
        sessionId,
        stopReason: response.stopReason as ACPPromptResult["stopReason"],
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

      console.error(`[ACPAgentService] Prompt error for session ${sessionId}:`, errorMessage);

      // Emit error chunk
      this.emit("message-chunk", {
        sessionId,
        agentId,
        messageId: crypto.randomUUID(),
        type: "error",
        content: errorMessage,
        done: true,
      } as ACPMessageChunk);

      return {
        sessionId,
        stopReason: "error",
        error: errorMessage,
      };
    }
  }

  /**
   * Cancel an ongoing prompt
   */
  async cancelPrompt(agentId: string, sessionId: string): Promise<void> {
    const activeAgent = this.agents.get(agentId);
    if (!activeAgent) {
      return;
    }

    await activeAgent.connection.cancel({ sessionId });
  }

  /**
   * Authenticate with an agent
   */
  async authenticate(
    agentId: string,
    methodId: string
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
