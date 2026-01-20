import "server-only";
import logger from "logger";

/**
 * Electron Authentication Instance
 *
 * In Electron desktop app, authentication is handled entirely through IPC
 * to the main process. This module provides stub implementations that
 * defer to IPC-based auth in the renderer.
 *
 * The actual auth logic lives in:
 * - electron/services/auth.ts (main process)
 * - src/lib/auth/client.ts (renderer IPC calls)
 */

/**
 * Session data returned by getSession
 */
interface SessionResult {
  user: {
    id: string;
    email: string;
    name: string;
    image: string | null;
    emailVerified: boolean;
    createdAt: Date;
    updatedAt: Date;
    preferences: any | null;
    banned: boolean;
    banReason: string | null;
    banExpires: Date | null;
  };
  session: {
    id: string;
    expiresAt: Date;
    token: string;
    userId: string;
  };
}

/**
 * Get the current user session
 *
 * In Electron, this checks the SQLite database for an active session.
 */
export async function getSession(): Promise<SessionResult | null> {
  // Try direct SQLite access
  try {
    // Try to use the SQLite database (available in Electron production)
    const { getDatabase, schema } = await import("lib/db/sqlite/db.sqlite");
    const { eq, gt, desc } = await import("drizzle-orm");

    const db = getDatabase();

    // Get the most recent valid session (order by created_at descending to get newest first)
    const sessions = await db
      .select()
      .from(schema.SessionTable)
      .where(gt(schema.SessionTable.expiresAt, new Date()))
      .orderBy(desc(schema.SessionTable.createdAt))
      .limit(1);

    const session = sessions[0];

    if (!session) {
      logger.debug("[Auth] No valid session found in database");

      // In Electron mode, if no session exists, try to get the first user
      // and create a default session for them (for local desktop app convenience)
      const users = await db.select().from(schema.UserTable).limit(1);

      if (users.length > 0) {
        const user = users[0];
        logger.debug("[Auth] Creating default session for user:", user.email);

        // Create a default session token
        const defaultToken = `default-${user.id}-${Date.now()}`;
        const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 year

        // Insert session
        const { randomUUID } = await import("crypto");
        await db.insert(schema.SessionTable).values({
          id: randomUUID(),
          token: defaultToken,
          userId: user.id,
          expiresAt: expiresAt,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        // Return session
        return {
          user: {
            id: user.id,
            email: user.email,
            name: user.name || "User",
            image: user.image,
            emailVerified: true,
            createdAt: user.createdAt ?? new Date(),
            updatedAt: user.updatedAt ?? new Date(),
            preferences: user.preferences,
            banned: false,
            banReason: null,
            banExpires: null,
          },
          session: {
            id: randomUUID(),
            expiresAt: expiresAt,
            token: defaultToken,
            userId: user.id,
          },
        };
      }

      return null;
    }

    // Get user
    const [user] = await db
      .select()
      .from(schema.UserTable)
      .where(eq(schema.UserTable.id, session.userId))
      .limit(1);

    if (!user) {
      logger.debug("[Auth] User not found for session");
      return null;
    }

    // Return session in expected format
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name || "User",
        image: user.image,
        emailVerified: true,
        createdAt: user.createdAt ?? new Date(),
        updatedAt: user.updatedAt ?? new Date(),
        preferences: user.preferences,
        banned: false,
        banReason: null,
        banExpires: null,
      },
      session: {
        id: session.id,
        expiresAt: session.expiresAt,
        token: session.token,
        userId: session.userId,
      },
    };
  } catch (error: any) {
    // Check if this is an Electron mode error (native module mismatch)
    const errorMsg = error?.message || "";
    const isElectronModeError =
      error?.isElectronMode ||
      errorMsg.includes("SQLite is not available") ||
      errorMsg.includes("NODE_MODULE_VERSION") ||
      errorMsg.includes("Use Electron IPC") ||
      errorMsg.includes("use IPC");

    if (isElectronModeError) {
      // In Electron dev mode, SQLite native module has version mismatch
      // For desktop app, return a default local user session
      // The actual database operations will go through Electron IPC
      logger.debug(
        "[Auth] SQLite unavailable in dev mode, trying fallback session",
      );

      const defaultSession = await getDefaultDesktopSession();
      if (defaultSession) {
        return defaultSession;
      }
    }

    // Not in Electron mode or database not available
    logger.debug("[Auth] Database unavailable:", error);
    return null;
  }
}

/**
 * Get a default session for Electron desktop mode
 * Used when SQLite native module has version mismatch in dev mode
 *
 * In dev mode, Electron writes a session-sync.json file that we can read
 * to get the actual user ID and session token from the authenticated session.
 * This enables proper auth interop between Electron main and Next.js server.
 */
async function getDefaultDesktopSession(): Promise<SessionResult | null> {
  try {
    const path = await import("path");
    const fs = await import("fs");

    // Get the userData path (same logic as session-store.ts)
    const platform = process.platform;
    const appName = "shadower";

    let userDataDir: string;
    if (platform === "darwin") {
      userDataDir = path.join(
        process.env.HOME || "",
        "Library",
        "Application Support",
        appName,
      );
    } else if (platform === "win32") {
      userDataDir = path.join(process.env.APPDATA || "", appName);
    } else {
      userDataDir = path.join(process.env.HOME || "", ".config", appName);
    }

    // Try to read the session sync file (written by Electron session-store)
    const syncFilePath = path.join(userDataDir, "session-sync.json");

    if (fs.existsSync(syncFilePath)) {
      try {
        const syncData = JSON.parse(fs.readFileSync(syncFilePath, "utf-8"));

        // Validate the sync data
        if (syncData.userId && syncData.token && syncData.expiresAt) {
          // Check if session is still valid
          if (Date.now() > syncData.expiresAt) {
            logger.debug("[Auth] Session sync file expired");
            return null;
          }

          logger.info(
            "[Auth] Using session from sync file for user:",
            syncData.userId,
          );

          return {
            user: {
              id: syncData.userId,
              email: "desktop@shadower.local",
              name: "Desktop User",
              image: null,
              emailVerified: true,
              createdAt: new Date(),
              updatedAt: new Date(),
              preferences: null,
              banned: false,
              banReason: null,
              banExpires: null,
            },
            session: {
              id: syncData.token,
              expiresAt: new Date(syncData.expiresAt),
              token: syncData.token,
              userId: syncData.userId,
            },
          };
        }
      } catch (parseError) {
        logger.debug("[Auth] Failed to parse session sync file:", parseError);
      }
    }

    // Fallback: Check if database file exists
    const dbPath = path.join(userDataDir, "data", "shadower.db");

    if (!fs.existsSync(dbPath)) {
      logger.debug("[Auth] Database file not found at:", dbPath);
      return null;
    }

    // Database exists but no sync file - user needs to sign in through Electron
    // Return null to trigger auth flow
    logger.debug(
      "[Auth] Database exists but no valid session sync file - user needs to authenticate",
    );
    return null;
  } catch (error) {
    logger.debug("[Auth] Default desktop session error:", error);
    return null;
  }
}

/**
 * Check if this is the first user (no users with passwords)
 *
 * In Electron, this check happens via IPC in the renderer.
 * Return true to let the client-side auth guard handle the redirect.
 */
export async function getIsFirstUser(): Promise<boolean> {
  // Let client-side auth guard handle this via IPC
  logger.debug("[Auth] getIsFirstUser called - deferring to client-side IPC");
  return true;
}

/**
 * Auth object for compatibility with existing code
 * All operations should go through Electron IPC
 */
export const auth = {
  api: {
    getSession: async () => {
      return getSession();
    },
    // Auth operations should go through Electron IPC, not Next.js server
    signIn: {
      email: async () => ({ error: "Use Electron IPC for auth", data: null }),
    },
    signUpEmail: async () => ({
      error: "Use Electron IPC for auth",
      data: null,
    }),
    listUserAccounts: async () => [],
    listSessions: async () => [],
    updateUser: async () => ({
      error: "Use Electron IPC for auth",
      data: null,
    }),
    changeEmail: async () => ({
      error: "Use Electron IPC for auth",
      data: null,
    }),
    removeUser: async () => ({
      error: "Use Electron IPC for auth",
      data: null,
    }),
    changePassword: async () => ({
      error: "Use Electron IPC for auth",
      data: null,
    }),
    setPassword: async () => ({
      error: "Use Electron IPC for auth",
      data: null,
    }),
    revokeUserSessions: async () => ({
      error: "Use Electron IPC for auth",
      data: null,
    }),
    banUser: async () => ({ error: "Use Electron IPC for auth", data: null }),
    unbanUser: async () => ({ error: "Use Electron IPC for auth", data: null }),
  },
  handler: async () => {
    return new Response(
      JSON.stringify({ error: "Auth operations use Electron IPC" }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  },
};
