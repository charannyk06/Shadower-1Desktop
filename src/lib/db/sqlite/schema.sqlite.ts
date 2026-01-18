import type { TipTapMentionJsonContent } from "@/types/util";
import type { UIMessage } from "ai";
import type { Agent } from "app-types/agent";
import type { ChatMetadata } from "app-types/chat";
import type { MCPServerConfig } from "app-types/mcp";
import type { UserPreferences } from "app-types/user";
import type { DBEdge, DBNode, DBWorkflow } from "app-types/workflow";
import { sql } from "drizzle-orm";
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

// User Table - Core authentication
export const UserTable = sqliteTable("user", {
  id: text("id").primaryKey().$defaultFn(() => randomUUID()),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(currentTimestamp),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(currentTimestamp),
  banned: integer("banned", { mode: "boolean" }).default(false),
  banReason: text("ban_reason"),
  banExpiresAt: integer("ban_expires_at", { mode: "timestamp" }),
  preferences: text("preferences", { mode: "json" }).$type<UserPreferences>(),
  role: text("role", { enum: ["user", "admin"] }).notNull().default("user"),
});

// Session Table - For auth sessions
export const SessionTable = sqliteTable("session", {
  id: text("id").primaryKey().$defaultFn(() => randomUUID()),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  token: text("token").notNull().unique(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => UserTable.id, { onDelete: "cascade" }),
});

// Account Table - OAuth accounts
export const AccountTable = sqliteTable("account", {
  id: text("id").primaryKey().$defaultFn(() => randomUUID()),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => UserTable.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp" }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp" }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(currentTimestamp),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(currentTimestamp),
});

// Verification Table - Email verification
export const VerificationTable = sqliteTable("verification", {
  id: text("id").primaryKey().$defaultFn(() => randomUUID()),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(currentTimestamp),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(currentTimestamp),
});

// Chat Thread Table
export const ChatThreadTable = sqliteTable("chat_thread", {
  id: text("id").primaryKey().$defaultFn(() => randomUUID()),
  title: text("title").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => UserTable.id, { onDelete: "cascade" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(currentTimestamp),
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
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(currentTimestamp),
});

// Agent Table
export const AgentTable = sqliteTable("agent", {
  id: text("id").primaryKey().$defaultFn(() => randomUUID()),
  name: text("name").notNull(),
  description: text("description"),
  icon: text("icon", { mode: "json" }).$type<Agent["icon"]>(),
  userId: text("user_id")
    .notNull()
    .references(() => UserTable.id, { onDelete: "cascade" }),
  instructions: text("instructions", { mode: "json" }).$type<Agent["instructions"]>(),
  visibility: text("visibility", { enum: ["public", "private", "readonly"] })
    .notNull()
    .default("private"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(currentTimestamp),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(currentTimestamp),
});

// Agent State Table - For stateful agents
export const AgentStateTable = sqliteTable("agent_state", {
  id: text("id").primaryKey().$defaultFn(() => randomUUID()),
  agentId: text("agent_id")
    .notNull()
    .references(() => AgentTable.id, { onDelete: "cascade" }),
  threadId: text("thread_id")
    .notNull()
    .references(() => ChatThreadTable.id, { onDelete: "cascade" }),
  state: text("state", { mode: "json" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(currentTimestamp),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(currentTimestamp),
});

// Bookmark Table
export const BookmarkTable = sqliteTable(
  "bookmark",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    itemId: text("item_id").notNull(),
    itemType: text("item_type", { enum: ["agent", "workflow", "mcp"] }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(currentTimestamp),
  },
  (table) => ({
    uniqueBookmark: unique().on(table.userId, table.itemId, table.itemType),
    userIdIdx: index("bookmark_user_id_idx").on(table.userId),
    itemIdx: index("bookmark_item_idx").on(table.itemId, table.itemType),
  })
);

// MCP Server Table
export const McpServerTable = sqliteTable("mcp_server", {
  id: text("id").primaryKey().$defaultFn(() => randomUUID()),
  name: text("name").notNull(),
  config: text("config", { mode: "json" }).notNull().$type<MCPServerConfig>(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  userId: text("user_id")
    .notNull()
    .references(() => UserTable.id, { onDelete: "cascade" }),
  visibility: text("visibility", { enum: ["public", "private"] })
    .notNull()
    .default("private"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(currentTimestamp),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(currentTimestamp),
});

// MCP Tool Customization Table
export const McpToolCustomizationTable = sqliteTable(
  "mcp_tool_customization",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    serverId: text("server_id")
      .notNull()
      .references(() => McpServerTable.id, { onDelete: "cascade" }),
    toolName: text("tool_name").notNull(),
    displayName: text("display_name"),
    description: text("description"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(currentTimestamp),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(currentTimestamp),
  },
  (table) => ({
    uniqueToolCustomization: unique().on(table.userId, table.serverId, table.toolName),
  })
);

// MCP Server Customization Table
export const McpServerCustomizationTable = sqliteTable(
  "mcp_server_customization",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    serverId: text("server_id")
      .notNull()
      .references(() => McpServerTable.id, { onDelete: "cascade" }),
    displayName: text("display_name"),
    description: text("description"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(currentTimestamp),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(currentTimestamp),
  },
  (table) => ({
    uniqueServerCustomization: unique().on(table.userId, table.serverId),
  })
);

// MCP OAuth Session Table
export const McpOAuthSessionTable = sqliteTable("mcp_oauth_session", {
  id: text("id").primaryKey().$defaultFn(() => randomUUID()),
  state: text("state").notNull().unique(),
  serverId: text("server_id")
    .notNull()
    .references(() => McpServerTable.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => UserTable.id, { onDelete: "cascade" }),
  codeVerifier: text("code_verifier"),
  redirectUri: text("redirect_uri").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(currentTimestamp),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
});

// Workflow Table
export const WorkflowTable = sqliteTable("workflow", {
  id: text("id").primaryKey().$defaultFn(() => randomUUID()),
  name: text("name").notNull(),
  description: text("description"),
  userId: text("user_id")
    .notNull()
    .references(() => UserTable.id, { onDelete: "cascade" }),
  data: text("data", { mode: "json" }).notNull().$type<DBWorkflow>(),
  visibility: text("visibility", { enum: ["public", "private", "readonly"] })
    .notNull()
    .default("private"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(currentTimestamp),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(currentTimestamp),
});

// Workflow Node Data Table
export const WorkflowNodeDataTable = sqliteTable(
  "workflow_node_data",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    workflowId: text("workflow_id")
      .notNull()
      .references(() => WorkflowTable.id, { onDelete: "cascade" }),
    nodeId: text("node_id").notNull(),
    nodeType: text("node_type").notNull(),
    data: text("data", { mode: "json" }).notNull().$type<DBNode["data"]>(),
    position: text("position", { mode: "json" }).notNull().$type<{ x: number; y: number }>(),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(currentTimestamp),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(currentTimestamp),
  },
  (table) => ({
    uniqueNode: unique().on(table.workflowId, table.nodeId),
  })
);

// Workflow Edge Table
export const WorkflowEdgeTable = sqliteTable("workflow_edge", {
  id: text("id").primaryKey().notNull(),
  workflowId: text("workflow_id")
    .notNull()
    .references(() => WorkflowTable.id, { onDelete: "cascade" }),
  source: text("source").notNull(),
  target: text("target").notNull(),
  edgeData: text("edge_data", { mode: "json" }).$type<DBEdge>(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(currentTimestamp),
});

// Archive Table
export const ArchiveTable = sqliteTable("archive", {
  id: text("id").primaryKey().$defaultFn(() => randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => UserTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(currentTimestamp),
});

// Archive Item Table
export const ArchiveItemTable = sqliteTable(
  "archive_item",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    archiveId: text("archive_id")
      .notNull()
      .references(() => ArchiveTable.id, { onDelete: "cascade" }),
    itemId: text("item_id").notNull(),
    itemType: text("item_type", { enum: ["agent", "workflow", "thread"] }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(currentTimestamp),
  },
  (table) => ({
    uniqueArchiveItem: unique().on(table.archiveId, table.itemId, table.itemType),
  })
);

// Chat Export Table
export const ChatExportTable = sqliteTable("chat_export", {
  id: text("id").primaryKey().$defaultFn(() => randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => UserTable.id, { onDelete: "cascade" }),
  threadId: text("thread_id")
    .notNull()
    .references(() => ChatThreadTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  shareableId: text("shareable_id").notNull().unique(),
  visibility: text("visibility", { enum: ["public", "unlisted", "private"] })
    .notNull()
    .default("private"),
  allowComments: integer("allow_comments", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(currentTimestamp),
  expiresAt: integer("expires_at", { mode: "timestamp" }),
});

// Chat Export Comment Table
export const ChatExportCommentTable = sqliteTable("chat_export_comment", {
  id: text("id").primaryKey().$defaultFn(() => randomUUID()),
  exportId: text("export_id")
    .notNull()
    .references(() => ChatExportTable.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => UserTable.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(currentTimestamp),
});

// User Invitation Table
export const UserInvitationTable = sqliteTable(
  "user_invitation",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    email: text("email").notNull(),
    invitedBy: text("invited_by")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "admin"] }).notNull().default("user"),
    token: text("token").notNull().unique(),
    status: text("status", {
      enum: ["pending", "accepted", "expired"],
    })
      .notNull()
      .default("pending"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(currentTimestamp),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    acceptedAt: integer("accepted_at", { mode: "timestamp" }),
  },
  (table) => ({
    emailStatusIdx: index("user_invitation_email_status_idx").on(table.email, table.status),
  })
);

// Composio Connection Table (for Composio integrations)
export const ComposioConnectionTable = sqliteTable("composio_connection", {
  id: text("id").primaryKey().$defaultFn(() => randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => UserTable.id, { onDelete: "cascade" }),
  connectionId: text("connection_id").notNull().unique(),
  integrationId: text("integration_id").notNull(),
  appName: text("app_name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(currentTimestamp),
});

// Subscription Table (for billing)
export const SubscriptionTable = sqliteTable("subscription", {
  id: text("id").primaryKey().$defaultFn(() => randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => UserTable.id, { onDelete: "cascade" })
    .unique(),
  stripeCustomerId: text("stripe_customer_id").unique(),
  stripeSubscriptionId: text("stripe_subscription_id").unique(),
  stripePriceId: text("stripe_price_id"),
  status: text("status", {
    enum: [
      "incomplete",
      "incomplete_expired",
      "trialing",
      "active",
      "past_due",
      "canceled",
      "unpaid",
      "paused",
    ],
  }).notNull(),
  currentPeriodStart: integer("current_period_start", { mode: "timestamp" }),
  currentPeriodEnd: integer("current_period_end", { mode: "timestamp" }),
  cancelAtPeriodEnd: integer("cancel_at_period_end", { mode: "boolean" }).default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(currentTimestamp),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(currentTimestamp),
});

// Usage Event Table (for tracking usage with OpenMeter)
export const UsageEventTable = sqliteTable(
  "usage_event",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    subject: text("subject").notNull(),
    value: integer("value").notNull().default(1),
    metadata: text("metadata", { mode: "json" }),
    synced: integer("synced", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(currentTimestamp),
  },
  (table) => ({
    userIdIdx: index("usage_event_user_id_idx").on(table.userId),
    eventTypeIdx: index("usage_event_event_type_idx").on(table.eventType),
    syncedIdx: index("usage_event_synced_idx").on(table.synced),
  })
);

// Promo Code Table
export const PromoCodeTable = sqliteTable(
  "promo_code",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    code: text("code").notNull().unique(),
    description: text("description"),
    discountType: text("discount_type", { enum: ["percentage", "fixed"] }).notNull(),
    discountValue: integer("discount_value").notNull(),
    maxRedemptions: integer("max_redemptions"),
    currentRedemptions: integer("current_redemptions").notNull().default(0),
    validFrom: integer("valid_from", { mode: "timestamp" }).$defaultFn(currentTimestamp),
    validUntil: integer("valid_until", { mode: "timestamp" }),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdBy: text("created_by")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(currentTimestamp),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(currentTimestamp),
  },
  (table) => ({
    codeIdx: index("promo_code_code_idx").on(table.code),
  })
);

// Promo Code Redemption Table
export const PromoCodeRedemptionTable = sqliteTable(
  "promo_code_redemption",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    promoCodeId: text("promo_code_id")
      .notNull()
      .references(() => PromoCodeTable.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    subscriptionId: text("subscription_id").references(() => SubscriptionTable.id, {
      onDelete: "set null",
    }),
    discountApplied: integer("discount_applied").notNull(),
    redeemedAt: integer("redeemed_at", { mode: "timestamp" }).$defaultFn(currentTimestamp),
  },
  (table) => ({
    uniqueUserPromoCode: unique().on(table.userId, table.promoCodeId),
    userIdIdx: index("promo_code_redemption_user_id_idx").on(table.userId),
    promoCodeIdIdx: index("promo_code_redemption_promo_code_id_idx").on(table.promoCodeId),
  })
);

// Webhook Event Table
export const WebhookEventTable = sqliteTable(
  "webhook_event",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    eventType: text("event_type").notNull(),
    payload: text("payload", { mode: "json" }).notNull(),
    source: text("source").notNull(),
    processed: integer("processed", { mode: "boolean" }).notNull().default(false),
    retryCount: integer("retry_count").notNull().default(0),
    lastError: text("last_error"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(currentTimestamp),
    processedAt: integer("processed_at", { mode: "timestamp" }),
  },
  (table) => ({
    processedIdx: index("webhook_event_processed_idx").on(table.processed),
    eventTypeIdx: index("webhook_event_event_type_idx").on(table.eventType),
  })
);

// Webhook Retry Queue Table
export const WebhookRetryQueueTable = sqliteTable(
  "webhook_retry_queue",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    webhookEventId: text("webhook_event_id")
      .notNull()
      .references(() => WebhookEventTable.id, { onDelete: "cascade" }),
    retryAttempt: integer("retry_attempt").notNull().default(0),
    maxRetries: integer("max_retries").notNull().default(3),
    nextRetryAt: integer("next_retry_at", { mode: "timestamp" }).notNull(),
    lastAttemptAt: integer("last_attempt_at", { mode: "timestamp" }),
    status: text("status", { enum: ["pending", "processing", "failed", "success"] })
      .notNull()
      .default("pending"),
    error: text("error"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(currentTimestamp),
  },
  (table) => ({
    statusIdx: index("webhook_retry_queue_status_idx").on(table.status),
    nextRetryIdx: index("webhook_retry_queue_next_retry_idx").on(table.nextRetryAt),
  })
);

// Usage Alert Table
export const UsageAlertTable = sqliteTable(
  "usage_alert",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    alertType: text("alert_type", { enum: ["threshold", "quota", "rate_limit"] }).notNull(),
    threshold: integer("threshold").notNull(),
    currentUsage: integer("current_usage").notNull().default(0),
    notificationSent: integer("notification_sent", { mode: "boolean" })
      .notNull()
      .default(false),
    resolved: integer("resolved", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(currentTimestamp),
    resolvedAt: integer("resolved_at", { mode: "timestamp" }),
    lastNotifiedAt: integer("last_notified_at", { mode: "timestamp" }),
  },
  (table) => ({
    userIdIdx: index("usage_alert_user_id_idx").on(table.userId),
    resolvedIdx: index("usage_alert_resolved_idx").on(table.resolved),
  })
);

// Referral Table
export const ReferralTable = sqliteTable(
  "referral",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    referrerId: text("referrer_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    referredUserId: text("referred_user_id").references(() => UserTable.id, {
      onDelete: "set null",
    }),
    referredEmail: text("referred_email").notNull(),
    referralCode: text("referral_code").notNull().unique(),
    status: text("status", { enum: ["pending", "completed", "expired"] })
      .notNull()
      .default("pending"),
    rewardType: text("reward_type", { enum: ["credit", "discount", "free_months"] }),
    rewardValue: integer("reward_value"),
    rewardApplied: integer("reward_applied", { mode: "boolean" }).default(false),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(currentTimestamp),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    expiresAt: integer("expires_at", { mode: "timestamp" }),
  },
  (table) => ({
    referrerIdIdx: index("referral_referrer_id_idx").on(table.referrerId),
    referralCodeIdx: index("referral_referral_code_idx").on(table.referralCode),
    statusIdx: index("referral_status_idx").on(table.status),
  })
);
