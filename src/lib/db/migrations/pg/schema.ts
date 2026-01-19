import { sql } from "drizzle-orm";
import {
  boolean,
  foreignKey,
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

export const agent = pgTable(
  "agent",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    name: text().notNull(),
    description: text(),
    icon: json(),
    userId: uuid("user_id").notNull(),
    instructions: json(),
    visibility: varchar().default("private").notNull(),
    createdAt: timestamp("created_at", { mode: "string" })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [user.id],
      name: "agent_user_id_user_id_fk",
    }).onDelete("cascade"),
  ],
);

export const archive = pgTable(
  "archive",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    name: text().notNull(),
    description: text(),
    userId: uuid("user_id").notNull(),
    createdAt: timestamp("created_at", { mode: "string" })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [user.id],
      name: "archive_user_id_user_id_fk",
    }).onDelete("cascade"),
  ],
);

export const bookmark = pgTable(
  "bookmark",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: uuid("user_id").notNull(),
    itemId: uuid("item_id").notNull(),
    itemType: varchar("item_type").notNull(),
    createdAt: timestamp("created_at", { mode: "string" })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index("bookmark_item_idx").using(
      "btree",
      table.itemId.asc().nullsLast().op("text_ops"),
      table.itemType.asc().nullsLast().op("text_ops"),
    ),
    index("bookmark_user_id_idx").using(
      "btree",
      table.userId.asc().nullsLast().op("uuid_ops"),
    ),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [user.id],
      name: "bookmark_user_id_user_id_fk",
    }).onDelete("cascade"),
    unique("bookmark_user_id_item_id_item_type_unique").on(
      table.userId,
      table.itemId,
      table.itemType,
    ),
  ],
);

export const chatExport = pgTable(
  "chat_export",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    title: text().notNull(),
    exporterId: uuid("exporter_id").notNull(),
    originalThreadId: uuid("original_thread_id"),
    messages: json().notNull(),
    exportedAt: timestamp("exported_at", { mode: "string" })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    expiresAt: timestamp("expires_at", { mode: "string" }),
  },
  (table) => [
    foreignKey({
      columns: [table.exporterId],
      foreignColumns: [user.id],
      name: "chat_export_exporter_id_user_id_fk",
    }).onDelete("cascade"),
  ],
);

export const chatThread = pgTable(
  "chat_thread",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    title: text().notNull(),
    userId: uuid("user_id").notNull(),
    createdAt: timestamp("created_at", { mode: "string" })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [user.id],
      name: "chat_thread_user_id_user_id_fk",
    }).onDelete("cascade"),
  ],
);

export const chatMessage = pgTable(
  "chat_message",
  {
    id: text().primaryKey().notNull(),
    threadId: uuid("thread_id").notNull(),
    role: text().notNull(),
    parts: json().array(),
    metadata: json(),
    createdAt: timestamp("created_at", { mode: "string" })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.threadId],
      foreignColumns: [chatThread.id],
      name: "chat_message_thread_id_chat_thread_id_fk",
    }).onDelete("cascade"),
  ],
);

export const mcpOauthSession = pgTable(
  "mcp_oauth_session",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    mcpServerId: uuid("mcp_server_id").notNull(),
    serverUrl: text("server_url").notNull(),
    clientInfo: json("client_info"),
    tokens: json(),
    codeVerifier: text("code_verifier"),
    state: text(),
    createdAt: timestamp("created_at", { mode: "string" })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index("mcp_oauth_session_server_id_idx").using(
      "btree",
      table.mcpServerId.asc().nullsLast().op("uuid_ops"),
    ),
    index("mcp_oauth_session_state_idx").using(
      "btree",
      table.state.asc().nullsLast().op("text_ops"),
    ),
    index("mcp_oauth_session_tokens_idx")
      .using("btree", table.mcpServerId.asc().nullsLast().op("uuid_ops"))
      .where(sql`(tokens IS NOT NULL)`),
    foreignKey({
      columns: [table.mcpServerId],
      foreignColumns: [mcpServer.id],
      name: "mcp_oauth_session_mcp_server_id_mcp_server_id_fk",
    }).onDelete("cascade"),
    unique("mcp_oauth_session_state_unique").on(table.state),
  ],
);

export const account = pgTable(
  "account",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: uuid("user_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      mode: "string",
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      mode: "string",
    }),
    scope: text(),
    password: text(),
    createdAt: timestamp("created_at", { mode: "string" })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [user.id],
      name: "account_user_id_user_id_fk",
    }).onDelete("cascade"),
  ],
);

export const chatExportComment = pgTable(
  "chat_export_comment",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    exportId: uuid("export_id").notNull(),
    authorId: uuid("author_id").notNull(),
    parentId: uuid("parent_id"),
    content: json().notNull(),
    createdAt: timestamp("created_at", { mode: "string" })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.exportId],
      foreignColumns: [chatExport.id],
      name: "chat_export_comment_export_id_chat_export_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.authorId],
      foreignColumns: [user.id],
      name: "chat_export_comment_author_id_user_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.parentId],
      foreignColumns: [table.id],
      name: "chat_export_comment_parent_id_chat_export_comment_id_fk",
    }).onDelete("cascade"),
  ],
);

export const mcpServerCustomInstructions = pgTable(
  "mcp_server_custom_instructions",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: uuid("user_id").notNull(),
    mcpServerId: uuid("mcp_server_id").notNull(),
    prompt: text(),
    createdAt: timestamp("created_at", { mode: "string" })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [user.id],
      name: "mcp_server_custom_instructions_user_id_user_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.mcpServerId],
      foreignColumns: [mcpServer.id],
      name: "mcp_server_custom_instructions_mcp_server_id_mcp_server_id_fk",
    }).onDelete("cascade"),
    unique("mcp_server_custom_instructions_user_id_mcp_server_id_unique").on(
      table.userId,
      table.mcpServerId,
    ),
  ],
);

export const session = pgTable(
  "session",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    expiresAt: timestamp("expires_at", { mode: "string" }).notNull(),
    token: text().notNull(),
    createdAt: timestamp("created_at", { mode: "string" })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: uuid("user_id").notNull(),
    impersonatedBy: text("impersonated_by"),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [user.id],
      name: "session_user_id_user_id_fk",
    }).onDelete("cascade"),
    unique("session_token_unique").on(table.token),
  ],
);

export const mcpServerToolCustomInstructions = pgTable(
  "mcp_server_tool_custom_instructions",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: uuid("user_id").notNull(),
    toolName: text("tool_name").notNull(),
    mcpServerId: uuid("mcp_server_id").notNull(),
    prompt: text(),
    createdAt: timestamp("created_at", { mode: "string" })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [user.id],
      name: "mcp_server_tool_custom_instructions_user_id_user_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.mcpServerId],
      foreignColumns: [mcpServer.id],
      name: "mcp_server_tool_custom_instructions_mcp_server_id_mcp_server_id",
    }).onDelete("cascade"),
    unique(
      "mcp_server_tool_custom_instructions_user_id_tool_name_mcp_serve",
    ).on(table.userId, table.toolName, table.mcpServerId),
  ],
);

export const userInvitation = pgTable(
  "user_invitation",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    email: text().notNull(),
    token: text().notNull(),
    role: text().default("editor").notNull(),
    invitedBy: uuid("invited_by").notNull(),
    expiresAt: timestamp("expires_at", { mode: "string" }).notNull(),
    acceptedAt: timestamp("accepted_at", { mode: "string" }),
    revokedAt: timestamp("revoked_at", { mode: "string" }),
    createdAt: timestamp("created_at", { mode: "string" })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index("user_invitation_email_idx").using(
      "btree",
      table.email.asc().nullsLast().op("text_ops"),
    ),
    index("user_invitation_token_idx").using(
      "btree",
      table.token.asc().nullsLast().op("text_ops"),
    ),
    foreignKey({
      columns: [table.invitedBy],
      foreignColumns: [user.id],
      name: "user_invitation_invited_by_user_id_fk",
    }).onDelete("cascade"),
    unique("user_invitation_token_unique").on(table.token),
  ],
);

export const mcpServer = pgTable(
  "mcp_server",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    name: text().notNull(),
    config: json().notNull(),
    enabled: boolean().default(true).notNull(),
    userId: uuid("user_id").notNull(),
    visibility: varchar().default("private").notNull(),
    createdAt: timestamp("created_at", { mode: "string" })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [user.id],
      name: "mcp_server_user_id_user_id_fk",
    }).onDelete("cascade"),
  ],
);

export const verification = pgTable("verification", {
  id: uuid().defaultRandom().primaryKey().notNull(),
  identifier: text().notNull(),
  value: text().notNull(),
  expiresAt: timestamp("expires_at", { mode: "string" }).notNull(),
  createdAt: timestamp("created_at", { mode: "string" }),
  updatedAt: timestamp("updated_at", { mode: "string" }),
});

export const archiveItem = pgTable(
  "archive_item",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    archiveId: uuid("archive_id").notNull(),
    itemId: uuid("item_id").notNull(),
    userId: uuid("user_id").notNull(),
    addedAt: timestamp("added_at", { mode: "string" })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index("archive_item_item_id_idx").using(
      "btree",
      table.itemId.asc().nullsLast().op("uuid_ops"),
    ),
    foreignKey({
      columns: [table.archiveId],
      foreignColumns: [archive.id],
      name: "archive_item_archive_id_archive_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [user.id],
      name: "archive_item_user_id_user_id_fk",
    }).onDelete("cascade"),
  ],
);

export const workflow = pgTable(
  "workflow",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    version: text().default("0.1.0").notNull(),
    name: text().notNull(),
    icon: json(),
    description: text(),
    isPublished: boolean("is_published").default(false).notNull(),
    visibility: varchar().default("private").notNull(),
    userId: uuid("user_id").notNull(),
    createdAt: timestamp("created_at", { mode: "string" })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [user.id],
      name: "workflow_user_id_user_id_fk",
    }).onDelete("cascade"),
  ],
);

export const workflowEdge = pgTable(
  "workflow_edge",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    version: text().default("0.1.0").notNull(),
    workflowId: uuid("workflow_id").notNull(),
    source: uuid().notNull(),
    target: uuid().notNull(),
    uiConfig: json("ui_config").default({}),
    createdAt: timestamp("created_at", { mode: "string" })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.workflowId],
      foreignColumns: [workflow.id],
      name: "workflow_edge_workflow_id_workflow_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.source],
      foreignColumns: [workflowNode.id],
      name: "workflow_edge_source_workflow_node_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.target],
      foreignColumns: [workflowNode.id],
      name: "workflow_edge_target_workflow_node_id_fk",
    }).onDelete("cascade"),
  ],
);

export const workflowNode = pgTable(
  "workflow_node",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    version: text().default("0.1.0").notNull(),
    workflowId: uuid("workflow_id").notNull(),
    kind: text().notNull(),
    name: text().notNull(),
    description: text(),
    uiConfig: json("ui_config").default({}),
    nodeConfig: json("node_config").default({}),
    createdAt: timestamp("created_at", { mode: "string" })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index("workflow_node_kind_idx").using(
      "btree",
      table.kind.asc().nullsLast().op("text_ops"),
    ),
    foreignKey({
      columns: [table.workflowId],
      foreignColumns: [workflow.id],
      name: "workflow_node_workflow_id_workflow_id_fk",
    }).onDelete("cascade"),
  ],
);

export const subscription = pgTable(
  "subscription",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: uuid("user_id").notNull(),
    tier: varchar().default("free").notNull(),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    stripePriceId: text("stripe_price_id"),
    status: varchar().default("active").notNull(),
    currentPeriodStart: timestamp("current_period_start", { mode: "string" }),
    currentPeriodEnd: timestamp("current_period_end", { mode: "string" }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false),
    cancelAt: timestamp("cancel_at", { mode: "string" }),
    purchasedTokens: text("purchased_tokens").default("0").notNull(),
    purchasedTokensUsed: text("purchased_tokens_used").default("0").notNull(),
    createdAt: timestamp("created_at", { mode: "string" })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [user.id],
      name: "subscription_user_id_fkey",
    }).onDelete("cascade"),
    unique("subscription_user_id_key").on(table.userId),
  ],
);

export const referral = pgTable(
  "referral",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    referrerId: uuid("referrer_id").notNull(),
    refereeId: uuid("referee_id").notNull(),
    referralCode: varchar("referral_code", { length: 20 }).notNull(),
    status: varchar().default("pending").notNull(),
    referrerBonus: text("referrer_bonus").default("0").notNull(),
    refereeBonus: text("referee_bonus").default("0").notNull(),
    completedAt: timestamp("completed_at", { mode: "string" }),
    createdAt: timestamp("created_at", { mode: "string" })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index("referral_referee_id_idx").using(
      "btree",
      table.refereeId.asc().nullsLast().op("uuid_ops"),
    ),
    index("referral_referrer_id_idx").using(
      "btree",
      table.referrerId.asc().nullsLast().op("uuid_ops"),
    ),
    index("referral_status_idx").using(
      "btree",
      table.status.asc().nullsLast().op("text_ops"),
    ),
    foreignKey({
      columns: [table.referrerId],
      foreignColumns: [user.id],
      name: "referral_referrer_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.refereeId],
      foreignColumns: [user.id],
      name: "referral_referee_id_fkey",
    }).onDelete("cascade"),
    unique("referral_referee_id_key").on(table.refereeId),
  ],
);

export const user = pgTable(
  "user",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    name: text().notNull(),
    email: text().notNull(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    password: text(),
    image: text(),
    preferences: json().default({}),
    createdAt: timestamp("created_at", { mode: "string" })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    banned: boolean(),
    banReason: text("ban_reason"),
    banExpires: timestamp("ban_expires", { mode: "string" }),
    role: text().default("user").notNull(),
    referralCode: varchar("referral_code", { length: 20 }),
    referredById: uuid("referred_by_id"),
    totalReferrals: integer("total_referrals").default(0).notNull(),
    totalReferralBonus: text("total_referral_bonus").default("0").notNull(),
  },
  (table) => [
    unique("user_email_unique").on(table.email),
    unique("user_referral_code_unique").on(table.referralCode),
  ],
);

export const promoCodeRedemption = pgTable(
  "promo_code_redemption",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    promoCodeId: uuid("promo_code_id").notNull(),
    userId: uuid("user_id").notNull(),
    purchaseType: varchar("purchase_type").notNull(),
    originalAmount: text("original_amount").notNull(),
    discountAmount: text("discount_amount").notNull(),
    finalAmount: text("final_amount").notNull(),
    stripeCheckoutSessionId: text("stripe_checkout_session_id"),
    stripeInvoiceId: text("stripe_invoice_id"),
    redeemedAt: timestamp("redeemed_at", { mode: "string" })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index("redemption_code_idx").using(
      "btree",
      table.promoCodeId.asc().nullsLast().op("uuid_ops"),
    ),
    index("redemption_user_idx").using(
      "btree",
      table.userId.asc().nullsLast().op("uuid_ops"),
    ),
    foreignKey({
      columns: [table.promoCodeId],
      foreignColumns: [promoCode.id],
      name: "promo_code_redemption_promo_code_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [user.id],
      name: "promo_code_redemption_user_id_fkey",
    }).onDelete("cascade"),
  ],
);

export const promoCode = pgTable(
  "promo_code",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    code: varchar({ length: 50 }).notNull(),
    description: text(),
    discountType: varchar("discount_type").notNull(),
    discountValue: text("discount_value").notNull(),
    appliesTo: varchar("applies_to").default("all").notNull(),
    applicableTiers: json("applicable_tiers").default([]),
    applicableTokenPacks: json("applicable_token_packs").default([]),
    maxRedemptions: text("max_redemptions"),
    currentRedemptions: text("current_redemptions").default("0").notNull(),
    maxPerUser: text("max_per_user").default("1").notNull(),
    newUsersOnly: boolean("new_users_only").default(false).notNull(),
    minAmount: text("min_amount"),
    startsAt: timestamp("starts_at", { mode: "string" })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    expiresAt: timestamp("expires_at", { mode: "string" }),
    isActive: boolean("is_active").default(true).notNull(),
    stripeCouponId: text("stripe_coupon_id"),
    createdAt: timestamp("created_at", { mode: "string" })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index("promo_code_active_idx").using(
      "btree",
      table.isActive.asc().nullsLast().op("bool_ops"),
      table.expiresAt.asc().nullsLast().op("bool_ops"),
    ),
    index("promo_code_code_idx").using(
      "btree",
      table.code.asc().nullsLast().op("text_ops"),
    ),
    unique("promo_code_code_key").on(table.code),
  ],
);

export const webhookRetryQueue = pgTable(
  "webhook_retry_queue",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: json().notNull(),
    retryCount: text("retry_count").default("0").notNull(),
    maxRetries: text("max_retries").default("5").notNull(),
    nextRetryAt: timestamp("next_retry_at", { mode: "string" }).notNull(),
    lastError: text("last_error"),
    status: varchar().default("pending").notNull(),
    createdAt: timestamp("created_at", { mode: "string" })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index("webhook_retry_event_id_idx").using(
      "btree",
      table.eventId.asc().nullsLast().op("text_ops"),
    ),
    index("webhook_retry_next_retry_idx").using(
      "btree",
      table.nextRetryAt.asc().nullsLast().op("timestamp_ops"),
    ),
    index("webhook_retry_status_idx").using(
      "btree",
      table.status.asc().nullsLast().op("text_ops"),
    ),
  ],
);

export const usageEvent = pgTable(
  "usage_event",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: uuid("user_id").notNull(),
    eventType: varchar("event_type").notNull(),
    amount: text().notNull(),
    metadata: json(),
    createdAt: timestamp("created_at", { mode: "string" })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index("usage_event_created_idx").using(
      "btree",
      table.createdAt.asc().nullsLast().op("timestamp_ops"),
    ),
    index("usage_event_type_idx").using(
      "btree",
      table.eventType.asc().nullsLast().op("text_ops"),
    ),
    index("usage_event_user_idx").using(
      "btree",
      table.userId.asc().nullsLast().op("uuid_ops"),
    ),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [user.id],
      name: "usage_event_user_id_fkey",
    }).onDelete("cascade"),
  ],
);

export const usageAlert = pgTable(
  "usage_alert",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: uuid("user_id").notNull(),
    alertType: varchar("alert_type").notNull(),
    limitType: varchar("limit_type").notNull(),
    threshold: text().notNull(),
    currentUsage: text("current_usage").notNull(),
    usageLimit: text("usage_limit").notNull(),
    emailSent: boolean("email_sent").default(false).notNull(),
    emailSentAt: timestamp("email_sent_at", { mode: "string" }),
    acknowledgedAt: timestamp("acknowledged_at", { mode: "string" }),
    periodStart: timestamp("period_start", { mode: "string" }).notNull(),
    periodEnd: timestamp("period_end", { mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { mode: "string" })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index("usage_alert_type_idx").using(
      "btree",
      table.alertType.asc().nullsLast().op("text_ops"),
      table.limitType.asc().nullsLast().op("text_ops"),
    ),
    index("usage_alert_user_id_idx").using(
      "btree",
      table.userId.asc().nullsLast().op("uuid_ops"),
    ),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [user.id],
      name: "usage_alert_user_id_fkey",
    }).onDelete("cascade"),
    unique("usage_alert_unique").on(
      table.userId,
      table.alertType,
      table.limitType,
      table.periodStart,
    ),
  ],
);

export const webhookEvent = pgTable(
  "webhook_event",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    processedAt: timestamp("processed_at", { mode: "string" })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    metadata: json(),
  },
  (table) => [
    index("webhook_event_id_idx").using(
      "btree",
      table.eventId.asc().nullsLast().op("text_ops"),
    ),
    index("webhook_event_processed_at_idx").using(
      "btree",
      table.processedAt.asc().nullsLast().op("timestamp_ops"),
    ),
    unique("webhook_event_event_id_key").on(table.eventId),
  ],
);
