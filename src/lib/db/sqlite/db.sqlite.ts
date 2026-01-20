import path from "path";
import fs from "fs-extra";
import type BetterSqlite3 from "better-sqlite3";
import * as schema from "./schema.sqlite";

/**
 * SQLite Database Module - Electron-Only Application
 *
 * This module manages the SQLite database for the Electron app.
 * In dev mode, Next.js may run alongside Electron with different Node.js versions,
 * causing native module version mismatches.
 */

// Type alias for the SQLite database instance
type SqliteDatabase = BetterSqlite3.Database;

// Type for the drizzle database instance
type DrizzleDb = ReturnType<
  typeof import("drizzle-orm/better-sqlite3").drizzle<typeof schema>
>;

// Use dynamic require for better-sqlite3 to handle Electron mode gracefully
let Database: typeof BetterSqlite3 | null = null;
let drizzle: typeof import("drizzle-orm/better-sqlite3").drizzle | null = null;
let IS_SQLITE_AVAILABLE = false;

// Try to load better-sqlite3
try {
  Database = require("better-sqlite3");
  drizzle = require("drizzle-orm/better-sqlite3").drizzle;
  IS_SQLITE_AVAILABLE = true;
} catch (_error: any) {
  // In Electron dev mode, native module version mismatch is expected
  // Database operations will be handled by Electron IPC instead
  // Silently set IS_SQLITE_AVAILABLE = false (already default)
}

// Get the Electron userData path for the current platform
// This must match what Electron main process uses in electron/services/database.ts
const getElectronUserDataPath = () => {
  const platform = process.platform;
  const appName = "shadower"; // Must match Electron app name

  if (platform === "darwin") {
    // macOS: ~/Library/Application Support/shadower
    return path.join(
      process.env.HOME || "",
      "Library",
      "Application Support",
      appName,
    );
  } else if (platform === "win32") {
    // Windows: %APPDATA%/shadower
    return path.join(process.env.APPDATA || "", appName);
  } else {
    // Linux: ~/.config/shadower
    return path.join(process.env.HOME || "", ".config", appName);
  }
};

// Get database path - MUST use same path as Electron main process
const getDbPath = () => {
  // Always use Electron's userData path for consistency
  // This ensures Next.js server and Electron main process share the same database
  const userDataDir = getElectronUserDataPath();
  const dbDir = path.join(userDataDir, "data");
  fs.ensureDirSync(dbDir);
  const dbPath = path.join(dbDir, "shadower.db");

  // Log the database path for debugging
  if (process.env.NODE_ENV === "development") {
    console.log(`[SQLite] Using database at: ${dbPath}`);
  }

  return dbPath;
};

// Initialize SQLite database connection
let sqlite: SqliteDatabase | null = null;
let db: DrizzleDb | null = null;

// Helper to check if a column exists in a table
const columnExists = (
  sqliteInstance: SqliteDatabase,
  tableName: string,
  columnName: string,
): boolean => {
  try {
    const result = sqliteInstance
      .prepare(`PRAGMA table_info(${tableName})`)
      .all() as Array<{ name: string }>;
    return result.some((col) => col.name === columnName);
  } catch {
    return false;
  }
};

// Helper to check if a table exists
const tableExists = (
  sqliteInstance: SqliteDatabase,
  tableName: string,
): boolean => {
  try {
    const result = sqliteInstance
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
      .get(tableName);
    return !!result;
  } catch {
    return false;
  }
};

// Run migrations for existing databases
const runMigrations = (sqliteInstance: SqliteDatabase) => {
  console.log("[SQLite] Running migrations...");

  // User table migrations
  if (tableExists(sqliteInstance, "user")) {
    if (!columnExists(sqliteInstance, "user", "password")) {
      console.log("[SQLite] Adding password column to user table...");
      sqliteInstance.exec(`ALTER TABLE user ADD COLUMN password TEXT`);
    }
  }

  // Session table migrations
  if (tableExists(sqliteInstance, "session")) {
    if (!columnExists(sqliteInstance, "session", "impersonated_by")) {
      console.log("[SQLite] Adding impersonated_by column to session table...");
      sqliteInstance.exec(
        `ALTER TABLE session ADD COLUMN impersonated_by TEXT`,
      );
    }
  }

  // Subscription table migrations
  if (tableExists(sqliteInstance, "subscription")) {
    if (!columnExists(sqliteInstance, "subscription", "tier")) {
      console.log("[SQLite] Adding tier column to subscription table...");
      sqliteInstance.exec(
        `ALTER TABLE subscription ADD COLUMN tier TEXT NOT NULL DEFAULT 'free'`,
      );
    }
    if (!columnExists(sqliteInstance, "subscription", "purchased_tokens")) {
      console.log(
        "[SQLite] Adding purchased_tokens column to subscription table...",
      );
      sqliteInstance.exec(
        `ALTER TABLE subscription ADD COLUMN purchased_tokens TEXT NOT NULL DEFAULT '0'`,
      );
    }
    if (
      !columnExists(sqliteInstance, "subscription", "purchased_tokens_used")
    ) {
      console.log(
        "[SQLite] Adding purchased_tokens_used column to subscription table...",
      );
      sqliteInstance.exec(
        `ALTER TABLE subscription ADD COLUMN purchased_tokens_used TEXT NOT NULL DEFAULT '0'`,
      );
    }
    if (!columnExists(sqliteInstance, "subscription", "cancel_at")) {
      console.log("[SQLite] Adding cancel_at column to subscription table...");
      sqliteInstance.exec(
        `ALTER TABLE subscription ADD COLUMN cancel_at INTEGER`,
      );
    }
  }

  // Archive table migrations
  if (tableExists(sqliteInstance, "archive")) {
    if (!columnExists(sqliteInstance, "archive", "description")) {
      console.log("[SQLite] Adding description column to archive table...");
      sqliteInstance.exec(`ALTER TABLE archive ADD COLUMN description TEXT`);
    }
    if (!columnExists(sqliteInstance, "archive", "updated_at")) {
      console.log("[SQLite] Adding updated_at column to archive table...");
      sqliteInstance.exec(`ALTER TABLE archive ADD COLUMN updated_at INTEGER`);
    }
  }

  // Workflow table migrations
  if (tableExists(sqliteInstance, "workflow")) {
    if (!columnExists(sqliteInstance, "workflow", "version")) {
      console.log("[SQLite] Adding version column to workflow table...");
      sqliteInstance.exec(
        `ALTER TABLE workflow ADD COLUMN version TEXT NOT NULL DEFAULT '0.1.0'`,
      );
    }
    if (!columnExists(sqliteInstance, "workflow", "icon")) {
      console.log("[SQLite] Adding icon column to workflow table...");
      sqliteInstance.exec(`ALTER TABLE workflow ADD COLUMN icon TEXT`);
    }
    if (!columnExists(sqliteInstance, "workflow", "is_published")) {
      console.log("[SQLite] Adding is_published column to workflow table...");
      sqliteInstance.exec(
        `ALTER TABLE workflow ADD COLUMN is_published INTEGER NOT NULL DEFAULT 0`,
      );
    }
  }

  console.log("[SQLite] Migrations complete");
};

// Create all tables if they don't exist
const createTablesIfNotExist = (sqliteInstance: SqliteDatabase) => {
  console.log("[SQLite] Checking and creating tables if needed...");

  try {
    // Level 1: Base tables (no dependencies)
    sqliteInstance.exec(`
      CREATE TABLE IF NOT EXISTS user (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        email_verified INTEGER NOT NULL DEFAULT 0,
        password TEXT,
        image TEXT,
        preferences TEXT,
        created_at INTEGER,
        updated_at INTEGER,
        banned INTEGER DEFAULT 0,
        ban_reason TEXT,
        ban_expires INTEGER,
        role TEXT NOT NULL DEFAULT 'user'
      );
    `);

    // Level 2: Auth tables (depend on user)
    sqliteInstance.exec(`
      CREATE TABLE IF NOT EXISTS session (
        id TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL,
        token TEXT NOT NULL UNIQUE,
        created_at INTEGER,
        updated_at INTEGER,
        ip_address TEXT,
        user_agent TEXT,
        user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
        impersonated_by TEXT
      );

      CREATE TABLE IF NOT EXISTS account (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
        access_token TEXT,
        refresh_token TEXT,
        id_token TEXT,
        access_token_expires_at INTEGER,
        refresh_token_expires_at INTEGER,
        scope TEXT,
        password TEXT,
        created_at INTEGER,
        updated_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS verification (
        id TEXT PRIMARY KEY,
        identifier TEXT NOT NULL,
        value TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER,
        updated_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS user_invitation (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        token TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL DEFAULT 'editor',
        invited_by TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL,
        accepted_at INTEGER,
        revoked_at INTEGER,
        created_at INTEGER
      );
    `);

    // Level 3: User-dependent tables
    sqliteInstance.exec(`
      CREATE TABLE IF NOT EXISTS chat_thread (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
        created_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS agent (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        icon TEXT,
        user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
        instructions TEXT,
        visibility TEXT NOT NULL DEFAULT 'private',
        created_at INTEGER,
        updated_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS bookmark (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
        item_id TEXT NOT NULL,
        item_type TEXT NOT NULL,
        created_at INTEGER,
        UNIQUE(user_id, item_id, item_type)
      );

      CREATE TABLE IF NOT EXISTS mcp_server (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        config TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
        visibility TEXT NOT NULL DEFAULT 'private',
        created_at INTEGER,
        updated_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS workflow (
        id TEXT PRIMARY KEY,
        version TEXT NOT NULL DEFAULT '0.1.0',
        name TEXT NOT NULL,
        icon TEXT,
        description TEXT,
        is_published INTEGER NOT NULL DEFAULT 0,
        visibility TEXT NOT NULL DEFAULT 'private',
        user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
        created_at INTEGER,
        updated_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS archive (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
        created_at INTEGER,
        updated_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS subscription (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE REFERENCES user(id) ON DELETE CASCADE,
        tier TEXT NOT NULL DEFAULT 'free',
        stripe_customer_id TEXT,
        stripe_subscription_id TEXT,
        stripe_price_id TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        current_period_start INTEGER,
        current_period_end INTEGER,
        cancel_at_period_end INTEGER DEFAULT 0,
        cancel_at INTEGER,
        purchased_tokens TEXT NOT NULL DEFAULT '0',
        purchased_tokens_used TEXT NOT NULL DEFAULT '0',
        created_at INTEGER,
        updated_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS usage_event (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        amount TEXT NOT NULL,
        metadata TEXT,
        created_at INTEGER
      );

    `);

    // Level 4: Tables depending on chat_thread
    sqliteInstance.exec(`
      CREATE TABLE IF NOT EXISTS chat_message (
        id TEXT PRIMARY KEY NOT NULL,
        thread_id TEXT NOT NULL REFERENCES chat_thread(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        parts TEXT NOT NULL,
        metadata TEXT,
        created_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS chat_export (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        exporter_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
        original_thread_id TEXT,
        messages TEXT NOT NULL,
        exported_at INTEGER,
        expires_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS conversation_summary (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES chat_thread(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
        summary TEXT NOT NULL,
        messages_compacted INTEGER NOT NULL,
        tokens_saved INTEGER NOT NULL,
        summary_tokens INTEGER NOT NULL DEFAULT 0,
        parent_summary_id TEXT,
        sequence_number INTEGER NOT NULL DEFAULT 1,
        model_provider TEXT,
        model_name TEXT,
        created_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS thread_file_context (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL UNIQUE REFERENCES chat_thread(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
        context_storage_key TEXT,
        context_size_bytes TEXT NOT NULL DEFAULT '0',
        file_metadata TEXT DEFAULT '[]',
        total_files_count INTEGER NOT NULL DEFAULT 0,
        last_execution_at INTEGER,
        last_accessed_at INTEGER,
        created_at INTEGER
      );
    `);

    // Level 5: Agent state tables
    sqliteInstance.exec(`
      CREATE TABLE IF NOT EXISTS agent_state (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
        thread_id TEXT REFERENCES chat_thread(id) ON DELETE SET NULL,
        plan_data TEXT,
        shared_context TEXT,
        status TEXT NOT NULL DEFAULT 'planning',
        error_message TEXT,
        steps_executed INTEGER NOT NULL DEFAULT 0,
        max_steps INTEGER NOT NULL DEFAULT 50,
        created_at INTEGER,
        updated_at INTEGER
      );
    `);

    // Level 6: Tables depending on agent_state
    sqliteInstance.exec(`
      CREATE TABLE IF NOT EXISTS agent_execution_log (
        id TEXT PRIMARY KEY,
        agent_state_id TEXT NOT NULL REFERENCES agent_state(id) ON DELETE CASCADE,
        step_number INTEGER NOT NULL,
        action_type TEXT NOT NULL,
        action_name TEXT,
        input TEXT,
        output TEXT,
        duration_ms INTEGER,
        tokens_used TEXT,
        error TEXT,
        created_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS agent_checkpoint (
        id TEXT PRIMARY KEY,
        agent_state_id TEXT NOT NULL REFERENCES agent_state(id) ON DELETE CASCADE,
        checkpoint_number INTEGER NOT NULL,
        step_number INTEGER NOT NULL,
        reason TEXT NOT NULL,
        state_snapshot TEXT NOT NULL,
        used_for_recovery INTEGER NOT NULL DEFAULT 0,
        metadata TEXT,
        created_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS agent_tool_execution (
        id TEXT PRIMARY KEY,
        agent_state_id TEXT NOT NULL REFERENCES agent_state(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
        tool_name TEXT NOT NULL,
        tool_source TEXT NOT NULL,
        mcp_server_id TEXT REFERENCES mcp_server(id) ON DELETE SET NULL,
        input TEXT,
        output TEXT,
        success INTEGER NOT NULL,
        error TEXT,
        duration_ms INTEGER,
        cost TEXT,
        started_at INTEGER,
        completed_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS agent_sub_agent_relation (
        id TEXT PRIMARY KEY,
        parent_agent_state_id TEXT NOT NULL REFERENCES agent_state(id) ON DELETE CASCADE,
        child_agent_state_id TEXT NOT NULL REFERENCES agent_state(id) ON DELETE CASCADE,
        parent_task_id TEXT,
        instructions TEXT,
        context_keys TEXT,
        status TEXT NOT NULL DEFAULT 'spawned',
        result TEXT,
        spawned_at INTEGER,
        completed_at INTEGER
      );
    `);

    // Level 7: Tables depending on mcp_server
    sqliteInstance.exec(`
      CREATE TABLE IF NOT EXISTS mcp_server_tool_custom_instructions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
        tool_name TEXT NOT NULL,
        mcp_server_id TEXT NOT NULL REFERENCES mcp_server(id) ON DELETE CASCADE,
        prompt TEXT,
        created_at INTEGER,
        updated_at INTEGER,
        UNIQUE(user_id, tool_name, mcp_server_id)
      );

      CREATE TABLE IF NOT EXISTS mcp_server_custom_instructions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
        mcp_server_id TEXT NOT NULL REFERENCES mcp_server(id) ON DELETE CASCADE,
        prompt TEXT,
        created_at INTEGER,
        updated_at INTEGER,
        UNIQUE(user_id, mcp_server_id)
      );

      CREATE TABLE IF NOT EXISTS mcp_oauth_session (
        id TEXT PRIMARY KEY,
        mcp_server_id TEXT NOT NULL REFERENCES mcp_server(id) ON DELETE CASCADE,
        server_url TEXT NOT NULL,
        client_info TEXT,
        tokens TEXT,
        code_verifier TEXT,
        state TEXT UNIQUE,
        created_at INTEGER,
        updated_at INTEGER
      );
    `);

    // Level 8: Tables depending on workflow
    sqliteInstance.exec(`
      CREATE TABLE IF NOT EXISTS workflow_node (
        id TEXT PRIMARY KEY,
        version TEXT NOT NULL DEFAULT '0.1.0',
        workflow_id TEXT NOT NULL REFERENCES workflow(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        ui_config TEXT DEFAULT '{}',
        node_config TEXT DEFAULT '{}',
        created_at INTEGER,
        updated_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS workflow_edge (
        id TEXT PRIMARY KEY,
        version TEXT NOT NULL DEFAULT '0.1.0',
        workflow_id TEXT NOT NULL REFERENCES workflow(id) ON DELETE CASCADE,
        source TEXT NOT NULL,
        target TEXT NOT NULL,
        ui_config TEXT DEFAULT '{}',
        created_at INTEGER
      );
    `);

    // Level 9: Tables depending on archive
    sqliteInstance.exec(`
      CREATE TABLE IF NOT EXISTS archive_item (
        id TEXT PRIMARY KEY,
        archive_id TEXT NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
        item_id TEXT NOT NULL,
        user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
        added_at INTEGER
      );
    `);

    // Level 10: Tables depending on chat_export
    sqliteInstance.exec(`
      CREATE TABLE IF NOT EXISTS chat_export_comment (
        id TEXT PRIMARY KEY,
        export_id TEXT NOT NULL REFERENCES chat_export(id) ON DELETE CASCADE,
        author_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
        parent_id TEXT,
        content TEXT NOT NULL,
        created_at INTEGER,
        updated_at INTEGER
      );
    `);

    // Level 11: Browser & Research tables
    sqliteInstance.exec(`
      CREATE TABLE IF NOT EXISTS browser_session (
        id TEXT PRIMARY KEY,
        thread_id TEXT REFERENCES chat_thread(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        session_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        current_url TEXT,
        replay_url TEXT,
        screenshots TEXT DEFAULT '[]',
        metadata TEXT,
        last_activity_at INTEGER,
        expires_at INTEGER,
        created_at INTEGER,
        closed_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS research_task (
        id TEXT PRIMARY KEY,
        thread_id TEXT REFERENCES chat_thread(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
        query TEXT NOT NULL,
        depth TEXT NOT NULL DEFAULT 'standard',
        status TEXT NOT NULL DEFAULT 'pending',
        current_step TEXT,
        progress INTEGER NOT NULL DEFAULT 0,
        sources TEXT DEFAULT '[]',
        findings TEXT DEFAULT '[]',
        citations TEXT DEFAULT '[]',
        report TEXT,
        error TEXT,
        browser_session_id TEXT REFERENCES browser_session(id) ON DELETE SET NULL,
        created_at INTEGER,
        completed_at INTEGER
      );
    `);

    // Level 12: Promo & Webhook tables
    sqliteInstance.exec(`
      CREATE TABLE IF NOT EXISTS promo_code (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        description TEXT,
        discount_type TEXT NOT NULL,
        discount_value TEXT NOT NULL,
        applies_to TEXT NOT NULL DEFAULT 'all',
        applicable_tiers TEXT DEFAULT '[]',
        applicable_token_packs TEXT DEFAULT '[]',
        max_redemptions TEXT,
        current_redemptions TEXT NOT NULL DEFAULT '0',
        max_per_user TEXT NOT NULL DEFAULT '1',
        new_users_only INTEGER NOT NULL DEFAULT 0,
        min_amount TEXT,
        starts_at INTEGER,
        expires_at INTEGER,
        is_active INTEGER NOT NULL DEFAULT 1,
        stripe_coupon_id TEXT,
        created_at INTEGER,
        updated_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS promo_code_redemption (
        id TEXT PRIMARY KEY,
        promo_code_id TEXT NOT NULL REFERENCES promo_code(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
        purchase_type TEXT NOT NULL,
        original_amount TEXT NOT NULL,
        discount_amount TEXT NOT NULL,
        final_amount TEXT NOT NULL,
        stripe_checkout_session_id TEXT,
        stripe_invoice_id TEXT,
        redeemed_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS webhook_event (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL UNIQUE,
        event_type TEXT NOT NULL,
        processed_at INTEGER,
        metadata TEXT
      );

      CREATE TABLE IF NOT EXISTS webhook_retry_queue (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        retry_count TEXT NOT NULL DEFAULT '0',
        max_retries TEXT NOT NULL DEFAULT '5',
        next_retry_at INTEGER NOT NULL,
        last_error TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER,
        updated_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS usage_alert (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
        alert_type TEXT NOT NULL,
        limit_type TEXT NOT NULL,
        threshold TEXT NOT NULL,
        current_usage TEXT NOT NULL,
        usage_limit TEXT NOT NULL,
        email_sent INTEGER NOT NULL DEFAULT 0,
        email_sent_at INTEGER,
        acknowledged_at INTEGER,
        period_start INTEGER NOT NULL,
        period_end INTEGER NOT NULL,
        created_at INTEGER,
        UNIQUE(user_id, alert_type, limit_type, period_start)
      );
    `);

    // Level 13: Vector tables
    sqliteInstance.exec(`
      CREATE TABLE IF NOT EXISTS vector_index (
        id TEXT PRIMARY KEY,
        point_id TEXT NOT NULL UNIQUE,
        collection_name TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        user_id TEXT REFERENCES user(id) ON DELETE CASCADE,
        metadata TEXT,
        created_at INTEGER
      );
    `);

    // Level 14: Fragment tables
    sqliteInstance.exec(`
      CREATE TABLE IF NOT EXISTS fragments (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES chat_thread(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
        template TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        code TEXT NOT NULL,
        file_path TEXT NOT NULL,
        port INTEGER,
        session_id TEXT,
        preview_url TEXT,
        deployment_url TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        error_message TEXT,
        created_at INTEGER,
        updated_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS fragment_executions (
        id TEXT PRIMARY KEY,
        fragment_id TEXT NOT NULL REFERENCES fragments(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL,
        template TEXT NOT NULL,
        stdout TEXT,
        stderr TEXT,
        runtime_error TEXT,
        preview_url TEXT,
        execution_time_ms INTEGER,
        created_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS local_execution_usage (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL,
        template TEXT,
        duration_ms INTEGER NOT NULL,
        operation_type TEXT,
        created_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS fragment_shares (
        id TEXT PRIMARY KEY,
        fragment_id TEXT NOT NULL REFERENCES fragments(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
        share_id TEXT NOT NULL UNIQUE,
        expires_at INTEGER,
        is_active INTEGER NOT NULL DEFAULT 1,
        view_count INTEGER NOT NULL DEFAULT 0,
        last_viewed_at INTEGER,
        created_at INTEGER
      );
    `);

    // Level 15: Provider and model tables
    sqliteInstance.exec(`
      CREATE TABLE IF NOT EXISTS provider_config (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'cloud',
        base_url TEXT,
        auth_type TEXT NOT NULL DEFAULT 'api-key',
        enabled INTEGER DEFAULT 1,
        status TEXT DEFAULT 'disconnected',
        last_tested_at INTEGER,
        error_message TEXT,
        metadata TEXT,
        user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
        created_at INTEGER DEFAULT (unixepoch()),
        updated_at INTEGER DEFAULT (unixepoch()),
        UNIQUE(user_id, provider_id)
      );

      CREATE TABLE IF NOT EXISTS api_key (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        encrypted_key TEXT NOT NULL,
        key_hint TEXT,
        is_valid INTEGER DEFAULT 0,
        last_validated_at INTEGER,
        error_message TEXT,
        user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
        created_at INTEGER DEFAULT (unixepoch()),
        updated_at INTEGER DEFAULT (unixepoch()),
        UNIQUE(user_id, provider_id)
      );

      CREATE TABLE IF NOT EXISTS local_model (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        display_name TEXT,
        provider_id TEXT NOT NULL,
        provider_config_id TEXT REFERENCES provider_config(id) ON DELETE SET NULL,
        path TEXT,
        size INTEGER,
        quantization TEXT,
        family TEXT,
        status TEXT DEFAULT 'available',
        is_vision INTEGER DEFAULT 0,
        is_tool_call_supported INTEGER DEFAULT 1,
        download_progress INTEGER,
        error_message TEXT,
        metadata TEXT,
        user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
        created_at INTEGER DEFAULT (unixepoch()),
        updated_at INTEGER DEFAULT (unixepoch()),
        UNIQUE(user_id, provider_id, name)
      );
    `);

    // Create indexes
    sqliteInstance.exec(`
      CREATE INDEX IF NOT EXISTS bookmark_user_id_idx ON bookmark(user_id);
      CREATE INDEX IF NOT EXISTS bookmark_item_idx ON bookmark(item_id, item_type);
      CREATE INDEX IF NOT EXISTS usage_event_user_idx ON usage_event(user_id);
      CREATE INDEX IF NOT EXISTS usage_event_type_idx ON usage_event(event_type);
      CREATE INDEX IF NOT EXISTS usage_event_created_idx ON usage_event(created_at);
      CREATE INDEX IF NOT EXISTS user_invitation_email_idx ON user_invitation(email);
      CREATE INDEX IF NOT EXISTS user_invitation_token_idx ON user_invitation(token);
      CREATE INDEX IF NOT EXISTS conversation_summary_thread_idx ON conversation_summary(thread_id);
      CREATE INDEX IF NOT EXISTS conversation_summary_user_idx ON conversation_summary(user_id);
      CREATE INDEX IF NOT EXISTS agent_state_user_id_idx ON agent_state(user_id);
      CREATE INDEX IF NOT EXISTS agent_state_thread_id_idx ON agent_state(thread_id);
      CREATE INDEX IF NOT EXISTS agent_state_status_idx ON agent_state(status);
      CREATE INDEX IF NOT EXISTS agent_exec_log_state_id_idx ON agent_execution_log(agent_state_id);
      CREATE INDEX IF NOT EXISTS agent_exec_log_action_type_idx ON agent_execution_log(action_type);
      CREATE INDEX IF NOT EXISTS mcp_oauth_session_server_id_idx ON mcp_oauth_session(mcp_server_id);
      CREATE INDEX IF NOT EXISTS mcp_oauth_session_state_idx ON mcp_oauth_session(state);
      CREATE INDEX IF NOT EXISTS workflow_node_kind_idx ON workflow_node(kind);
      CREATE INDEX IF NOT EXISTS archive_item_item_id_idx ON archive_item(item_id);
      CREATE INDEX IF NOT EXISTS browser_session_thread_idx ON browser_session(thread_id);
      CREATE INDEX IF NOT EXISTS browser_session_user_idx ON browser_session(user_id);
      CREATE INDEX IF NOT EXISTS browser_session_status_idx ON browser_session(status);
      CREATE INDEX IF NOT EXISTS research_task_thread_idx ON research_task(thread_id);
      CREATE INDEX IF NOT EXISTS research_task_user_idx ON research_task(user_id);
      CREATE INDEX IF NOT EXISTS research_task_status_idx ON research_task(status);
      CREATE INDEX IF NOT EXISTS promo_code_code_idx ON promo_code(code);
      CREATE INDEX IF NOT EXISTS redemption_user_idx ON promo_code_redemption(user_id);
      CREATE INDEX IF NOT EXISTS redemption_code_idx ON promo_code_redemption(promo_code_id);
      CREATE INDEX IF NOT EXISTS webhook_event_id_idx ON webhook_event(event_id);
      CREATE INDEX IF NOT EXISTS webhook_retry_status_idx ON webhook_retry_queue(status);
      CREATE INDEX IF NOT EXISTS usage_alert_user_id_idx ON usage_alert(user_id);
      CREATE INDEX IF NOT EXISTS vector_index_point_idx ON vector_index(point_id);
      CREATE INDEX IF NOT EXISTS vector_index_entity_idx ON vector_index(entity_type, entity_id);
      CREATE INDEX IF NOT EXISTS vector_index_user_idx ON vector_index(user_id);
      CREATE INDEX IF NOT EXISTS fragments_thread_idx ON fragments(thread_id);
      CREATE INDEX IF NOT EXISTS fragments_user_idx ON fragments(user_id);
      CREATE INDEX IF NOT EXISTS fragments_status_idx ON fragments(status);
      CREATE INDEX IF NOT EXISTS fragment_executions_fragment_idx ON fragment_executions(fragment_id);
      CREATE INDEX IF NOT EXISTS local_execution_usage_user_idx ON local_execution_usage(user_id);
      CREATE INDEX IF NOT EXISTS fragment_shares_fragment_idx ON fragment_shares(fragment_id);
      CREATE INDEX IF NOT EXISTS fragment_shares_share_id_idx ON fragment_shares(share_id);
      CREATE INDEX IF NOT EXISTS thread_file_context_thread_idx ON thread_file_context(thread_id);
      CREATE INDEX IF NOT EXISTS thread_file_context_user_idx ON thread_file_context(user_id);
      CREATE INDEX IF NOT EXISTS idx_provider_config_user ON provider_config(user_id);
      CREATE INDEX IF NOT EXISTS idx_provider_config_provider ON provider_config(provider_id);
      CREATE INDEX IF NOT EXISTS idx_api_key_user ON api_key(user_id);
      CREATE INDEX IF NOT EXISTS idx_api_key_provider ON api_key(provider_id);
      CREATE INDEX IF NOT EXISTS idx_local_model_user ON local_model(user_id);
      CREATE INDEX IF NOT EXISTS idx_local_model_provider ON local_model(provider_id);
      CREATE INDEX IF NOT EXISTS idx_local_model_status ON local_model(status);
    `);

    // Run migrations for existing databases (add missing columns)
    runMigrations(sqliteInstance);

    console.log("[SQLite] All tables created/verified successfully");
  } catch (error) {
    console.error("[SQLite] Error creating tables:", error);
    throw error;
  }
};

// Create default local user if not exists
const createDefaultUserIfNotExists = (sqliteInstance: SqliteDatabase) => {
  try {
    const existingUser = sqliteInstance
      .prepare("SELECT id FROM user WHERE email = ?")
      .get("local@shadower.app");

    if (!existingUser) {
      console.log("[SQLite] Creating default local user...");
      const { randomUUID } = require("crypto");
      const userId = randomUUID();
      const now = Date.now();

      sqliteInstance
        .prepare(
          `
          INSERT INTO user (id, name, email, email_verified, preferences, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        )
        .run(
          userId,
          "Local User",
          "local@shadower.app",
          1, // email_verified = true
          JSON.stringify({ theme: "dark", language: "en" }),
          now,
          now,
        );

      // Create default subscription for the user
      sqliteInstance
        .prepare(
          `
          INSERT INTO subscription (id, user_id, tier, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
        )
        .run(randomUUID(), userId, "free", "active", now, now);

      console.log("[SQLite] Default local user created:", userId);
    } else {
      console.log("[SQLite] Default local user already exists");
    }
  } catch (error) {
    console.error("[SQLite] Error creating default user:", error);
    // Don't throw - this is not critical for app startup
  }
};

export const getSqliteDb = () => {
  // Check if SQLite is available
  if (!IS_SQLITE_AVAILABLE || !Database || !drizzle) {
    const error = new Error(
      "SQLite is not available. " +
        "In Electron dev mode, database operations should be handled via Electron IPC.",
    );
    (error as any).isElectronMode = true;
    throw error;
  }

  if (db) {
    return db;
  }

  const dbPath = getDbPath();
  console.log(`[SQLite] Initializing database at: ${dbPath}`);

  try {
    // Create SQLite database instance
    sqlite = new Database(dbPath);
    console.log("[SQLite] SQLite database connection created");

    // Enable foreign keys
    sqlite.pragma("foreign_keys = ON");

    // Enable WAL mode for better concurrency
    sqlite.pragma("journal_mode = WAL");

    // Create tables if they don't exist
    createTablesIfNotExist(sqlite);

    // Create default user for local-first setup
    createDefaultUserIfNotExists(sqlite);

    // Create drizzle instance
    db = drizzle(sqlite, { schema });

    console.log("[SQLite] Database initialized successfully with drizzle ORM");
  } catch (error: any) {
    const errorMsg = error?.message || String(error) || "";
    console.error("[SQLite] Database initialization error:", errorMsg);

    // Handle module version mismatch
    if (
      errorMsg.includes("NODE_MODULE_VERSION") ||
      errorMsg.includes("was compiled against a different Node.js version")
    ) {
      IS_SQLITE_AVAILABLE = false;
      const newError = new Error(
        "SQLite is not available due to Node.js version mismatch. " +
          "Use Electron IPC instead.",
      );
      (newError as any).isElectronMode = true;
      throw newError;
    }
    throw error;
  }

  return db;
};

// Export the database instance (lazy-loaded)
export const sqliteDb = new Proxy({} as DrizzleDb, {
  get(_target, prop) {
    if (!IS_SQLITE_AVAILABLE) {
      const error = new Error("SQLite not available in renderer - use IPC");
      (error as any).isElectronMode = true;
      throw error;
    }

    try {
      return (getSqliteDb() as any)[prop];
    } catch (error: any) {
      if (error?.isElectronMode) {
        throw error;
      }
      const errorMsg = error?.message || String(error) || "";
      if (
        errorMsg.includes("NODE_MODULE_VERSION") ||
        errorMsg.includes("SQLite is not available")
      ) {
        IS_SQLITE_AVAILABLE = false;
        const newError = new Error(
          "SQLite not available in renderer - use IPC",
        );
        (newError as any).isElectronMode = true;
        throw newError;
      }
      throw error;
    }
  },
});

// Initialize database on module load
try {
  getSqliteDb();
} catch (error: any) {
  // Silently handle Electron mode - database access goes through IPC
  if (error?.isElectronMode) {
    // Expected in Electron - don't log
  } else {
    // Only log unexpected errors
    console.warn(
      "[SQLite] Database not initialized:",
      (error as Error).message?.substring(0, 100),
    );
  }
}

// Alias for backward compatibility with auth-instance.ts and other consumers
export const getDatabase = getSqliteDb;

// Re-export schema for consumers that import from this module
export { schema };

/**
 * Check if SQLite is available (server-side)
 * Returns false in Electron dev mode due to native module version mismatch
 */
export function isSqliteAvailable(): boolean {
  return IS_SQLITE_AVAILABLE;
}

/**
 * Check if we're in Electron dev mode (SQLite unavailable)
 * This is used by API routes to handle database errors gracefully
 */
export function isElectronDevMode(): boolean {
  return !IS_SQLITE_AVAILABLE && process.env.NODE_ENV === "development";
}
