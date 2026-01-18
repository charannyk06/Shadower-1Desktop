import "server-only";
import type { Tool } from "ai";
import type { Agent } from "app-types/agent";
import type { ChatModel } from "app-types/chat";

/**
 * Result from spawning a sub-agent
 */
export type SpawnAgentResult = {
  agentId: string;
  agentName: string;
  result: string;
  steps?: number;
  error?: string;
};

/**
 * Result from parallel agent execution
 */
export type ParallelAgentResult = {
  totalTasks: number;
  completed: number;
  results: SpawnAgentResult[];
};

/**
 * Configuration for creating an orchestrator agent
 */
export type OrchestratorConfig = {
  userId: string;
  /** Thread ID for browser session association (required for sub-agents using browser tools) */
  threadId?: string;
  chatModel?: ChatModel;
  availableTools: Record<string, Tool>;
  mcpTools: Record<string, Tool>;
  userAgent?: Agent | null;
  maxSteps?: number;
};

/**
 * Context passed to agent tools for execution
 */
export type AgentToolContext = {
  userId: string;
  abortSignal?: AbortSignal;
};

/**
 * Tool names for orchestrator-specific tools
 */
export const OrchestratorToolName = {
  SpawnAgent: "spawnUserAgent",
  SpawnParallel: "spawnParallelAgents",
  CreatePlan: "createPlan",
  UpdateTaskStatus: "updateTaskStatus",
  GetNextTask: "getNextTask",
  GetPlanStatus: "getPlanStatus",
  SetContext: "setContext",
  GetContext: "getContext",
  GetAllContext: "getAllContext",
} as const;

export type OrchestratorToolName =
  (typeof OrchestratorToolName)[keyof typeof OrchestratorToolName];
