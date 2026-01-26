/**
 * ACP Features Unit Tests
 *
 * Tests for the new ACP features:
 * - Feature 1: Plan Updates
 * - Feature 2: Session Load/Resume
 * - Feature 3: Terminal Streaming
 * - Feature 4: Available Commands
 * - Feature 5: Subagent Support
 * - Feature 6: Session Info Updates
 */

import { test, expect } from "@playwright/test";
import {
  MockACPAgent,
  createMockACPAgent,
  createMockPlan,
  createMockCommands,
} from "../helpers/mock-acp-agent";
import type {
  ACPMessageChunk,
  ACPAvailableCommand,
  ACPSessionInfoUpdateEvent,
} from "../../src/types/acp";
import {
  isSubagentToolCall,
  SUBAGENT_TOOL_NAME,
  TOOL_NAME_META_KEY,
} from "../../src/types/acp";

test.describe("ACP Features", () => {
  let mockAgent: MockACPAgent;

  test.beforeEach(() => {
    mockAgent = createMockACPAgent("test-agent", {
      loadSession: true,
      sessionList: true,
      sessionResume: true,
    });
  });

  // ===========================================================================
  // Feature 1: Plan Updates
  // ===========================================================================
  test.describe("Plan Updates", () => {
    test("should create a valid plan structure", () => {
      const plan = createMockPlan("plan-123", 3);

      expect(plan.planId).toBe("plan-123");
      expect(plan.title).toBe("Test Plan");
      expect(plan.steps).toHaveLength(3);
      expect(plan.status).toBe("in_progress");

      // First step should be in_progress, others pending
      expect(plan.steps[0].status).toBe("in_progress");
      expect(plan.steps[1].status).toBe("pending");
      expect(plan.steps[2].status).toBe("pending");
    });

    test("should emit plan update chunks", () => {
      const chunks: ACPMessageChunk[] = [];
      const session = mockAgent.createSession("/test/dir");

      mockAgent.on({
        onMessageChunk: (chunk) => chunks.push(chunk),
      });

      const plan = createMockPlan("plan-test");
      mockAgent.emitPlan(session.sessionId, plan);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe("plan");
      expect(chunks[0].content).toEqual(plan);
    });

    test("should update plan step status", () => {
      const plan = createMockPlan("plan-456", 2);

      // Simulate step completion
      plan.steps[0].status = "completed";
      plan.steps[1].status = "in_progress";

      expect(plan.steps[0].status).toBe("completed");
      expect(plan.steps[1].status).toBe("in_progress");
    });
  });

  // ===========================================================================
  // Feature 2: Session Management
  // ===========================================================================
  test.describe("Session Management", () => {
    test("should list available sessions", () => {
      // Create some sessions
      mockAgent.createSession("/path/one");
      mockAgent.createSession("/path/two");

      const response = mockAgent.listSessions();

      expect(response.sessions).toHaveLength(2);
      expect(response.sessions[0].cwd).toBe("/path/one");
      expect(response.sessions[1].cwd).toBe("/path/two");
    });

    test("should load existing session", () => {
      const original = mockAgent.createSession("/original/path");
      const sessionId = original.sessionId;

      // Clear and load
      const loaded = mockAgent.loadSession(sessionId, "/new/path");

      expect(loaded).toBeDefined();
      expect(loaded?.sessionId).toBe(sessionId);
      expect(loaded?.workingDirectory).toBe("/new/path");
    });

    test("should resume session without history", () => {
      const original = mockAgent.createSession("/original/path");
      const sessionId = original.sessionId;

      const resumed = mockAgent.resumeSession(sessionId, "/new/path");

      expect(resumed).toBeDefined();
      expect(resumed?.sessionId).toBe(sessionId);
    });

    test("should report capabilities correctly", () => {
      expect(mockAgent.capabilities.loadSession).toBe(true);
      expect(mockAgent.capabilities.sessionList).toBe(true);
      expect(mockAgent.capabilities.sessionResume).toBe(true);
    });

    test("should return undefined for non-existent session", () => {
      const result = mockAgent.loadSession("non-existent", "/path");
      expect(result).toBeUndefined();
    });
  });

  // ===========================================================================
  // Feature 3: Terminal Streaming
  // ===========================================================================
  test.describe("Terminal Streaming", () => {
    test("should emit terminal created event", () => {
      let terminalEvent: any = null;
      const session = mockAgent.createSession("/test/dir");

      mockAgent.on({
        onTerminalCreated: (data) => {
          terminalEvent = data;
        },
      });

      mockAgent.emitTerminalCreated(session.sessionId, "term-1", "/test/dir");

      expect(terminalEvent).not.toBeNull();
      expect(terminalEvent.agentId).toBe("test-agent");
      expect(terminalEvent.sessionId).toBe(session.sessionId);
      expect(terminalEvent.terminalId).toBe("term-1");
    });

    test("should stream terminal output", () => {
      const outputs: string[] = [];
      const chunks: ACPMessageChunk[] = [];
      const session = mockAgent.createSession("/test/dir");

      mockAgent.on({
        onTerminalOutput: (data) => outputs.push(data.data),
        onMessageChunk: (chunk) => chunks.push(chunk),
      });

      mockAgent.emitTerminalOutput(session.sessionId, "term-1", "$ ls\n");
      mockAgent.emitTerminalOutput(session.sessionId, "term-1", "file1.txt\n");
      mockAgent.emitTerminalOutput(session.sessionId, "term-1", "file2.txt\n");

      expect(outputs).toHaveLength(3);
      expect(outputs.join("")).toBe("$ ls\nfile1.txt\nfile2.txt\n");

      // Should also emit as message chunks
      expect(chunks.filter((c) => c.type === "terminal_output")).toHaveLength(
        3,
      );
    });

    test("should handle terminal exit", () => {
      let exitEvent: any = null;
      const chunks: ACPMessageChunk[] = [];
      const session = mockAgent.createSession("/test/dir");

      mockAgent.on({
        onTerminalExit: (data) => {
          exitEvent = data;
        },
        onMessageChunk: (chunk) => chunks.push(chunk),
      });

      mockAgent.emitTerminalExit(session.sessionId, "term-1", 0);

      expect(exitEvent).not.toBeNull();
      expect(exitEvent.terminalId).toBe("term-1");
      expect(exitEvent.exitCode).toBe(0);

      // Should emit as message chunk
      const exitChunks = chunks.filter((c) => c.type === "terminal_exit");
      expect(exitChunks).toHaveLength(1);
    });

    test("should handle terminal exit with signal", () => {
      let exitEvent: any = null;
      const session = mockAgent.createSession("/test/dir");

      mockAgent.on({
        onTerminalExit: (data) => {
          exitEvent = data;
        },
      });

      mockAgent.emitTerminalExit(
        session.sessionId,
        "term-1",
        undefined,
        "SIGKILL",
      );

      expect(exitEvent).not.toBeNull();
      expect(exitEvent.exitCode).toBeUndefined();
    });
  });

  // ===========================================================================
  // Feature 4: Available Commands
  // ===========================================================================
  test.describe("Available Commands", () => {
    test("should create valid command structure", () => {
      const commands = createMockCommands(2);

      expect(commands).toHaveLength(2);
      expect(commands[0].id).toBe("cmd-1");
      expect(commands[0].name).toBe("command1");
      expect(commands[0].arguments).toHaveLength(2);
      expect(commands[0].arguments?.[0].required).toBe(true);
    });

    test("should update available commands", () => {
      let commandsUpdate: ACPAvailableCommand[] | null = null;
      const chunks: ACPMessageChunk[] = [];
      const session = mockAgent.createSession("/test/dir");

      mockAgent.on({
        onCommandsUpdate: (data) => {
          commandsUpdate = data.commands;
        },
        onMessageChunk: (chunk) => chunks.push(chunk),
      });

      const commands = createMockCommands(3);
      mockAgent.emitCommandsUpdate(session.sessionId, commands);

      expect(commandsUpdate).not.toBeNull();
      expect(commandsUpdate).toHaveLength(3);

      // Should emit as message chunk
      const cmdChunks = chunks.filter((c) => c.type === "commands_update");
      expect(cmdChunks).toHaveLength(1);
    });
  });

  // ===========================================================================
  // Feature 5: Subagent Support
  // ===========================================================================
  test.describe("Subagent Support", () => {
    test("should detect subagent tool calls", () => {
      const chunks: ACPMessageChunk[] = [];
      const session = mockAgent.createSession("/test/dir");

      mockAgent.on({
        onMessageChunk: (chunk) => chunks.push(chunk),
      });

      mockAgent.emitSubagentSpawn(session.sessionId, "sub-session-1");

      expect(chunks).toHaveLength(1);
      const toolCall = chunks[0].content as any;
      expect(toolCall.isSubagent).toBe(true);
      expect(toolCall.toolName).toBe(SUBAGENT_TOOL_NAME);
    });

    test("should extract tool name from meta", () => {
      const chunks: ACPMessageChunk[] = [];
      const session = mockAgent.createSession("/test/dir");

      mockAgent.on({
        onMessageChunk: (chunk) => chunks.push(chunk),
      });

      mockAgent.emitToolCall(
        session.sessionId,
        "tool-1",
        "execute_code",
        { code: "print('hello')" },
        { kind: "code" },
      );

      expect(chunks).toHaveLength(1);
      const toolCall = chunks[0].content as any;
      expect(toolCall.toolName).toBe("execute_code");
      expect(toolCall.isSubagent).toBeUndefined();
    });

    test("should use TOOL_NAME_META_KEY constant correctly", () => {
      expect(TOOL_NAME_META_KEY).toBe("tool_name");
      expect(SUBAGENT_TOOL_NAME).toBe("subagent");
    });

    test("isSubagentToolCall type guard should work", () => {
      const normalToolCall = {
        id: "tool-1",
        name: "execute",
        state: "running" as const,
      };

      const subagentToolCall = {
        id: "tool-2",
        name: "subagent",
        state: "running" as const,
        isSubagent: true as const,
        toolName: "subagent",
      };

      expect(isSubagentToolCall(normalToolCall)).toBe(false);
      expect(isSubagentToolCall(subagentToolCall)).toBe(true);
    });
  });

  // ===========================================================================
  // Feature 6: Session Info Updates
  // ===========================================================================
  test.describe("Session Info Updates", () => {
    test("should emit session info update event", () => {
      let infoUpdate: ACPSessionInfoUpdateEvent | null = null;
      const chunks: ACPMessageChunk[] = [];
      const session = mockAgent.createSession("/test/dir");

      mockAgent.on({
        onSessionInfoUpdate: (data) => {
          infoUpdate = data;
        },
        onMessageChunk: (chunk) => chunks.push(chunk),
      });

      mockAgent.emitSessionInfoUpdate(session.sessionId, "New Title", {
        key: "value",
      });

      expect(infoUpdate).not.toBeNull();
      const update = infoUpdate!;
      expect(update.agentId).toBe("test-agent");
      expect(update.sessionId).toBe(session.sessionId);
      expect(update.title).toBe("New Title");
      expect(update.meta).toEqual({ key: "value" });

      // Should emit as message chunk
      const infoChunks = chunks.filter((c) => c.type === "session_info");
      expect(infoChunks).toHaveLength(1);
    });

    test("should handle partial session info updates", () => {
      let infoUpdate: ACPSessionInfoUpdateEvent | null = null;
      const session = mockAgent.createSession("/test/dir");

      mockAgent.on({
        onSessionInfoUpdate: (data) => {
          infoUpdate = data;
        },
      });

      // Only update title
      mockAgent.emitSessionInfoUpdate(session.sessionId, "Just Title");

      const update = infoUpdate!;
      expect(update.title).toBe("Just Title");
      expect(update.meta).toBeUndefined();
    });
  });

  // ===========================================================================
  // Integration: Complete Conversation Flow
  // ===========================================================================
  test.describe("Integration", () => {
    test("should handle complete tool use flow", async () => {
      const chunks: ACPMessageChunk[] = [];
      const session = mockAgent.createSession("/test/dir");

      mockAgent.on({
        onMessageChunk: (chunk) => chunks.push(chunk),
      });

      await mockAgent.simulateToolUse(
        session.sessionId,
        "read_file",
        { path: "/test/file.txt" },
        "file contents here",
      );

      // Should have: thinking, tool_call, tool_result, text (done)
      expect(chunks.length).toBeGreaterThanOrEqual(4);

      const types = chunks.map((c) => c.type);
      expect(types).toContain("thinking");
      expect(types).toContain("tool_call");
      expect(types).toContain("tool_result");
      expect(types).toContain("text");

      // Last chunk should be done
      expect(chunks[chunks.length - 1].done).toBe(true);
    });

    test("should handle mixed content types", () => {
      const chunks: ACPMessageChunk[] = [];
      const session = mockAgent.createSession("/test/dir");

      mockAgent.on({
        onMessageChunk: (chunk) => chunks.push(chunk),
      });

      // Emit various content types
      mockAgent.emitThinking(session.sessionId, "Let me think...");
      mockAgent.emitText(session.sessionId, "Here's my response.");
      mockAgent.emitPlan(session.sessionId, createMockPlan());
      mockAgent.emitCommandsUpdate(session.sessionId, createMockCommands(2));
      mockAgent.emitTerminalOutput(session.sessionId, "term-1", "output");
      mockAgent.emitDone(session.sessionId);

      const types = chunks.map((c) => c.type);
      expect(types).toContain("thinking");
      expect(types).toContain("text");
      expect(types).toContain("plan");
      expect(types).toContain("commands_update");
      expect(types).toContain("terminal_output");
    });
  });
});
