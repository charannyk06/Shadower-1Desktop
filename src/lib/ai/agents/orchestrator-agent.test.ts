import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock server-only module
vi.mock("server-only", () => ({}));

// Mock dependencies
vi.mock("../models", () => ({
  customModelProvider: {
    getModel: vi.fn().mockReturnValue({}),
  },
}));

vi.mock("lib/db/repository", () => ({
  agentRepository: {
    selectAgentById: vi.fn(),
  },
  workflowRepository: {
    checkAccess: vi.fn(),
    selectStructureById: vi.fn(),
  },
}));

vi.mock("../workflow/executor/workflow-executor", () => ({
  createWorkflowExecutor: vi.fn(),
}));

vi.mock("logger", () => ({
  default: {
    withDefaults: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

vi.mock("consola/utils", () => ({
  colorize: vi.fn((_, msg) => msg),
}));

import {
  AGENT_ORCHESTRATOR_INSTRUCTIONS,
  createAgentOrchestratorConfig,
  createStreamingAgentConfig,
} from "./orchestrator-agent";

describe("Orchestrator Agent Configuration", () => {
  const mockConfig = {
    userId: "test-user-123",
    chatModel: { provider: "openai" as const, model: "gpt-4o" as const },
    availableTools: {},
    mcpTools: {},
    userAgent: null,
  };

  describe("AGENT_ORCHESTRATOR_INSTRUCTIONS", () => {
    it("should contain core capability instructions", () => {
      expect(AGENT_ORCHESTRATOR_INSTRUCTIONS).toContain("PLANNING");
      expect(AGENT_ORCHESTRATOR_INSTRUCTIONS).toContain("EXECUTION");
      expect(AGENT_ORCHESTRATOR_INSTRUCTIONS).toContain("DELEGATION");
      expect(AGENT_ORCHESTRATOR_INSTRUCTIONS).toContain("TRACKING");
      expect(AGENT_ORCHESTRATOR_INSTRUCTIONS).toContain("CONTEXT SHARING");
    });

    it("should contain workflow instructions", () => {
      expect(AGENT_ORCHESTRATOR_INSTRUCTIONS).toContain("createPlan");
      expect(AGENT_ORCHESTRATOR_INSTRUCTIONS).toContain("updateTaskStatus");
      expect(AGENT_ORCHESTRATOR_INSTRUCTIONS).toContain("spawnParallelAgents");
    });

    it("should contain delegation rules", () => {
      expect(AGENT_ORCHESTRATOR_INSTRUCTIONS).toContain("DELEGATION RULES");
      expect(AGENT_ORCHESTRATOR_INSTRUCTIONS).toContain("Independent tasks");
      expect(AGENT_ORCHESTRATOR_INSTRUCTIONS).toContain("Sequential tasks");
    });

    it("should contain reminder section", () => {
      expect(AGENT_ORCHESTRATOR_INSTRUCTIONS).toContain("REMEMBER");
      expect(AGENT_ORCHESTRATOR_INSTRUCTIONS).toContain("update task status");
    });
  });

  describe("createAgentOrchestratorConfig", () => {
    it("should return a valid configuration object", () => {
      const config = createAgentOrchestratorConfig(mockConfig);

      expect(config).toHaveProperty("system");
      expect(config).toHaveProperty("tools");
      expect(config).toHaveProperty("maxSteps");
      expect(config).toHaveProperty("toolChoice", "auto");
      expect(config).toHaveProperty("contextManager");
    });

    it("should include orchestrator instructions in system prompt", () => {
      const config = createAgentOrchestratorConfig(mockConfig);

      expect(config.system).toContain("autonomous AI orchestrator");
      expect(config.system).toContain("PLANNING");
    });

    it("should include agent context tools", () => {
      const config = createAgentOrchestratorConfig(mockConfig);

      expect(config.tools).toHaveProperty("createPlan");
      expect(config.tools).toHaveProperty("updateTaskStatus");
      expect(config.tools).toHaveProperty("getNextTask");
      expect(config.tools).toHaveProperty("getPlanStatus");
      expect(config.tools).toHaveProperty("setContext");
      expect(config.tools).toHaveProperty("getContext");
      expect(config.tools).toHaveProperty("getAllContext");
    });

    it("should include sub-agent tools", () => {
      const config = createAgentOrchestratorConfig(mockConfig);

      expect(config.tools).toHaveProperty("spawnAgent");
      expect(config.tools).toHaveProperty("spawnParallelAgents");
    });

    it("should include workflow tool", () => {
      const config = createAgentOrchestratorConfig(mockConfig);

      expect(config.tools).toHaveProperty("executeWorkflow");
    });

    it("should merge available tools", () => {
      const configWithTools = {
        ...mockConfig,
        availableTools: { customTool: {} as any },
        mcpTools: { mcpTool: {} as any },
      };

      const config = createAgentOrchestratorConfig(configWithTools);

      expect(config.tools).toHaveProperty("customTool");
      expect(config.tools).toHaveProperty("mcpTool");
    });

    it("should use custom maxSteps when provided", () => {
      const configWithMaxSteps = {
        ...mockConfig,
        maxSteps: 100,
      };

      const config = createAgentOrchestratorConfig(configWithMaxSteps);

      expect(config.maxSteps).toBe(100);
    });

    it("should default maxSteps to 50", () => {
      const config = createAgentOrchestratorConfig(mockConfig);

      expect(config.maxSteps).toBe(50);
    });

    it("should include user agent instructions when provided", () => {
      const configWithAgent = {
        ...mockConfig,
        userAgent: {
          id: "agent-1",
          name: "Test Agent",
          instructions: {
            role: "Test Assistant",
            systemPrompt: "You are a helpful test assistant.",
          },
          userId: "test-user",
          visibility: "private" as const,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      };

      const config = createAgentOrchestratorConfig(configWithAgent);

      expect(config.system).toContain("Test Assistant");
      expect(config.system).toContain("helpful test assistant");
      expect(config.system).toContain("PLANNING"); // Still includes orchestrator instructions
    });
  });

  describe("createStreamingAgentConfig", () => {
    it("should return config without contextManager", () => {
      const config = createStreamingAgentConfig(mockConfig);

      expect(config).not.toHaveProperty("contextManager");
    });

    it("should include stopWhen property", () => {
      const config = createStreamingAgentConfig(mockConfig);

      expect(config).toHaveProperty("stopWhen");
    });

    it("should include system prompt", () => {
      const config = createStreamingAgentConfig(mockConfig);

      expect(config).toHaveProperty("system");
      expect(config.system).toContain("autonomous AI orchestrator");
    });

    it("should include all tools", () => {
      const config = createStreamingAgentConfig(mockConfig);

      expect(config.tools).toHaveProperty("createPlan");
      expect(config.tools).toHaveProperty("spawnAgent");
      expect(config.tools).toHaveProperty("executeWorkflow");
    });
  });

  describe("Tool Definitions", () => {
    let config: ReturnType<typeof createAgentOrchestratorConfig>;

    beforeEach(() => {
      config = createAgentOrchestratorConfig(mockConfig);
    });

    describe("createPlan tool", () => {
      it("should have proper description", () => {
        const tool = config.tools.createPlan as any;
        expect(tool.description).toContain("execution plan");
      });

      it("should execute and create a plan", async () => {
        const tool = config.tools.createPlan as any;
        const result = await tool.execute({
          request: "Test request",
          tasks: [{ description: "Task 1" }, { description: "Task 2" }],
        });

        expect(result).toHaveProperty("planId");
        expect(result).toHaveProperty("taskCount", 2);
        expect(result.tasks).toHaveLength(2);
      });
    });

    describe("updateTaskStatus tool", () => {
      it("should have proper description", () => {
        const tool = config.tools.updateTaskStatus as any;
        expect(tool.description).toContain("status");
      });

      it("should update task status", async () => {
        // First create a plan
        const createPlan = config.tools.createPlan as any;
        const planResult = await createPlan.execute({
          request: "Test",
          tasks: [{ description: "Task 1" }],
        });

        // Then update task status
        const updateStatus = config.tools.updateTaskStatus as any;
        const result = await updateStatus.execute({
          taskId: planResult.tasks[0].id,
          status: "completed",
          result: { data: "done" },
        });

        expect(result.newStatus).toBe("completed");
        expect(result.planProgress).toBeGreaterThanOrEqual(0);
      });
    });

    describe("getNextTask tool", () => {
      it("should return next pending task", async () => {
        // Create a plan first
        const createPlan = config.tools.createPlan as any;
        await createPlan.execute({
          request: "Test",
          tasks: [{ description: "Task 1" }],
        });

        const getNext = config.tools.getNextTask as any;
        const result = await getNext.execute({});

        expect(result).toHaveProperty("taskId");
        expect(result).toHaveProperty("description", "Task 1");
      });

      it("should return message when no pending tasks", async () => {
        // Create and complete all tasks
        const createPlan = config.tools.createPlan as any;
        const planResult = await createPlan.execute({
          request: "Test",
          tasks: [{ description: "Task 1" }],
        });

        const updateStatus = config.tools.updateTaskStatus as any;
        await updateStatus.execute({
          taskId: planResult.tasks[0].id,
          status: "completed",
        });

        const getNext = config.tools.getNextTask as any;
        const result = await getNext.execute({});

        expect(result.message).toContain("No pending tasks");
      });
    });

    describe("getPlanStatus tool", () => {
      it("should return plan status", async () => {
        // Create a plan first
        const createPlan = config.tools.createPlan as any;
        await createPlan.execute({
          request: "Test request",
          tasks: [{ description: "Task 1" }],
        });

        const getStatus = config.tools.getPlanStatus as any;
        const result = await getStatus.execute({});

        expect(result).toHaveProperty("planId");
        expect(result).toHaveProperty("request", "Test request");
        expect(result).toHaveProperty("progress");
        expect(result).toHaveProperty("status");
      });

      it("should return message when no plan exists", async () => {
        // Fresh config without plan
        const freshConfig = createAgentOrchestratorConfig(mockConfig);
        const getStatus = freshConfig.tools.getPlanStatus as any;
        const result = await getStatus.execute({});

        expect(result.message).toContain("No plan exists yet");
      });
    });

    describe("setContext tool", () => {
      it("should store context value", async () => {
        const setCtx = config.tools.setContext as any;
        const result = await setCtx.execute({
          key: "testKey",
          value: { data: "testValue" },
        });

        expect(result.stored).toBe("testKey");
      });
    });

    describe("getContext tool", () => {
      it("should retrieve stored context", async () => {
        const setCtx = config.tools.setContext as any;
        await setCtx.execute({
          key: "testKey",
          value: "testValue",
        });

        const getCtx = config.tools.getContext as any;
        const result = await getCtx.execute({ key: "testKey" });

        expect(result.found).toBe(true);
        expect(result.value).toBe("testValue");
      });

      it("should return not found for missing keys", async () => {
        const getCtx = config.tools.getContext as any;
        const result = await getCtx.execute({ key: "nonExistent" });

        expect(result.found).toBe(false);
      });
    });

    describe("getAllContext tool", () => {
      it("should return all stored context", async () => {
        const setCtx = config.tools.setContext as any;
        await setCtx.execute({ key: "key1", value: "value1" });
        await setCtx.execute({ key: "key2", value: "value2" });

        const getAllCtx = config.tools.getAllContext as any;
        const result = await getAllCtx.execute({});

        expect(result.contextCount).toBe(2);
        expect(result.keys).toContain("key1");
        expect(result.keys).toContain("key2");
      });
    });
  });
});

describe("Agent Context Tool Integration", () => {
  it("should maintain state across tool calls", async () => {
    const config = createAgentOrchestratorConfig({
      userId: "test-user",
      chatModel: { provider: "openai" as const, model: "gpt-4o" as const },
      availableTools: {},
      mcpTools: {},
      userAgent: null,
    });

    // Create plan
    const createPlan = config.tools.createPlan as any;
    const planResult = await createPlan.execute({
      request: "Multi-step task",
      tasks: [
        { description: "Research" },
        { description: "Analyze" },
        { description: "Report" },
      ],
    });

    expect(planResult.taskCount).toBe(3);

    // Get first task
    const getNext = config.tools.getNextTask as any;
    let nextTask = await getNext.execute({});
    expect(nextTask.description).toBe("Research");

    // Update to in-progress
    const updateStatus = config.tools.updateTaskStatus as any;
    await updateStatus.execute({
      taskId: nextTask.taskId,
      status: "in-progress",
    });

    // Complete first task with result
    const setCtx = config.tools.setContext as any;
    await setCtx.execute({
      key: "researchResults",
      value: { findings: ["finding1", "finding2"] },
    });

    await updateStatus.execute({
      taskId: nextTask.taskId,
      status: "completed",
      result: "Research complete",
    });

    // Check progress
    const getStatus = config.tools.getPlanStatus as any;
    let status = await getStatus.execute({});
    expect(status.progress).toBeCloseTo(33, 0);
    expect(status.status).toBe("executing");

    // Get and complete second task
    nextTask = await getNext.execute({});
    expect(nextTask.description).toBe("Analyze");

    await updateStatus.execute({
      taskId: nextTask.taskId,
      status: "completed",
    });

    // Check context is preserved
    const getCtx = config.tools.getContext as any;
    const contextResult = await getCtx.execute({ key: "researchResults" });
    expect(contextResult.found).toBe(true);
    expect(contextResult.value.findings).toHaveLength(2);

    // Complete last task
    nextTask = await getNext.execute({});
    await updateStatus.execute({
      taskId: nextTask.taskId,
      status: "completed",
    });

    // Verify final status
    status = await getStatus.execute({});
    expect(status.progress).toBe(100);
    expect(status.status).toBe("completed");
  });
});
