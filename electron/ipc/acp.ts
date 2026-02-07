import { ipcMain, BrowserWindow } from "electron";
import { getACPAgentManager } from "../services/acp-agent-service";
import {
  getRecentSessions,
  getSession,
  getSessionMessages,
  deleteSession,
  saveSession,
  updateSessionState,
  updateSessionTitle,
  updateSessionTokenCount,
  setAutoResume,
  getAutoResumeSession,
  clearAutoResume,
  deleteOldSessions,
  getSessionStats,
  saveMessage,
  storePermission,
  type PersistedSession,
  type SessionState,
} from "../services/session-persistence";
import {
  getFileWatcherService,
  cleanupFileWatcher,
  type FileChangeEvent,
  type WatcherConfig,
} from "../services/file-watcher";
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

  // Auto-reconnect events
  manager.on("agent-reconnecting", (data) =>
    forwardToRenderer("acp:agent-reconnecting", data),
  );
  manager.on("agent-reconnected", (data) =>
    forwardToRenderer("acp:agent-reconnected", data),
  );
  manager.on("agent-reconnect-failed", (data) =>
    forwardToRenderer("acp:agent-reconnect-failed", data),
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
          request.threadId,
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
      // Get permission details before responding (so we can store if needed)
      const permissionDetails = manager.getPermissionRequestDetails(
        request.requestId
      );

      // Send the response to the agent
      manager.respondToPermission(request.requestId, request.optionId);

      // Store permission if rememberGlobally is true
      if (request.rememberGlobally && permissionDetails) {
        const selectedOption = permissionDetails.options.find(
          (o) => o.id === request.optionId
        );
        const granted = selectedOption?.grants !== false;

        storePermission(
          permissionDetails.agentId,
          permissionDetails.permissionType || "unknown",
          request.optionId,
          granted,
          permissionDetails.toolName,
          permissionDetails.filePath
        );
        console.log(
          `[IPC] Stored global permission for ${permissionDetails.agentId}: ${permissionDetails.permissionType} -> ${granted ? "granted" : "denied"}`
        );
      }
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
  // SESSION AUTO-RESUME HANDLER
  // ============================================================================

  /**
   * Safely parse JSON content, returning the raw string if parsing fails
   */
  function safeParseMessageContent(content: string): unknown {
    try {
      return JSON.parse(content);
    } catch (_error) {
      console.warn(`[IPC] Failed to parse message content as JSON, using raw string`);
      return content;
    }
  }

  /**
   * Attempt to auto-resume a previous session for a thread
   * Returns session info and messages if resumable
   */
  ipcMain.handle(
    "acp:attempt-auto-resume",
    async (
      _event,
      threadId: string
    ): Promise<{
      resumed: boolean;
      sessionId?: string;
      agentId?: string;
      messages?: Array<{
        id: string;
        role: string;
        content: unknown;
        createdAt: number;
      }>;
    }> => {
      console.log(`[IPC] acp:attempt-auto-resume called for thread: ${threadId}`);

      // Check if there's a session to resume
      const autoResumeInfo = getAutoResumeSession(threadId);
      if (!autoResumeInfo || !autoResumeInfo.shouldResume) {
        return { resumed: false };
      }

      // Get the persisted session
      const persistedSession = getSession(autoResumeInfo.sessionId);
      if (!persistedSession) {
        console.log(
          `[IPC] Persisted session not found: ${autoResumeInfo.sessionId}`
        );
        return { resumed: false };
      }

      // Get persisted messages
      const messages = getSessionMessages(autoResumeInfo.sessionId);

      // Try to start the agent if needed
      try {
        await manager.startAgent(autoResumeInfo.agentId);
      } catch (error) {
        console.error(
          `[IPC] Failed to start agent for auto-resume:`,
          error
        );
        return { resumed: false };
      }

      // Check if agent supports session resume
      const capabilities = manager.getAgentCapabilities(autoResumeInfo.agentId);
      if (capabilities?.sessionResume) {
        // Use native session resume
        try {
          const session = await manager.resumeSession(
            autoResumeInfo.agentId,
            autoResumeInfo.sessionId,
            persistedSession.workingDirectory
          );
          return {
            resumed: true,
            sessionId: session.sessionId,
            agentId: autoResumeInfo.agentId,
            messages: messages.map((m) => ({
              id: m.messageId,
              role: m.role,
              content: safeParseMessageContent(m.content),
              createdAt: m.createdAt,
            })),
          };
        } catch (error) {
          console.error(`[IPC] Native session resume failed:`, error);
        }
      }

      // Fallback: return messages for UI to display (no real session resume)
      return {
        resumed: true,
        sessionId: autoResumeInfo.sessionId,
        agentId: autoResumeInfo.agentId,
        messages: messages.map((m) => ({
          id: m.messageId,
          role: m.role,
          content: safeParseMessageContent(m.content),
          createdAt: m.createdAt,
        })),
      };
    }
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

  // ============================================================================
  // SESSION PERSISTENCE HANDLERS
  // ============================================================================

  /**
   * Get recent/persisted sessions with optional filters
   */
  ipcMain.handle(
    "acp:get-persisted-sessions",
    async (
      _event,
      options: {
        agentId?: string;
        threadId?: string;
        state?: SessionState;
        workingDirectory?: string;
        limit?: number;
      },
    ): Promise<PersistedSession[]> => {
      console.log("[IPC] acp:get-persisted-sessions called", options);
      return getRecentSessions(options);
    },
  );

  /**
   * Get a specific session by ID
   */
  ipcMain.handle(
    "acp:get-persisted-session",
    async (_event, sessionId: string): Promise<PersistedSession | null> => {
      console.log("[IPC] acp:get-persisted-session called", sessionId);
      return getSession(sessionId);
    },
  );

  /**
   * Get messages for a session
   */
  ipcMain.handle(
    "acp:get-session-messages",
    async (
      _event,
      sessionId: string,
      limit?: number,
    ): Promise<unknown[]> => {
      console.log("[IPC] acp:get-session-messages called", sessionId);
      return getSessionMessages(sessionId, limit);
    },
  );

  /**
   * Delete a persisted session
   */
  ipcMain.handle(
    "acp:delete-persisted-session",
    async (_event, sessionId: string): Promise<void> => {
      console.log("[IPC] acp:delete-persisted-session called", sessionId);
      deleteSession(sessionId);
    },
  );

  /**
   * Update session state
   */
  ipcMain.handle(
    "acp:update-session-state",
    async (_event, sessionId: string, state: SessionState): Promise<void> => {
      console.log("[IPC] acp:update-session-state called", sessionId, state);
      updateSessionState(sessionId, state);
    },
  );

  /**
   * Update session title
   */
  ipcMain.handle(
    "acp:update-session-title",
    async (_event, sessionId: string, title: string): Promise<void> => {
      console.log("[IPC] acp:update-session-title called", sessionId, title);
      updateSessionTitle(sessionId, title);
    },
  );

  /**
   * Save a session to persistence
   */
  ipcMain.handle(
    "acp:save-session",
    async (
      _event,
      data: {
        session: { sessionId: string; agentId: string; workingDirectory: string };
        threadId?: string;
        title?: string;
      },
    ): Promise<void> => {
      console.log("[IPC] acp:save-session called", data.session.sessionId);
      saveSession(
        {
          sessionId: data.session.sessionId,
          agentId: data.session.agentId,
          workingDirectory: data.session.workingDirectory,
          createdAt: new Date(),
        } as any,
        data.threadId,
        data.title,
      );
    },
  );

  /**
   * Save a message to a session
   */
  ipcMain.handle(
    "acp:save-message",
    async (
      _event,
      data: {
        sessionId: string;
        messageId: string;
        role: "user" | "assistant" | "system";
        content: unknown;
        tokenCount?: number;
      },
    ): Promise<void> => {
      saveMessage(
        data.sessionId,
        data.messageId,
        data.role,
        data.content,
        data.tokenCount,
      );
    },
  );

  /**
   * Update session token count
   */
  ipcMain.handle(
    "acp:update-session-token-count",
    async (_event, sessionId: string, tokenCount: number): Promise<void> => {
      updateSessionTokenCount(sessionId, tokenCount);
    },
  );

  /**
   * Set auto-resume preference for a thread
   */
  ipcMain.handle(
    "acp:set-session-auto-resume",
    async (
      _event,
      data: {
        threadId: string;
        sessionId: string;
        agentId: string;
        shouldResume: boolean;
      },
    ): Promise<void> => {
      setAutoResume(data.threadId, data.sessionId, data.agentId, data.shouldResume);
    },
  );

  /**
   * Get auto-resume session for a thread
   */
  ipcMain.handle(
    "acp:get-auto-resume-session",
    async (
      _event,
      threadId: string,
    ): Promise<{ sessionId: string; agentId: string; shouldResume: boolean } | null> => {
      return getAutoResumeSession(threadId);
    },
  );

  /**
   * Clear auto-resume for a thread
   */
  ipcMain.handle(
    "acp:clear-auto-resume",
    async (_event, threadId: string): Promise<void> => {
      clearAutoResume(threadId);
    },
  );

  /**
   * Cleanup old sessions
   */
  ipcMain.handle(
    "acp:cleanup-old-sessions",
    async (_event, olderThanDays?: number): Promise<number> => {
      return deleteOldSessions(olderThanDays);
    },
  );

  /**
   * Get session statistics
   */
  ipcMain.handle(
    "acp:get-session-stats",
    async (): Promise<{
      total: number;
      active: number;
      completed: number;
      error: number;
    }> => {
      return getSessionStats();
    },
  );

  // ============================================================================
  // FILE WATCHER HANDLERS
  // ============================================================================

  const fileWatcher = getFileWatcherService();

  // Forward file watcher events to renderer
  fileWatcher.on("change", (event: FileChangeEvent) => {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      try {
        if (!win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
          win.webContents.send("file-watcher:change", event);
        }
      } catch (err) {
        console.log("[FileWatcher] Could not forward change to renderer:", err);
      }
    }
  });

  /**
   * Start watching a directory
   */
  ipcMain.handle(
    "file-watcher:start",
    async (_event, config: WatcherConfig): Promise<{ success: boolean }> => {
      console.log("[IPC] file-watcher:start called", config.directory);
      try {
        await fileWatcher.startWatching(config);
        return { success: true };
      } catch (error) {
        console.error("[IPC] file-watcher:start error:", error);
        throw error;
      }
    },
  );

  /**
   * Stop watching a directory
   */
  ipcMain.handle(
    "file-watcher:stop",
    async (_event, directory: string): Promise<{ success: boolean }> => {
      console.log("[IPC] file-watcher:stop called", directory);
      await fileWatcher.stopWatching(directory);
      return { success: true };
    },
  );

  /**
   * Mark a file as modified by the agent
   */
  ipcMain.handle(
    "file-watcher:mark-agent-modification",
    async (_event, filePath: string): Promise<void> => {
      fileWatcher.markAgentModification(filePath);
    },
  );

  /**
   * Get watched directories
   */
  ipcMain.handle(
    "file-watcher:get-watched",
    async (): Promise<string[]> => {
      return fileWatcher.getWatchedDirectories();
    },
  );

  /**
   * Check if a directory is being watched
   */
  ipcMain.handle(
    "file-watcher:is-watching",
    async (_event, directory: string): Promise<boolean> => {
      return fileWatcher.isWatching(directory);
    },
  );

  /**
   * Get file watcher stats
   */
  ipcMain.handle(
    "file-watcher:stats",
    async (): Promise<{
      watchedDirectories: number;
      trackedFiles: number;
      pendingChanges: number;
    }> => {
      return fileWatcher.getStats();
    },
  );
}

/**
 * Cleanup function to stop all agents and services on app quit
 */
export async function cleanupACPAgents(): Promise<void> {
  const manager = getACPAgentManager();
  await manager.stopAllAgents();
  await cleanupFileWatcher();
}
