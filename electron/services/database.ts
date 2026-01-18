import { app } from 'electron';
import path from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '@/lib/db/sqlite/schema.sqlite';
import fs from 'fs-extra';

// Get the user data directory based on platform
const getUserDataDir = () => {
  return app.getPath('userData');
};

// Database file path
const getDbPath = () => {
  const userDataDir = getUserDataDir();
  const dbDir = path.join(userDataDir, 'data');

  // Ensure directory exists
  fs.ensureDirSync(dbDir);

  return path.join(dbDir, 'shadower.db');
};

// Initialize SQLite database
let sqlite: Database.Database | null = null;
let db: ReturnType<typeof drizzle> | null = null;

export const initializeDatabase = () => {
  if (db) {
    return db;
  }

  const dbPath = getDbPath();
  console.log(`[Database] Initializing SQLite database at: ${dbPath}`);

  // Create SQLite database instance
  sqlite = new Database(dbPath);

  // Enable foreign keys
  sqlite.pragma('foreign_keys = ON');

  // Enable WAL mode for better concurrency
  sqlite.pragma('journal_mode = WAL');

  // Create drizzle instance
  db = drizzle(sqlite, { schema });

  console.log('[Database] SQLite database initialized successfully');

  return db;
};

// Run migrations
export const runMigrations = () => {
  if (!db || !sqlite) {
    throw new Error('Database not initialized');
  }

  const migrationsFolder = path.join(
    app.getAppPath(),
    'src/lib/db/migrations/sqlite'
  );

  console.log(`[Database] Running migrations from: ${migrationsFolder}`);

  try {
    migrate(db, { migrationsFolder });
    console.log('[Database] Migrations completed successfully');
  } catch (error) {
    console.error('[Database] Migration error:', error);
    throw error;
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
    console.log('[Database] Closing SQLite database');
    sqlite.close();
    sqlite = null;
    db = null;
  }
};

// Create default user for local-first setup
export const createDefaultUser = async () => {
  const database = getDatabase();

  try {
    // Check if default user exists
    const existingUser = await database.query.UserTable.findFirst({
      where: (users, { eq }) => eq(users.email, 'local@shadower.app'),
    });

    if (!existingUser) {
      console.log('[Database] Creating default local user');

      const [user] = await database
        .insert(schema.UserTable)
        .values({
          name: 'Local User',
          email: 'local@shadower.app',
          emailVerified: true,
          role: 'admin',
          preferences: {
            theme: 'dark',
            language: 'en',
          },
        })
        .returning();

      console.log('[Database] Default user created:', user.id);
      return user;
    }

    console.log('[Database] Default user already exists');
    return existingUser;
  } catch (error) {
    console.error('[Database] Error creating default user:', error);
    throw error;
  }
};

// Database health check
export const checkDatabaseHealth = () => {
  try {
    if (!sqlite) {
      throw new Error('Database not initialized');
    }

    // Simple query to check if database is responding
    const result = sqlite.prepare('SELECT 1 as health').get();
    return result && (result as { health: number }).health === 1;
  } catch (error) {
    console.error('[Database] Health check failed:', error);
    return false;
  }
};

// Export schema for use in IPC handlers
export { schema };
export type Database = typeof db;
