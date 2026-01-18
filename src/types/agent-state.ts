import { z } from "zod";

/**
 * Agent execution status
 */
export const AgentExecutionStatusSchema = z.enum([
  "planning",
  "executing",
  "paused",
  "completed",
  "failed",
]);

export type AgentExecutionStatus = z.infer<typeof AgentExecutionStatusSchema>;

/**
 * Task status for agent tasks
 */
export const AgentTaskStatusSchema = z.enum([
  "pending",
  "in-progress",
  "completed",
  "failed",
  "blocked",
]);

export type AgentTaskStatus = z.infer<typeof AgentTaskStatusSchema>;

/**
 * Agent task definition
 */
export const AgentTaskSchema = z.object({
  id: z.string(),
  description: z.string(),
  status: AgentTaskStatusSchema,
  assignedAgent: z.string().optional(),
  parentTaskId: z.string().optional(),
  result: z.unknown().optional(),
  error: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type AgentTask = z.infer<typeof AgentTaskSchema>;

/**
 * Agent plan definition
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

export type AgentPlan = z.infer<typeof AgentPlanSchema>;

/**
 * Persisted agent state
 */
export type AgentState = {
  id: string;
  userId: string;
  threadId?: string | null;
  planData?: AgentPlan | null;
  sharedContext?: Record<string, unknown> | null;
  status: AgentExecutionStatus;
  errorMessage?: string | null;
  stepsExecuted: number;
  maxSteps: number;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Input for creating a new agent state
 */
export const AgentStateCreateSchema = z.object({
  userId: z.string().uuid(),
  threadId: z.string().uuid().optional(),
  planData: AgentPlanSchema.optional(),
  sharedContext: z.record(z.string(), z.unknown()).optional(),
  status: AgentExecutionStatusSchema.default("planning"),
  maxSteps: z.number().int().positive().default(50),
});

export type AgentStateCreate = z.infer<typeof AgentStateCreateSchema>;

/**
 * Input for updating agent state
 */
export const AgentStateUpdateSchema = z.object({
  planData: AgentPlanSchema.optional(),
  sharedContext: z.record(z.string(), z.unknown()).optional(),
  status: AgentExecutionStatusSchema.optional(),
  errorMessage: z.string().optional().nullable(),
  stepsExecuted: z.number().int().nonnegative().optional(),
});

export type AgentStateUpdate = z.infer<typeof AgentStateUpdateSchema>;

/**
 * Agent state repository interface
 */
export type AgentStateRepository = {
  /**
   * Create a new agent state
   */
  create(data: AgentStateCreate): Promise<AgentState>;

  /**
   * Get agent state by ID
   */
  getById(id: string): Promise<AgentState | null>;

  /**
   * Get agent state by thread ID (for resuming agent in chat context)
   */
  getByThreadId(threadId: string): Promise<AgentState | null>;

  /**
   * Get active agent states for a user
   */
  getActiveByUserId(userId: string): Promise<AgentState[]>;

  /**
   * Update agent state
   */
  update(id: string, data: AgentStateUpdate): Promise<AgentState>;

  /**
   * Delete agent state
   */
  delete(id: string): Promise<void>;

  /**
   * Delete completed/failed agent states older than specified time
   * (cleanup utility)
   */
  deleteOlderThan(olderThanDays: number): Promise<number>;

  /**
   * Increment steps executed and check if max reached
   * Returns true if max steps NOT yet reached (can continue)
   */
  incrementSteps(id: string): Promise<boolean>;
};
