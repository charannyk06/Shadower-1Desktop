/**
 * Mock ACP Agent for Testing
 *
 * Provides a mock implementation of ACP agent behavior for unit and integration tests.
 * This allows testing of ACP features without requiring actual agent processes.
 */

import type {
  ACPSession,
  ACPSessionInfo,
  ACPSessionListResponse,
  ACPMessageChunk,
  ACPAgentCapabilities,
  ACPPlan,
  ACPAvailableCommand,
  ACPTerminalOutput,
  ACPTerminalExit,
  ACPSessionInfoUpdateEvent,
} from "../../src/types/acp";
import { SUBAGENT_TOOL_NAME, TOOL_NAME_META_KEY } from "../../src/types/acp";

/**
 * Mock session update types for testing
 */
type MockSessionUpdate =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | {
      type: "tool_call";
      toolCallId: string;
      title: string;
      kind: string;
      meta?: Record<string, unknown>;
    }
  | {
      type: "tool_call_update";
      toolCallId: string;
      status: string;
      rawOutput?: unknown;
    }
  | { type: "plan"; plan: ACPPlan }
  | { type: "available_commands_update"; commands: ACPAvailableCommand[] }
  | {
      type: "session_info_update";
      title?: string;
      meta?: Record<string, unknown>;
    }
  | { type: "terminal_output"; terminalId: string; data: string }
  | {
      type: "terminal_exit";
      terminalId: string;
      exitCode?: number;
      signal?: string;
    };

/**
 * Event handlers for the mock agent
 */
interface MockAgentHandlers {
  onSessionUpdate?: (sessionId: string, update: MockSessionUpdate) => void;
  onMessageChunk?: (chunk: ACPMessageChunk) => void;
  onTerminalCreated?: (data: {
    agentId: string;
    sessionId: string;
    terminalId: string;
  }) => void;
  onTerminalOutput?: (data: {
    agentId: string;
    sessionId: string;
    terminalId: string;
    data: string;
  }) => void;
  onTerminalExit?: (data: {
    agentId: string;
    sessionId: string;
    terminalId: string;
    exitCode?: number;
  }) => void;
  onCommandsUpdate?: (data: {
    agentId: string;
    sessionId: string;
    commands: ACPAvailableCommand[];
  }) => void;
  onSessionInfoUpdate?: (data: ACPSessionInfoUpdateEvent) => void;
}

/**
 * Mock ACP Agent for testing
 */
export class MockACPAgent {
  readonly agentId: string;
  readonly capabilities: ACPAgentCapabilities;
  private sessions: Map<string, ACPSession> = new Map();
  private sessionList: ACPSessionInfo[] = [];
  private handlers: MockAgentHandlers = {};
  private sessionIdCounter = 0;

  constructor(
    agentId: string = "mock-agent",
    capabilities: Partial<ACPAgentCapabilities> = {},
  ) {
    this.agentId = agentId;
    this.capabilities = {
      loadSession: capabilities.loadSession ?? true,
      sessionList: capabilities.sessionList ?? true,
      sessionResume: capabilities.sessionResume ?? true,
      prompt: capabilities.prompt,
    };
  }

  /**
   * Register event handlers
   */
  on(handlers: MockAgentHandlers): void {
    this.handlers = { ...this.handlers, ...handlers };
  }

  /**
   * Create a new session
   */
  createSession(workingDirectory: string): ACPSession {
    const sessionId = `mock-session-${++this.sessionIdCounter}`;
    const session: ACPSession = {
      sessionId,
      agentId: this.agentId,
      workingDirectory,
      createdAt: new Date(),
      availableModes: ["default", "plan"],
      currentMode: "default",
    };
    this.sessions.set(sessionId, session);

    // Add to session list
    this.sessionList.push({
      sessionId,
      cwd: workingDirectory,
      title: `Session ${this.sessionIdCounter}`,
      updatedAt: new Date(),
    });

    return session;
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): ACPSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * List all sessions
   */
  listSessions(): ACPSessionListResponse {
    return {
      sessions: this.sessionList,
    };
  }

  /**
   * Load an existing session
   */
  loadSession(
    sessionId: string,
    workingDirectory: string,
  ): ACPSession | undefined {
    const existing = this.sessionList.find((s) => s.sessionId === sessionId);
    if (!existing) return undefined;

    const session: ACPSession = {
      sessionId,
      agentId: this.agentId,
      workingDirectory,
      createdAt: new Date(),
      availableModes: ["default", "plan"],
      currentMode: "default",
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * Resume an existing session
   */
  resumeSession(
    sessionId: string,
    workingDirectory: string,
  ): ACPSession | undefined {
    return this.loadSession(sessionId, workingDirectory);
  }

  // ============================================================================
  // EMIT METHODS - Simulate agent sending updates
  // ============================================================================

  /**
   * Emit a text message chunk
   */
  emitText(sessionId: string, text: string, done = false): void {
    const chunk: ACPMessageChunk = {
      sessionId,
      agentId: this.agentId,
      messageId: `msg-${Date.now()}`,
      type: "text",
      content: text,
      role: "assistant",
      done,
    };
    this.handlers.onMessageChunk?.(chunk);
  }

  /**
   * Emit a thinking/reasoning chunk
   */
  emitThinking(sessionId: string, text: string): void {
    const chunk: ACPMessageChunk = {
      sessionId,
      agentId: this.agentId,
      messageId: `msg-${Date.now()}`,
      type: "thinking",
      content: text,
      role: "assistant",
    };
    this.handlers.onMessageChunk?.(chunk);
  }

  /**
   * Emit a tool call
   */
  emitToolCall(
    sessionId: string,
    toolCallId: string,
    toolName: string,
    input?: Record<string, unknown>,
    options?: { isSubagent?: boolean; kind?: string },
  ): void {
    const meta: Record<string, unknown> = {};
    if (options?.isSubagent) {
      meta[TOOL_NAME_META_KEY] = SUBAGENT_TOOL_NAME;
    } else {
      meta[TOOL_NAME_META_KEY] = toolName;
    }

    const chunk: ACPMessageChunk = {
      sessionId,
      agentId: this.agentId,
      messageId: `msg-${Date.now()}`,
      type: "tool_call",
      content: {
        id: toolCallId,
        name: toolName,
        input,
        state: "running",
        toolName: options?.isSubagent ? SUBAGENT_TOOL_NAME : toolName,
        isSubagent: options?.isSubagent,
        kind: options?.kind || "other",
      },
      role: "assistant",
    };
    this.handlers.onMessageChunk?.(chunk);
  }

  /**
   * Emit a tool call result
   */
  emitToolResult(
    sessionId: string,
    toolCallId: string,
    output: unknown,
    state: "completed" | "failed" = "completed",
  ): void {
    const chunk: ACPMessageChunk = {
      sessionId,
      agentId: this.agentId,
      messageId: `msg-${Date.now()}`,
      type: "tool_result",
      content: {
        id: toolCallId,
        name: "",
        output: output as string | Record<string, unknown>,
        state,
      },
      role: "assistant",
    };
    this.handlers.onMessageChunk?.(chunk);
  }

  /**
   * Emit a plan update
   */
  emitPlan(sessionId: string, plan: ACPPlan): void {
    const chunk: ACPMessageChunk = {
      sessionId,
      agentId: this.agentId,
      messageId: `msg-${Date.now()}`,
      type: "plan",
      content: plan,
      role: "assistant",
    };
    this.handlers.onMessageChunk?.(chunk);
  }

  /**
   * Emit terminal creation (via event)
   */
  emitTerminalCreated(
    sessionId: string,
    terminalId: string,
    _cwd?: string,
  ): void {
    this.handlers.onTerminalCreated?.({
      agentId: this.agentId,
      sessionId,
      terminalId,
    });
  }

  /**
   * Emit terminal output
   */
  emitTerminalOutput(
    sessionId: string,
    terminalId: string,
    data: string,
  ): void {
    // Via event handler
    this.handlers.onTerminalOutput?.({
      agentId: this.agentId,
      sessionId,
      terminalId,
      data,
    });

    // Also as message chunk
    const chunk: ACPMessageChunk = {
      sessionId,
      agentId: this.agentId,
      messageId: `msg-${Date.now()}`,
      type: "terminal_output",
      content: { terminalId, data } as ACPTerminalOutput,
      role: "assistant",
    };
    this.handlers.onMessageChunk?.(chunk);
  }

  /**
   * Emit terminal exit
   */
  emitTerminalExit(
    sessionId: string,
    terminalId: string,
    exitCode?: number,
    signal?: string,
  ): void {
    // Via event handler
    this.handlers.onTerminalExit?.({
      agentId: this.agentId,
      sessionId,
      terminalId,
      exitCode,
    });

    // Also as message chunk
    const chunk: ACPMessageChunk = {
      sessionId,
      agentId: this.agentId,
      messageId: `msg-${Date.now()}`,
      type: "terminal_exit",
      content: { terminalId, exitCode, signal } as ACPTerminalExit,
      role: "assistant",
    };
    this.handlers.onMessageChunk?.(chunk);
  }

  /**
   * Emit available commands update
   */
  emitCommandsUpdate(sessionId: string, commands: ACPAvailableCommand[]): void {
    this.handlers.onCommandsUpdate?.({
      agentId: this.agentId,
      sessionId,
      commands,
    });

    const chunk: ACPMessageChunk = {
      sessionId,
      agentId: this.agentId,
      messageId: `msg-${Date.now()}`,
      type: "commands_update",
      content: commands,
      role: "assistant",
    };
    this.handlers.onMessageChunk?.(chunk);
  }

  /**
   * Emit session info update
   */
  emitSessionInfoUpdate(
    sessionId: string,
    title?: string,
    meta?: Record<string, unknown>,
  ): void {
    const event: ACPSessionInfoUpdateEvent = {
      agentId: this.agentId,
      sessionId,
      title,
      meta,
    };
    this.handlers.onSessionInfoUpdate?.(event);

    const chunk: ACPMessageChunk = {
      sessionId,
      agentId: this.agentId,
      messageId: `msg-${Date.now()}`,
      type: "session_info",
      content: event,
      role: "assistant",
    };
    this.handlers.onMessageChunk?.(chunk);
  }

  /**
   * Emit done signal
   */
  emitDone(sessionId: string): void {
    const chunk: ACPMessageChunk = {
      sessionId,
      agentId: this.agentId,
      messageId: `msg-${Date.now()}`,
      type: "text",
      content: "",
      role: "assistant",
      done: true,
    };
    this.handlers.onMessageChunk?.(chunk);
  }

  /**
   * Simulate a complete conversation turn with tool use
   */
  async simulateToolUse(
    sessionId: string,
    toolName: string,
    input: Record<string, unknown>,
    output: unknown,
  ): Promise<void> {
    const toolCallId = `tool-${Date.now()}`;

    // Start thinking
    this.emitThinking(sessionId, `I'll use the ${toolName} tool...`);

    // Emit tool call
    this.emitToolCall(sessionId, toolCallId, toolName, input);

    // Small delay to simulate execution
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Emit result
    this.emitToolResult(sessionId, toolCallId, output);

    // Emit completion text
    this.emitText(sessionId, `Done using ${toolName}.`, true);
  }

  /**
   * Simulate a subagent spawn
   */
  emitSubagentSpawn(sessionId: string, _subagentSessionId: string): void {
    const toolCallId = `subagent-${Date.now()}`;
    this.emitToolCall(
      sessionId,
      toolCallId,
      "Spawning subagent",
      { task: "process data" },
      { isSubagent: true, kind: "other" },
    );
  }
}

/**
 * Create a mock ACP agent with default capabilities
 */
export function createMockACPAgent(
  agentId?: string,
  capabilities?: Partial<ACPAgentCapabilities>,
): MockACPAgent {
  return new MockACPAgent(agentId, capabilities);
}

/**
 * Create a mock plan for testing
 */
export function createMockPlan(planId?: string, stepCount = 3): ACPPlan {
  const steps = Array.from({ length: stepCount }, (_, i) => ({
    id: `step-${i + 1}`,
    description: `Step ${i + 1} description`,
    status: i === 0 ? ("in_progress" as const) : ("pending" as const),
  }));

  return {
    planId: planId || `plan-${Date.now()}`,
    title: "Test Plan",
    steps,
    status: "in_progress",
  };
}

/**
 * Create mock available commands for testing
 */
export function createMockCommands(count = 3): ACPAvailableCommand[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `cmd-${i + 1}`,
    name: `command${i + 1}`,
    description: `Description for command ${i + 1}`,
    arguments: [
      { name: "arg1", description: "First argument", required: true },
      { name: "arg2", description: "Second argument", required: false },
    ],
  }));
}
