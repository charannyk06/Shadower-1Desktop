import { app } from "electron";
import path from "path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "@/lib/db/sqlite/schema.sqlite";
import fs from "fs-extra";
import {
  runMigrations as runSchemaMigrations,
  getSchemaInfo,
  getMigrationHistory,
  validateMigrations,
  CURRENT_SCHEMA_VERSION,
  APP_VERSION,
} from "@/lib/db/migrations/sqlite/schema-migration";

// Get the user data directory based on platform
const getUserDataDir = () => {
  return app.getPath("userData");
};

// Database file path
const getDbPath = () => {
  const userDataDir = getUserDataDir();
  const dbDir = path.join(userDataDir, "data");

  // Ensure directory exists
  fs.ensureDirSync(dbDir);

  return path.join(dbDir, "shadower.db");
};

// Initialize SQLite database
let sqlite: Database.Database | null = null;
let db: ReturnType<typeof drizzle> | null = null;

export const initializeDatabase = (force = false) => {
  if (db && !force) {
    return db;
  }

  // If forcing reinitialization, close existing connection first
  if (force && sqlite) {
    try {
      sqlite.close();
    } catch (error) {
      console.warn("[Database] Error closing existing connection:", error);
    }
    sqlite = null;
    db = null;
  }

  const dbPath = getDbPath();
  console.log(`[Database] Initializing SQLite database at: ${dbPath}`);

  // Create SQLite database instance
  sqlite = new Database(dbPath);

  // Enable foreign keys
  sqlite.pragma("foreign_keys = ON");

  // Enable WAL mode for better concurrency
  sqlite.pragma("journal_mode = WAL");

  // Create drizzle instance
  db = drizzle(sqlite, { schema });

  console.log("[Database] SQLite database initialized successfully");

  return db;
};

// Run migrations or push schema
export const runMigrations = () => {
  if (!db || !sqlite) {
    throw new Error("Database not initialized");
  }

  // Try multiple possible migration paths
  const possiblePaths = [
    path.join(app.getAppPath(), "src/lib/db/migrations/sqlite"),
    path.join(process.cwd(), "src/lib/db/migrations/sqlite"),
    path.join(__dirname, "../../../src/lib/db/migrations/sqlite"),
  ];

  let migrationsFolder: string | null = null;
  for (const possiblePath of possiblePaths) {
    if (fs.existsSync(possiblePath)) {
      migrationsFolder = possiblePath;
      break;
    }
  }

  if (migrationsFolder) {
    console.log(`[Database] Running migrations from: ${migrationsFolder}`);
    try {
      migrate(db, { migrationsFolder });
      console.log("[Database] Migrations completed successfully");
    } catch (error) {
      console.warn(
        "[Database] Migration failed, falling back to schema push:",
        error,
      );
      // Fallback to creating tables from schema
      createTablesFromSchema();
    }
  } else {
    // Fallback: Use Drizzle Kit's push functionality
    console.log("[Database] No migrations found, pushing schema directly...");
    try {
      // Use drizzle-kit push via exec or create tables manually from schema
      // For now, we'll use a simpler approach: create tables using SQL based on schema
      createTablesFromSchema();
      console.log("[Database] Schema pushed successfully");
    } catch (error) {
      console.error("[Database] Schema push error:", error);
      // Last resort: create minimal tables manually
      createBasicTables();
    }
  }

  // Run schema migrations for auto-updates (adds new columns, etc.)
  runSchemaMigrationsForUpdates();
};

// Run schema migrations to handle auto-updates (new columns, tables)
const runSchemaMigrationsForUpdates = () => {
  if (!sqlite) {
    console.error(
      "[Database] Cannot run schema migrations - database not initialized",
    );
    return;
  }

  try {
    // Validate migrations first (in development)
    if (process.env.NODE_ENV === "development") {
      const validation = validateMigrations();
      if (!validation.valid) {
        console.error(
          "[Database] ⚠️ Migration validation errors:",
          validation.errors,
        );
      }
    }

    // Get current schema info
    const schemaInfo = getSchemaInfo(sqlite);
    console.log("[Database] ========================================");
    console.log(`[Database] Schema Info:`);
    console.log(`[Database]   Current Version: ${schemaInfo.version}`);
    console.log(`[Database]   Target Version: ${CURRENT_SCHEMA_VERSION}`);
    console.log(`[Database]   App Version: ${APP_VERSION}`);
    console.log(
      `[Database]   Last Migration: ${schemaInfo.lastMigrationAt?.toISOString() || "Never"}`,
    );
    console.log("[Database] ========================================");

    if (schemaInfo.version < CURRENT_SCHEMA_VERSION) {
      console.log("[Database] Running schema migrations for auto-update...");
      const result = runSchemaMigrations(sqlite);

      if (result.success) {
        console.log(`[Database] ✓ Schema migrations complete.`);
        console.log(`[Database]   Migrations run: ${result.migrationsRun}`);
        console.log(
          `[Database]   From version: ${result.fromVersion} → ${result.toVersion}`,
        );

        // Log migration details
        for (const detail of result.details) {
          if (detail.success) {
            console.log(
              `[Database]   ✓ v${detail.version} (${detail.name}) - ${detail.durationMs}ms`,
            );
          } else {
            console.error(
              `[Database]   ✗ v${detail.version} (${detail.name}) - ${detail.error}`,
            );
          }
        }
      } else {
        console.error(`[Database] ⚠️ Schema migration error: ${result.error}`);
        console.error(`[Database]   Stopped at version: ${result.toVersion}`);
      }
    } else {
      console.log("[Database] ✓ Schema is up to date, no migrations needed.");
    }
  } catch (error) {
    console.error("[Database] Error running schema migrations:", error);
  }
};

// Get database schema information (for debugging/diagnostics)
export const getDatabaseSchemaInfo = () => {
  if (!sqlite) {
    return null;
  }
  return getSchemaInfo(sqlite);
};

// Get migration history (for debugging/diagnostics)
export const getDatabaseMigrationHistory = () => {
  if (!sqlite) {
    return [];
  }
  return getMigrationHistory(sqlite);
};

// Create tables from schema definition
const createTablesFromSchema = () => {
  if (!db || !sqlite) return;

  try {
    console.log("[Database] Creating all tables from schema...");

    // Create tables in dependency order
    // Level 1: Base tables (no dependencies)
    sqlite.exec(`
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
        ban_expires INTEGER
      );
    `);
    console.log("[Database] ✓ Created table: user");

    // Level 2: Auth tables (depend on user)
    sqlite.exec(`
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
    `);
    console.log(
      "[Database] ✓ Created auth tables: session, account, verification",
    );

    // Level 3: User-dependent tables
    sqlite.exec(`
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
        created_at INTEGER,
        updated_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS mcp_server (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        config TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
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
      CREATE INDEX IF NOT EXISTS usage_event_user_idx ON usage_event(user_id);
      CREATE INDEX IF NOT EXISTS usage_event_type_idx ON usage_event(event_type);
      CREATE INDEX IF NOT EXISTS usage_event_created_idx ON usage_event(created_at);

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
      CREATE INDEX IF NOT EXISTS promo_code_code_idx ON promo_code(code);
      CREATE INDEX IF NOT EXISTS promo_code_active_idx ON promo_code(is_active, expires_at);

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
      CREATE INDEX IF NOT EXISTS usage_alert_user_id_idx ON usage_alert(user_id);
      CREATE INDEX IF NOT EXISTS usage_alert_type_idx ON usage_alert(alert_type, limit_type);

    `);
    console.log("[Database] ✓ Created user-dependent tables");

    // Level 4: Tables depending on chat_thread
    sqlite.exec(`
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
      CREATE INDEX IF NOT EXISTS conversation_summary_thread_idx ON conversation_summary(thread_id);
      CREATE INDEX IF NOT EXISTS conversation_summary_user_idx ON conversation_summary(user_id);
      CREATE INDEX IF NOT EXISTS conversation_summary_sequence_idx ON conversation_summary(thread_id, sequence_number);

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
      CREATE INDEX IF NOT EXISTS thread_file_context_thread_idx ON thread_file_context(thread_id);
      CREATE INDEX IF NOT EXISTS thread_file_context_user_idx ON thread_file_context(user_id);
      CREATE INDEX IF NOT EXISTS thread_file_context_cleanup_idx ON thread_file_context(last_accessed_at);
    `);
    console.log("[Database] ✓ Created chat-related tables");

    // Level 5: Tables depending on user and chat_thread (agent state)
    sqlite.exec(`
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
      CREATE INDEX IF NOT EXISTS agent_state_user_id_idx ON agent_state(user_id);
      CREATE INDEX IF NOT EXISTS agent_state_thread_id_idx ON agent_state(thread_id);
      CREATE INDEX IF NOT EXISTS agent_state_status_idx ON agent_state(status);

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
      CREATE INDEX IF NOT EXISTS agent_exec_log_state_id_idx ON agent_execution_log(agent_state_id);
      CREATE INDEX IF NOT EXISTS agent_exec_log_step_idx ON agent_execution_log(agent_state_id, step_number);
      CREATE INDEX IF NOT EXISTS agent_exec_log_action_type_idx ON agent_execution_log(action_type);
      CREATE INDEX IF NOT EXISTS agent_exec_log_created_idx ON agent_execution_log(created_at);

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
      CREATE INDEX IF NOT EXISTS agent_checkpoint_state_id_idx ON agent_checkpoint(agent_state_id);
      CREATE INDEX IF NOT EXISTS agent_checkpoint_number_idx ON agent_checkpoint(agent_state_id, checkpoint_number);
      CREATE INDEX IF NOT EXISTS agent_checkpoint_step_idx ON agent_checkpoint(agent_state_id, step_number);

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
      CREATE INDEX IF NOT EXISTS agent_tool_exec_state_id_idx ON agent_tool_execution(agent_state_id);
      CREATE INDEX IF NOT EXISTS agent_tool_exec_user_id_idx ON agent_tool_execution(user_id);
      CREATE INDEX IF NOT EXISTS agent_tool_exec_tool_name_idx ON agent_tool_execution(tool_name);
      CREATE INDEX IF NOT EXISTS agent_tool_exec_source_idx ON agent_tool_execution(tool_source);
      CREATE INDEX IF NOT EXISTS agent_tool_exec_started_idx ON agent_tool_execution(started_at);
      CREATE INDEX IF NOT EXISTS agent_tool_exec_success_idx ON agent_tool_execution(success);

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
      CREATE INDEX IF NOT EXISTS agent_sub_agent_parent_idx ON agent_sub_agent_relation(parent_agent_state_id);
      CREATE INDEX IF NOT EXISTS agent_sub_agent_child_idx ON agent_sub_agent_relation(child_agent_state_id);
      CREATE INDEX IF NOT EXISTS agent_sub_agent_status_idx ON agent_sub_agent_relation(status);
    `);
    console.log("[Database] ✓ Created agent_state and related tables");

    // Level 6: Tables depending on mcp_server
    sqlite.exec(`
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
      CREATE INDEX IF NOT EXISTS mcp_oauth_session_server_id_idx ON mcp_oauth_session(mcp_server_id);
      CREATE INDEX IF NOT EXISTS mcp_oauth_session_state_idx ON mcp_oauth_session(state);
    `);
    console.log("[Database] ✓ Created MCP-related tables");

    // Level 7: Tables depending on workflow
    sqlite.exec(`
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
      CREATE INDEX IF NOT EXISTS workflow_node_kind_idx ON workflow_node(kind);

      CREATE TABLE IF NOT EXISTS workflow_edge (
        id TEXT PRIMARY KEY NOT NULL,
        version TEXT NOT NULL DEFAULT '0.1.0',
        workflow_id TEXT NOT NULL REFERENCES workflow(id) ON DELETE CASCADE,
        source TEXT NOT NULL,
        target TEXT NOT NULL,
        ui_config TEXT DEFAULT '{}',
        created_at INTEGER
      );
    `);
    console.log("[Database] ✓ Created workflow-related tables");

    // Level 8: Tables depending on chat_export
    sqlite.exec(`
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
    console.log("[Database] ✓ Created chat_export_comment table");

    // Level 10: Tables depending on promo_code and subscription
    sqlite.exec(`
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
      CREATE INDEX IF NOT EXISTS redemption_user_idx ON promo_code_redemption(user_id);
      CREATE INDEX IF NOT EXISTS redemption_code_idx ON promo_code_redemption(promo_code_id);
    `);
    console.log("[Database] ✓ Created promo_code_redemption table");

    // Level 11: Webhook tables
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS webhook_event (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL UNIQUE,
        event_type TEXT NOT NULL,
        processed_at INTEGER,
        metadata TEXT
      );
      CREATE INDEX IF NOT EXISTS webhook_event_id_idx ON webhook_event(event_id);
      CREATE INDEX IF NOT EXISTS webhook_event_processed_at_idx ON webhook_event(processed_at);

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
      CREATE INDEX IF NOT EXISTS webhook_retry_event_id_idx ON webhook_retry_queue(event_id);
      CREATE INDEX IF NOT EXISTS webhook_retry_status_idx ON webhook_retry_queue(status);
      CREATE INDEX IF NOT EXISTS webhook_retry_next_retry_idx ON webhook_retry_queue(next_retry_at);
    `);
    console.log("[Database] ✓ Created webhook tables");

    // Level 12: Browser session and research tables
    sqlite.exec(`
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
      CREATE INDEX IF NOT EXISTS browser_session_thread_idx ON browser_session(thread_id);
      CREATE INDEX IF NOT EXISTS browser_session_user_idx ON browser_session(user_id);
      CREATE INDEX IF NOT EXISTS browser_session_provider_idx ON browser_session(provider);
      CREATE INDEX IF NOT EXISTS browser_session_status_idx ON browser_session(status);
      CREATE INDEX IF NOT EXISTS browser_session_session_id_idx ON browser_session(session_id);
      CREATE INDEX IF NOT EXISTS browser_session_expires_idx ON browser_session(expires_at);
      CREATE INDEX IF NOT EXISTS browser_session_activity_idx ON browser_session(last_activity_at);
      CREATE INDEX IF NOT EXISTS browser_session_cleanup_idx ON browser_session(status, expires_at);

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
      CREATE INDEX IF NOT EXISTS research_task_thread_idx ON research_task(thread_id);
      CREATE INDEX IF NOT EXISTS research_task_user_idx ON research_task(user_id);
      CREATE INDEX IF NOT EXISTS research_task_status_idx ON research_task(status);
      CREATE INDEX IF NOT EXISTS research_task_created_idx ON research_task(created_at);
    `);
    console.log(
      "[Database] ✓ Created browser_session and research_task tables",
    );

    // Level 13: Vector index and fragment tables
    sqlite.exec(`
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
      CREATE INDEX IF NOT EXISTS vector_index_point_idx ON vector_index(point_id);
      CREATE INDEX IF NOT EXISTS vector_index_entity_idx ON vector_index(entity_type, entity_id);
      CREATE INDEX IF NOT EXISTS vector_index_user_idx ON vector_index(user_id);
      CREATE INDEX IF NOT EXISTS vector_index_collection_idx ON vector_index(collection_name);

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
      CREATE INDEX IF NOT EXISTS fragments_thread_idx ON fragments(thread_id);
      CREATE INDEX IF NOT EXISTS fragments_user_idx ON fragments(user_id);
      CREATE INDEX IF NOT EXISTS fragments_status_idx ON fragments(status);

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
      CREATE INDEX IF NOT EXISTS fragment_executions_fragment_idx ON fragment_executions(fragment_id);

      CREATE TABLE IF NOT EXISTS local_execution_usage (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL,
        template TEXT,
        duration_ms INTEGER NOT NULL,
        operation_type TEXT,
        created_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS local_execution_usage_user_idx ON local_execution_usage(user_id);
      CREATE INDEX IF NOT EXISTS local_execution_usage_created_idx ON local_execution_usage(created_at);
    `);
    console.log("[Database] ✓ Created vector_index and fragment tables");

    // Create provider and model tables
    sqlite.exec(`
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
      CREATE INDEX IF NOT EXISTS idx_provider_config_user ON provider_config(user_id);
      CREATE INDEX IF NOT EXISTS idx_provider_config_provider ON provider_config(provider_id);

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
      CREATE INDEX IF NOT EXISTS idx_api_key_user ON api_key(user_id);
      CREATE INDEX IF NOT EXISTS idx_api_key_provider ON api_key(provider_id);

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
      CREATE INDEX IF NOT EXISTS idx_local_model_user ON local_model(user_id);
      CREATE INDEX IF NOT EXISTS idx_local_model_provider ON local_model(provider_id);
      CREATE INDEX IF NOT EXISTS idx_local_model_status ON local_model(status);
    `);
    console.log(
      "[Database] ✓ Created provider_config, api_key, and local_model tables",
    );

    console.log("[Database] ✓ All tables created successfully from schema");

    // Verify all tables were created
    verifyTablesCreated();
  } catch (error) {
    console.error("[Database] Error creating tables from schema:", error);
    throw error;
  }
};

// Verify that all required tables exist
const verifyTablesCreated = () => {
  if (!sqlite) return;

  const requiredTables = [
    // Core user and auth tables
    "user",
    "session",
    "account",
    "verification",
    // Chat tables
    "chat_thread",
    "chat_message",
    "chat_export",
    "chat_export_comment",
    "conversation_summary",
    // Agent tables
    "agent",
    "agent_state",
    "agent_execution_log",
    "agent_checkpoint",
    "agent_tool_execution",
    "agent_sub_agent_relation",
    // MCP tables
    "mcp_server",
    "mcp_server_tool_custom_instructions",
    "mcp_server_custom_instructions",
    "mcp_oauth_session",
    // Workflow tables
    "workflow",
    "workflow_node",
    "workflow_edge",
    "bookmark",
    // User management tables
    "user_invitation",
    // Subscription and billing tables
    "subscription",
    "usage_event",
    "promo_code",
    "promo_code_redemption",
    "usage_alert",
    // Webhook tables
    "webhook_event",
    "webhook_retry_queue",
    // Browser and research tables
    "browser_session",
    "research_task",
    // Thread context tables
    "thread_file_context",
    // Vector and fragment tables
    "vector_index",
    "fragments",
    "fragment_executions",
    "local_execution_usage",
    // Provider and model tables
    "provider_config",
    "api_key",
    "local_model",
  ];

  const missingTables: string[] = [];

  for (const tableName of requiredTables) {
    try {
      const result = sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
        .get(tableName);

      if (!result) {
        missingTables.push(tableName);
      }
    } catch (error) {
      console.warn(`[Database] Error checking table ${tableName}:`, error);
      missingTables.push(tableName);
    }
  }

  if (missingTables.length > 0) {
    console.error(`[Database] ⚠️ Missing tables: ${missingTables.join(", ")}`);
    throw new Error(
      `Failed to create ${missingTables.length} table(s): ${missingTables.join(", ")}`,
    );
  }

  console.log(
    `[Database] ✓ Verified all ${requiredTables.length} tables exist`,
  );
};

// Create basic tables if migrations don't exist (fallback)
const createBasicTables = () => {
  if (!db || !sqlite) return;

  try {
    // Fallback to comprehensive schema creation
    console.log("[Database] Falling back to comprehensive table creation...");
    createTablesFromSchema();
  } catch (error) {
    console.error("[Database] Error creating basic tables:", error);
    // Last resort: at least create user table
    try {
      sqlite.exec(`
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
          ban_expires INTEGER
        )
      `);
      console.log("[Database] Created minimal user table as last resort");
    } catch (fallbackError) {
      console.error(
        "[Database] Even minimal table creation failed:",
        fallbackError,
      );
    }
  }
};

// Get database instance
export const getDatabase = () => {
  if (!db) {
    return initializeDatabase();
  }
  return db;
};

// Close database connection
export const closeDatabase = () => {
  if (sqlite) {
    console.log("[Database] Closing SQLite database");
    try {
      sqlite.close();
    } catch (error) {
      console.warn("[Database] Error closing database:", error);
    }
    sqlite = null;
    db = null;
  }
};

// Reset database - close connections, delete database file, and reinitialize
export const resetDatabase = async () => {
  console.log("[Database] Resetting database...");

  // Close existing connections
  closeDatabase();

  // Get database path
  const dbPath = getDbPath();

  // Delete database file and related files (WAL, SHM)
  try {
    const filesToDelete = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];

    for (const file of filesToDelete) {
      if (fs.existsSync(file)) {
        fs.removeSync(file);
        console.log(`[Database] Deleted: ${file}`);
      }
    }

    console.log("[Database] ✓ Database files deleted");
  } catch (error) {
    console.error("[Database] Error deleting database files:", error);
    throw error;
  }

  // Wait a bit to ensure file handles are released
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Reinitialize database
  console.log("[Database] Reinitializing clean database...");
  initializeDatabase();
  runMigrations();
  await createDefaultUser();

  console.log("[Database] ✓ Database reset complete");
  return getDatabase();
};

/**
 * Initialize default user for Electron desktop app
 * Creates a default local user if no users exist in the database.
 * This ensures the app works out of the box for desktop users.
 */
export const createDefaultUser = async () => {
  if (!db || !sqlite) {
    console.error(
      "[Database] Cannot create default user - database not initialized",
    );
    return null;
  }

  try {
    // Check if any user exists
    const existingUsers = await db.select().from(schema.UserTable).limit(1);

    if (existingUsers.length > 0) {
      console.log(
        "[Database] User already exists, skipping default user creation",
      );
      return existingUsers[0];
    }

    // Create default user for desktop app
    const { randomUUID } = require("crypto");
    const userId = randomUUID();
    const now = new Date();

    console.log("[Database] Creating default desktop user...");

    const [user] = await db
      .insert(schema.UserTable)
      .values({
        id: userId,
        name: "Desktop User",
        email: "user@desktop.local",
        emailVerified: true,
        password: null, // No password for default user - local desktop app
        image: null,
        preferences: {
          displayName: "Desktop User",
          botName: "Shadower",
        },
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (user) {
      console.log(
        `[Database] ✓ Created default user: ${user.email} (${user.id})`,
      );

      // Also create a session for the user so they're logged in automatically
      const sessionId = randomUUID();
      const sessionToken = `desktop-${userId}-${Date.now()}`;
      const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 year

      await db.insert(schema.SessionTable).values({
        id: sessionId,
        token: sessionToken,
        userId: user.id,
        expiresAt: expiresAt,
        createdAt: now,
        updatedAt: now,
      });

      console.log(`[Database] ✓ Created default session for user`);

      return user;
    }

    return null;
  } catch (error) {
    console.error("[Database] Error creating default user:", error);
    return null;
  }
};

// Database health check
export const checkDatabaseHealth = () => {
  try {
    if (!sqlite) {
      throw new Error("Database not initialized");
    }

    // Simple query to check if database is responding
    const result = sqlite.prepare("SELECT 1 as health").get();
    return result && (result as { health: number }).health === 1;
  } catch (error) {
    console.error("[Database] Health check failed:", error);
    return false;
  }
};

// Export schema for use in IPC handlers
export { schema };
export type Database = typeof db;
