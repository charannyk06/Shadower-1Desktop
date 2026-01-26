/**
 * SQLite Schema Migration System
 *
 * This system handles automatic schema updates when the app is updated via GitHub releases.
 * Each migration is versioned and runs in order to bring the database
 * from any version to the current version.
 *
 * HOW IT WORKS:
 * 1. On app startup, the system checks the current schema version in the database
 * 2. If the database version is lower than CURRENT_SCHEMA_VERSION, migrations run
 * 3. Each migration runs in a transaction for safety (rollback on failure)
 * 4. Migration history is tracked for debugging and auditing
 *
 * WHEN TO ADD A MIGRATION:
 * - Adding a new column to an existing table
 * - Creating a new table (if not using CREATE TABLE IF NOT EXISTS)
 * - Modifying column types or constraints
 * - Adding/removing indexes
 * - Any schema change that existing users need
 *
 * IMPORTANT: When adding new columns or tables in schema.sqlite.ts,
 * you MUST add a corresponding migration here for existing users.
 */

import type Database from "better-sqlite3";

// ============================================================================
// SCHEMA VERSION - INCREMENT THIS WHEN ADDING NEW MIGRATIONS
// ============================================================================
export const CURRENT_SCHEMA_VERSION = 5;

// App version for tracking (updated on release)
export const APP_VERSION = "1.0.0";

// ============================================================================
// TYPES
// ============================================================================

interface Migration {
  version: number;
  name: string;
  description: string;
  up: (db: Database.Database) => void;
  // Optional rollback (not always possible with SQLite)
  down?: (db: Database.Database) => void;
}

interface MigrationResult {
  success: boolean;
  migrationsRun: number;
  fromVersion: number;
  toVersion: number;
  error?: string;
  details: Array<{
    version: number;
    name: string;
    success: boolean;
    error?: string;
    durationMs: number;
  }>;
}

interface SchemaInfo {
  version: number;
  appVersion: string | null;
  lastMigrationAt: Date | null;
  createdAt: Date | null;
}

// ============================================================================
// HELPER UTILITIES FOR MIGRATIONS
// ============================================================================

/**
 * Check if a column exists in a table
 */
export function columnExists(
  db: Database.Database,
  tableName: string,
  columnName: string,
): boolean {
  try {
    const result = db
      .prepare(`PRAGMA table_info(${tableName})`)
      .all() as Array<{ name: string }>;
    return result.some((col) => col.name === columnName);
  } catch {
    return false;
  }
}

/**
 * Check if a table exists
 */
export function tableExists(db: Database.Database, tableName: string): boolean {
  try {
    const result = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
      .get(tableName);
    return !!result;
  } catch {
    return false;
  }
}

/**
 * Check if an index exists
 */
export function indexExists(db: Database.Database, indexName: string): boolean {
  try {
    const result = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name=?`)
      .get(indexName);
    return !!result;
  } catch {
    return false;
  }
}

/**
 * Safely add a column if it doesn't exist
 */
export function addColumnIfNotExists(
  db: Database.Database,
  tableName: string,
  columnName: string,
  columnDefinition: string,
): boolean {
  if (columnExists(db, tableName, columnName)) {
    console.log(
      `[Migration] Column ${tableName}.${columnName} already exists, skipping`,
    );
    return false;
  }
  db.exec(
    `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`,
  );
  console.log(`[Migration] Added column ${tableName}.${columnName}`);
  return true;
}

/**
 * Safely create an index if it doesn't exist
 */
export function createIndexIfNotExists(
  db: Database.Database,
  indexName: string,
  tableName: string,
  columns: string,
  unique: boolean = false,
): boolean {
  if (indexExists(db, indexName)) {
    console.log(`[Migration] Index ${indexName} already exists, skipping`);
    return false;
  }
  const uniqueStr = unique ? "UNIQUE " : "";
  db.exec(`CREATE ${uniqueStr}INDEX ${indexName} ON ${tableName}(${columns})`);
  console.log(`[Migration] Created index ${indexName}`);
  return true;
}

// ============================================================================
// MIGRATIONS LIST
// Add new migrations at the end with incrementing version numbers
// ============================================================================

const migrations: Migration[] = [
  {
    version: 1,
    name: "initial_schema",
    description: "Establish schema version baseline for existing databases",
    up: (_db) => {
      // This is the baseline - all tables are created via CREATE TABLE IF NOT EXISTS
      // This migration just marks that we've established the schema version system
      console.log("[Migration] Establishing schema version baseline v1");
    },
  },

  {
    version: 2,
    name: "add_knowledge_base_tables",
    description: "Add knowledge_base, document, and document_chunk tables for RAG system",
    up: (db) => {
      // Create knowledge_base table if not exists
      if (!tableExists(db, "knowledge_base")) {
        db.exec(`
          CREATE TABLE knowledge_base (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
            document_count INTEGER NOT NULL DEFAULT 0,
            total_chunks INTEGER NOT NULL DEFAULT 0,
            is_active INTEGER NOT NULL DEFAULT 1,
            metadata TEXT,
            created_at INTEGER,
            updated_at INTEGER
          );
          CREATE INDEX knowledge_base_user_idx ON knowledge_base(user_id);
          CREATE INDEX knowledge_base_name_idx ON knowledge_base(name);
        `);
        console.log("[Migration] Created knowledge_base table");
      }

      // Create document table if not exists
      if (!tableExists(db, "document")) {
        db.exec(`
          CREATE TABLE document (
            id TEXT PRIMARY KEY,
            knowledge_base_id TEXT NOT NULL REFERENCES knowledge_base(id) ON DELETE CASCADE,
            user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
            file_name TEXT NOT NULL,
            file_type TEXT NOT NULL,
            file_path TEXT,
            file_size INTEGER NOT NULL,
            mime_type TEXT,
            extracted_text TEXT,
            chunk_count INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'pending',
            error_message TEXT,
            title TEXT,
            author TEXT,
            page_count INTEGER,
            word_count INTEGER,
            metadata TEXT,
            created_at INTEGER,
            updated_at INTEGER,
            indexed_at INTEGER
          );
          CREATE INDEX document_kb_idx ON document(knowledge_base_id);
          CREATE INDEX document_user_idx ON document(user_id);
          CREATE INDEX document_status_idx ON document(status);
          CREATE INDEX document_file_type_idx ON document(file_type);
        `);
        console.log("[Migration] Created document table");
      }

      // Create document_chunk table if not exists
      if (!tableExists(db, "document_chunk")) {
        db.exec(`
          CREATE TABLE document_chunk (
            id TEXT PRIMARY KEY,
            document_id TEXT NOT NULL REFERENCES document(id) ON DELETE CASCADE,
            knowledge_base_id TEXT NOT NULL REFERENCES knowledge_base(id) ON DELETE CASCADE,
            user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
            chunk_index INTEGER NOT NULL,
            content TEXT NOT NULL,
            start_page INTEGER,
            end_page INTEGER,
            start_offset INTEGER,
            end_offset INTEGER,
            vector_id TEXT,
            is_indexed INTEGER NOT NULL DEFAULT 0,
            metadata TEXT,
            created_at INTEGER
          );
          CREATE INDEX document_chunk_doc_idx ON document_chunk(document_id);
          CREATE INDEX document_chunk_kb_idx ON document_chunk(knowledge_base_id);
          CREATE INDEX document_chunk_user_idx ON document_chunk(user_id);
          CREATE INDEX document_chunk_vector_idx ON document_chunk(vector_id);
        `);
        console.log("[Migration] Created document_chunk table");
      }
    },
  },

  {
    version: 3,
    name: "add_acp_permission_table",
    description: "Add acp_permission table for ACP agent global permission storage",
    up: (db) => {
      // Create acp_permission table if not exists
      if (!tableExists(db, "acp_permission")) {
        db.exec(`
          CREATE TABLE acp_permission (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
            agent_id TEXT NOT NULL,
            permission_type TEXT NOT NULL,
            tool_name TEXT,
            scope TEXT NOT NULL DEFAULT 'global',
            approved_at INTEGER,
            expires_at INTEGER,
            metadata TEXT,
            created_at INTEGER
          );
          CREATE INDEX acp_permission_user_idx ON acp_permission(user_id);
          CREATE INDEX acp_permission_agent_idx ON acp_permission(agent_id);
          CREATE INDEX acp_permission_type_idx ON acp_permission(permission_type);
          CREATE INDEX acp_permission_lookup_idx ON acp_permission(user_id, agent_id, permission_type);
          CREATE UNIQUE INDEX acp_permission_unique ON acp_permission(user_id, agent_id, permission_type, tool_name);
        `);
        console.log("[Migration] Created acp_permission table");
      }
    },
  },

  {
    version: 4,
    name: "add_thread_provider",
    description: "Add provider column to chat_thread for identifying coding agent chats",
    up: (db) => {
      addColumnIfNotExists(db, "chat_thread", "provider", "TEXT");
    },
  },

  {
    version: 5,
    name: "add_thread_model",
    description: "Add model column to chat_thread for restoring model when loading thread",
    up: (db) => {
      addColumnIfNotExists(db, "chat_thread", "model", "TEXT");
    },
  },

  // ============================================================================
  // EXAMPLE MIGRATIONS (uncomment and modify when needed)
  // ============================================================================

  // {
  //   version: 2,
  //   name: "add_user_locale",
  //   description: "Add locale column to user table for internationalization",
  //   up: (db) => {
  //     addColumnIfNotExists(db, "user", "locale", "TEXT DEFAULT 'en'");
  //   },
  //   down: (db) => {
  //     // SQLite doesn't support DROP COLUMN easily, would need table recreation
  //     console.log("[Migration] Rollback for add_user_locale not supported");
  //   },
  // },

  // {
  //   version: 3,
  //   name: "add_thread_pinned",
  //   description: "Add pinned column to chat_thread for pinning conversations",
  //   up: (db) => {
  //     addColumnIfNotExists(db, "chat_thread", "pinned", "INTEGER DEFAULT 0");
  //     addColumnIfNotExists(db, "chat_thread", "pinned_at", "INTEGER");
  //   },
  // },

  // {
  //   version: 4,
  //   name: "add_message_reactions",
  //   description: "Create table for message reactions/feedback",
  //   up: (db) => {
  //     if (!tableExists(db, "message_reaction")) {
  //       db.exec(`
  //         CREATE TABLE message_reaction (
  //           id TEXT PRIMARY KEY,
  //           message_id TEXT NOT NULL REFERENCES chat_message(id) ON DELETE CASCADE,
  //           user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  //           reaction_type TEXT NOT NULL,
  //           created_at INTEGER,
  //           UNIQUE(message_id, user_id, reaction_type)
  //         );
  //         CREATE INDEX message_reaction_message_idx ON message_reaction(message_id);
  //       `);
  //     }
  //   },
  // },
];

// ============================================================================
// SCHEMA VERSION MANAGEMENT
// ============================================================================

/**
 * Initialize schema version tables
 */
function initializeSchemaVersionTables(db: Database.Database): void {
  // Main schema version table
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL DEFAULT 0,
      app_version TEXT,
      last_migration_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    );
  `);

  // Migration history table for auditing
  db.exec(`
    CREATE TABLE IF NOT EXISTS migration_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      app_version TEXT,
      success INTEGER NOT NULL,
      error_message TEXT,
      duration_ms INTEGER,
      executed_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    );
    CREATE INDEX IF NOT EXISTS migration_history_version_idx ON migration_history(version);
  `);
}

/**
 * Get the current schema version from the database
 */
export function getSchemaVersion(db: Database.Database): number {
  try {
    initializeSchemaVersionTables(db);

    const row = db
      .prepare("SELECT version FROM schema_version WHERE id = 1")
      .get() as { version: number } | undefined;

    if (!row) {
      // Insert initial version
      db.prepare(
        "INSERT INTO schema_version (id, version, app_version) VALUES (1, 0, ?)",
      ).run(APP_VERSION);
      return 0;
    }

    return row.version;
  } catch (error) {
    console.error("[Migration] Error getting schema version:", error);
    return 0;
  }
}

/**
 * Get full schema info including app version
 */
export function getSchemaInfo(db: Database.Database): SchemaInfo {
  try {
    initializeSchemaVersionTables(db);

    const row = db
      .prepare(
        "SELECT version, app_version, last_migration_at, created_at FROM schema_version WHERE id = 1",
      )
      .get() as
      | {
          version: number;
          app_version: string | null;
          last_migration_at: number | null;
          created_at: number | null;
        }
      | undefined;

    if (!row) {
      return {
        version: 0,
        appVersion: null,
        lastMigrationAt: null,
        createdAt: null,
      };
    }

    return {
      version: row.version,
      appVersion: row.app_version,
      lastMigrationAt: row.last_migration_at
        ? new Date(row.last_migration_at * 1000)
        : null,
      createdAt: row.created_at ? new Date(row.created_at * 1000) : null,
    };
  } catch (error) {
    console.error("[Migration] Error getting schema info:", error);
    return {
      version: 0,
      appVersion: null,
      lastMigrationAt: null,
      createdAt: null,
    };
  }
}

/**
 * Update the schema version in the database
 */
function setSchemaVersion(db: Database.Database, version: number): void {
  db.prepare(
    `UPDATE schema_version
     SET version = ?,
         app_version = ?,
         last_migration_at = strftime('%s', 'now'),
         updated_at = strftime('%s', 'now')
     WHERE id = 1`,
  ).run(version, APP_VERSION);
}

/**
 * Record migration in history table
 */
function recordMigrationHistory(
  db: Database.Database,
  migration: Migration,
  success: boolean,
  durationMs: number,
  errorMessage?: string,
): void {
  db.prepare(
    `INSERT INTO migration_history
     (version, name, description, app_version, success, error_message, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    migration.version,
    migration.name,
    migration.description,
    APP_VERSION,
    success ? 1 : 0,
    errorMessage || null,
    durationMs,
  );
}

// ============================================================================
// MIGRATION RUNNER
// ============================================================================

/**
 * Run all pending migrations
 * This should be called during app startup after database initialization
 */
export function runMigrations(db: Database.Database): MigrationResult {
  const startTime = Date.now();
  const currentVersion = getSchemaVersion(db);
  const details: MigrationResult["details"] = [];

  console.log("[Migration] ========================================");
  console.log(`[Migration] Current schema version: ${currentVersion}`);
  console.log(`[Migration] Target schema version: ${CURRENT_SCHEMA_VERSION}`);
  console.log(`[Migration] App version: ${APP_VERSION}`);
  console.log("[Migration] ========================================");

  if (currentVersion >= CURRENT_SCHEMA_VERSION) {
    console.log("[Migration] Schema is up to date, no migrations needed");
    return {
      success: true,
      migrationsRun: 0,
      fromVersion: currentVersion,
      toVersion: currentVersion,
      details: [],
    };
  }

  const pendingMigrations = migrations.filter(
    (m) => m.version > currentVersion,
  );
  console.log(`[Migration] ${pendingMigrations.length} migration(s) pending`);

  let lastSuccessfulVersion = currentVersion;

  for (const migration of pendingMigrations) {
    const migrationStartTime = Date.now();
    console.log(`[Migration] Running v${migration.version}: ${migration.name}`);
    console.log(`[Migration]   Description: ${migration.description}`);

    try {
      // Run migration in a transaction
      const runMigration = db.transaction(() => {
        migration.up(db);
        setSchemaVersion(db, migration.version);
      });

      runMigration();

      const durationMs = Date.now() - migrationStartTime;
      recordMigrationHistory(db, migration, true, durationMs);
      lastSuccessfulVersion = migration.version;

      details.push({
        version: migration.version,
        name: migration.name,
        success: true,
        durationMs,
      });

      console.log(
        `[Migration] ✓ Completed v${migration.version} in ${durationMs}ms`,
      );
    } catch (error) {
      const durationMs = Date.now() - migrationStartTime;
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      recordMigrationHistory(db, migration, false, durationMs, errorMessage);

      details.push({
        version: migration.version,
        name: migration.name,
        success: false,
        error: errorMessage,
        durationMs,
      });

      console.error(
        `[Migration] ✗ Failed v${migration.version}: ${errorMessage}`,
      );

      // Stop on first failure
      return {
        success: false,
        migrationsRun: details.filter((d) => d.success).length,
        fromVersion: currentVersion,
        toVersion: lastSuccessfulVersion,
        error: `Migration v${migration.version} failed: ${errorMessage}`,
        details,
      };
    }
  }

  const totalDuration = Date.now() - startTime;
  console.log("[Migration] ========================================");
  console.log(`[Migration] All migrations complete in ${totalDuration}ms`);
  console.log(
    `[Migration] Migrated from v${currentVersion} to v${CURRENT_SCHEMA_VERSION}`,
  );
  console.log("[Migration] ========================================");

  return {
    success: true,
    migrationsRun: details.length,
    fromVersion: currentVersion,
    toVersion: CURRENT_SCHEMA_VERSION,
    details,
  };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Check if migrations are needed
 */
export function needsMigration(db: Database.Database): boolean {
  const currentVersion = getSchemaVersion(db);
  return currentVersion < CURRENT_SCHEMA_VERSION;
}

/**
 * Get list of pending migrations
 */
export function getPendingMigrations(db: Database.Database): Migration[] {
  const currentVersion = getSchemaVersion(db);
  return migrations.filter((m) => m.version > currentVersion);
}

/**
 * Get migration history from database
 */
export function getMigrationHistory(db: Database.Database): Array<{
  version: number;
  name: string;
  description: string | null;
  appVersion: string | null;
  success: boolean;
  errorMessage: string | null;
  durationMs: number | null;
  executedAt: Date;
}> {
  try {
    initializeSchemaVersionTables(db);

    const rows = db
      .prepare(
        `SELECT version, name, description, app_version, success, error_message, duration_ms, executed_at
         FROM migration_history
         ORDER BY executed_at DESC`,
      )
      .all() as Array<{
      version: number;
      name: string;
      description: string | null;
      app_version: string | null;
      success: number;
      error_message: string | null;
      duration_ms: number | null;
      executed_at: number;
    }>;

    return rows.map((row) => ({
      version: row.version,
      name: row.name,
      description: row.description,
      appVersion: row.app_version,
      success: row.success === 1,
      errorMessage: row.error_message,
      durationMs: row.duration_ms,
      executedAt: new Date(row.executed_at * 1000),
    }));
  } catch (error) {
    console.error("[Migration] Error getting migration history:", error);
    return [];
  }
}

/**
 * Validate that all migrations are in order and have unique versions
 */
export function validateMigrations(): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const versions = new Set<number>();

  for (let i = 0; i < migrations.length; i++) {
    const migration = migrations[i];

    // Check for duplicate versions
    if (versions.has(migration.version)) {
      errors.push(`Duplicate migration version: ${migration.version}`);
    }
    versions.add(migration.version);

    // Check that versions are in ascending order
    if (i > 0 && migrations[i - 1].version >= migration.version) {
      errors.push(
        `Migration versions out of order: v${migrations[i - 1].version} before v${migration.version}`,
      );
    }

    // Check for required fields
    if (!migration.name) {
      errors.push(`Migration v${migration.version} missing name`);
    }
    if (!migration.description) {
      errors.push(`Migration v${migration.version} missing description`);
    }
    if (typeof migration.up !== "function") {
      errors.push(`Migration v${migration.version} missing up function`);
    }
  }

  // Check that CURRENT_SCHEMA_VERSION matches the latest migration
  const maxVersion = Math.max(...migrations.map((m) => m.version), 0);
  if (CURRENT_SCHEMA_VERSION !== maxVersion) {
    errors.push(
      `CURRENT_SCHEMA_VERSION (${CURRENT_SCHEMA_VERSION}) does not match latest migration version (${maxVersion})`,
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
