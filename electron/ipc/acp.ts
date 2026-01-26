import { ipcMain, BrowserWindow } from "electron";
import { getACPAgentManager } from "../services/acp-agent-service";
import type {
  ACPAgentStatus,
  ACPAgentCapabilities,
  ACPSession,
  ACPSessionListRequest,
  ACPSessionListResponse,
  ACPPromptResult,
  StartACPSessionRequest,
  SendACPPromptRequest,
  RespondToPermissionRequest,
  SetACPSessionModelRequest,
  SetACPSessionConfigOptionRequest,
  SetACPSessionModeRequest,
  LoadACPSessionRequest,
  ResumeACPSessionRequest,
} from "../../src/types/acp";

/**
 * Serialize an error for IPC transport
 * Electron IPC can't serialize complex Error objects with circular references
 */
function serializeError(error: unknown): Error {
  if (error instanceof Error) {
    // Create a new Error with just the message to ensure serialization
    const serializedError = new Error(error.message);
    serializedError.name = error.name;
    // Copy stack if available
    if (error.stack) {
      serializedError.stack = error.stack;
    }
    return serializedError;
  }
  // Handle non-Error objects (including JSON-RPC errors from ACP SDK)
  if (typeof error === "object" && error !== null) {
    const obj = error as Record<string, unknown>;

    // Handle JSON-RPC error format: { code, message, data }
    if (typeof obj.code === "number" && typeof obj.message === "string") {
      let message = `[${obj.code}] ${obj.message}`;
      // Include data details if available
      if (obj.data && typeof obj.data === "object") {
        const dataStr = JSON.stringify(obj.data);
        if (dataStr !== "{}") {
          message += `: ${dataStr}`;
        }
      }
      return new Error(message);
    }

    // Try to extract a message from other object formats
    const message =
      obj.message || obj.error || obj.reason || JSON.stringify(error, null, 2);
    return new Error(String(message));
  }
  return new Error(String(error));
}

/**
 * Register all ACP-related IPC handlers
 */
export function registerACPHandlers(): void {
  const manager = getACPAgentManager();

  // Forward events to renderer
  const forwardToRenderer = (channel: string, data: unknown) => {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      try {
        // Check if the webContents is still valid
        if (
          !win.isDestroyed() &&
          win.webContents &&
          !win.webContents.isDestroyed()
        ) {
          win.webContents.send(channel, data);
        }
      } catch (err) {
        // Ignore errors when renderer isn't ready (during hot reload or initial load)
        console.log(
          `[ACP] Could not forward ${channel} to renderer:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  };

  // Set up event forwarding
  manager.on("agent-started", (data) =>
    forwardToRenderer("acp:agent-started", data),
  );
  manager.on("agent-exit", (data) => forwardToRenderer("acp:agent-exit", data));
  manager.on("agent-error", (data) =>
    forwardToRenderer("acp:agent-error", data),
  );
  manager.on("agent-authenticated", (data) =>
    forwardToRenderer("acp:agent-authenticated", data),
  );
  manager.on("auth-required", (data) =>
    forwardToRenderer("acp:auth-required", data),
  );
  manager.on("session-created", (data) =>
    forwardToRenderer("acp:session-created", data),
  );
  manager.on("session-update", (data) =>
    forwardToRenderer("acp:session-update", data),
  );
  manager.on("message-chunk", (data) =>
    forwardToRenderer("acp:message-chunk", data),
  );
  manager.on("permission-request", (data) =>
    forwardToRenderer("acp:permission-request", data),
  );

  // Feature 2: Session load/resume events
  manager.on("session-loaded", (data) =>
    forwardToRenderer("acp:session-loaded", data),
  );
  manager.on("session-resumed", (data) =>
    forwardToRenderer("acp:session-resumed", data),
  );
  manager.on("session-recreated", (data) =>
    forwardToRenderer("acp:session-recreated", data),
  );

  // Feature 3: Terminal events
  manager.on("terminal-created", (data) =>
    forwardToRenderer("acp:terminal-created", data),
  );
  manager.on("terminal-output", (data) =>
    forwardToRenderer("acp:terminal-output", data),
  );
  manager.on("terminal-exit", (data) =>
    forwardToRenderer("acp:terminal-exit", data),
  );

  // Feature 4: Commands update event
  manager.on("commands-update", (data) =>
    forwardToRenderer("acp:commands-update", data),
  );

  // Feature 6: Session info update event
  manager.on("session-info-update", (data) =>
    forwardToRenderer("acp:session-info-update", data),
  );

  // Session mode update event
  manager.on("session-mode-update", (data) =>
    forwardToRenderer("acp:session-mode-update", data),
  );

  // Session model update event
  manager.on("session-model-update", (data) =>
    forwardToRenderer("acp:session-model-update", data),
  );

  // Session config update event
  manager.on("session-config-update", (data) =>
    forwardToRenderer("acp:session-config-update", data),
  );

  // Session context update event (working directory changes)
  manager.on("session-context-updated", (data) =>
    forwardToRenderer("acp:session-context-updated", data),
  );

  /**
   * List all available agents and their status
   */
  ipcMain.handle(
    "acp:list-agents",
    async (_event, forceRefresh?: boolean): Promise<ACPAgentStatus[]> => {
      return manager.detectInstalledAgents(forceRefresh);
    },
  );

  /**
   * Get status of a specific agent
   */
  ipcMain.handle(
    "acp:get-agent-status",
    async (_event, agentId: string): Promise<ACPAgentStatus | undefined> => {
      return manager.getAgentStatus(agentId);
    },
  );

  /**
   * Start an agent process
   */
  ipcMain.handle(
    "acp:start-agent",
    async (_event, agentId: string): Promise<void> => {
      try {
        return await manager.startAgent(agentId);
      } catch (error) {
        console.error(`[IPC] acp:start-agent error:`, error);
        throw serializeError(error);
      }
    },
  );

  /**
   * Stop an agent process
   */
  ipcMain.handle(
    "acp:stop-agent",
    async (_event, agentId: string): Promise<void> => {
      return manager.stopAgent(agentId);
    },
  );

  /**
   * Create a new session with an agent
   */
  ipcMain.handle(
    "acp:create-session",
    async (_event, request: StartACPSessionRequest): Promise<ACPSession> => {
      console.log(
        `[IPC] acp:create-session called for agent: ${request.agentId}, cwd: ${request.workingDirectory}`,
      );
      try {
        const session = await manager.createSession(
          request.agentId,
          request.workingDirectory,
          request.mcpServers,
        );
        console.log(
          `[IPC] acp:create-session success, sessionId: ${session.sessionId}`,
        );
        return session;
      } catch (error) {
        console.error(`[IPC] acp:create-session error:`, error);
        throw serializeError(error);
      }
    },
  );

  /**
   * Set ACP session model (experimental)
   */
  ipcMain.handle(
    "acp:set-session-model",
    async (_event, request: SetACPSessionModelRequest): Promise<void> => {
      try {
        await manager.setSessionModel(
          request.agentId,
          request.sessionId,
          request.modelId,
        );
      } catch (error) {
        console.error(`[IPC] acp:set-session-model error:`, error);
        throw serializeError(error);
      }
    },
  );

  /**
   * Set ACP session config option (experimental)
   */
  ipcMain.handle(
    "acp:set-session-config",
    async (
      _event,
      request: SetACPSessionConfigOptionRequest,
    ): Promise<{ configOptions: ACPSession["configOptions"] }> => {
      try {
        return await manager.setSessionConfigOption(
          request.agentId,
          request.sessionId,
          request.configId,
          request.value,
        );
      } catch (error) {
        console.error(`[IPC] acp:set-session-config error:`, error);
        throw serializeError(error);
      }
    },
  );

  /**
   * Set ACP session mode
   */
  ipcMain.handle(
    "acp:set-session-mode",
    async (_event, request: SetACPSessionModeRequest): Promise<void> => {
      try {
        await manager.setSessionMode(
          request.agentId,
          request.sessionId,
          request.modeId,
        );
      } catch (error) {
        console.error(`[IPC] acp:set-session-mode error:`, error);
        throw serializeError(error);
      }
    },
  );

  /**
   * Send a prompt to an agent session
   */
  ipcMain.handle(
    "acp:prompt",
    async (_event, request: SendACPPromptRequest): Promise<ACPPromptResult> => {
      try {
        return await manager.sendPrompt(
          request.agentId,
          request.sessionId,
          request.message,
          request.contextFiles,
        );
      } catch (error) {
        console.error(`[IPC] acp:prompt error:`, error);
        throw serializeError(error);
      }
    },
  );

  /**
   * Cancel an ongoing prompt
   */
  ipcMain.handle(
    "acp:cancel",
    async (_event, agentId: string, sessionId: string): Promise<void> => {
      return manager.cancelPrompt(agentId, sessionId);
    },
  );

  /**
   * Authenticate with an agent
   */
  ipcMain.handle(
    "acp:authenticate",
    async (
      _event,
      agentId: string,
      methodId: string,
    ): Promise<{ success: boolean; message?: string }> => {
      try {
        return await manager.authenticate(agentId, methodId);
      } catch (error) {
        console.error(`[IPC] acp:authenticate error:`, error);
        throw serializeError(error);
      }
    },
  );

  /**
   * Respond to a permission request
   */
  ipcMain.handle(
    "acp:respond-permission",
    async (_event, request: RespondToPermissionRequest): Promise<void> => {
      manager.respondToPermission(request.requestId, request.optionId);
      // TODO: If rememberGlobally is true, store in database
    },
  );

  /**
   * Get all installed agents (for model selector)
   * This is a lightweight version that just returns installed agents
   */
  ipcMain.handle(
    "acp:get-installed-agents",
    async (): Promise<ACPAgentStatus[]> => {
      const agents = await manager.detectInstalledAgents();
      return agents.filter((a) => a.installed);
    },
  );

  // ============================================================================
  // SESSION LIST/LOAD/RESUME HANDLERS (Feature 2)
  // ============================================================================

  /**
   * Get agent capabilities
   */
  ipcMain.handle(
    "acp:get-agent-capabilities",
    async (
      _event,
      agentId: string,
    ): Promise<ACPAgentCapabilities | undefined> => {
      return manager.getAgentCapabilities(agentId);
    },
  );

  /**
   * List available sessions for an agent
   */
  ipcMain.handle(
    "acp:list-sessions",
    async (
      _event,
      agentId: string,
      request?: ACPSessionListRequest,
    ): Promise<ACPSessionListResponse> => {
      try {
        return await manager.listSessions(agentId, request);
      } catch (error) {
        console.error(`[IPC] acp:list-sessions error:`, error);
        throw serializeError(error);
      }
    },
  );

  /**
   * Load an existing session with history replay
   */
  ipcMain.handle(
    "acp:load-session",
    async (_event, request: LoadACPSessionRequest): Promise<ACPSession> => {
      console.log(
        `[IPC] acp:load-session called for agent: ${request.agentId}, session: ${request.sessionId}`,
      );
      try {
        const session = await manager.loadSession(
          request.agentId,
          request.sessionId,
          request.workingDirectory,
          request.mcpServers,
        );
        console.log(
          `[IPC] acp:load-session success, sessionId: ${session.sessionId}`,
        );
        return session;
      } catch (error) {
        console.error(`[IPC] acp:load-session error:`, error);
        throw serializeError(error);
      }
    },
  );

  /**
   * Resume an existing session without history replay
   */
  ipcMain.handle(
    "acp:resume-session",
    async (_event, request: ResumeACPSessionRequest): Promise<ACPSession> => {
      console.log(
        `[IPC] acp:resume-session called for agent: ${request.agentId}, session: ${request.sessionId}`,
      );
      try {
        const session = await manager.resumeSession(
          request.agentId,
          request.sessionId,
          request.workingDirectory,
          request.mcpServers,
        );
        console.log(
          `[IPC] acp:resume-session success, sessionId: ${session.sessionId}`,
        );
        return session;
      } catch (error) {
        console.error(`[IPC] acp:resume-session error:`, error);
        throw serializeError(error);
      }
    },
  );

  // ============================================================================
  // SESSION CONTEXT UPDATE HANDLER
  // ============================================================================

  /**
   * Update session context (e.g., working directory)
   * Note: For full model awareness, session recreation may be preferred.
   * This method updates the local session state.
   */
  ipcMain.handle(
    "acp:update-session-context",
    async (
      _event,
      agentId: string,
      sessionId: string,
      context: { workingDirectory?: string },
    ): Promise<{
      sessionId: string;
      workingDirectory?: string;
      contextUpdated: boolean;
    }> => {
      console.log(
        `[IPC] acp:update-session-context called for agent: ${agentId}, session: ${sessionId}`,
      );
      try {
        return await manager.updateSessionContext(agentId, sessionId, context);
      } catch (error) {
        console.error(`[IPC] acp:update-session-context error:`, error);
        throw serializeError(error);
      }
    },
  );

  // ============================================================================
  // AGENTIC LOOP HANDLERS
  // ============================================================================

  /**
   * Set auto-resume mode for a session
   * When enabled, the agent will automatically continue after tool completion
   */
  ipcMain.handle(
    "acp:set-auto-resume",
    async (
      _event,
      agentId: string,
      sessionId: string,
      enabled: boolean,
    ): Promise<void> => {
      manager.setAutoResume(agentId, sessionId, enabled);
    },
  );

  /**
   * Get the current agentic loop status for a session
   */
  ipcMain.handle(
    "acp:get-agentic-loop-status",
    async (
      _event,
      agentId: string,
      sessionId: string,
    ): Promise<{
      active: boolean;
      iteration: number;
      pendingTools: number;
      autoResume: boolean;
    } | null> => {
      return manager.getAgenticLoopStatus(agentId, sessionId);
    },
  );

  // ============================================================================
  // AUTO-DETECTION HANDLERS
  // ============================================================================

  /**
   * Force refresh agent detection
   * This is useful after installing a new agent
   */
  ipcMain.handle(
    "acp:auto-detect",
    async (): Promise<ACPAgentStatus[]> => {
      console.log("[IPC] acp:auto-detect called");
      return manager.detectInstalledAgents(true); // force refresh
    },
  );

  /**
   * Start background polling for agent detection
   * This will periodically check for newly installed agents
   */
  ipcMain.handle(
    "acp:start-auto-detect-polling",
    async (_event, intervalMs?: number): Promise<{ success: boolean }> => {
      console.log(`[IPC] acp:start-auto-detect-polling called (interval: ${intervalMs || "default"}ms)`);
      
      manager.startAutoDetectionPolling((agents) => {
        // Notify all renderer windows when agents are detected
        const windows = BrowserWindow.getAllWindows();
        for (const win of windows) {
          try {
            if (!win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
              win.webContents.send("acp:agents-updated", {
                agents,
                timestamp: Date.now(),
              });
            }
          } catch (err) {
            console.log(
              "[ACP] Could not forward agents-updated to renderer:",
              err instanceof Error ? err.message : err,
            );
          }
        }
      }, intervalMs);

      return { success: true };
    },
  );

  /**
   * Stop background polling for agent detection
   */
  ipcMain.handle(
    "acp:stop-auto-detect-polling",
    async (): Promise<{ success: boolean }> => {
      console.log("[IPC] acp:stop-auto-detect-polling called");
      manager.stopAutoDetectionPolling();
      return { success: true };
    },
  );
}

/**
 * Cleanup function to stop all agents on app quit
 */
export async function cleanupACPAgents(): Promise<void> {
  const manager = getACPAgentManager();
  await manager.stopAllAgents();
}
