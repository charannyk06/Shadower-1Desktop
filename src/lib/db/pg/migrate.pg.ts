import { join } from "path";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { pgDb } from "lib/db/pg/db.pg";

/**
 * List of critical tables that must exist after migration
 */
const CRITICAL_TABLES = [
  "user",
  "session",
  "chat_thread",
  "chat_message",
  "referral",
  "subscription",
  "usage_event",
  "usage_alert",
  "webhook_event",
  "webhook_retry_queue",
  "promo_code",
  "promo_code_redemption",
  // Agent tables for autonomous agent implementation
  "agent_state",
  "agent_execution_log",
  "agent_checkpoint",
  "agent_tool_execution",
  "agent_sub_agent_relation",
  // Sandbox context for per-thread file persistence
  "thread_sandbox_context",
  // MCP server tables
  "mcp_server",
  // Browser automation tables
  "browser_session",
  // Other tables
  "agent",
  "workflow",
  "archive",
  "chat_export",
  "bookmark",
  "mcp_tool_customization",
  "mcp_server_customization",
  "mcp_oauth_session",
  "research_task",
  // Fragment system tables
  "fragments",
  "fragment_executions",
  "e2b_usage",
  "fragment_shares",
];

/**
 * Check which critical tables are missing
 */
async function getMissingTables(): Promise<string[]> {
  const missing: string[] = [];

  for (const table of CRITICAL_TABLES) {
    const result = await pgDb.execute(
      sql`SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = ${table}
      ) as exists`,
    );
    if (!result.rows[0]?.exists) {
      missing.push(table);
    }
  }

  return missing;
}

/**
 * Verify critical tables exist after migration
 */
async function verifySchema(): Promise<void> {
  console.log("🔍 Verifying schema...");

  const missing = await getMissingTables();

  if (missing.length > 0) {
    console.error(`❌ Missing tables: ${missing.join(", ")}`);
    throw new Error(
      `Migration verification failed: tables missing: ${missing.join(", ")}`,
    );
  }

  for (const table of CRITICAL_TABLES) {
    console.log(`  ✓ Table '${table}' exists`);
  }

  console.log("✅ Schema verification passed");
}

/**
 * Create missing tables directly via SQL as a fallback
 */
async function createMissingTablesDirectly(
  missingTables: string[],
): Promise<void> {
  console.log(
    `🔧 Creating missing tables directly: ${missingTables.join(", ")}`,
  );

  // SQL for each critical table that might be missing
  const tableSQL: Record<string, string> = {
    subscription: `
      CREATE TABLE IF NOT EXISTS "subscription" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "user_id" uuid NOT NULL UNIQUE REFERENCES "user"("id") ON DELETE CASCADE,
        "tier" varchar DEFAULT 'free' NOT NULL,
        "stripe_customer_id" text,
        "stripe_subscription_id" text,
        "stripe_price_id" text,
        "status" varchar DEFAULT 'active' NOT NULL,
        "current_period_start" timestamp,
        "current_period_end" timestamp,
        "cancel_at_period_end" boolean DEFAULT false,
        "cancel_at" timestamp,
        "purchased_tokens" text DEFAULT '0' NOT NULL,
        "purchased_tokens_used" text DEFAULT '0' NOT NULL,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
      )`,
    referral: `
      CREATE TABLE IF NOT EXISTS "referral" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "referrer_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
        "referee_id" uuid NOT NULL UNIQUE REFERENCES "user"("id") ON DELETE CASCADE,
        "referral_code" varchar(20) NOT NULL,
        "status" varchar DEFAULT 'pending' NOT NULL,
        "referrer_bonus" text DEFAULT '0' NOT NULL,
        "referee_bonus" text DEFAULT '0' NOT NULL,
        "completed_at" timestamp,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
      )`,
    usage_event: `
      CREATE TABLE IF NOT EXISTS "usage_event" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
        "event_type" varchar NOT NULL,
        "amount" text NOT NULL,
        "metadata" json,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
      CREATE INDEX IF NOT EXISTS "usage_event_user_idx" ON "usage_event" ("user_id");
      CREATE INDEX IF NOT EXISTS "usage_event_type_idx" ON "usage_event" ("event_type");
      CREATE INDEX IF NOT EXISTS "usage_event_created_idx" ON "usage_event" ("created_at")`,
    usage_alert: `
      CREATE TABLE IF NOT EXISTS "usage_alert" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
        "alert_type" varchar NOT NULL,
        "limit_type" varchar NOT NULL,
        "threshold" text NOT NULL,
        "current_usage" text NOT NULL,
        "usage_limit" text NOT NULL,
        "email_sent" boolean DEFAULT false NOT NULL,
        "email_sent_at" timestamp,
        "acknowledged_at" timestamp,
        "period_start" timestamp NOT NULL,
        "period_end" timestamp NOT NULL,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
        CONSTRAINT "usage_alert_unique" UNIQUE("user_id","alert_type","limit_type","period_start")
      );
      CREATE INDEX IF NOT EXISTS "usage_alert_user_id_idx" ON "usage_alert" ("user_id");
      CREATE INDEX IF NOT EXISTS "usage_alert_type_idx" ON "usage_alert" ("alert_type","limit_type")`,
    webhook_event: `
      CREATE TABLE IF NOT EXISTS "webhook_event" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "event_id" text NOT NULL UNIQUE,
        "event_type" text NOT NULL,
        "processed_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "metadata" json
      );
      CREATE INDEX IF NOT EXISTS "webhook_event_id_idx" ON "webhook_event" ("event_id");
      CREATE INDEX IF NOT EXISTS "webhook_event_processed_at_idx" ON "webhook_event" ("processed_at")`,
    webhook_retry_queue: `
      CREATE TABLE IF NOT EXISTS "webhook_retry_queue" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "event_id" text NOT NULL,
        "event_type" text NOT NULL,
        "payload" json NOT NULL,
        "retry_count" text DEFAULT '0' NOT NULL,
        "max_retries" text DEFAULT '5' NOT NULL,
        "next_retry_at" timestamp NOT NULL,
        "last_error" text,
        "status" varchar DEFAULT 'pending' NOT NULL,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
      CREATE INDEX IF NOT EXISTS "webhook_retry_event_id_idx" ON "webhook_retry_queue" ("event_id");
      CREATE INDEX IF NOT EXISTS "webhook_retry_status_idx" ON "webhook_retry_queue" ("status");
      CREATE INDEX IF NOT EXISTS "webhook_retry_next_retry_idx" ON "webhook_retry_queue" ("next_retry_at")`,
    promo_code: `
      CREATE TABLE IF NOT EXISTS "promo_code" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "code" varchar(50) NOT NULL UNIQUE,
        "description" text,
        "discount_type" varchar NOT NULL,
        "discount_value" text NOT NULL,
        "applies_to" varchar DEFAULT 'all' NOT NULL,
        "applicable_tiers" json DEFAULT '[]'::json,
        "applicable_token_packs" json DEFAULT '[]'::json,
        "max_redemptions" text,
        "current_redemptions" text DEFAULT '0' NOT NULL,
        "max_per_user" text DEFAULT '1' NOT NULL,
        "new_users_only" boolean DEFAULT false NOT NULL,
        "min_amount" text,
        "starts_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "expires_at" timestamp,
        "is_active" boolean DEFAULT true NOT NULL,
        "stripe_coupon_id" text,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
      CREATE INDEX IF NOT EXISTS "promo_code_code_idx" ON "promo_code" ("code");
      CREATE INDEX IF NOT EXISTS "promo_code_active_idx" ON "promo_code" ("is_active","expires_at")`,
    promo_code_redemption: `
      CREATE TABLE IF NOT EXISTS "promo_code_redemption" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "promo_code_id" uuid NOT NULL REFERENCES "promo_code"("id") ON DELETE CASCADE,
        "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
        "purchase_type" varchar NOT NULL,
        "original_amount" text NOT NULL,
        "discount_amount" text NOT NULL,
        "final_amount" text NOT NULL,
        "stripe_checkout_session_id" text,
        "stripe_invoice_id" text,
        "redeemed_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
      CREATE INDEX IF NOT EXISTS "redemption_user_idx" ON "promo_code_redemption" ("user_id");
      CREATE INDEX IF NOT EXISTS "redemption_code_idx" ON "promo_code_redemption" ("promo_code_id")`,
    // Agent tables for autonomous agent implementation
    agent_state: `
      CREATE TABLE IF NOT EXISTS "agent_state" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
        "thread_id" uuid REFERENCES "chat_thread"("id") ON DELETE SET NULL,
        "plan_data" json,
        "shared_context" json,
        "status" varchar DEFAULT 'planning' NOT NULL,
        "error_message" text,
        "steps_executed" integer DEFAULT 0 NOT NULL,
        "max_steps" integer DEFAULT 50 NOT NULL,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
      CREATE INDEX IF NOT EXISTS "agent_state_user_id_idx" ON "agent_state" ("user_id");
      CREATE INDEX IF NOT EXISTS "agent_state_thread_id_idx" ON "agent_state" ("thread_id");
      CREATE INDEX IF NOT EXISTS "agent_state_status_idx" ON "agent_state" ("status")`,
    agent_execution_log: `
      CREATE TABLE IF NOT EXISTS "agent_execution_log" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "agent_state_id" uuid NOT NULL REFERENCES "agent_state"("id") ON DELETE CASCADE,
        "step_number" integer NOT NULL,
        "action_type" varchar NOT NULL,
        "action_name" text,
        "input" json,
        "output" json,
        "duration_ms" integer,
        "tokens_used" json,
        "error" text,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
      CREATE INDEX IF NOT EXISTS "agent_exec_log_state_id_idx" ON "agent_execution_log" ("agent_state_id");
      CREATE INDEX IF NOT EXISTS "agent_exec_log_step_idx" ON "agent_execution_log" ("agent_state_id", "step_number");
      CREATE INDEX IF NOT EXISTS "agent_exec_log_action_type_idx" ON "agent_execution_log" ("action_type");
      CREATE INDEX IF NOT EXISTS "agent_exec_log_created_idx" ON "agent_execution_log" ("created_at")`,
    agent_checkpoint: `
      CREATE TABLE IF NOT EXISTS "agent_checkpoint" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "agent_state_id" uuid NOT NULL REFERENCES "agent_state"("id") ON DELETE CASCADE,
        "checkpoint_number" integer NOT NULL,
        "step_number" integer NOT NULL,
        "reason" varchar NOT NULL,
        "state_snapshot" json NOT NULL,
        "used_for_recovery" boolean DEFAULT false NOT NULL,
        "metadata" json,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
      CREATE INDEX IF NOT EXISTS "agent_checkpoint_state_id_idx" ON "agent_checkpoint" ("agent_state_id");
      CREATE INDEX IF NOT EXISTS "agent_checkpoint_number_idx" ON "agent_checkpoint" ("agent_state_id", "checkpoint_number");
      CREATE INDEX IF NOT EXISTS "agent_checkpoint_step_idx" ON "agent_checkpoint" ("agent_state_id", "step_number")`,
    agent_tool_execution: `
      CREATE TABLE IF NOT EXISTS "agent_tool_execution" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "agent_state_id" uuid NOT NULL REFERENCES "agent_state"("id") ON DELETE CASCADE,
        "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
        "tool_name" text NOT NULL,
        "tool_source" varchar NOT NULL,
        "mcp_server_id" uuid REFERENCES "mcp_server"("id") ON DELETE SET NULL,
        "input" json,
        "output" json,
        "success" boolean NOT NULL,
        "error" text,
        "duration_ms" integer,
        "cost" text,
        "started_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "completed_at" timestamp
      );
      CREATE INDEX IF NOT EXISTS "agent_tool_exec_state_id_idx" ON "agent_tool_execution" ("agent_state_id");
      CREATE INDEX IF NOT EXISTS "agent_tool_exec_user_id_idx" ON "agent_tool_execution" ("user_id");
      CREATE INDEX IF NOT EXISTS "agent_tool_exec_tool_name_idx" ON "agent_tool_execution" ("tool_name");
      CREATE INDEX IF NOT EXISTS "agent_tool_exec_source_idx" ON "agent_tool_execution" ("tool_source");
      CREATE INDEX IF NOT EXISTS "agent_tool_exec_started_idx" ON "agent_tool_execution" ("started_at");
      CREATE INDEX IF NOT EXISTS "agent_tool_exec_success_idx" ON "agent_tool_execution" ("success")`,
    agent_sub_agent_relation: `
      CREATE TABLE IF NOT EXISTS "agent_sub_agent_relation" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "parent_agent_state_id" uuid NOT NULL REFERENCES "agent_state"("id") ON DELETE CASCADE,
        "child_agent_state_id" uuid NOT NULL REFERENCES "agent_state"("id") ON DELETE CASCADE,
        "parent_task_id" text,
        "instructions" text,
        "context_keys" json,
        "status" varchar DEFAULT 'spawned' NOT NULL,
        "result" json,
        "spawned_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "completed_at" timestamp
      );
      CREATE INDEX IF NOT EXISTS "agent_sub_agent_parent_idx" ON "agent_sub_agent_relation" ("parent_agent_state_id");
      CREATE INDEX IF NOT EXISTS "agent_sub_agent_child_idx" ON "agent_sub_agent_relation" ("child_agent_state_id");
      CREATE INDEX IF NOT EXISTS "agent_sub_agent_status_idx" ON "agent_sub_agent_relation" ("status")`,
    // Thread sandbox context for per-thread file persistence
    thread_sandbox_context: `
      CREATE TABLE IF NOT EXISTS "thread_sandbox_context" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "thread_id" uuid NOT NULL UNIQUE REFERENCES "chat_thread"("id") ON DELETE CASCADE,
        "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
        "context_storage_key" varchar(512),
        "context_size_bytes" text DEFAULT '0' NOT NULL,
        "file_metadata" json DEFAULT '[]'::json,
        "total_files_count" integer DEFAULT 0 NOT NULL,
        "last_execution_at" timestamp,
        "last_accessed_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
      CREATE INDEX IF NOT EXISTS "thread_sandbox_context_thread_idx" ON "thread_sandbox_context" ("thread_id");
      CREATE INDEX IF NOT EXISTS "thread_sandbox_context_user_idx" ON "thread_sandbox_context" ("user_id");
      CREATE INDEX IF NOT EXISTS "thread_sandbox_context_cleanup_idx" ON "thread_sandbox_context" ("last_accessed_at")`,
    // MCP server table
    mcp_server: `
      CREATE TABLE IF NOT EXISTS "mcp_server" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "name" text NOT NULL,
        "config" json NOT NULL,
        "enabled" boolean DEFAULT true NOT NULL,
        "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
        "visibility" varchar DEFAULT 'private' NOT NULL,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
      CREATE INDEX IF NOT EXISTS "mcp_server_user_idx" ON "mcp_server" ("user_id");
      CREATE INDEX IF NOT EXISTS "mcp_server_visibility_idx" ON "mcp_server" ("visibility")`,
    // Browser session table
    browser_session: `
      CREATE TABLE IF NOT EXISTS "browser_session" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "thread_id" uuid REFERENCES "chat_thread"("id") ON DELETE CASCADE,
        "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
        "provider" varchar NOT NULL,
        "session_id" text NOT NULL,
        "status" varchar DEFAULT 'active' NOT NULL,
        "current_url" text,
        "replay_url" text,
        "screenshots" json DEFAULT '[]'::json,
        "metadata" json,
        "last_activity_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "expires_at" timestamp,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "closed_at" timestamp
      );
      CREATE INDEX IF NOT EXISTS "browser_session_thread_idx" ON "browser_session" ("thread_id");
      CREATE INDEX IF NOT EXISTS "browser_session_user_idx" ON "browser_session" ("user_id");
      CREATE INDEX IF NOT EXISTS "browser_session_provider_idx" ON "browser_session" ("provider");
      CREATE INDEX IF NOT EXISTS "browser_session_status_idx" ON "browser_session" ("status");
      CREATE INDEX IF NOT EXISTS "browser_session_session_id_idx" ON "browser_session" ("session_id");
      CREATE INDEX IF NOT EXISTS "browser_session_expires_idx" ON "browser_session" ("expires_at");
      CREATE INDEX IF NOT EXISTS "browser_session_activity_idx" ON "browser_session" ("last_activity_at");
      CREATE INDEX IF NOT EXISTS "browser_session_cleanup_idx" ON "browser_session" ("status", "expires_at")`,
    // Chat message table
    chat_message: `
      CREATE TABLE IF NOT EXISTS "chat_message" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "thread_id" uuid NOT NULL REFERENCES "chat_thread"("id") ON DELETE CASCADE,
        "role" varchar NOT NULL,
        "content" text,
        "tool_invocations" json,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
      CREATE INDEX IF NOT EXISTS "chat_message_thread_idx" ON "chat_message" ("thread_id")`,
    // Agent table
    agent: `
      CREATE TABLE IF NOT EXISTS "agent" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
        "name" text NOT NULL,
        "description" text,
        "system_prompt" text,
        "model" text,
        "tools" json DEFAULT '[]'::json,
        "is_public" boolean DEFAULT false NOT NULL,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
      CREATE INDEX IF NOT EXISTS "agent_user_idx" ON "agent" ("user_id")`,
    // Workflow table
    workflow: `
      CREATE TABLE IF NOT EXISTS "workflow" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
        "name" text NOT NULL,
        "description" text,
        "nodes" json DEFAULT '[]'::json,
        "edges" json DEFAULT '[]'::json,
        "is_public" boolean DEFAULT false NOT NULL,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
      CREATE INDEX IF NOT EXISTS "workflow_user_idx" ON "workflow" ("user_id")`,
    // Archive table
    archive: `
      CREATE TABLE IF NOT EXISTS "archive" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
        "thread_id" uuid REFERENCES "chat_thread"("id") ON DELETE SET NULL,
        "title" text,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
      CREATE INDEX IF NOT EXISTS "archive_user_idx" ON "archive" ("user_id")`,
    // Chat export table
    chat_export: `
      CREATE TABLE IF NOT EXISTS "chat_export" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
        "thread_id" uuid REFERENCES "chat_thread"("id") ON DELETE SET NULL,
        "title" text,
        "share_id" text UNIQUE,
        "is_public" boolean DEFAULT false NOT NULL,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
      CREATE INDEX IF NOT EXISTS "chat_export_user_idx" ON "chat_export" ("user_id");
      CREATE INDEX IF NOT EXISTS "chat_export_share_idx" ON "chat_export" ("share_id")`,
    // Bookmark table
    bookmark: `
      CREATE TABLE IF NOT EXISTS "bookmark" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
        "thread_id" uuid REFERENCES "chat_thread"("id") ON DELETE CASCADE,
        "message_id" uuid,
        "note" text,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
      CREATE INDEX IF NOT EXISTS "bookmark_user_idx" ON "bookmark" ("user_id")`,
    // MCP tool customization table
    mcp_tool_customization: `
      CREATE TABLE IF NOT EXISTS "mcp_tool_customization" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "tool_name" text NOT NULL,
        "mcp_server_id" uuid NOT NULL REFERENCES "mcp_server"("id") ON DELETE CASCADE,
        "prompt" text,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
      )`,
    // MCP server customization table
    mcp_server_customization: `
      CREATE TABLE IF NOT EXISTS "mcp_server_customization" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
        "mcp_server_id" uuid NOT NULL REFERENCES "mcp_server"("id") ON DELETE CASCADE,
        "prompt" text,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
      )`,
    // MCP OAuth session table
    mcp_oauth_session: `
      CREATE TABLE IF NOT EXISTS "mcp_oauth_session" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "mcp_server_id" uuid NOT NULL REFERENCES "mcp_server"("id") ON DELETE CASCADE,
        "server_url" text NOT NULL,
        "client_info" json,
        "tokens" json,
        "code_verifier" text,
        "state" text,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
      )`,
    // Research task table
    research_task: `
      CREATE TABLE IF NOT EXISTS "research_task" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
        "thread_id" uuid REFERENCES "chat_thread"("id") ON DELETE SET NULL,
        "query" text NOT NULL,
        "status" varchar DEFAULT 'pending' NOT NULL,
        "result" json,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
      CREATE INDEX IF NOT EXISTS "research_task_user_idx" ON "research_task" ("user_id")`,
    e2b_usage: `
      CREATE TABLE IF NOT EXISTS "e2b_usage" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
        "session_id" varchar(100) NOT NULL,
        "template" varchar(100),
        "duration_ms" integer NOT NULL,
        "credits_used" text NOT NULL,
        "cost_usd" text NOT NULL,
        "operation_type" varchar(50),
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
      CREATE INDEX IF NOT EXISTS "e2b_usage_user_idx" ON "e2b_usage" ("user_id");
      CREATE INDEX IF NOT EXISTS "e2b_usage_created_idx" ON "e2b_usage" ("created_at")`,
    fragments: `
      CREATE TABLE IF NOT EXISTS "fragments" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "thread_id" uuid NOT NULL REFERENCES "chat_thread"("id") ON DELETE CASCADE,
        "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
        "template" varchar(100) NOT NULL,
        "title" varchar(100) NOT NULL,
        "description" text,
        "code" text NOT NULL,
        "file_path" varchar(500) NOT NULL,
        "port" integer,
        "sandbox_id" varchar(100),
        "preview_url" text,
        "deployment_url" text,
        "status" varchar(50) DEFAULT 'draft',
        "error_message" text,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
      CREATE INDEX IF NOT EXISTS "idx_fragments_thread" ON "fragments" ("thread_id");
      CREATE INDEX IF NOT EXISTS "idx_fragments_user" ON "fragments" ("user_id");
      CREATE INDEX IF NOT EXISTS "idx_fragments_status" ON "fragments" ("status")`,
    fragment_executions: `
      CREATE TABLE IF NOT EXISTS "fragment_executions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "fragment_id" uuid NOT NULL REFERENCES "fragments"("id") ON DELETE CASCADE,
        "sandbox_id" varchar(100) NOT NULL,
        "template" varchar(100) NOT NULL,
        "stdout" text,
        "stderr" text,
        "runtime_error" text,
        "preview_url" text,
        "execution_time_ms" integer,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
      CREATE INDEX IF NOT EXISTS "idx_fragment_executions_fragment" ON "fragment_executions" ("fragment_id")`,
    fragment_shares: `
      CREATE TABLE IF NOT EXISTS "fragment_shares" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "fragment_id" uuid NOT NULL REFERENCES "fragments"("id") ON DELETE CASCADE,
        "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
        "share_id" varchar(50) NOT NULL UNIQUE,
        "expires_at" timestamp,
        "is_active" boolean DEFAULT true,
        "view_count" integer DEFAULT 0,
        "last_viewed_at" timestamp,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
      CREATE INDEX IF NOT EXISTS "idx_fragment_shares_fragment" ON "fragment_shares" ("fragment_id");
      CREATE INDEX IF NOT EXISTS "idx_fragment_shares_share_id" ON "fragment_shares" ("share_id")`,
  };

  // Add referral columns to user table if they don't exist
  const userColumnsSQL = `
    DO $$ BEGIN
      ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "referral_code" varchar(20);
      ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "referred_by_id" uuid;
      ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "total_referrals" integer DEFAULT 0 NOT NULL;
      ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "total_referral_bonus" text DEFAULT '0' NOT NULL;
    EXCEPTION WHEN others THEN NULL;
    END $$;
  `;

  // Fix all tables if they exist with wrong schema
  const fixAllTablesSQL = `
    DO $$ BEGIN
      -- Fix browser_session table
      ALTER TABLE "browser_session" ADD COLUMN IF NOT EXISTS "provider" varchar NOT NULL DEFAULT 'browserbase';
      ALTER TABLE "browser_session" ADD COLUMN IF NOT EXISTS "session_id" text NOT NULL DEFAULT '';
      ALTER TABLE "browser_session" ADD COLUMN IF NOT EXISTS "current_url" text;
      ALTER TABLE "browser_session" ADD COLUMN IF NOT EXISTS "replay_url" text;
      ALTER TABLE "browser_session" ADD COLUMN IF NOT EXISTS "screenshots" json DEFAULT '[]'::json;
      ALTER TABLE "browser_session" ADD COLUMN IF NOT EXISTS "last_activity_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL;
      ALTER TABLE "browser_session" ADD COLUMN IF NOT EXISTS "expires_at" timestamp;
      ALTER TABLE "browser_session" ADD COLUMN IF NOT EXISTS "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL;
      ALTER TABLE "browser_session" ADD COLUMN IF NOT EXISTS "closed_at" timestamp;
      ALTER TABLE "browser_session" ADD COLUMN IF NOT EXISTS "metadata" json;
    EXCEPTION WHEN others THEN NULL;
    END $$;

    DO $$ BEGIN
      -- Fix chat_message table
      ALTER TABLE "chat_message" ADD COLUMN IF NOT EXISTS "parts" json;
      ALTER TABLE "chat_message" ADD COLUMN IF NOT EXISTS "metadata" json;
    EXCEPTION WHEN others THEN NULL;
    END $$;

    DO $$ BEGIN
      -- Fix agent table
      ALTER TABLE "agent" ADD COLUMN IF NOT EXISTS "icon" json;
      ALTER TABLE "agent" ADD COLUMN IF NOT EXISTS "instructions" json;
      ALTER TABLE "agent" ADD COLUMN IF NOT EXISTS "visibility" varchar DEFAULT 'private' NOT NULL;
    EXCEPTION WHEN others THEN NULL;
    END $$;

    DO $$ BEGIN
      -- Fix workflow table
      ALTER TABLE "workflow" ADD COLUMN IF NOT EXISTS "version" text DEFAULT '0.1.0' NOT NULL;
      ALTER TABLE "workflow" ADD COLUMN IF NOT EXISTS "icon" json;
      ALTER TABLE "workflow" ADD COLUMN IF NOT EXISTS "is_published" boolean DEFAULT false NOT NULL;
      ALTER TABLE "workflow" ADD COLUMN IF NOT EXISTS "visibility" varchar DEFAULT 'private' NOT NULL;
    EXCEPTION WHEN others THEN NULL;
    END $$;

    DO $$ BEGIN
      -- Fix archive table
      ALTER TABLE "archive" ADD COLUMN IF NOT EXISTS "name" text;
      ALTER TABLE "archive" ADD COLUMN IF NOT EXISTS "description" text;
      ALTER TABLE "archive" ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL;
    EXCEPTION WHEN others THEN NULL;
    END $$;

    DO $$ BEGIN
      -- Fix chat_export table
      ALTER TABLE "chat_export" ADD COLUMN IF NOT EXISTS "exporter_id" uuid;
      ALTER TABLE "chat_export" ADD COLUMN IF NOT EXISTS "original_thread_id" uuid;
      ALTER TABLE "chat_export" ADD COLUMN IF NOT EXISTS "messages" json;
      ALTER TABLE "chat_export" ADD COLUMN IF NOT EXISTS "exported_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL;
      ALTER TABLE "chat_export" ADD COLUMN IF NOT EXISTS "expires_at" timestamp;
      ALTER TABLE "chat_export" ADD COLUMN IF NOT EXISTS "title" text;
    EXCEPTION WHEN others THEN NULL;
    END $$;

    DO $$ BEGIN
      -- Fix bookmark table
      ALTER TABLE "bookmark" ADD COLUMN IF NOT EXISTS "item_id" uuid;
      ALTER TABLE "bookmark" ADD COLUMN IF NOT EXISTS "item_type" varchar;
    EXCEPTION WHEN others THEN NULL;
    END $$;

    DO $$ BEGIN
      -- Fix research_task table
      ALTER TABLE "research_task" ADD COLUMN IF NOT EXISTS "depth" varchar DEFAULT 'standard' NOT NULL;
      ALTER TABLE "research_task" ADD COLUMN IF NOT EXISTS "current_step" text;
      ALTER TABLE "research_task" ADD COLUMN IF NOT EXISTS "progress" integer DEFAULT 0 NOT NULL;
      ALTER TABLE "research_task" ADD COLUMN IF NOT EXISTS "sources" json DEFAULT '[]'::json;
      ALTER TABLE "research_task" ADD COLUMN IF NOT EXISTS "findings" json DEFAULT '[]'::json;
      ALTER TABLE "research_task" ADD COLUMN IF NOT EXISTS "citations" json DEFAULT '[]'::json;
      ALTER TABLE "research_task" ADD COLUMN IF NOT EXISTS "report" text;
      ALTER TABLE "research_task" ADD COLUMN IF NOT EXISTS "error" text;
      ALTER TABLE "research_task" ADD COLUMN IF NOT EXISTS "browser_session_id" uuid;
      ALTER TABLE "research_task" ADD COLUMN IF NOT EXISTS "completed_at" timestamp;
    EXCEPTION WHEN others THEN NULL;
    END $$;

    DO $$ BEGIN
      -- Fix mcp_server_tool_custom_instructions table
      ALTER TABLE "mcp_server_tool_custom_instructions" ADD COLUMN IF NOT EXISTS "user_id" uuid;
    EXCEPTION WHEN others THEN NULL;
    END $$;
  `;

  try {
    // Fix all tables with missing columns
    await pgDb.execute(sql.raw(fixAllTablesSQL));
    console.log("  ✓ All table columns ensured");

    // Add user columns first
    await pgDb.execute(sql.raw(userColumnsSQL));
    console.log("  ✓ User referral columns ensured");

    // Create each missing table
    for (const table of missingTables) {
      if (tableSQL[table]) {
        await pgDb.execute(sql.raw(tableSQL[table]));
        console.log(`  ✓ Table '${table}' created`);
      }
    }

    // Try to add the unique constraint on referral_code if not exists
    try {
      await pgDb.execute(
        sql.raw(`
        DO $$ BEGIN
          ALTER TABLE "user" ADD CONSTRAINT "user_referral_code_unique" UNIQUE("referral_code");
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
      `),
      );
      console.log("  ✓ Referral code unique constraint ensured");
    } catch {
      // Constraint might already exist or have conflicts - that's ok
    }

    // Create indexes for referral table (other indexes are created in tableSQL)
    const indexSQL = `
      CREATE INDEX IF NOT EXISTS "referral_referrer_id_idx" ON "referral" ("referrer_id");
      CREATE INDEX IF NOT EXISTS "referral_referee_id_idx" ON "referral" ("referee_id");
      CREATE INDEX IF NOT EXISTS "referral_status_idx" ON "referral" ("status");
    `;
    await pgDb.execute(sql.raw(indexSQL));
    console.log("  ✓ Referral indexes created");

    console.log("✅ Direct table creation completed");
  } catch (err) {
    console.error("❌ Direct table creation failed:", err);
    throw err;
  }
}

/**
 * Sync missing tables - uses direct SQL creation to avoid interactive prompts
 */
async function syncMissingTables(missingTables: string[]): Promise<void> {
  // In CI environments, drizzle-kit push has interactive prompts that can't be bypassed
  // So we directly create the missing tables via SQL instead
  console.log("🔄 Syncing missing tables via direct SQL...");
  await createMissingTablesDirectly(missingTables);
}

export const runMigrate = async () => {
  console.log("⏳ Running PostgreSQL migrations...");

  // PRODUCTION SAFEGUARD: Prevent accidental data loss
  // Skip safeguard if SKIP_MIGRATION_SAFEGUARD is set (for Vercel builds with no schema changes)
  // Also skip if running on Vercel (VERCEL env is set) or in CI environments - migrations are safe in CI
  const skipSafeguard =
    process.env.SKIP_MIGRATION_SAFEGUARD === "true" ||
    process.env.VERCEL === "1" ||
    process.env.CI === "true";
  const dbUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL || "";
  const isProduction =
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production" ||
    dbUrl.includes("neon.tech") ||
    dbUrl.includes("supabase.co") ||
    dbUrl.includes(".aws") ||
    dbUrl.includes(".azure");

  if (skipSafeguard) {
    console.log(
      "⏭️  Skipping production safeguard (SKIP_MIGRATION_SAFEGUARD, VERCEL, or CI env set)",
    );
  }

  if (isProduction && !skipSafeguard) {
    // Check if database has existing user data
    try {
      // First check if user table exists
      const tableCheck = await pgDb.execute(
        sql`SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public'
          AND table_name = 'user'
        ) as exists`,
      );
      const tableExists = tableCheck.rows[0]?.exists === true;

      if (tableExists) {
        // Check if there are any users
        const userCountResult = await pgDb.execute(
          sql`SELECT COUNT(*)::int as count FROM "user"`,
        );
        const userCount = parseInt(
          String(userCountResult.rows[0]?.count || "0"),
        );

        if (userCount > 0) {
          console.error(
            "🚨 PRODUCTION SAFEGUARD: Database contains user data!",
          );
          console.error(`   Found ${userCount} user(s) in the database.`);
          console.error(
            "   Migrations are blocked in production when users exist.",
          );
          console.error(
            "   If you need to migrate, use a separate migration tool or contact support.",
          );
          throw new Error(
            "Cannot run migrations in production database with existing users",
          );
        }
      }
    } catch (err: unknown) {
      // If check fails, allow migration (might be first setup)
      if (
        err instanceof Error &&
        err.message.includes("Cannot run migrations")
      ) {
        throw err;
      }
      // Otherwise continue (table might not exist yet or query failed)
    }
  }

  // Check database connection first
  try {
    await pgDb.execute(sql`SELECT 1`);
    console.log("✅ Database connection successful");
  } catch (err) {
    console.error("❌ Failed to connect to database:", err);
    console.error("   POSTGRES_URL set:", !!process.env.POSTGRES_URL);
    throw new Error(
      "Database connection failed - check POSTGRES_URL environment variable",
    );
  }

  const start = Date.now();

  // Check for missing tables before migration
  const missingBefore = await getMissingTables();
  if (missingBefore.length > 0) {
    console.log(`⚠️ Missing tables detected: ${missingBefore.join(", ")}`);
  }

  try {
    await migrate(pgDb, {
      migrationsFolder: join(process.cwd(), "src/lib/db/migrations/pg"),
    });
    console.log("✅ Migrations applied successfully");
  } catch (err: unknown) {
    const error = err as {
      code?: string;
      cause?: { code?: string };
      message?: string;
    };
    // Handle "already exists" errors (code 42P07)
    // This happens when schema was pushed via db:push instead of migrate
    if (error?.code === "42P07" || error?.cause?.code === "42P07") {
      console.log("⚠️ Some tables already exist (previous db:push detected)");
    } else {
      console.error(
        `❌ PostgreSQL migrations failed:`,
        error?.message || error,
      );
      throw err;
    }
  }

  // Check if we still have missing tables after migration
  const missingAfter = await getMissingTables();
  if (missingAfter.length > 0) {
    console.log(
      `⚠️ Tables still missing after migrate: ${missingAfter.join(", ")}`,
    );
    console.log("🔄 Falling back to direct SQL to create missing tables...");
    await syncMissingTables(missingAfter);
  }

  const end = Date.now();
  console.log(`✅ PostgreSQL migrations completed in ${end - start}ms`);

  // Final verification
  await verifySchema();
};
