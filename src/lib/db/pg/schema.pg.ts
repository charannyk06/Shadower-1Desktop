import { TipTapMentionJsonContent } from "@/types/util";
import { UIMessage } from "ai";
import { Agent } from "app-types/agent";
import { ChatMetadata } from "app-types/chat";
import { MCPServerConfig } from "app-types/mcp";
import { UserPreferences } from "app-types/user";
import { DBEdge, DBNode, DBWorkflow } from "app-types/workflow";
import { sql } from "drizzle-orm";
import { isNotNull } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  json,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const ChatThreadTable = pgTable("chat_thread", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  title: text("title").notNull(),
  userId: uuid("user_id")
    .notNull()
    .references(() => UserTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const ChatMessageTable = pgTable("chat_message", {
  id: text("id").primaryKey().notNull(),
  threadId: uuid("thread_id")
    .notNull()
    .references(() => ChatThreadTable.id, { onDelete: "cascade" }),
  role: text("role").notNull().$type<UIMessage["role"]>(),
  parts: json("parts").notNull().array().$type<UIMessage["parts"]>(),
  metadata: json("metadata").$type<ChatMetadata>(),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const AgentTable = pgTable("agent", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  icon: json("icon").$type<Agent["icon"]>(),
  userId: uuid("user_id")
    .notNull()
    .references(() => UserTable.id, { onDelete: "cascade" }),
  instructions: json("instructions").$type<Agent["instructions"]>(),
  visibility: varchar("visibility", {
    enum: ["public", "private", "readonly"],
  })
    .notNull()
    .default("private"),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const BookmarkTable = pgTable(
  "bookmark",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").notNull(),
    itemType: varchar("item_type", {
      enum: ["agent", "workflow", "mcp"],
    }).notNull(),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    unique().on(table.userId, table.itemId, table.itemType),
    index("bookmark_user_id_idx").on(table.userId),
    index("bookmark_item_idx").on(table.itemId, table.itemType),
  ],
);

export const McpServerTable = pgTable("mcp_server", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  name: text("name").notNull(),
  config: json("config").notNull().$type<MCPServerConfig>(),
  enabled: boolean("enabled").notNull().default(true),
  userId: uuid("user_id")
    .notNull()
    .references(() => UserTable.id, { onDelete: "cascade" }),
  visibility: varchar("visibility", {
    enum: ["public", "private"],
  })
    .notNull()
    .default("private"),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const UserTable = pgTable("user", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  password: text("password"),
  image: text("image"),
  preferences: json("preferences").default({}).$type<UserPreferences>(),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  banned: boolean("banned"),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires"),
  role: text("role").notNull().default("user"),
  // Referral system fields
  referralCode: varchar("referral_code", { length: 20 }).unique(),
  referredById: uuid("referred_by_id"),
  totalReferrals: integer("total_referrals").notNull().default(0),
  totalReferralBonus: text("total_referral_bonus").notNull().default("0"),
});

// Role tables removed - using Better Auth's built-in role system
// Roles are now managed via the 'role' field on UserTable

export const SessionTable = pgTable("session", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: uuid("user_id")
    .notNull()
    .references(() => UserTable.id, { onDelete: "cascade" }),
  // Admin plugin field (from better-auth generated schema)
  impersonatedBy: text("impersonated_by"),
});

export const AccountTable = pgTable("account", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: uuid("user_id")
    .notNull()
    .references(() => UserTable.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const VerificationTable = pgTable("verification", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").$defaultFn(
    () => /* @__PURE__ */ new Date(),
  ),
  updatedAt: timestamp("updated_at").$defaultFn(
    () => /* @__PURE__ */ new Date(),
  ),
});

// Tool customization table for per-user additional instructions
export const McpToolCustomizationTable = pgTable(
  "mcp_server_tool_custom_instructions",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    toolName: text("tool_name").notNull(),
    mcpServerId: uuid("mcp_server_id")
      .notNull()
      .references(() => McpServerTable.id, { onDelete: "cascade" }),
    prompt: text("prompt"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [unique().on(table.userId, table.toolName, table.mcpServerId)],
);

export const McpServerCustomizationTable = pgTable(
  "mcp_server_custom_instructions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    mcpServerId: uuid("mcp_server_id")
      .notNull()
      .references(() => McpServerTable.id, { onDelete: "cascade" }),
    prompt: text("prompt"),
    createdAt: timestamp("created_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [unique().on(table.userId, table.mcpServerId)],
);

export const WorkflowTable = pgTable("workflow", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  version: text("version").notNull().default("0.1.0"),
  name: text("name").notNull(),
  icon: json("icon").$type<DBWorkflow["icon"]>(),
  description: text("description"),
  isPublished: boolean("is_published").notNull().default(false),
  visibility: varchar("visibility", {
    enum: ["public", "private", "readonly"],
  })
    .notNull()
    .default("private"),
  userId: uuid("user_id")
    .notNull()
    .references(() => UserTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const WorkflowNodeDataTable = pgTable(
  "workflow_node",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    version: text("version").notNull().default("0.1.0"),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => WorkflowTable.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    uiConfig: json("ui_config").$type<DBNode["uiConfig"]>().default({}),
    nodeConfig: json("node_config")
      .$type<Partial<DBNode["nodeConfig"]>>()
      .default({}),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("workflow_node_kind_idx").on(t.kind)],
);

export const WorkflowEdgeTable = pgTable("workflow_edge", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  version: text("version").notNull().default("0.1.0"),
  workflowId: uuid("workflow_id")
    .notNull()
    .references(() => WorkflowTable.id, { onDelete: "cascade" }),
  source: uuid("source")
    .notNull()
    .references(() => WorkflowNodeDataTable.id, { onDelete: "cascade" }),
  target: uuid("target")
    .notNull()
    .references(() => WorkflowNodeDataTable.id, { onDelete: "cascade" }),
  uiConfig: json("ui_config").$type<DBEdge["uiConfig"]>().default({}),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const ArchiveTable = pgTable("archive", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  userId: uuid("user_id")
    .notNull()
    .references(() => UserTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const ArchiveItemTable = pgTable(
  "archive_item",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    archiveId: uuid("archive_id")
      .notNull()
      .references(() => ArchiveTable.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    addedAt: timestamp("added_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("archive_item_item_id_idx").on(t.itemId)],
);

export const McpOAuthSessionTable = pgTable(
  "mcp_oauth_session",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    mcpServerId: uuid("mcp_server_id")
      .notNull()
      .references(() => McpServerTable.id, { onDelete: "cascade" }),
    serverUrl: text("server_url").notNull(),
    clientInfo: json("client_info"),
    tokens: json("tokens"),
    codeVerifier: text("code_verifier"),
    state: text("state").unique(), // OAuth state parameter for current flow (unique for security)
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("mcp_oauth_session_server_id_idx").on(t.mcpServerId),
    index("mcp_oauth_session_state_idx").on(t.state),
    // Partial index for sessions with tokens for better performance
    index("mcp_oauth_session_tokens_idx")
      .on(t.mcpServerId)
      .where(isNotNull(t.tokens)),
  ],
);

export type McpServerEntity = typeof McpServerTable.$inferSelect;
export type ChatThreadEntity = typeof ChatThreadTable.$inferSelect;
export type ChatMessageEntity = typeof ChatMessageTable.$inferSelect;

export type AgentEntity = typeof AgentTable.$inferSelect;
export type UserEntity = typeof UserTable.$inferSelect;
export type SessionEntity = typeof SessionTable.$inferSelect;

export type ToolCustomizationEntity =
  typeof McpToolCustomizationTable.$inferSelect;
export type McpServerCustomizationEntity =
  typeof McpServerCustomizationTable.$inferSelect;

export const ChatExportTable = pgTable("chat_export", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  title: text("title").notNull(),
  exporterId: uuid("exporter_id")
    .notNull()
    .references(() => UserTable.id, { onDelete: "cascade" }),
  originalThreadId: uuid("original_thread_id"),
  messages: json("messages").notNull().$type<
    Array<{
      id: string;
      role: UIMessage["role"];
      parts: UIMessage["parts"];
      metadata?: ChatMetadata;
    }>
  >(),
  exportedAt: timestamp("exported_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  expiresAt: timestamp("expires_at"),
});

export const ChatExportCommentTable = pgTable("chat_export_comment", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  exportId: uuid("export_id")
    .notNull()
    .references(() => ChatExportTable.id, { onDelete: "cascade" }),
  authorId: uuid("author_id")
    .notNull()
    .references(() => UserTable.id, { onDelete: "cascade" }),
  parentId: uuid("parent_id").references(() => ChatExportCommentTable.id, {
    onDelete: "cascade",
  }),
  content: json("content").notNull().$type<TipTapMentionJsonContent>(),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// User Invitation table for admin-created invitations
export const UserInvitationTable = pgTable(
  "user_invitation",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    email: text("email").notNull(),
    token: text("token").notNull().unique(),
    role: text("role").notNull().default("editor"),
    invitedBy: uuid("invited_by")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at").notNull(),
    acceptedAt: timestamp("accepted_at"),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("user_invitation_email_idx").on(t.email),
    index("user_invitation_token_idx").on(t.token),
  ],
);

export type UserInvitationEntity = typeof UserInvitationTable.$inferSelect;

export type ArchiveEntity = typeof ArchiveTable.$inferSelect;
export type ArchiveItemEntity = typeof ArchiveItemTable.$inferSelect;
export type BookmarkEntity = typeof BookmarkTable.$inferSelect;

export const ComposioConnectionTable = pgTable("composio_connection", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => UserTable.id, { onDelete: "cascade" }),
  entityId: text("entity_id").notNull(),
  connectedApps: json("connected_apps").$type<string[]>().default([]),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export type ComposioConnectionEntity =
  typeof ComposioConnectionTable.$inferSelect;

export const SubscriptionTable = pgTable("subscription", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => UserTable.id, { onDelete: "cascade" }),
  tier: varchar("tier", { enum: ["free", "pro", "ultra"] })
    .notNull()
    .default("free"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  stripePriceId: text("stripe_price_id"),
  status: varchar("status", {
    enum: [
      "active",
      "canceled",
      "past_due",
      "trialing",
      "incomplete",
      "incomplete_expired",
      "unpaid",
      "paused",
    ],
  })
    .notNull()
    .default("active"),
  currentPeriodStart: timestamp("current_period_start"),
  currentPeriodEnd: timestamp("current_period_end"),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false),
  cancelAt: timestamp("cancel_at"), // Scheduled cancellation date from Stripe
  // Purchased token packs - cumulative tokens bought separately from subscription
  purchasedTokens: text("purchased_tokens").notNull().default("0"),
  // Track how many purchased tokens have been used (consumed first before subscription)
  purchasedTokensUsed: text("purchased_tokens_used").notNull().default("0"),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export type SubscriptionEntity = typeof SubscriptionTable.$inferSelect;

export const UsageEventTable = pgTable(
  "usage_event",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    eventType: varchar("event_type", {
      enum: [
        "llm_tokens",
        "image_generation",
        "sandbox_execution",
        "voice_minutes",
        "mcp_tool_call",
        "workflow_execution",
        "composio_action",
        "web_search",
      ],
    }).notNull(),
    amount: text("amount").notNull(),
    metadata: json("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("usage_event_user_idx").on(t.userId),
    index("usage_event_type_idx").on(t.eventType),
    index("usage_event_created_idx").on(t.createdAt),
  ],
);

export type UsageEventEntity = typeof UsageEventTable.$inferSelect;

// Promo Code table for subscription and token pack discounts
export const PromoCodeTable = pgTable(
  "promo_code",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    code: varchar("code", { length: 50 }).notNull().unique(),
    description: text("description"),

    // Discount settings
    discountType: varchar("discount_type", {
      enum: ["percentage", "fixed_amount"],
    }).notNull(),
    discountValue: text("discount_value").notNull(), // Stored as string for precision

    // Applicability
    appliesTo: varchar("applies_to", {
      enum: ["all", "subscription", "token_pack"],
    })
      .notNull()
      .default("all"),
    applicableTiers: json("applicable_tiers").$type<string[]>().default([]), // ["pro", "ultra"] or empty for all
    applicableTokenPacks: json("applicable_token_packs")
      .$type<string[]>()
      .default([]), // ["500000", "2000000", "5000000"] or empty for all

    // Restrictions
    maxRedemptions: text("max_redemptions"), // NULL = unlimited
    currentRedemptions: text("current_redemptions").notNull().default("0"),
    maxPerUser: text("max_per_user").notNull().default("1"),
    newUsersOnly: boolean("new_users_only").notNull().default(false),
    minAmount: text("min_amount"), // Minimum purchase in cents

    // Validity
    startsAt: timestamp("starts_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    expiresAt: timestamp("expires_at"), // NULL = never expires
    isActive: boolean("is_active").notNull().default(true),

    // Stripe integration
    stripeCouponId: text("stripe_coupon_id"),

    // Metadata
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("promo_code_code_idx").on(t.code),
    index("promo_code_active_idx").on(t.isActive, t.expiresAt),
  ],
);

export type PromoCodeEntity = typeof PromoCodeTable.$inferSelect;

// Promo Code Redemption tracking table
export const PromoCodeRedemptionTable = pgTable(
  "promo_code_redemption",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    promoCodeId: uuid("promo_code_id")
      .notNull()
      .references(() => PromoCodeTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),

    // What was purchased
    purchaseType: varchar("purchase_type", {
      enum: ["subscription", "token_pack"],
    }).notNull(),
    originalAmount: text("original_amount").notNull(), // Original price in cents
    discountAmount: text("discount_amount").notNull(), // Discount applied in cents
    finalAmount: text("final_amount").notNull(), // Final price in cents

    // Stripe references
    stripeCheckoutSessionId: text("stripe_checkout_session_id"),
    stripeInvoiceId: text("stripe_invoice_id"),

    redeemedAt: timestamp("redeemed_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("redemption_user_idx").on(t.userId),
    index("redemption_code_idx").on(t.promoCodeId),
  ],
);

export type PromoCodeRedemptionEntity =
  typeof PromoCodeRedemptionTable.$inferSelect;

// Webhook Event Deduplication table for multi-instance deployments
// Tracks processed Stripe webhook events to prevent duplicate processing
export const WebhookEventTable = pgTable(
  "webhook_event",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    eventId: text("event_id").notNull().unique(), // Stripe event ID
    eventType: text("event_type").notNull(), // e.g., "checkout.session.completed"
    processedAt: timestamp("processed_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    // Store minimal metadata for debugging
    metadata: json("metadata").$type<{
      customerId?: string;
      subscriptionId?: string;
      error?: string;
    }>(),
  },
  (t) => [
    index("webhook_event_id_idx").on(t.eventId),
    index("webhook_event_processed_at_idx").on(t.processedAt),
  ],
);

export type WebhookEventEntity = typeof WebhookEventTable.$inferSelect;

// Webhook Retry Queue for failed webhook processing
// Implements exponential backoff retry logic with dead letter handling
export const WebhookRetryQueueTable = pgTable(
  "webhook_retry_queue",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    eventId: text("event_id")
      .notNull()
      .references(() => WebhookEventTable.eventId),
    eventType: text("event_type").notNull(),
    payload: json("payload").notNull(), // The original Stripe event payload
    retryCount: text("retry_count").notNull().default("0"),
    maxRetries: text("max_retries").notNull().default("5"),
    nextRetryAt: timestamp("next_retry_at").notNull(),
    lastError: text("last_error"),
    status: varchar("status", {
      enum: ["pending", "processing", "succeeded", "dead_letter"],
    })
      .notNull()
      .default("pending"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("webhook_retry_event_id_idx").on(t.eventId),
    index("webhook_retry_status_idx").on(t.status),
    index("webhook_retry_next_retry_idx").on(t.nextRetryAt),
  ],
);

export type WebhookRetryQueueEntity =
  typeof WebhookRetryQueueTable.$inferSelect;

// Usage Alert table for tracking when users approach or exceed usage limits
// Prevents duplicate alerts for the same threshold within a billing period
export const UsageAlertTable = pgTable(
  "usage_alert",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    // Type of alert: approaching_80, approaching_100, exceeded
    alertType: varchar("alert_type", {
      enum: ["approaching_80", "approaching_100", "exceeded"],
    }).notNull(),
    // Type of limit: monthly, weekly, daily_expensive
    limitType: varchar("limit_type", {
      enum: ["monthly", "weekly", "daily_expensive"],
    }).notNull(),
    // Threshold percentage (80 or 100)
    threshold: text("threshold").notNull(),
    // Usage at time of alert
    currentUsage: text("current_usage").notNull(),
    // The limit that was approached/exceeded
    usageLimit: text("usage_limit").notNull(),
    // Whether email notification was sent
    emailSent: boolean("email_sent").notNull().default(false),
    emailSentAt: timestamp("email_sent_at"),
    // When user acknowledged the alert (dismissed it)
    acknowledgedAt: timestamp("acknowledged_at"),
    // Billing period this alert belongs to
    periodStart: timestamp("period_start").notNull(),
    periodEnd: timestamp("period_end").notNull(),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("usage_alert_user_id_idx").on(t.userId),
    index("usage_alert_type_idx").on(t.alertType, t.limitType),
    // Unique constraint to prevent duplicate alerts per user/type/period
    unique("usage_alert_unique").on(
      t.userId,
      t.alertType,
      t.limitType,
      t.periodStart,
    ),
  ],
);

export type UsageAlertEntity = typeof UsageAlertTable.$inferSelect;

// ============================================================================
// Referral System
// ============================================================================

export const ReferralTable = pgTable(
  "referral",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    // The user who shared the referral code
    referrerId: uuid("referrer_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    // The user who signed up with the referral code
    refereeId: uuid("referee_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    // The referral code used
    referralCode: varchar("referral_code", { length: 20 }).notNull(),
    // Status: pending (waiting for first purchase), completed, expired
    status: varchar("status", {
      enum: ["pending", "completed", "expired"],
    })
      .notNull()
      .default("pending"),
    // Bonus credits awarded to referrer
    referrerBonus: text("referrer_bonus").notNull().default("0"),
    // Bonus credits awarded to referee
    refereeBonus: text("referee_bonus").notNull().default("0"),
    // When the referral was completed (first purchase made)
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("referral_referrer_id_idx").on(t.referrerId),
    index("referral_referee_id_idx").on(t.refereeId),
    index("referral_status_idx").on(t.status),
    // A user can only be referred once
    unique("referral_referee_unique").on(t.refereeId),
  ],
);

export type ReferralEntity = typeof ReferralTable.$inferSelect;

// ============================================================================
// Agent State Persistence (for true autonomous agent behavior)
// ============================================================================

/**
 * AgentStateTable stores persistent state for autonomous agent execution.
 * This enables:
 * - Agent loop resumption across HTTP requests
 * - Task state persistence
 * - Inter-agent context sharing
 * - Progress tracking and recovery
 */
export const AgentStateTable = pgTable(
  "agent_state",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    // Optional link to chat thread (agent may run in chat context)
    threadId: uuid("thread_id").references(() => ChatThreadTable.id, {
      onDelete: "set null",
    }),
    // Serialized AgentPlan from agent-state.ts
    planData: json("plan_data").$type<{
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
    // Serialized shared context map
    sharedContext: json("shared_context").$type<Record<string, unknown>>(),
    // Agent execution status
    status: varchar("status", {
      enum: ["planning", "executing", "paused", "completed", "failed"],
    })
      .notNull()
      .default("planning"),
    // Error message if execution failed
    errorMessage: text("error_message"),
    // Number of steps executed so far
    stepsExecuted: integer("steps_executed").notNull().default(0),
    // Maximum steps allowed
    maxSteps: integer("max_steps").notNull().default(50),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("agent_state_user_id_idx").on(t.userId),
    index("agent_state_thread_id_idx").on(t.threadId),
    index("agent_state_status_idx").on(t.status),
  ],
);

export type AgentStateEntity = typeof AgentStateTable.$inferSelect;

// ============================================================================
// Agent Execution Log (for audit trail and debugging)
// ============================================================================

/**
 * AgentExecutionLogTable tracks each step/action taken by an agent
 * Enables:
 * - Debugging failed executions
 * - Understanding agent decision making
 * - Cost analysis per agent run
 * - Replay/audit capabilities
 */
export const AgentExecutionLogTable = pgTable(
  "agent_execution_log",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    agentStateId: uuid("agent_state_id")
      .notNull()
      .references(() => AgentStateTable.id, { onDelete: "cascade" }),
    // Step number in the execution sequence
    stepNumber: integer("step_number").notNull(),
    // Type of action: tool_call, plan_update, context_update, sub_agent_spawn, etc.
    actionType: varchar("action_type", {
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
    // Name of tool or action
    actionName: text("action_name"),
    // Input parameters (for tools) or context data
    input: json("input").$type<Record<string, unknown>>(),
    // Output or result
    output: json("output").$type<unknown>(),
    // Duration of the action in milliseconds
    durationMs: integer("duration_ms"),
    // Token usage for this step
    tokensUsed: json("tokens_used").$type<{
      input?: number;
      output?: number;
      total?: number;
    }>(),
    // Error details if action failed
    error: text("error"),
    // Timestamp
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("agent_exec_log_state_id_idx").on(t.agentStateId),
    index("agent_exec_log_step_idx").on(t.agentStateId, t.stepNumber),
    index("agent_exec_log_action_type_idx").on(t.actionType),
    index("agent_exec_log_created_idx").on(t.createdAt),
  ],
);

export type AgentExecutionLogEntity =
  typeof AgentExecutionLogTable.$inferSelect;

// ============================================================================
// Agent Checkpoint (for state recovery and rollback)
// ============================================================================

/**
 * AgentCheckpointTable stores periodic snapshots of agent state
 * Enables:
 * - Recovery from failures
 * - Rollback to previous states
 * - Long-running agent suspension/resumption
 * - Debugging by replaying from checkpoint
 */
export const AgentCheckpointTable = pgTable(
  "agent_checkpoint",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    agentStateId: uuid("agent_state_id")
      .notNull()
      .references(() => AgentStateTable.id, { onDelete: "cascade" }),
    // Checkpoint number (for ordering)
    checkpointNumber: integer("checkpoint_number").notNull(),
    // Step number at which checkpoint was taken
    stepNumber: integer("step_number").notNull(),
    // Reason for checkpoint: periodic, before_tool, after_task, manual, etc.
    reason: varchar("reason", {
      enum: [
        "periodic",
        "before_risky_tool",
        "after_task_complete",
        "before_sub_agent",
        "manual",
        "error_recovery",
      ],
    }).notNull(),
    // Full serialized state at this point
    stateSnapshot: json("state_snapshot").notNull().$type<{
      planData: unknown;
      sharedContext: Record<string, unknown>;
      stepsExecuted: number;
    }>(),
    // Whether this checkpoint has been used for recovery
    usedForRecovery: boolean("used_for_recovery").notNull().default(false),
    // Metadata about system state at checkpoint time
    metadata: json("metadata").$type<{
      tokensUsedSoFar?: number;
      tasksCompleted?: number;
      totalTasks?: number;
    }>(),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("agent_checkpoint_state_id_idx").on(t.agentStateId),
    index("agent_checkpoint_number_idx").on(t.agentStateId, t.checkpointNumber),
    index("agent_checkpoint_step_idx").on(t.agentStateId, t.stepNumber),
  ],
);

export type AgentCheckpointEntity = typeof AgentCheckpointTable.$inferSelect;

// ============================================================================
// Agent Tool Execution (for tracking tool usage and costs)
// ============================================================================

/**
 * AgentToolExecutionTable tracks individual tool executions
 * Enables:
 * - Cost tracking per tool per agent
 * - Performance monitoring
 * - Rate limiting and throttling
 * - Tool reliability metrics
 */
export const AgentToolExecutionTable = pgTable(
  "agent_tool_execution",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    agentStateId: uuid("agent_state_id")
      .notNull()
      .references(() => AgentStateTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    // Tool identification
    toolName: text("tool_name").notNull(),
    toolSource: varchar("tool_source", {
      enum: ["built_in", "mcp", "workflow", "composio", "agent_context"],
    }).notNull(),
    // MCP server ID if applicable
    mcpServerId: uuid("mcp_server_id").references(() => McpServerTable.id, {
      onDelete: "set null",
    }),
    // Execution details
    input: json("input").$type<Record<string, unknown>>(),
    output: json("output").$type<unknown>(),
    success: boolean("success").notNull(),
    error: text("error"),
    // Performance metrics
    durationMs: integer("duration_ms"),
    // Cost tracking (in tokens or credits)
    cost: text("cost"),
    // Timestamps
    startedAt: timestamp("started_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    completedAt: timestamp("completed_at"),
  },
  (t) => [
    index("agent_tool_exec_state_id_idx").on(t.agentStateId),
    index("agent_tool_exec_user_id_idx").on(t.userId),
    index("agent_tool_exec_tool_name_idx").on(t.toolName),
    index("agent_tool_exec_source_idx").on(t.toolSource),
    index("agent_tool_exec_started_idx").on(t.startedAt),
    index("agent_tool_exec_success_idx").on(t.success),
  ],
);

export type AgentToolExecutionEntity =
  typeof AgentToolExecutionTable.$inferSelect;

// ============================================================================
// Agent Sub-Agent Relation (for tracking parent-child agent relationships)
// ============================================================================

/**
 * AgentSubAgentRelationTable tracks parent-child relationships when spawning sub-agents
 * Enables:
 * - Understanding agent hierarchy
 * - Tracking delegation patterns
 * - Cost attribution to parent tasks
 * - Debugging complex multi-agent workflows
 */
export const AgentSubAgentRelationTable = pgTable(
  "agent_sub_agent_relation",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    // The parent agent that spawned the sub-agent
    parentAgentStateId: uuid("parent_agent_state_id")
      .notNull()
      .references(() => AgentStateTable.id, { onDelete: "cascade" }),
    // The spawned sub-agent
    childAgentStateId: uuid("child_agent_state_id")
      .notNull()
      .references(() => AgentStateTable.id, { onDelete: "cascade" }),
    // Task ID in parent that triggered spawn (if applicable)
    parentTaskId: text("parent_task_id"),
    // Instructions given to sub-agent
    instructions: text("instructions"),
    // Context keys passed to sub-agent
    contextKeys: json("context_keys").$type<string[]>(),
    // Status of sub-agent relation
    status: varchar("status", {
      enum: ["spawned", "running", "completed", "failed", "cancelled"],
    })
      .notNull()
      .default("spawned"),
    // Result summary from sub-agent
    result: json("result").$type<unknown>(),
    // Timestamps
    spawnedAt: timestamp("spawned_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    completedAt: timestamp("completed_at"),
  },
  (t) => [
    index("agent_sub_agent_parent_idx").on(t.parentAgentStateId),
    index("agent_sub_agent_child_idx").on(t.childAgentStateId),
    index("agent_sub_agent_status_idx").on(t.status),
  ],
);

export type AgentSubAgentRelationEntity =
  typeof AgentSubAgentRelationTable.$inferSelect;

// ============================================================================
// Thread Sandbox Context (for per-thread file system persistence)
// ============================================================================

/**
 * ThreadSandboxContextTable stores context for per-thread E2B sandbox file persistence.
 * Enables:
 * - Files created in one execution to persist to the next
 * - User-uploaded files to be available in sandbox
 * - Thread-scoped file management
 */
export interface ThreadFileMetadata {
  name: string;
  size: number;
  type: string;
  source: "user" | "generated";
  storageKey?: string;
  url?: string;
  sandboxPath?: string; // Path within the sandbox filesystem
  uploadedAt: string;
}

export const ThreadSandboxContextTable = pgTable(
  "thread_sandbox_context",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .unique()
      .references(() => ChatThreadTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    // Archive storage
    contextStorageKey: varchar("context_storage_key", { length: 512 }),
    contextSizeBytes: text("context_size_bytes").notNull().default("0"),
    // File tracking
    fileMetadata: json("file_metadata")
      .$type<ThreadFileMetadata[]>()
      .default([]),
    totalFilesCount: integer("total_files_count").notNull().default(0),
    // Timestamps
    lastExecutionAt: timestamp("last_execution_at"),
    lastAccessedAt: timestamp("last_accessed_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("thread_sandbox_context_thread_idx").on(t.threadId),
    index("thread_sandbox_context_user_idx").on(t.userId),
    index("thread_sandbox_context_cleanup_idx").on(t.lastAccessedAt),
  ],
);

export type ThreadSandboxContextEntity =
  typeof ThreadSandboxContextTable.$inferSelect;

// ============================================================================
// Browser Sessions (for Browserbase and E2B Desktop tracking)
// ============================================================================

/**
 * BrowserSessionTable tracks browser and desktop sandbox sessions.
 * Enables:
 * - Live browser preview in theater mode
 * - Session replay URLs
 * - Screenshot history
 * - Resource cleanup
 */
export const BrowserSessionTable = pgTable(
  "browser_session",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    threadId: uuid("thread_id").references(() => ChatThreadTable.id, {
      onDelete: "cascade",
    }),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    // Provider identification
    provider: varchar("provider", {
      enum: ["browserbase", "e2b-desktop"],
    }).notNull(),
    // External session ID from provider
    sessionId: text("session_id").notNull(),
    // Session status
    status: varchar("status", {
      enum: ["active", "closed", "error", "expired"],
    })
      .notNull()
      .default("active"),
    // Current URL (for browser sessions)
    currentUrl: text("current_url"),
    // Replay URL (for Browserbase session replay)
    replayUrl: text("replay_url"),
    // Screenshot history (base64 or storage keys)
    screenshots: json("screenshots")
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
    // Session metadata
    metadata: json("metadata").$type<{
      browserType?: string;
      viewport?: { width: number; height: number };
      stealth?: boolean;
      proxy?: boolean;
      error?: string;
      closeReason?: string;
    }>(),
    // Session tracking for cleanup
    lastActivityAt: timestamp("last_activity_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    expiresAt: timestamp("expires_at"),
    // Timestamps
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    closedAt: timestamp("closed_at"),
  },
  (t) => [
    index("browser_session_thread_idx").on(t.threadId),
    index("browser_session_user_idx").on(t.userId),
    index("browser_session_provider_idx").on(t.provider),
    index("browser_session_status_idx").on(t.status),
    index("browser_session_session_id_idx").on(t.sessionId),
    // Cleanup query indexes
    index("browser_session_expires_idx").on(t.expiresAt),
    index("browser_session_activity_idx").on(t.lastActivityAt),
    index("browser_session_cleanup_idx").on(t.status, t.expiresAt),
  ],
);

export type BrowserSessionEntity = typeof BrowserSessionTable.$inferSelect;
export type BrowserSessionInsert = typeof BrowserSessionTable.$inferInsert;

// ============================================================================
// Research Tasks (for Deep Research Agent progress tracking)
// ============================================================================

/**
 * ResearchTaskTable tracks deep research task progress.
 * Enables:
 * - Research progress visualization in theater mode
 * - Source and citation tracking
 * - Multi-step research workflow
 * - Findings accumulation
 */
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

export const ResearchTaskTable = pgTable(
  "research_task",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    threadId: uuid("thread_id").references(() => ChatThreadTable.id, {
      onDelete: "cascade",
    }),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    // Research query
    query: text("query").notNull(),
    // Research depth/mode
    depth: varchar("depth", {
      enum: ["quick", "standard", "comprehensive"],
    })
      .notNull()
      .default("standard"),
    // Task status
    status: varchar("status", {
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
    // Current step description
    currentStep: text("current_step"),
    // Progress percentage (0-100)
    progress: integer("progress").notNull().default(0),
    // Sources visited
    sources: json("sources").$type<ResearchSource[]>().default([]),
    // Key findings extracted
    findings: json("findings").$type<ResearchFinding[]>().default([]),
    // Citations for the final report
    citations: json("citations").$type<ResearchCitation[]>().default([]),
    // Final synthesized report
    report: text("report"),
    // Error message if failed
    error: text("error"),
    // Browser session used for research
    browserSessionId: uuid("browser_session_id").references(
      () => BrowserSessionTable.id,
      { onDelete: "set null" },
    ),
    // Timestamps
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    completedAt: timestamp("completed_at"),
  },
  (t) => [
    index("research_task_thread_idx").on(t.threadId),
    index("research_task_user_idx").on(t.userId),
    index("research_task_status_idx").on(t.status),
    index("research_task_created_idx").on(t.createdAt),
  ],
);

export type ResearchTaskEntity = typeof ResearchTaskTable.$inferSelect;

// ============================================================================
// Conversation Summary (for context compaction/long-term memory)
// ============================================================================

/**
 * ConversationSummaryTable stores LLM-generated summaries of compacted messages.
 * Enables:
 * - Endless conversations without token limit errors
 * - Long-term memory across sessions
 * - Context recovery after compaction
 * - Chained summaries (summary of summaries)
 */
export const ConversationSummaryTable = pgTable(
  "conversation_summary",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => ChatThreadTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    // The LLM-generated summary text
    summary: text("summary").notNull(),
    // Number of messages that were compacted into this summary
    messagesCompacted: integer("messages_compacted").notNull(),
    // Estimated tokens saved by this compaction
    tokensSaved: integer("tokens_saved").notNull(),
    // Token count of the summary itself
    summaryTokens: integer("summary_tokens").notNull().default(0),
    // For chained summaries (summary of summaries)
    parentSummaryId: uuid("parent_summary_id").references(
      (): any => ConversationSummaryTable.id,
      { onDelete: "set null" },
    ),
    // Version/sequence number within the thread
    sequenceNumber: integer("sequence_number").notNull().default(1),
    // Model used to generate the summary
    modelProvider: varchar("model_provider", { length: 50 }),
    modelName: varchar("model_name", { length: 100 }),
    // Timestamps
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("conversation_summary_thread_idx").on(t.threadId),
    index("conversation_summary_user_idx").on(t.userId),
    index("conversation_summary_sequence_idx").on(t.threadId, t.sequenceNumber),
    index("conversation_summary_parent_idx").on(t.parentSummaryId),
  ],
);

export type ConversationSummaryEntity =
  typeof ConversationSummaryTable.$inferSelect;

// ============================================================================
// Vector Search Index Tracking
// ============================================================================

/**
 * VectorIndexTable tracks Qdrant point IDs in PostgreSQL
 * Links Qdrant vectors to PostgreSQL records for data consistency
 */
export const VectorIndexTable = pgTable(
  "vector_index",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    qdrantPointId: uuid("qdrant_point_id").notNull().unique(),
    collectionName: varchar("collection_name", { length: 50 }).notNull(),
    entityType: varchar("entity_type", {
      enum: ["document", "message", "knowledge"],
    }).notNull(),
    entityId: text("entity_id").notNull(), // Reference to document/message ID
    userId: uuid("user_id").references(() => UserTable.id, {
      onDelete: "cascade",
    }),
    metadata: json("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("vector_index_qdrant_point_idx").on(t.qdrantPointId),
    index("vector_index_entity_idx").on(t.entityType, t.entityId),
    index("vector_index_user_idx").on(t.userId),
    index("vector_index_collection_idx").on(t.collectionName),
  ],
);

export type VectorIndexEntity = typeof VectorIndexTable.$inferSelect;

// ============================================================================
// Fragment Tables (for micro-app and document generation)
// ============================================================================

/**
 * FragmentsTable stores generated code fragments and metadata.
 * Enables:
 * - Autonomous micro-app generation
 * - Document generation with preview
 * - Multi-template support (Next.js, Vue, Streamlit, Gradio, Python)
 * - Iterative editing with surgical code edits
 */
export const FragmentsTable = pgTable(
  "fragments",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => ChatThreadTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),

    // Fragment metadata
    template: varchar("template", { length: 100 }).notNull(),
    title: varchar("title", { length: 100 }).notNull(),
    description: text("description"),

    // Code and execution
    code: text("code").notNull(),
    filePath: varchar("file_path", { length: 500 }).notNull(),
    port: integer("port"),

    // Sandbox and deployment
    sandboxId: varchar("sandbox_id", { length: 100 }),
    previewUrl: text("preview_url"),
    deploymentUrl: text("deployment_url"),

    // Status
    status: varchar("status", {
      enum: ["draft", "generating", "ready", "deployed", "failed"],
    })
      .notNull()
      .default("draft"),
    errorMessage: text("error_message"),

    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("fragments_thread_idx").on(t.threadId),
    index("fragments_user_idx").on(t.userId),
    index("fragments_status_idx").on(t.status),
  ],
);

export type FragmentsEntity = typeof FragmentsTable.$inferSelect;

/**
 * FragmentExecutionsTable tracks execution history for fragments.
 * Enables:
 * - Debugging failed executions
 * - Performance tracking
 * - Audit trail for rollback
 */
export const FragmentExecutionsTable = pgTable(
  "fragment_executions",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    fragmentId: uuid("fragment_id")
      .notNull()
      .references(() => FragmentsTable.id, { onDelete: "cascade" }),
    sandboxId: varchar("sandbox_id", { length: 100 }).notNull(),
    template: varchar("template", { length: 100 }).notNull(),

    // Results
    stdout: text("stdout"),
    stderr: text("stderr"),
    runtimeError: text("runtime_error"),
    previewUrl: text("preview_url"),

    // Metrics
    executionTimeMs: integer("execution_time_ms"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("fragment_executions_fragment_idx").on(t.fragmentId)],
);

export type FragmentExecutionsEntity =
  typeof FragmentExecutionsTable.$inferSelect;

/**
 * E2BUsageTable tracks sandbox usage for cost management.
 * Enables:
 * - Per-user usage tracking
 * - Billing and quota enforcement
 * - Cost analysis and optimization
 */
export const E2BUsageTable = pgTable(
  "e2b_usage",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    sessionId: varchar("session_id", { length: 100 }).notNull(),
    template: varchar("template", { length: 100 }),

    // Usage metrics
    durationMs: integer("duration_ms").notNull(),
    creditsUsed: text("credits_used").notNull(),
    costUsd: text("cost_usd").notNull(),

    // Metadata
    operationType: varchar("operation_type", {
      enum: ["create", "edit", "execute", "deploy"],
    }),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("e2b_usage_user_idx").on(t.userId),
    index("e2b_usage_created_idx").on(t.createdAt),
  ],
);

export type E2BUsageEntity = typeof E2BUsageTable.$inferSelect;

/**
 * FragmentSharesTable tracks shared fragment links.
 * Enables:
 * - Public sharing with expiration
 * - Anonymous access to deployed fragments
 * - Link tracking and analytics
 */
export const FragmentSharesTable = pgTable(
  "fragment_shares",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    fragmentId: uuid("fragment_id")
      .notNull()
      .references(() => FragmentsTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),

    // Share settings
    shareId: varchar("share_id", { length: 50 }).notNull().unique(),
    expiresAt: timestamp("expires_at"),
    isActive: boolean("is_active").notNull().default(true),

    // Analytics
    viewCount: integer("view_count").notNull().default(0),
    lastViewedAt: timestamp("last_viewed_at"),

    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("fragment_shares_fragment_idx").on(t.fragmentId),
    index("fragment_shares_share_id_idx").on(t.shareId),
  ],
);

export type FragmentSharesEntity = typeof FragmentSharesTable.$inferSelect;
