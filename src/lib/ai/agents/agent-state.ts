import { nanoid } from "nanoid";
import "server-only";
import { z } from "zod";

/**
 * Enhanced Task schema for persistent tracking
 * Implements recommendation #2: Add persistent task state tracking
 */
export const AgentTaskSchema = z.object({
  id: z.string(),
  description: z.string(),
  status: z.enum(["pending", "in-progress", "completed", "failed", "blocked"]),
  assignedAgent: z.string().optional(),
  parentTaskId: z.string().optional(),
  result: z.any().optional(),
  error: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/**
 * Plan schema for autonomous task management
 */
export const AgentPlanSchema = z.object({
  id: z.string(),
  request: z.string(),
  tasks: z.array(AgentTaskSchema),
  progress: z.number().min(0).max(100),
  status: z.enum(["planning", "executing", "completed", "failed"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type AgentTask = z.infer<typeof AgentTaskSchema>;
export type AgentPlan = z.infer<typeof AgentPlanSchema>;

/**
 * Task definition without auto-generated fields (for createPlan input)
 */
export type TaskDefinition = Omit<
  AgentTask,
  "id" | "createdAt" | "updatedAt" | "status"
>;

/**
 * Agent context manager for state sharing
 * Implements recommendations #2, #3, and #4:
 * - Persistent task state tracking
 * - updateTaskStatus tool capability
 * - Inter-agent context sharing
 */
export interface AgentContextManager {
  // Plan management
  createPlan(request: string, tasks: TaskDefinition[]): AgentPlan;
  getPlan(): AgentPlan | null;
  updatePlanStatus(status: AgentPlan["status"]): void;

  // Task management (implements recommendation #3)
  updateTaskStatus(
    taskId: string,
    status: AgentTask["status"],
    result?: any,
  ): void;
  getTask(taskId: string): AgentTask | null;
  getNextPendingTask(): AgentTask | null;
  getTasksByStatus(status: AgentTask["status"]): AgentTask[];

  // Inter-agent context sharing (implements recommendation #4)
  setSharedContext(key: string, value: any): void;
  getSharedContext<T = any>(key: string): T | undefined;
  getAllSharedContext(): Record<string, any>;
  clearSharedContext(): void;

  // Progress tracking
  calculateProgress(): number;

  // Tool call tracking (prevents infinite loops)
  trackToolCall(toolName: string): {
    allowed: boolean;
    count: number;
    limit: number;
  };
  getToolCallCounts(): Record<string, number>;
  resetToolCallCounts(): void;

  // Serialization for persistence
  serialize(): string;
  deserialize(data: string): void;
}

/**
 * Creates an agent context manager for managing state during agent execution
 * This enables the agent to:
 * - Create and track execution plans
 * - Update task status dynamically
 * - Share context between steps and sub-agents
 */
// Maximum calls per tool to prevent infinite loops
const MAX_TOOL_CALLS_PER_TOOL = 10;

// Some tools are allowed more calls (planning tools that need multiple updates)
const TOOL_CALL_LIMITS: Record<string, number> = {
  updateTaskStatus: 25, // Needs to be called for each task (in-progress + completed)
  setContext: 20,
  getContext: 30,
  getAllContext: 10,
  getPlanStatus: 15,
  getNextTask: 15,
  sandbox: 30, // Sandbox needs multiple calls for file operations, code execution, etc.
  // All other tools default to MAX_TOOL_CALLS_PER_TOOL (10)
};

export function createAgentContext(): AgentContextManager {
  let plan: AgentPlan | null = null;
  const sharedContext = new Map<string, any>();
  const toolCallCounts = new Map<string, number>();

  const manager: AgentContextManager = {
    createPlan(request: string, taskDefs: TaskDefinition[]): AgentPlan {
      const now = new Date().toISOString();
      const planId = `plan-${nanoid()}`;

      plan = {
        id: planId,
        request,
        tasks: taskDefs.map((t, i) => ({
          ...t,
          id: `${planId}-task-${i}`,
          status: "pending" as const,
          createdAt: now,
          updatedAt: now,
        })),
        progress: 0,
        status: "planning",
        createdAt: now,
        updatedAt: now,
      };

      return plan;
    },

    getPlan(): AgentPlan | null {
      return plan;
    },

    updatePlanStatus(status: AgentPlan["status"]): void {
      if (!plan) return;
      plan.status = status;
      plan.updatedAt = new Date().toISOString();
    },

    updateTaskStatus(
      taskId: string,
      status: AgentTask["status"],
      result?: any,
    ): void {
      if (!plan) return;

      const task = plan.tasks.find((t) => t.id === taskId);
      if (!task) return;

      task.status = status;
      task.updatedAt = new Date().toISOString();

      if (result !== undefined) {
        if (status === "failed") {
          task.error =
            typeof result === "string" ? result : JSON.stringify(result);
        } else {
          task.result = result;
        }
      }

      // Recalculate progress
      plan.progress = manager.calculateProgress();
      plan.updatedAt = new Date().toISOString();

      // Auto-update plan status based on tasks
      const allCompleted = plan.tasks.every((t) => t.status === "completed");
      const anyFailed = plan.tasks.some((t) => t.status === "failed");
      const anyBlocked = plan.tasks.some((t) => t.status === "blocked");
      const anyInProgress = plan.tasks.some((t) => t.status === "in-progress");

      if (allCompleted) {
        plan.status = "completed";
      } else if (anyFailed && !anyInProgress) {
        plan.status = "failed";
      } else if (anyInProgress || anyBlocked) {
        plan.status = "executing";
      }
    },

    getTask(taskId: string): AgentTask | null {
      return plan?.tasks.find((t) => t.id === taskId) ?? null;
    },

    getNextPendingTask(): AgentTask | null {
      return plan?.tasks.find((t) => t.status === "pending") ?? null;
    },

    getTasksByStatus(status: AgentTask["status"]): AgentTask[] {
      return plan?.tasks.filter((t) => t.status === status) ?? [];
    },

    setSharedContext(key: string, value: any): void {
      sharedContext.set(key, value);
    },

    getSharedContext<T = any>(key: string): T | undefined {
      return sharedContext.get(key) as T | undefined;
    },

    getAllSharedContext(): Record<string, any> {
      const result: Record<string, any> = {};
      sharedContext.forEach((value, key) => {
        result[key] = value;
      });
      return result;
    },

    clearSharedContext(): void {
      sharedContext.clear();
    },

    calculateProgress(): number {
      if (!plan || plan.tasks.length === 0) return 0;
      const completed = plan.tasks.filter(
        (t) => t.status === "completed",
      ).length;
      return Math.round((completed / plan.tasks.length) * 100);
    },

    trackToolCall(toolName: string): {
      allowed: boolean;
      count: number;
      limit: number;
    } {
      const currentCount = (toolCallCounts.get(toolName) || 0) + 1;
      toolCallCounts.set(toolName, currentCount);

      const limit = TOOL_CALL_LIMITS[toolName] ?? MAX_TOOL_CALLS_PER_TOOL;
      const allowed = currentCount <= limit;

      return { allowed, count: currentCount, limit };
    },

    getToolCallCounts(): Record<string, number> {
      const result: Record<string, number> = {};
      toolCallCounts.forEach((count, name) => {
        result[name] = count;
      });
      return result;
    },

    resetToolCallCounts(): void {
      toolCallCounts.clear();
    },

    serialize(): string {
      return JSON.stringify({
        plan,
        sharedContext: Object.fromEntries(sharedContext),
      });
    },

    deserialize(data: string): void {
      try {
        const parsed = JSON.parse(data);
        if (parsed.plan) {
          plan = parsed.plan;
        }
        if (parsed.sharedContext) {
          sharedContext.clear();
          Object.entries(parsed.sharedContext).forEach(([key, value]) => {
            sharedContext.set(key, value);
          });
        }
      } catch {
        // Ignore parse errors
      }
    },
  };

  return manager;
}

/**
 * Helper to gather context for sub-agents
 * Selectively extracts context values by key for passing to sub-agents
 */
export function gatherContextForSubAgent(
  ctx: AgentContextManager,
  keys?: string[],
): Record<string, any> {
  if (!keys || keys.length === 0) {
    return {};
  }

  const result: Record<string, any> = {};
  keys.forEach((key) => {
    const value = ctx.getSharedContext(key);
    if (value !== undefined) {
      result[key] = value;
    }
  });

  return result;
}
