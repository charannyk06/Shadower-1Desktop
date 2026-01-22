import type { UIMessage } from "ai";
import type { Agent } from "app-types/agent";
import type { ChatMetadata } from "app-types/chat";
import type { MCPServerConfig } from "app-types/mcp";
import type { UserPreferences } from "app-types/user";
import type { DBEdge, DBNode, DBWorkflow } from "app-types/workflow";
import type { TipTapMentionJsonContent } from "@/types/util";
import {
  integer,
  sqliteTable,
  text,
  unique,
  index,
} from "drizzle-orm/sqlite-core";
import { randomUUID } from "crypto";

// Helper to generate default timestamps
const currentTimestamp = () => new Date();

// ============================================================================
// User and Authentication Tables
// ============================================================================

// User Table - Core authentication
export const UserTable = sqliteTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" })
    .notNull()
    .default(false),
  password: text("password"), // For credential-based auth
  image: text("image"),
  preferences: text("preferences", { mode: "json" }).$type<UserPreferences>(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
    currentTimestamp,
  ),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(
    currentTimestamp,
  ),
});

// Session Table - For auth sessions
export const SessionTable = sqliteTable("session", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
    currentTimestamp,
  ),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(
    currentTimestamp,
  ),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => UserTable.id, { onDelete: "cascade" }),
});

// Account Table - OAuth accounts
export const AccountTable = sqliteTable("account", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => UserTable.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", {
    mode: "timestamp",
  }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", {
    mode: "timestamp",
  }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
    currentTimestamp,
  ),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(
    currentTimestamp,
  ),
});

// Verification Table - Email verification
export const VerificationTable = sqliteTable("verification", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
    currentTimestamp,
  ),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(
    currentTimestamp,
  ),
});

// ============================================================================
// Chat Tables
// ============================================================================

// Chat Thread Table
export const ChatThreadTable = sqliteTable("chat_thread", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  title: text("title").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => UserTable.id, { onDelete: "cascade" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
    currentTimestamp,
  ),
});

// Chat Message Table
export const ChatMessageTable = sqliteTable("chat_message", {
  id: text("id").primaryKey().notNull(),
  threadId: text("thread_id")
    .notNull()
    .references(() => ChatThreadTable.id, { onDelete: "cascade" }),
  role: text("role").notNull().$type<UIMessage["role"]>(),
  parts: text("parts", { mode: "json" }).notNull().$type<UIMessage["parts"]>(),
  metadata: text("metadata", { mode: "json" }).$type<ChatMetadata>(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
    currentTimestamp,
  ),
});

// Conversation Summary Table (for context compaction)
export const ConversationSummaryTable = sqliteTable(
  "conversation_summary",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    threadId: text("thread_id")
      .notNull()
      .references(() => ChatThreadTable.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    summary: text("summary").notNull(),
    messagesCompacted: integer("messages_compacted").notNull(),
    tokensSaved: integer("tokens_saved").notNull(),
    summaryTokens: integer("summary_tokens").notNull().default(0),
    parentSummaryId: text("parent_summary_id"),
    sequenceNumber: integer("sequence_number").notNull().default(1),
    modelProvider: text("model_provider"),
    modelName: text("model_name"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
      currentTimestamp,
    ),
  },
  (table) => ({
    threadIdx: index("conversation_summary_thread_idx").on(table.threadId),
    userIdx: index("conversation_summary_user_idx").on(table.userId),
    sequenceIdx: index("conversation_summary_sequence_idx").on(
      table.threadId,
      table.sequenceNumber,
    ),
  }),
);

// ============================================================================
// Agent Tables
// ============================================================================

// Agent Table
export const AgentTable = sqliteTable("agent", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  name: text("name").notNull(),
  description: text("description"),
  icon: text("icon", { mode: "json" }).$type<Agent["icon"]>(),
  userId: text("user_id")
    .notNull()
    .references(() => UserTable.id, { onDelete: "cascade" }),
  instructions: text("instructions", { mode: "json" }).$type<
    Agent["instructions"]
  >(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
    currentTimestamp,
  ),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(
    currentTimestamp,
  ),
});

// Agent State Table - For autonomous agent execution persistence
export const AgentStateTable = sqliteTable(
  "agent_state",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    threadId: text("thread_id").references(() => ChatThreadTable.id, {
      onDelete: "set null",
    }),
    planData: text("plan_data", { mode: "json" }).$type<{
      id: string;
      request: string;
      tasks: Array<{
        id: string;
        description: string;
        status: "pending" | "in-progress" | "completed" | "failed" | "blocked";
        assignedAgent?: string;
        parentTaskId?: string;
        result?: unknown;
        error?: string;
        createdAt: string;
        updatedAt: string;
      }>;
      progress: number;
      status: "planning" | "executing" | "completed" | "failed";
      createdAt: string;
      updatedAt: string;
    }>(),
    sharedContext: text("shared_context", { mode: "json" }).$type<
      Record<string, unknown>
    >(),
    status: text("status", {
      enum: ["planning", "executing", "paused", "completed", "failed"],
    })
      .notNull()
      .default("planning"),
    errorMessage: text("error_message"),
    stepsExecuted: integer("steps_executed").notNull().default(0),
    maxSteps: integer("max_steps").notNull().default(50),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
      currentTimestamp,
    ),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(
      currentTimestamp,
    ),
  },
  (table) => ({
    userIdx: index("agent_state_user_id_idx").on(table.userId),
    threadIdx: index("agent_state_thread_id_idx").on(table.threadId),
    statusIdx: index("agent_state_status_idx").on(table.status),
  }),
);

// Agent Execution Log Table
export const AgentExecutionLogTable = sqliteTable(
  "agent_execution_log",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    agentStateId: text("agent_state_id")
      .notNull()
      .references(() => AgentStateTable.id, { onDelete: "cascade" }),
    stepNumber: integer("step_number").notNull(),
    actionType: text("action_type", {
      enum: [
        "tool_call",
        "tool_result",
        "plan_create",
        "plan_update",
        "task_update",
        "context_set",
        "sub_agent_spawn",
        "sub_agent_complete",
        "error",
        "completion",
      ],
    }).notNull(),
    actionName: text("action_name"),
    input: text("input", { mode: "json" }).$type<Record<string, unknown>>(),
    output: text("output", { mode: "json" }).$type<unknown>(),
    durationMs: integer("duration_ms"),
    tokensUsed: text("tokens_used", { mode: "json" }).$type<{
      input?: number;
      output?: number;
      total?: number;
    }>(),
    error: text("error"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
      currentTimestamp,
    ),
  },
  (table) => ({
    stateIdx: index("agent_exec_log_state_id_idx").on(table.agentStateId),
    stepIdx: index("agent_exec_log_step_idx").on(
      table.agentStateId,
      table.stepNumber,
    ),
    actionTypeIdx: index("agent_exec_log_action_type_idx").on(table.actionType),
    createdIdx: index("agent_exec_log_created_idx").on(table.createdAt),
  }),
);

// Agent Checkpoint Table
export const AgentCheckpointTable = sqliteTable(
  "agent_checkpoint",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    agentStateId: text("agent_state_id")
      .notNull()
      .references(() => AgentStateTable.id, { onDelete: "cascade" }),
    checkpointNumber: integer("checkpoint_number").notNull(),
    stepNumber: integer("step_number").notNull(),
    reason: text("reason", {
      enum: [
        "periodic",
        "before_risky_tool",
        "after_task_complete",
        "before_sub_agent",
        "manual",
        "error_recovery",
      ],
    }).notNull(),
    stateSnapshot: text("state_snapshot", { mode: "json" }).notNull().$type<{
      planData: unknown;
      sharedContext: Record<string, unknown>;
      stepsExecuted: number;
    }>(),
    usedForRecovery: integer("used_for_recovery", { mode: "boolean" })
      .notNull()
      .default(false),
    metadata: text("metadata", { mode: "json" }).$type<{
      tokensUsedSoFar?: number;
      tasksCompleted?: number;
      totalTasks?: number;
    }>(),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
      currentTimestamp,
    ),
  },
  (table) => ({
    stateIdx: index("agent_checkpoint_state_id_idx").on(table.agentStateId),
    numberIdx: index("agent_checkpoint_number_idx").on(
      table.agentStateId,
      table.checkpointNumber,
    ),
    stepIdx: index("agent_checkpoint_step_idx").on(
      table.agentStateId,
      table.stepNumber,
    ),
  }),
);

// Agent Tool Execution Table
export const AgentToolExecutionTable = sqliteTable(
  "agent_tool_execution",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    agentStateId: text("agent_state_id")
      .notNull()
      .references(() => AgentStateTable.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    toolName: text("tool_name").notNull(),
    toolSource: text("tool_source", {
      enum: ["built_in", "mcp", "workflow", "agent_context"],
    }).notNull(),
    mcpServerId: text("mcp_server_id").references(() => McpServerTable.id, {
      onDelete: "set null",
    }),
    input: text("input", { mode: "json" }).$type<Record<string, unknown>>(),
    output: text("output", { mode: "json" }).$type<unknown>(),
    success: integer("success", { mode: "boolean" }).notNull(),
    error: text("error"),
    durationMs: integer("duration_ms"),
    cost: text("cost"),
    startedAt: integer("started_at", { mode: "timestamp" }).$defaultFn(
      currentTimestamp,
    ),
    completedAt: integer("completed_at", { mode: "timestamp" }),
  },
  (table) => ({
    stateIdx: index("agent_tool_exec_state_id_idx").on(table.agentStateId),
    userIdx: index("agent_tool_exec_user_id_idx").on(table.userId),
    toolNameIdx: index("agent_tool_exec_tool_name_idx").on(table.toolName),
    sourceIdx: index("agent_tool_exec_source_idx").on(table.toolSource),
    startedIdx: index("agent_tool_exec_started_idx").on(table.startedAt),
    successIdx: index("agent_tool_exec_success_idx").on(table.success),
  }),
);

// Agent Sub-Agent Relation Table
export const AgentSubAgentRelationTable = sqliteTable(
  "agent_sub_agent_relation",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    parentAgentStateId: text("parent_agent_state_id")
      .notNull()
      .references(() => AgentStateTable.id, { onDelete: "cascade" }),
    childAgentStateId: text("child_agent_state_id")
      .notNull()
      .references(() => AgentStateTable.id, { onDelete: "cascade" }),
    parentTaskId: text("parent_task_id"),
    instructions: text("instructions"),
    contextKeys: text("context_keys", { mode: "json" }).$type<string[]>(),
    status: text("status", {
      enum: ["spawned", "running", "completed", "failed", "cancelled"],
    })
      .notNull()
      .default("spawned"),
    result: text("result", { mode: "json" }).$type<unknown>(),
    spawnedAt: integer("spawned_at", { mode: "timestamp" }).$defaultFn(
      currentTimestamp,
    ),
    completedAt: integer("completed_at", { mode: "timestamp" }),
  },
  (table) => ({
    parentIdx: index("agent_sub_agent_parent_idx").on(table.parentAgentStateId),
    childIdx: index("agent_sub_agent_child_idx").on(table.childAgentStateId),
    statusIdx: index("agent_sub_agent_status_idx").on(table.status),
  }),
);

// ============================================================================
// MCP Server Tables
// ============================================================================

// MCP Server Table
export const McpServerTable = sqliteTable("mcp_server", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  name: text("name").notNull(),
  config: text("config", { mode: "json" }).notNull().$type<MCPServerConfig>(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  userId: text("user_id")
    .notNull()
    .references(() => UserTable.id, { onDelete: "cascade" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
    currentTimestamp,
  ),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(
    currentTimestamp,
  ),
});

// MCP Tool Customization Table
export const McpToolCustomizationTable = sqliteTable(
  "mcp_server_tool_custom_instructions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    toolName: text("tool_name").notNull(),
    mcpServerId: text("mcp_server_id")
      .notNull()
      .references(() => McpServerTable.id, { onDelete: "cascade" }),
    prompt: text("prompt"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
      currentTimestamp,
    ),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(
      currentTimestamp,
    ),
  },
  (table) => ({
    uniqueToolCustomization: unique().on(
      table.userId,
      table.toolName,
      table.mcpServerId,
    ),
  }),
);

// MCP Server Customization Table
export const McpServerCustomizationTable = sqliteTable(
  "mcp_server_custom_instructions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    mcpServerId: text("mcp_server_id")
      .notNull()
      .references(() => McpServerTable.id, { onDelete: "cascade" }),
    prompt: text("prompt"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
      currentTimestamp,
    ),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(
      currentTimestamp,
    ),
  },
  (table) => ({
    uniqueServerCustomization: unique().on(table.userId, table.mcpServerId),
  }),
);

// MCP OAuth Session Table
export const McpOAuthSessionTable = sqliteTable(
  "mcp_oauth_session",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    mcpServerId: text("mcp_server_id")
      .notNull()
      .references(() => McpServerTable.id, { onDelete: "cascade" }),
    serverUrl: text("server_url").notNull(),
    clientInfo: text("client_info", { mode: "json" }),
    tokens: text("tokens", { mode: "json" }),
    codeVerifier: text("code_verifier"),
    state: text("state").unique(),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
      currentTimestamp,
    ),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(
      currentTimestamp,
    ),
  },
  (table) => ({
    serverIdIdx: index("mcp_oauth_session_server_id_idx").on(table.mcpServerId),
    stateIdx: index("mcp_oauth_session_state_idx").on(table.state),
  }),
);

// ============================================================================
// Workflow Tables
// ============================================================================

// Workflow Table
export const WorkflowTable = sqliteTable("workflow", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  version: text("version").notNull().default("0.1.0"),
  name: text("name").notNull(),
  icon: text("icon", { mode: "json" }).$type<DBWorkflow["icon"]>(),
  description: text("description"),
  isPublished: integer("is_published", { mode: "boolean" })
    .notNull()
    .default(false),
  userId: text("user_id")
    .notNull()
    .references(() => UserTable.id, { onDelete: "cascade" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
    currentTimestamp,
  ),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(
    currentTimestamp,
  ),
});

// Workflow Node Data Table
export const WorkflowNodeDataTable = sqliteTable(
  "workflow_node",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    version: text("version").notNull().default("0.1.0"),
    workflowId: text("workflow_id")
      .notNull()
      .references(() => WorkflowTable.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    uiConfig: text("ui_config", { mode: "json" })
      .$type<DBNode["uiConfig"]>()
      .default({}),
    nodeConfig: text("node_config", { mode: "json" })
      .$type<Partial<DBNode["nodeConfig"]>>()
      .default({}),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
      currentTimestamp,
    ),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(
      currentTimestamp,
    ),
  },
  (table) => ({
    kindIdx: index("workflow_node_kind_idx").on(table.kind),
  }),
);

// Workflow Edge Table
export const WorkflowEdgeTable = sqliteTable("workflow_edge", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  version: text("version").notNull().default("0.1.0"),
  workflowId: text("workflow_id")
    .notNull()
    .references(() => WorkflowTable.id, { onDelete: "cascade" }),
  source: text("source").notNull(),
  target: text("target").notNull(),
  uiConfig: text("ui_config", { mode: "json" })
    .$type<DBEdge["uiConfig"]>()
    .default({}),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
    currentTimestamp,
  ),
});

// ============================================================================
// Thread File Context (for per-thread file persistence in local execution)
// ============================================================================

export interface ThreadFileMetadata {
  name: string;
  size: number;
  type: string;
  source: "user" | "generated";
  storageKey?: string;
  url?: string;
  localPath?: string;
  uploadedAt: string;
}

export const ThreadFileContextTable = sqliteTable(
  "thread_file_context",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    threadId: text("thread_id")
      .notNull()
      .unique()
      .references(() => ChatThreadTable.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    contextStorageKey: text("context_storage_key"),
    contextSizeBytes: text("context_size_bytes").notNull().default("0"),
    fileMetadata: text("file_metadata", { mode: "json" })
      .$type<ThreadFileMetadata[]>()
      .default([]),
    totalFilesCount: integer("total_files_count").notNull().default(0),
    lastExecutionAt: integer("last_execution_at", { mode: "timestamp" }),
    lastAccessedAt: integer("last_accessed_at", {
      mode: "timestamp",
    }).$defaultFn(currentTimestamp),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
      currentTimestamp,
    ),
  },
  (table) => ({
    threadIdx: index("thread_file_context_thread_idx").on(table.threadId),
    userIdx: index("thread_file_context_user_idx").on(table.userId),
    cleanupIdx: index("thread_file_context_cleanup_idx").on(
      table.lastAccessedAt,
    ),
  }),
);

// Legacy alias for backwards compatibility (deprecated - use ThreadFileContextTable)
export const ThreadWorkspaceContextTable = ThreadFileContextTable;

// ============================================================================
// Browser Sessions
// ============================================================================

export const BrowserSessionTable = sqliteTable(
  "browser_session",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    threadId: text("thread_id").references(() => ChatThreadTable.id, {
      onDelete: "cascade",
    }),
    userId: text("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    provider: text("provider", {
      enum: ["chrome-devtools", "local-terminal"],
    }).notNull(),
    sessionId: text("session_id").notNull(),
    status: text("status", {
      enum: ["active", "closed", "error", "expired"],
    })
      .notNull()
      .default("active"),
    currentUrl: text("current_url"),
    replayUrl: text("replay_url"),
    screenshots: text("screenshots", { mode: "json" })
      .$type<
        Array<{
          id: string;
          timestamp: string;
          url?: string;
          storageKey?: string;
          thumbnail?: string;
        }>
      >()
      .default([]),
    metadata: text("metadata", { mode: "json" }).$type<{
      browserType?: string;
      viewport?: { width: number; height: number };
      stealth?: boolean;
      proxy?: boolean;
      error?: string;
      closeReason?: string;
    }>(),
    lastActivityAt: integer("last_activity_at", {
      mode: "timestamp",
    }).$defaultFn(currentTimestamp),
    expiresAt: integer("expires_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
      currentTimestamp,
    ),
    closedAt: integer("closed_at", { mode: "timestamp" }),
  },
  (table) => ({
    threadIdx: index("browser_session_thread_idx").on(table.threadId),
    userIdx: index("browser_session_user_idx").on(table.userId),
    providerIdx: index("browser_session_provider_idx").on(table.provider),
    statusIdx: index("browser_session_status_idx").on(table.status),
    sessionIdIdx: index("browser_session_session_id_idx").on(table.sessionId),
    expiresIdx: index("browser_session_expires_idx").on(table.expiresAt),
    activityIdx: index("browser_session_activity_idx").on(table.lastActivityAt),
    cleanupIdx: index("browser_session_cleanup_idx").on(
      table.status,
      table.expiresAt,
    ),
  }),
);

// ============================================================================
// Research Tasks (for Deep Research Agent)
// ============================================================================

export interface ResearchSource {
  id: string;
  url: string;
  title: string;
  domain: string;
  visitedAt: string;
  extractedContent?: string;
  reliability?: "high" | "medium" | "low";
  screenshotKey?: string;
}

export interface ResearchFinding {
  id: string;
  content: string;
  sourceIds: string[];
  confidence: number;
  category?: string;
  createdAt: string;
}

export interface ResearchCitation {
  id: string;
  text: string;
  sourceId: string;
  sourceUrl: string;
  sourceTitle: string;
}

export const ResearchTaskTable = sqliteTable(
  "research_task",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    threadId: text("thread_id").references(() => ChatThreadTable.id, {
      onDelete: "cascade",
    }),
    userId: text("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    query: text("query").notNull(),
    depth: text("depth", {
      enum: ["quick", "standard", "comprehensive"],
    })
      .notNull()
      .default("standard"),
    status: text("status", {
      enum: [
        "pending",
        "planning",
        "searching",
        "extracting",
        "analyzing",
        "synthesizing",
        "completed",
        "failed",
      ],
    })
      .notNull()
      .default("pending"),
    currentStep: text("current_step"),
    progress: integer("progress").notNull().default(0),
    sources: text("sources", { mode: "json" })
      .$type<ResearchSource[]>()
      .default([]),
    findings: text("findings", { mode: "json" })
      .$type<ResearchFinding[]>()
      .default([]),
    citations: text("citations", { mode: "json" })
      .$type<ResearchCitation[]>()
      .default([]),
    report: text("report"),
    error: text("error"),
    browserSessionId: text("browser_session_id").references(
      () => BrowserSessionTable.id,
      { onDelete: "set null" },
    ),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
      currentTimestamp,
    ),
    completedAt: integer("completed_at", { mode: "timestamp" }),
  },
  (table) => ({
    threadIdx: index("research_task_thread_idx").on(table.threadId),
    userIdx: index("research_task_user_idx").on(table.userId),
    statusIdx: index("research_task_status_idx").on(table.status),
    createdIdx: index("research_task_created_idx").on(table.createdAt),
  }),
);

// ============================================================================
// Vector Search Index Tracking
// ============================================================================

export const VectorIndexTable = sqliteTable(
  "vector_index",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    pointId: text("point_id").notNull().unique(), // Local vector DB point ID
    collectionName: text("collection_name").notNull(),
    entityType: text("entity_type", {
      enum: ["document", "message", "knowledge"],
    }).notNull(),
    entityId: text("entity_id").notNull(),
    userId: text("user_id").references(() => UserTable.id, {
      onDelete: "cascade",
    }),
    metadata: text("metadata", { mode: "json" }).$type<
      Record<string, unknown>
    >(),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
      currentTimestamp,
    ),
  },
  (table) => ({
    pointIdx: index("vector_index_point_idx").on(table.pointId),
    entityIdx: index("vector_index_entity_idx").on(
      table.entityType,
      table.entityId,
    ),
    userIdx: index("vector_index_user_idx").on(table.userId),
    collectionIdx: index("vector_index_collection_idx").on(
      table.collectionName,
    ),
  }),
);

// ============================================================================
// Models & Provider Configuration Tables
// ============================================================================

// Provider Configuration Table - Store custom provider configurations
export const ProviderConfigTable = sqliteTable(
  "provider_config",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    name: text("name").notNull(),
    providerId: text("provider_id").notNull(), // openai, anthropic, ollama, lmstudio, custom, etc.
    type: text("type", { enum: ["cloud", "local"] }).notNull(),
    baseUrl: text("base_url"),
    authType: text("auth_type", { enum: ["api-key", "oauth", "none"] })
      .notNull()
      .default("api-key"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    status: text("status", {
      enum: ["connected", "disconnected", "testing", "error", "disabled"],
    })
      .notNull()
      .default("disconnected"),
    lastTestedAt: integer("last_tested_at", { mode: "timestamp" }),
    errorMessage: text("error_message"),
    metadata: text("metadata", { mode: "json" }).$type<
      Record<string, unknown>
    >(),
    userId: text("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
      currentTimestamp,
    ),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(
      currentTimestamp,
    ),
  },
  (table) => ({
    userIdx: index("provider_config_user_idx").on(table.userId),
    providerIdx: index("provider_config_provider_idx").on(table.providerId),
    typeIdx: index("provider_config_type_idx").on(table.type),
    enabledIdx: index("provider_config_enabled_idx").on(table.enabled),
    uniqueUserProvider: unique("provider_config_unique_user_provider").on(
      table.userId,
      table.providerId,
    ),
  }),
);

// Local Model Table - Store local model metadata
export const LocalModelTable = sqliteTable(
  "local_model",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    name: text("name").notNull(), // Model identifier (e.g., "llama3.3", "mistral-7b")
    displayName: text("display_name").notNull(),
    providerId: text("provider_id").notNull(), // ollama, lmstudio, custom-local
    providerConfigId: text("provider_config_id").references(
      () => ProviderConfigTable.id,
      { onDelete: "set null" },
    ),
    path: text("path"), // File path for local model files
    size: integer("size"), // Size in bytes
    quantization: text("quantization"), // e.g., "Q4_K_M", "Q8_0"
    family: text("family"), // e.g., "llama", "mistral", "qwen"
    status: text("status", {
      enum: ["available", "downloading", "validating", "error", "disabled"],
    })
      .notNull()
      .default("available"),
    isVision: integer("is_vision", { mode: "boolean" })
      .notNull()
      .default(false),
    isToolCallSupported: integer("is_tool_call_supported", { mode: "boolean" })
      .notNull()
      .default(true),
    downloadProgress: integer("download_progress"), // 0-100
    errorMessage: text("error_message"),
    metadata: text("metadata", { mode: "json" }).$type<
      Record<string, unknown>
    >(),
    userId: text("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
      currentTimestamp,
    ),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(
      currentTimestamp,
    ),
  },
  (table) => ({
    userIdx: index("local_model_user_idx").on(table.userId),
    providerIdx: index("local_model_provider_idx").on(table.providerId),
    statusIdx: index("local_model_status_idx").on(table.status),
    nameIdx: index("local_model_name_idx").on(table.name),
    uniqueUserModel: unique("local_model_unique_user_model").on(
      table.userId,
      table.providerId,
      table.name,
    ),
  }),
);

// API Keys Table - Store encrypted API keys separately for security
// Note: In production, consider using Electron's safeStorage for additional encryption
export const ApiKeyTable = sqliteTable(
  "api_key",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    providerId: text("provider_id").notNull(),
    encryptedKey: text("encrypted_key").notNull(),
    keyHint: text("key_hint"), // Last 4 characters for display (e.g., "...abc1")
    isValid: integer("is_valid", { mode: "boolean" }).notNull().default(false),
    lastValidatedAt: integer("last_validated_at", { mode: "timestamp" }),
    errorMessage: text("error_message"),
    userId: text("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
      currentTimestamp,
    ),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(
      currentTimestamp,
    ),
  },
  (table) => ({
    userIdx: index("api_key_user_idx").on(table.userId),
    providerIdx: index("api_key_provider_idx").on(table.providerId),
    uniqueUserProvider: unique("api_key_unique_user_provider").on(
      table.userId,
      table.providerId,
    ),
  }),
);

// ============================================================================
// Type Exports
// ============================================================================

// Select types (for reading from database)
export type UserEntity = typeof UserTable.$inferSelect;
export type SessionEntity = typeof SessionTable.$inferSelect;
export type AccountEntity = typeof AccountTable.$inferSelect;
export type VerificationEntity = typeof VerificationTable.$inferSelect;
export type ChatThreadEntity = typeof ChatThreadTable.$inferSelect;
export type ChatMessageEntity = typeof ChatMessageTable.$inferSelect;
export type ConversationSummaryEntity =
  typeof ConversationSummaryTable.$inferSelect;
export type AgentEntity = typeof AgentTable.$inferSelect;
export type AgentStateEntity = typeof AgentStateTable.$inferSelect;
export type AgentExecutionLogEntity =
  typeof AgentExecutionLogTable.$inferSelect;
export type AgentCheckpointEntity = typeof AgentCheckpointTable.$inferSelect;
export type AgentToolExecutionEntity =
  typeof AgentToolExecutionTable.$inferSelect;
export type AgentSubAgentRelationEntity =
  typeof AgentSubAgentRelationTable.$inferSelect;
export type McpServerEntity = typeof McpServerTable.$inferSelect;
export type ToolCustomizationEntity =
  typeof McpToolCustomizationTable.$inferSelect;
export type McpServerCustomizationEntity =
  typeof McpServerCustomizationTable.$inferSelect;
export type McpOAuthSessionEntity = typeof McpOAuthSessionTable.$inferSelect;
export type WorkflowEntity = typeof WorkflowTable.$inferSelect;
export type WorkflowNodeDataEntity = typeof WorkflowNodeDataTable.$inferSelect;
export type WorkflowEdgeEntity = typeof WorkflowEdgeTable.$inferSelect;
export type ThreadWorkspaceContextEntity =
  typeof ThreadWorkspaceContextTable.$inferSelect;
export type ThreadFileContextEntity = ThreadWorkspaceContextEntity;
export type BrowserSessionEntity = typeof BrowserSessionTable.$inferSelect;
export type ResearchTaskEntity = typeof ResearchTaskTable.$inferSelect;
export type VectorIndexEntity = typeof VectorIndexTable.$inferSelect;
export type ProviderConfigEntity = typeof ProviderConfigTable.$inferSelect;
export type LocalModelEntity = typeof LocalModelTable.$inferSelect;
export type ApiKeyEntity = typeof ApiKeyTable.$inferSelect;

// Insert types (for inserting into database - includes optional fields with defaults)
export type UserInsert = typeof UserTable.$inferInsert;
export type SessionInsert = typeof SessionTable.$inferInsert;
export type AccountInsert = typeof AccountTable.$inferInsert;
export type VerificationInsert = typeof VerificationTable.$inferInsert;
export type ChatThreadInsert = typeof ChatThreadTable.$inferInsert;
export type ChatMessageInsert = typeof ChatMessageTable.$inferInsert;
export type ConversationSummaryInsert =
  typeof ConversationSummaryTable.$inferInsert;
export type AgentInsert = typeof AgentTable.$inferInsert;
export type AgentStateInsert = typeof AgentStateTable.$inferInsert;
export type AgentExecutionLogInsert =
  typeof AgentExecutionLogTable.$inferInsert;
export type AgentCheckpointInsert = typeof AgentCheckpointTable.$inferInsert;
export type AgentToolExecutionInsert =
  typeof AgentToolExecutionTable.$inferInsert;
export type AgentSubAgentRelationInsert =
  typeof AgentSubAgentRelationTable.$inferInsert;
export type McpServerInsert = typeof McpServerTable.$inferInsert;
export type ToolCustomizationInsert =
  typeof McpToolCustomizationTable.$inferInsert;
export type McpServerCustomizationInsert =
  typeof McpServerCustomizationTable.$inferInsert;
export type McpOAuthSessionInsert = typeof McpOAuthSessionTable.$inferInsert;
export type WorkflowInsert = typeof WorkflowTable.$inferInsert;
export type WorkflowNodeDataInsert = typeof WorkflowNodeDataTable.$inferInsert;
export type WorkflowEdgeInsert = typeof WorkflowEdgeTable.$inferInsert;
export type ThreadWorkspaceContextInsert =
  typeof ThreadWorkspaceContextTable.$inferInsert;
export type BrowserSessionInsert = typeof BrowserSessionTable.$inferInsert;
export type ResearchTaskInsert = typeof ResearchTaskTable.$inferInsert;
export type VectorIndexInsert = typeof VectorIndexTable.$inferInsert;
export type ProviderConfigInsert = typeof ProviderConfigTable.$inferInsert;
export type LocalModelInsert = typeof LocalModelTable.$inferInsert;
export type ApiKeyInsert = typeof ApiKeyTable.$inferInsert;
