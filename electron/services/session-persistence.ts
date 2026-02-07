/**
 * Session Persistence Service
 * 
 * Stores ACP session metadata in SQLite for persistence across app restarts.
 * Implements P0 Gap #1 from ACP_GAP_ANALYSIS.md
 * 
 * Features:
 * - Store session metadata (sessionId, agentId, workingDirectory, etc.)
 * - Store session messages for replay
 * - Auto-resume last active session on app restart
 * - Track session state (active, completed, error)
 */

import Database from "better-sqlite3";
import { app } from "electron";
import { join } from "path";
import { existsSync, mkdirSync } from "fs";
import type { ACPSession, ACPSessionInfo } from "../../src/types/acp";

// Database path in app data directory
const getDbPath = (): string => {
  const userDataPath = app.getPath("userData");
  const dbDir = join(userDataPath, "data");
  
  // Ensure directory exists
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }
  
  return join(dbDir, "acp-sessions.db");
};

// Singleton database instance
let db: Database.Database | null = null;

/**
 * Session state enum
 */
export type SessionState = "active" | "completed" | "error" | "abandoned";

/**
 * Persisted session data
 */
export interface PersistedSession {
  id: number;
  sessionId: string;
  agentId: string;
  workingDirectory: string;
  threadId: string | null;
  title: string | null;
  state: SessionState;
  currentMode: string | null;
  createdAt: number; // Unix timestamp
  updatedAt: number; // Unix timestamp
  lastMessageAt: number | null; // Unix timestamp
  messageCount: number;
  tokenCount: number | null;
  metadata: string | null; // JSON string
}

/**
 * Persisted message data
 */
export interface PersistedMessage {
  id: number;
  sessionId: string;
  messageId: string;
  role: "user" | "assistant" | "system";
  content: string; // JSON string of parts
  createdAt: number;
  tokenCount: number | null;
}

/**
 * Initialize the database and create tables
 */
function initializeDatabase(): Database.Database {
  if (db) return db;
  
  const dbPath = getDbPath();
  console.log(`[SessionPersistence] Initializing database at: ${dbPath}`);
  
  db = new Database(dbPath);
  
  // Enable WAL mode for better performance
  db.pragma("journal_mode = WAL");
  
  // Create sessions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS acp_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT UNIQUE NOT NULL,
      agent_id TEXT NOT NULL,
      working_directory TEXT NOT NULL,
      thread_id TEXT,
      title TEXT,
      state TEXT DEFAULT 'active',
      current_mode TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_message_at INTEGER,
      message_count INTEGER DEFAULT 0,
      token_count INTEGER,
      metadata TEXT,
      
      -- Indexes
      UNIQUE(session_id)
    );
    
    CREATE INDEX IF NOT EXISTS idx_sessions_agent ON acp_sessions(agent_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_thread ON acp_sessions(thread_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_state ON acp_sessions(state);
    CREATE INDEX IF NOT EXISTS idx_sessions_updated ON acp_sessions(updated_at);
  `);
  
  // Create messages table
  db.exec(`
    CREATE TABLE IF NOT EXISTS acp_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      token_count INTEGER,
      
      FOREIGN KEY (session_id) REFERENCES acp_sessions(session_id) ON DELETE CASCADE,
      UNIQUE(session_id, message_id)
    );
    
    CREATE INDEX IF NOT EXISTS idx_messages_session ON acp_messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_messages_created ON acp_messages(created_at);
  `);
  
  // Create auto-resume settings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS acp_auto_resume (
      id INTEGER PRIMARY KEY,
      thread_id TEXT UNIQUE NOT NULL,
      session_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      should_resume INTEGER DEFAULT 1,

      FOREIGN KEY (session_id) REFERENCES acp_sessions(session_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_auto_resume_thread ON acp_auto_resume(thread_id);
  `);

  // Create stored permissions table for global permission persistence
  db.exec(`
    CREATE TABLE IF NOT EXISTS acp_stored_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      permission_type TEXT NOT NULL,
      tool_name TEXT,
      file_pattern TEXT,
      option_id TEXT NOT NULL,
      granted INTEGER NOT NULL,
      created_at INTEGER NOT NULL,

      UNIQUE(agent_id, permission_type, tool_name, file_pattern)
    );

    CREATE INDEX IF NOT EXISTS idx_permissions_agent ON acp_stored_permissions(agent_id);
    CREATE INDEX IF NOT EXISTS idx_permissions_type ON acp_stored_permissions(permission_type);
  `);

  console.log("[SessionPersistence] Database initialized successfully");
  return db;
}

/**
 * Get the database instance, initializing if needed
 */
export function getDatabase(): Database.Database {
  return initializeDatabase();
}

/**
 * Save or update a session
 */
export function saveSession(
  session: ACPSession,
  threadId?: string,
  title?: string
): void {
  const database = getDatabase();
  const now = Date.now();
  
  const stmt = database.prepare(`
    INSERT INTO acp_sessions (
      session_id, agent_id, working_directory, thread_id, title,
      state, current_mode, created_at, updated_at, message_count
    ) VALUES (
      ?, ?, ?, ?, ?, 'active', ?, ?, ?, 0
    )
    ON CONFLICT(session_id) DO UPDATE SET
      working_directory = excluded.working_directory,
      title = COALESCE(excluded.title, title),
      current_mode = excluded.current_mode,
      updated_at = excluded.updated_at
  `);
  
  stmt.run(
    session.sessionId,
    session.agentId,
    session.workingDirectory,
    threadId || null,
    title || null,
    session.currentMode || null,
    now,
    now
  );
  
  console.log(`[SessionPersistence] Session saved: ${session.sessionId}`);
}

/**
 * Update session state
 */
export function updateSessionState(sessionId: string, state: SessionState): void {
  const database = getDatabase();
  
  const stmt = database.prepare(`
    UPDATE acp_sessions
    SET state = ?, updated_at = ?
    WHERE session_id = ?
  `);
  
  stmt.run(state, Date.now(), sessionId);
}

/**
 * Update session title
 */
export function updateSessionTitle(sessionId: string, title: string): void {
  const database = getDatabase();
  
  const stmt = database.prepare(`
    UPDATE acp_sessions
    SET title = ?, updated_at = ?
    WHERE session_id = ?
  `);
  
  stmt.run(title, Date.now(), sessionId);
}

/**
 * Update session token count
 */
export function updateSessionTokenCount(sessionId: string, tokenCount: number): void {
  const database = getDatabase();
  
  const stmt = database.prepare(`
    UPDATE acp_sessions
    SET token_count = ?, updated_at = ?
    WHERE session_id = ?
  `);
  
  stmt.run(tokenCount, Date.now(), sessionId);
}

/**
 * Save a message to a session
 */
export function saveMessage(
  sessionId: string,
  messageId: string,
  role: "user" | "assistant" | "system",
  content: unknown,
  tokenCount?: number
): void {
  const database = getDatabase();
  const now = Date.now();
  
  const contentJson = typeof content === "string" ? content : JSON.stringify(content);
  
  // Insert message
  const msgStmt = database.prepare(`
    INSERT INTO acp_messages (session_id, message_id, role, content, created_at, token_count)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id, message_id) DO UPDATE SET
      content = excluded.content,
      token_count = COALESCE(excluded.token_count, token_count)
  `);
  
  msgStmt.run(sessionId, messageId, role, contentJson, now, tokenCount || null);
  
  // Update session message count and last message timestamp
  const updateStmt = database.prepare(`
    UPDATE acp_sessions
    SET message_count = message_count + 1,
        last_message_at = ?,
        updated_at = ?
    WHERE session_id = ?
  `);
  
  updateStmt.run(now, now, sessionId);
}

/**
 * Get a session by ID
 */
export function getSession(sessionId: string): PersistedSession | null {
  const database = getDatabase();
  
  const stmt = database.prepare(`
    SELECT
      id, session_id as sessionId, agent_id as agentId,
      working_directory as workingDirectory, thread_id as threadId,
      title, state, current_mode as currentMode,
      created_at as createdAt, updated_at as updatedAt,
      last_message_at as lastMessageAt, message_count as messageCount,
      token_count as tokenCount, metadata
    FROM acp_sessions
    WHERE session_id = ?
  `);
  
  return stmt.get(sessionId) as PersistedSession | null;
}

/**
 * Get sessions for a specific thread
 */
export function getSessionsByThread(threadId: string, limit = 50): PersistedSession[] {
  const database = getDatabase();
  
  const stmt = database.prepare(`
    SELECT
      id, session_id as sessionId, agent_id as agentId,
      working_directory as workingDirectory, thread_id as threadId,
      title, state, current_mode as currentMode,
      created_at as createdAt, updated_at as updatedAt,
      last_message_at as lastMessageAt, message_count as messageCount,
      token_count as tokenCount, metadata
    FROM acp_sessions
    WHERE thread_id = ?
    ORDER BY updated_at DESC
    LIMIT ?
  `);
  
  return stmt.all(threadId, limit) as PersistedSession[];
}

/**
 * Get sessions for a specific agent
 */
export function getSessionsByAgent(agentId: string, limit = 50): PersistedSession[] {
  const database = getDatabase();
  
  const stmt = database.prepare(`
    SELECT
      id, session_id as sessionId, agent_id as agentId,
      working_directory as workingDirectory, thread_id as threadId,
      title, state, current_mode as currentMode,
      created_at as createdAt, updated_at as updatedAt,
      last_message_at as lastMessageAt, message_count as messageCount,
      token_count as tokenCount, metadata
    FROM acp_sessions
    WHERE agent_id = ?
    ORDER BY updated_at DESC
    LIMIT ?
  `);
  
  return stmt.all(agentId, limit) as PersistedSession[];
}

/**
 * Get recent sessions with optional filters
 */
export function getRecentSessions(options: {
  agentId?: string;
  threadId?: string;
  state?: SessionState;
  workingDirectory?: string;
  limit?: number;
} = {}): PersistedSession[] {
  const database = getDatabase();
  const { agentId, threadId, state, workingDirectory, limit = 50 } = options;
  
  let sql = `
    SELECT
      id, session_id as sessionId, agent_id as agentId,
      working_directory as workingDirectory, thread_id as threadId,
      title, state, current_mode as currentMode,
      created_at as createdAt, updated_at as updatedAt,
      last_message_at as lastMessageAt, message_count as messageCount,
      token_count as tokenCount, metadata
    FROM acp_sessions
    WHERE 1=1
  `;
  
  const params: unknown[] = [];
  
  if (agentId) {
    sql += " AND agent_id = ?";
    params.push(agentId);
  }
  
  if (threadId) {
    sql += " AND thread_id = ?";
    params.push(threadId);
  }
  
  if (state) {
    sql += " AND state = ?";
    params.push(state);
  }
  
  if (workingDirectory) {
    sql += " AND working_directory = ?";
    params.push(workingDirectory);
  }
  
  sql += " ORDER BY updated_at DESC LIMIT ?";
  params.push(limit);
  
  const stmt = database.prepare(sql);
  return stmt.all(...params) as PersistedSession[];
}

/**
 * Get messages for a session
 */
export function getSessionMessages(sessionId: string, limit = 100): PersistedMessage[] {
  const database = getDatabase();
  
  const stmt = database.prepare(`
    SELECT
      id, session_id as sessionId, message_id as messageId,
      role, content, created_at as createdAt, token_count as tokenCount
    FROM acp_messages
    WHERE session_id = ?
    ORDER BY created_at ASC
    LIMIT ?
  `);
  
  return stmt.all(sessionId, limit) as PersistedMessage[];
}

/**
 * Set auto-resume preference for a thread
 */
export function setAutoResume(threadId: string, sessionId: string, agentId: string, shouldResume: boolean): void {
  const database = getDatabase();
  
  const stmt = database.prepare(`
    INSERT INTO acp_auto_resume (thread_id, session_id, agent_id, should_resume)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(thread_id) DO UPDATE SET
      session_id = excluded.session_id,
      agent_id = excluded.agent_id,
      should_resume = excluded.should_resume
  `);
  
  stmt.run(threadId, sessionId, agentId, shouldResume ? 1 : 0);
}

/**
 * Get auto-resume session for a thread
 */
export function getAutoResumeSession(threadId: string): {
  sessionId: string;
  agentId: string;
  shouldResume: boolean;
} | null {
  const database = getDatabase();
  
  const stmt = database.prepare(`
    SELECT session_id as sessionId, agent_id as agentId, should_resume as shouldResume
    FROM acp_auto_resume
    WHERE thread_id = ?
  `);
  
  const result = stmt.get(threadId) as { sessionId: string; agentId: string; shouldResume: number } | undefined;
  
  if (!result) return null;
  
  return {
    sessionId: result.sessionId,
    agentId: result.agentId,
    shouldResume: result.shouldResume === 1,
  };
}

/**
 * Clear auto-resume for a thread
 */
export function clearAutoResume(threadId: string): void {
  const database = getDatabase();
  
  const stmt = database.prepare("DELETE FROM acp_auto_resume WHERE thread_id = ?");
  stmt.run(threadId);
}

/**
 * Delete a session and its messages
 */
export function deleteSession(sessionId: string): void {
  const database = getDatabase();
  
  // Messages are deleted via CASCADE
  const stmt = database.prepare("DELETE FROM acp_sessions WHERE session_id = ?");
  stmt.run(sessionId);
  
  console.log(`[SessionPersistence] Session deleted: ${sessionId}`);
}

/**
 * Delete old sessions (cleanup)
 */
export function deleteOldSessions(olderThanDays: number = 30): number {
  const database = getDatabase();
  const cutoff = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
  
  const stmt = database.prepare(`
    DELETE FROM acp_sessions
    WHERE updated_at < ? AND state IN ('completed', 'abandoned', 'error')
  `);
  
  const result = stmt.run(cutoff);
  console.log(`[SessionPersistence] Deleted ${result.changes} old sessions`);
  
  return result.changes;
}

/**
 * Convert persisted session to ACPSessionInfo format
 */
export function toACPSessionInfo(persisted: PersistedSession): ACPSessionInfo {
  return {
    sessionId: persisted.sessionId,
    cwd: persisted.workingDirectory,
    title: persisted.title || undefined,
    updatedAt: new Date(persisted.updatedAt),
    meta: persisted.metadata ? JSON.parse(persisted.metadata) : undefined,
  };
}

/**
 * Get session count for stats
 */
export function getSessionStats(): {
  total: number;
  active: number;
  completed: number;
  error: number;
} {
  const database = getDatabase();
  
  const stmt = database.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN state = 'active' THEN 1 ELSE 0 END) as active,
      SUM(CASE WHEN state = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN state = 'error' THEN 1 ELSE 0 END) as error
    FROM acp_sessions
  `);
  
  const result = stmt.get() as {
    total: number;
    active: number;
    completed: number;
    error: number;
  };
  
  return result;
}

// ============================================================================
// PERMISSION PERSISTENCE
// ============================================================================

/**
 * Stored permission data
 */
export interface StoredPermission {
  id: number;
  agentId: string;
  permissionType: string;
  toolName: string | null;
  filePattern: string | null;
  optionId: string;
  granted: boolean;
  createdAt: number;
}

/**
 * Store a permission decision for future auto-approval
 */
export function storePermission(
  agentId: string,
  permissionType: string,
  optionId: string,
  granted: boolean,
  toolName?: string,
  filePattern?: string
): void {
  const database = getDatabase();

  const stmt = database.prepare(`
    INSERT INTO acp_stored_permissions (
      agent_id, permission_type, tool_name, file_pattern,
      option_id, granted, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(agent_id, permission_type, tool_name, file_pattern)
    DO UPDATE SET
      option_id = excluded.option_id,
      granted = excluded.granted,
      created_at = excluded.created_at
  `);

  stmt.run(
    agentId,
    permissionType,
    toolName || null,
    filePattern || null,
    optionId,
    granted ? 1 : 0,
    Date.now()
  );

  console.log(
    `[SessionPersistence] Stored permission for ${agentId}: ${permissionType} -> ${granted ? "granted" : "denied"}`
  );
}

/**
 * Get a stored permission for auto-approval
 */
export function getStoredPermission(
  agentId: string,
  permissionType: string,
  toolName?: string,
  filePattern?: string
): StoredPermission | null {
  const database = getDatabase();

  const stmt = database.prepare(`
    SELECT
      id, agent_id as agentId, permission_type as permissionType,
      tool_name as toolName, file_pattern as filePattern,
      option_id as optionId, granted, created_at as createdAt
    FROM acp_stored_permissions
    WHERE agent_id = ?
      AND permission_type = ?
      AND (tool_name = ? OR (tool_name IS NULL AND ? IS NULL))
      AND (file_pattern = ? OR (file_pattern IS NULL AND ? IS NULL))
  `);

  const result = stmt.get(
    agentId,
    permissionType,
    toolName || null,
    toolName || null,
    filePattern || null,
    filePattern || null
  ) as {
    id: number;
    agentId: string;
    permissionType: string;
    toolName: string | null;
    filePattern: string | null;
    optionId: string;
    granted: number;
    createdAt: number;
  } | undefined;

  if (!result) return null;

  return {
    ...result,
    granted: result.granted === 1,
  };
}

/**
 * Get all stored permissions for an agent
 * TODO: Wire up to IPC handler for settings UI to view/manage stored permissions
 */
export function getStoredPermissionsByAgent(agentId: string): StoredPermission[] {
  const database = getDatabase();

  const stmt = database.prepare(`
    SELECT
      id, agent_id as agentId, permission_type as permissionType,
      tool_name as toolName, file_pattern as filePattern,
      option_id as optionId, granted, created_at as createdAt
    FROM acp_stored_permissions
    WHERE agent_id = ?
    ORDER BY created_at DESC
  `);

  const results = stmt.all(agentId) as Array<{
    id: number;
    agentId: string;
    permissionType: string;
    toolName: string | null;
    filePattern: string | null;
    optionId: string;
    granted: number;
    createdAt: number;
  }>;

  return results.map((r) => ({
    ...r,
    granted: r.granted === 1,
  }));
}

/**
 * Clear stored permissions for an agent (or all if no agentId)
 * TODO: Wire up to IPC handler for settings UI to clear stored permissions
 */
export function clearStoredPermissions(agentId?: string): void {
  const database = getDatabase();

  if (agentId) {
    const stmt = database.prepare(
      "DELETE FROM acp_stored_permissions WHERE agent_id = ?"
    );
    stmt.run(agentId);
    console.log(`[SessionPersistence] Cleared permissions for agent: ${agentId}`);
  } else {
    database.exec("DELETE FROM acp_stored_permissions");
    console.log("[SessionPersistence] Cleared all stored permissions");
  }
}

/**
 * Close the database connection
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    console.log("[SessionPersistence] Database closed");
  }
}

/**
 * Vacuum the database (optimize)
 */
export function vacuumDatabase(): void {
  const database = getDatabase();
  database.exec("VACUUM");
  console.log("[SessionPersistence] Database vacuumed");
}
