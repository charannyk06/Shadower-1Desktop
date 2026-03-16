import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock server-only module before importing agent-state
vi.mock("server-only", () => ({}));

import {
  type AgentContextManager,
  createAgentContext,
  gatherContextForSubAgent,
} from "./agent-state";

describe("AgentContextManager", () => {
  let ctx: AgentContextManager;

  beforeEach(() => {
    ctx = createAgentContext();
  });

  describe("Plan Management", () => {
    it("should create a plan with tasks", () => {
      const plan = ctx.createPlan("Test request", [
        { description: "Task 1" },
        { description: "Task 2" },
        { description: "Task 3" },
      ]);

      expect(plan.id).toBeTruthy();
      expect(plan.request).toBe("Test request");
      expect(plan.tasks).toHaveLength(3);
      expect(plan.progress).toBe(0);
      expect(plan.status).toBe("planning");
    });

    it("should assign unique IDs to each task", () => {
      const plan = ctx.createPlan("Test", [
        { description: "Task 1" },
        { description: "Task 2" },
      ]);

      const taskIds = plan.tasks.map((t) => t.id);
      const uniqueIds = new Set(taskIds);
      expect(uniqueIds.size).toBe(taskIds.length);
    });

    it("should initialize all tasks with pending status", () => {
      const plan = ctx.createPlan("Test", [
        { description: "Task 1" },
        { description: "Task 2" },
      ]);

      plan.tasks.forEach((task) => {
        expect(task.status).toBe("pending");
      });
    });

    it("should support optional task properties", () => {
      const plan = ctx.createPlan("Test", [
        { description: "Task 1", assignedAgent: "agent-1" },
        { description: "Task 2", parentTaskId: "task-0" },
      ]);

      expect(plan.tasks[0].assignedAgent).toBe("agent-1");
      expect(plan.tasks[1].parentTaskId).toBe("task-0");
    });

    it("should return null when no plan exists", () => {
      expect(ctx.getPlan()).toBeNull();
    });

    it("should return the plan after creation", () => {
      ctx.createPlan("Test", [{ description: "Task 1" }]);
      const plan = ctx.getPlan();

      expect(plan).not.toBeNull();
      expect(plan!.request).toBe("Test");
    });
  });

  describe("Task Status Updates", () => {
    beforeEach(() => {
      ctx.createPlan("Test request", [
        { description: "Task 1" },
        { description: "Task 2" },
        { description: "Task 3" },
      ]);
    });

    it("should update task status to in-progress", () => {
      const plan = ctx.getPlan()!;
      const taskId = plan.tasks[0].id;

      ctx.updateTaskStatus(taskId, "in-progress");

      const task = ctx.getTask(taskId);
      expect(task!.status).toBe("in-progress");
    });

    it("should update task status to completed with result", () => {
      const plan = ctx.getPlan()!;
      const taskId = plan.tasks[0].id;
      const result = { data: "task result" };

      ctx.updateTaskStatus(taskId, "completed", result);

      const task = ctx.getTask(taskId);
      expect(task!.status).toBe("completed");
      expect(task!.result).toEqual(result);
    });

    it("should update task status to failed with error", () => {
      const plan = ctx.getPlan()!;
      const taskId = plan.tasks[0].id;
      const error = "Something went wrong";

      ctx.updateTaskStatus(taskId, "failed", error);

      const task = ctx.getTask(taskId);
      expect(task!.status).toBe("failed");
      expect(task!.error).toBe(error);
    });

    it("should update task status to blocked", () => {
      const plan = ctx.getPlan()!;
      const taskId = plan.tasks[0].id;

      ctx.updateTaskStatus(taskId, "blocked");

      const task = ctx.getTask(taskId);
      expect(task!.status).toBe("blocked");
    });

    it("should update the task's updatedAt timestamp", async () => {
      const plan = ctx.getPlan()!;
      const task = plan.tasks[0];
      const originalUpdatedAt = task.updatedAt;

      // Wait a bit to ensure time difference (1ms minimum)
      await new Promise((resolve) => setTimeout(resolve, 2));
      ctx.updateTaskStatus(task.id, "in-progress");

      expect(task.updatedAt).not.toBe(originalUpdatedAt);
    });
  });

  describe("Progress Calculation", () => {
    it("should calculate 0% progress with no completed tasks", () => {
      ctx.createPlan("Test", [
        { description: "Task 1" },
        { description: "Task 2" },
      ]);

      expect(ctx.calculateProgress()).toBe(0);
    });

    it("should calculate 50% progress with half completed tasks", () => {
      ctx.createPlan("Test", [
        { description: "Task 1" },
        { description: "Task 2" },
      ]);

      const plan = ctx.getPlan()!;
      ctx.updateTaskStatus(plan.tasks[0].id, "completed");

      expect(ctx.calculateProgress()).toBe(50);
    });

    it("should calculate 100% progress when all tasks completed", () => {
      ctx.createPlan("Test", [
        { description: "Task 1" },
        { description: "Task 2" },
      ]);

      const plan = ctx.getPlan()!;
      ctx.updateTaskStatus(plan.tasks[0].id, "completed");
      ctx.updateTaskStatus(plan.tasks[1].id, "completed");

      expect(ctx.calculateProgress()).toBe(100);
    });

    it("should handle single task plans", () => {
      ctx.createPlan("Test", [{ description: "Task 1" }]);

      const plan = ctx.getPlan()!;
      ctx.updateTaskStatus(plan.tasks[0].id, "completed");

      expect(ctx.calculateProgress()).toBe(100);
    });

    it("should return 0 for empty plan", () => {
      expect(ctx.calculateProgress()).toBe(0);
    });
  });

  describe("Plan Status Transitions", () => {
    beforeEach(() => {
      ctx.createPlan("Test", [
        { description: "Task 1" },
        { description: "Task 2" },
      ]);
    });

    it("should transition to executing when a task starts", () => {
      const plan = ctx.getPlan()!;
      ctx.updateTaskStatus(plan.tasks[0].id, "in-progress");

      expect(ctx.getPlan()!.status).toBe("executing");
    });

    it("should transition to completed when all tasks complete", () => {
      const plan = ctx.getPlan()!;
      ctx.updateTaskStatus(plan.tasks[0].id, "completed");
      ctx.updateTaskStatus(plan.tasks[1].id, "completed");

      expect(ctx.getPlan()!.status).toBe("completed");
    });

    it("should transition to failed when any task fails", () => {
      const plan = ctx.getPlan()!;
      ctx.updateTaskStatus(plan.tasks[0].id, "failed");

      expect(ctx.getPlan()!.status).toBe("failed");
    });
  });

  describe("Task Queries", () => {
    beforeEach(() => {
      ctx.createPlan("Test", [
        { description: "Task 1" },
        { description: "Task 2" },
        { description: "Task 3" },
      ]);
    });

    it("should get task by ID", () => {
      const plan = ctx.getPlan()!;
      const taskId = plan.tasks[1].id;

      const task = ctx.getTask(taskId);

      expect(task).not.toBeNull();
      expect(task!.description).toBe("Task 2");
    });

    it("should return null for non-existent task ID", () => {
      expect(ctx.getTask("non-existent-id")).toBeNull();
    });

    it("should get next pending task", () => {
      const plan = ctx.getPlan()!;

      // First pending task should be Task 1
      const firstPending = ctx.getNextPendingTask();
      expect(firstPending!.description).toBe("Task 1");

      // After completing Task 1, next should be Task 2
      ctx.updateTaskStatus(plan.tasks[0].id, "completed");
      const secondPending = ctx.getNextPendingTask();
      expect(secondPending!.description).toBe("Task 2");
    });

    it("should return null when no pending tasks", () => {
      const plan = ctx.getPlan()!;
      plan.tasks.forEach((t) => ctx.updateTaskStatus(t.id, "completed"));

      expect(ctx.getNextPendingTask()).toBeNull();
    });

    it("should filter tasks by status", () => {
      const plan = ctx.getPlan()!;
      ctx.updateTaskStatus(plan.tasks[0].id, "completed");
      ctx.updateTaskStatus(plan.tasks[1].id, "in-progress");

      const completed = ctx.getTasksByStatus("completed");
      const inProgress = ctx.getTasksByStatus("in-progress");
      const pending = ctx.getTasksByStatus("pending");

      expect(completed).toHaveLength(1);
      expect(inProgress).toHaveLength(1);
      expect(pending).toHaveLength(1);
    });
  });

  describe("Shared Context", () => {
    it("should set and get context values", () => {
      ctx.setSharedContext("key1", "value1");
      ctx.setSharedContext("key2", { data: "value2" });

      expect(ctx.getSharedContext("key1")).toBe("value1");
      expect(ctx.getSharedContext("key2")).toEqual({ data: "value2" });
    });

    it("should return undefined for non-existent keys", () => {
      expect(ctx.getSharedContext("non-existent")).toBeUndefined();
    });

    it("should overwrite existing context values", () => {
      ctx.setSharedContext("key", "original");
      ctx.setSharedContext("key", "updated");

      expect(ctx.getSharedContext("key")).toBe("updated");
    });

    it("should get all shared context", () => {
      ctx.setSharedContext("key1", "value1");
      ctx.setSharedContext("key2", "value2");

      const allContext = ctx.getAllSharedContext();

      expect(allContext).toEqual({
        key1: "value1",
        key2: "value2",
      });
    });

    it("should return empty object when no context set", () => {
      expect(ctx.getAllSharedContext()).toEqual({});
    });
  });

  describe("gatherContextForSubAgent", () => {
    it("should gather specified context keys", () => {
      ctx.setSharedContext("key1", "value1");
      ctx.setSharedContext("key2", "value2");
      ctx.setSharedContext("key3", "value3");

      const gathered = gatherContextForSubAgent(ctx, ["key1", "key3"]);

      expect(gathered).toEqual({
        key1: "value1",
        key3: "value3",
      });
    });

    it("should ignore non-existent keys", () => {
      ctx.setSharedContext("key1", "value1");

      const gathered = gatherContextForSubAgent(ctx, ["key1", "non-existent"]);

      expect(gathered).toEqual({ key1: "value1" });
    });

    it("should return empty object when no keys specified", () => {
      ctx.setSharedContext("key1", "value1");

      const gathered = gatherContextForSubAgent(ctx, undefined);

      expect(gathered).toEqual({});
    });

    it("should return empty object for empty keys array", () => {
      ctx.setSharedContext("key1", "value1");

      const gathered = gatherContextForSubAgent(ctx, []);

      expect(gathered).toEqual({});
    });
  });
});

describe("Multiple Context Instances", () => {
  it("should maintain separate state for different instances", () => {
    const ctx1 = createAgentContext();
    const ctx2 = createAgentContext();

    ctx1.createPlan("Plan 1", [{ description: "Task 1" }]);
    ctx2.createPlan("Plan 2", [{ description: "Task A" }]);

    ctx1.setSharedContext("key", "value1");
    ctx2.setSharedContext("key", "value2");

    expect(ctx1.getPlan()!.request).toBe("Plan 1");
    expect(ctx2.getPlan()!.request).toBe("Plan 2");
    expect(ctx1.getSharedContext("key")).toBe("value1");
    expect(ctx2.getSharedContext("key")).toBe("value2");
  });
});

describe("Tool Call Tracking", () => {
  let ctx: AgentContextManager;

  beforeEach(() => {
    ctx = createAgentContext();
  });

  describe("trackToolCall", () => {
    it("should allow first tool call", () => {
      const result = ctx.trackToolCall("webSearch");

      expect(result.allowed).toBeTruthy();
      expect(result.count).toBe(1);
      expect(result.limit).toBe(20); // webSearch has specific limit of 20
    });

    it("should track multiple calls to same tool", () => {
      ctx.trackToolCall("webSearch");
      ctx.trackToolCall("webSearch");
      const result = ctx.trackToolCall("webSearch");

      expect(result.count).toBe(3);
      expect(result.allowed).toBeTruthy();
    });

    it("should track different tools independently", () => {
      ctx.trackToolCall("toolA");
      ctx.trackToolCall("toolA");
      ctx.trackToolCall("toolB");

      const resultA = ctx.trackToolCall("toolA");
      const resultB = ctx.trackToolCall("toolB");

      expect(resultA.count).toBe(3);
      expect(resultB.count).toBe(2);
    });

    it("should block tool after exceeding default limit (15)", () => {
      // Call tool 15 times (default limit for unknown tools)
      for (let i = 0; i < 15; i++) {
        const result = ctx.trackToolCall("someUnknownTool");
        expect(result.allowed).toBeTruthy();
        expect(result.count).toBe(i + 1);
      }

      // 16th call should be blocked
      const result = ctx.trackToolCall("someUnknownTool");
      expect(result.allowed).toBeFalsy();
      expect(result.count).toBe(16);
      expect(result.limit).toBe(15);
    });

    it("should have higher limit (25) for updateTaskStatus", () => {
      // updateTaskStatus has limit of 25
      for (let i = 0; i < 24; i++) {
        const result = ctx.trackToolCall("updateTaskStatus");
        expect(result.allowed).toBeTruthy();
      }

      // 25th call should still be allowed
      const result25 = ctx.trackToolCall("updateTaskStatus");
      expect(result25.allowed).toBeTruthy();
      expect(result25.count).toBe(25);
      expect(result25.limit).toBe(25);

      // 26th call should be blocked
      const result26 = ctx.trackToolCall("updateTaskStatus");
      expect(result26.allowed).toBeFalsy();
      expect(result26.count).toBe(26);
    });

    it("should have higher limit (20) for setContext", () => {
      for (let i = 0; i < 20; i++) {
        const result = ctx.trackToolCall("setContext");
        expect(result.allowed).toBeTruthy();
      }

      const result21 = ctx.trackToolCall("setContext");
      expect(result21.allowed).toBeFalsy();
      expect(result21.limit).toBe(20);
    });

    it("should have higher limit (30) for getContext", () => {
      for (let i = 0; i < 30; i++) {
        const result = ctx.trackToolCall("getContext");
        expect(result.allowed).toBeTruthy();
      }

      const result31 = ctx.trackToolCall("getContext");
      expect(result31.allowed).toBeFalsy();
      expect(result31.limit).toBe(30);
    });

    it("should have higher limit (15) for getPlanStatus", () => {
      const result = ctx.trackToolCall("getPlanStatus");
      expect(result.limit).toBe(15);
    });

    it("should have higher limit (15) for getNextTask", () => {
      const result = ctx.trackToolCall("getNextTask");
      expect(result.limit).toBe(15);
    });

    it("should have higher limit (15) for getAllContext", () => {
      const result = ctx.trackToolCall("getAllContext");
      expect(result.limit).toBe(15);
    });

    it("should use default limit for unknown tools", () => {
      const result = ctx.trackToolCall("unknownTool");
      expect(result.limit).toBe(15); // MAX_TOOL_CALLS_PER_TOOL
    });
  });

  describe("getToolCallCounts", () => {
    it("should return empty object initially", () => {
      expect(ctx.getToolCallCounts()).toEqual({});
    });

    it("should return all tool counts", () => {
      ctx.trackToolCall("toolA");
      ctx.trackToolCall("toolA");
      ctx.trackToolCall("toolB");
      ctx.trackToolCall("toolC");
      ctx.trackToolCall("toolC");
      ctx.trackToolCall("toolC");

      expect(ctx.getToolCallCounts()).toEqual({
        toolA: 2,
        toolB: 1,
        toolC: 3,
      });
    });

    it("should not mutate internal state when returned object is modified", () => {
      ctx.trackToolCall("toolA");

      const counts = ctx.getToolCallCounts();
      counts.toolA = 999;

      expect(ctx.getToolCallCounts().toolA).toBe(1);
    });
  });

  describe("resetToolCallCounts", () => {
    it("should reset all counts to empty", () => {
      ctx.trackToolCall("toolA");
      ctx.trackToolCall("toolB");
      ctx.trackToolCall("toolB");

      ctx.resetToolCallCounts();

      expect(ctx.getToolCallCounts()).toEqual({});
    });

    it("should allow previously blocked tools after reset", () => {
      // Exhaust limit for a tool (webSearch limit is 20)
      for (let i = 0; i < 21; i++) {
        ctx.trackToolCall("webSearch");
      }

      // Verify it's blocked
      expect(ctx.trackToolCall("webSearch").allowed).toBeFalsy();

      // Reset
      ctx.resetToolCallCounts();

      // Now it should be allowed again
      const result = ctx.trackToolCall("webSearch");
      expect(result.allowed).toBeTruthy();
      expect(result.count).toBe(1);
    });

    it("should not affect other context state (plan, shared context)", () => {
      ctx.createPlan("Test Plan", [{ description: "Task 1" }]);
      ctx.setSharedContext("key", "value");
      ctx.trackToolCall("toolA");

      ctx.resetToolCallCounts();

      expect(ctx.getPlan()?.request).toBe("Test Plan");
      expect(ctx.getSharedContext("key")).toBe("value");
    });
  });

  describe("Tool call tracking edge cases", () => {
    it("should handle empty string tool name", () => {
      const result = ctx.trackToolCall("");
      expect(result.count).toBe(1);
      expect(result.limit).toBe(15);
    });

    it("should handle tool names with special characters", () => {
      const result = ctx.trackToolCall("tool-with_special.chars");
      expect(result.count).toBe(1);
      expect(result.allowed).toBeTruthy();
    });

    it("should be case-sensitive for tool names", () => {
      ctx.trackToolCall("ToolA");
      ctx.trackToolCall("toolA");
      ctx.trackToolCall("TOOLA");

      expect(ctx.getToolCallCounts()).toEqual({
        ToolA: 1,
        toolA: 1,
        TOOLA: 1,
      });
    });
  });
});

describe("Context Serialization", () => {
  it("should serialize and deserialize plan state", () => {
    const ctx1 = createAgentContext();

    ctx1.createPlan("Test Plan", [
      { description: "Task 1" },
      { description: "Task 2" },
    ]);
    ctx1.updateTaskStatus(ctx1.getPlan()!.tasks[0].id, "completed");

    const serialized = ctx1.serialize();

    const ctx2 = createAgentContext();
    ctx2.deserialize(serialized);

    expect(ctx2.getPlan()?.request).toBe("Test Plan");
    expect(ctx2.getPlan()?.tasks).toHaveLength(2);
    expect(ctx2.getPlan()?.tasks[0].status).toBe("completed");
  });

  it("should serialize and deserialize shared context", () => {
    const ctx1 = createAgentContext();

    ctx1.setSharedContext("key1", "value1");
    ctx1.setSharedContext("key2", { nested: "object" });

    const serialized = ctx1.serialize();

    const ctx2 = createAgentContext();
    ctx2.deserialize(serialized);

    expect(ctx2.getSharedContext("key1")).toBe("value1");
    expect(ctx2.getSharedContext("key2")).toEqual({ nested: "object" });
  });

  it("should handle invalid JSON gracefully during deserialization", () => {
    const ctx = createAgentContext();

    // Should not throw
    ctx.deserialize("invalid json");
    ctx.deserialize("");
    ctx.deserialize("null");

    // State should remain empty
    expect(ctx.getPlan()).toBeNull();
    expect(ctx.getAllSharedContext()).toEqual({});
  });

  it("should handle partial data during deserialization", () => {
    const ctx = createAgentContext();

    // Only plan, no shared context
    ctx.deserialize(
      JSON.stringify({
        plan: {
          id: "test",
          request: "Test",
          tasks: [],
          progress: 0,
          status: "planning",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }),
    );

    expect(ctx.getPlan()?.request).toBe("Test");
    expect(ctx.getAllSharedContext()).toEqual({});
  });
});
