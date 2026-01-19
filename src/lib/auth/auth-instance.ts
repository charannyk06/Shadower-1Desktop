import { DEFAULT_USER_ROLE, USER_ROLES } from "app-types/roles";
// Base auth instance without "server-only" - can be used in seed scripts
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { admin as adminPlugin } from "better-auth/plugins";
// Import SQLite database module - use try/catch to handle Electron mode gracefully
// CRITICAL: Detect Electron mode BEFORE requiring SQLite module to prevent NODE_MODULE_VERSION errors
let sqliteDbModule: { getSqliteDb: () => any; sqliteDb: any } | null = null;
let sqliteModuleLoadError: Error | null = null;

try {
  // Check Electron mode BEFORE requiring the module
  const isElectronBuild = process.env.ELECTRON_BUILD === "true";
  const isElectronContext = (() => {
    try {
      const electron = require("electron");
      return electron && electron.app;
    } catch {
      return false;
    }
  })();

  // Only try to load SQLite module if NOT in Electron mode
  if (!isElectronBuild && !isElectronContext) {
    // Use require for conditional import to avoid bundling issues
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    sqliteDbModule = require("../db/sqlite/db.sqlite");
  } else {
    console.warn("[Auth] Electron mode detected - skipping SQLite module load");
  }
} catch (error: any) {
  const errorMsg = error?.message || String(error) || "";
  sqliteModuleLoadError = error;

  // Check if this is a NODE_MODULE_VERSION error (Electron mode)
  if (
    errorMsg.includes("NODE_MODULE_VERSION") ||
    errorMsg.includes("was compiled against a different Node.js version") ||
    errorMsg.includes("SQLite is not available")
  ) {
    console.warn(
      "[Auth] SQLite module unavailable (Electron mode):",
      errorMsg.substring(0, 150),
    );
  } else {
    console.warn(
      "[Auth] SQLite module not available:",
      errorMsg.substring(0, 100) || error,
    );
  }
}

import {
  AccountTable,
  SessionTable,
  UserTable,
  VerificationTable,
} from "lib/db/sqlite/schema.sqlite";
import { count } from "drizzle-orm";
import logger from "logger";
import { headers } from "next/headers";
import { getAuthConfig } from "./config";
import { ac, admin, editor, user } from "./roles";

// Helper to check if we're in Electron dev mode (where SQLite is not available)
// Cache the result to avoid repeated checks, but allow resetting if needed
let _isElectronDevMode: boolean | null = null;

const isElectronDevMode = (forceCheck = false): boolean => {
  // Return cached result if available (unless forcing a recheck)
  if (!forceCheck && _isElectronDevMode !== null) {
    return _isElectronDevMode;
  }

  // Check if we're in Electron build mode
  if (process.env.ELECTRON_BUILD === "true") {
    _isElectronDevMode = true;
    return true;
  }

  // Check if SQLite module was loaded successfully at module init time
  if (!sqliteDbModule) {
    // Check if the error was due to Electron mode
    if (sqliteModuleLoadError) {
      const errorMsg =
        sqliteModuleLoadError.message || String(sqliteModuleLoadError) || "";
      if (
        errorMsg.includes("NODE_MODULE_VERSION") ||
        errorMsg.includes("was compiled against a different Node.js version") ||
        errorMsg.includes("SQLite is not available")
      ) {
        _isElectronDevMode = true;
        logger.info(
          "[Auth] Electron mode detected - SQLite module unavailable",
        );
        return true;
      }
    }
    // Module failed to load - likely in Electron dev mode or SQLite unavailable
    _isElectronDevMode = true;
    logger.info(
      "[Auth] SQLite module not available - treating as Electron mode",
    );
    return true;
  }

  // Try to verify SQLite is working by accessing the database
  try {
    const db = sqliteDbModule.getSqliteDb ? sqliteDbModule.getSqliteDb() : null;
    if (!db || typeof db.select !== "function") {
      _isElectronDevMode = true;
      logger.info(
        "[Auth] SQLite database not functional - treating as Electron mode",
      );
      return true;
    }
    // SQLite is available and working
    _isElectronDevMode = false;
    return false;
  } catch (error: any) {
    const errorMsg = error?.message || String(error) || "";
    // Check for any indication that we're in Electron dev mode
    if (
      errorMsg.includes(
        "SQLite is not available in Next.js when running in Electron dev mode",
      ) ||
      errorMsg.includes("NODE_MODULE_VERSION") ||
      errorMsg.includes("was compiled against a different Node.js version") ||
      errorMsg.includes("better-sqlite3") ||
      errorMsg.includes("Cannot find module")
    ) {
      _isElectronDevMode = true;
      logger.info(
        "[Auth] Electron dev mode detected via SQLite error:",
        errorMsg.substring(0, 150),
      );
      return true;
    }
    // If error doesn't match expected patterns, assume not Electron mode
    // But log it for debugging
    logger.warn(
      "[Auth] SQLite error but not matching Electron pattern:",
      errorMsg.substring(0, 100),
    );
    _isElectronDevMode = false;
    return false;
  }
};

// Get database adapter - handle Electron mode gracefully
const getDatabaseAdapter = () => {
  // Check Electron mode first to avoid trying to access SQLite
  if (isElectronDevMode()) {
    logger.warn(
      "[Auth] Electron dev mode detected - using stub adapter. Session will be handled via IPC.",
    );

    // Create a comprehensive mock drizzle-like object that better-auth expects
    // The drizzle adapter returns an object with a `db` property that has query builder methods
    const createQueryBuilder = () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([]),
          then: (resolve: any) => resolve([]),
        }),
        limit: () => Promise.resolve([]),
        then: (resolve: any) => resolve([]),
      }),
      then: (resolve: any) => resolve([]),
    });

    const mockDb = {
      select: createQueryBuilder,
      insert: () => ({
        values: () => ({
          returning: () => Promise.resolve([]),
          then: (resolve: any) => resolve([]),
        }),
        then: (resolve: any) => resolve([]),
      }),
      update: () => ({
        set: () => ({
          where: () => ({
            returning: () => Promise.resolve([]),
            then: (resolve: any) => resolve([]),
          }),
          then: (resolve: any) => resolve([]),
        }),
        then: (resolve: any) => resolve([]),
      }),
      delete: () => ({
        where: () => Promise.resolve([]),
        then: (resolve: any) => resolve([]),
      }),
    };

    // Return a minimal adapter that implements required methods but returns null/empty
    // This allows better-auth to initialize without crashing
    // The adapter structure must match what drizzleAdapter returns
    return {
      provider: "sqlite" as const,
      db: mockDb,
      findSession: async () => null,
      findUser: async () => null,
      createSession: async () => null,
      updateSession: async () => null,
      deleteSession: async () => null,
      createUser: async () => null,
      updateUser: async () => null,
      deleteUser: async () => null,
      linkAccount: async () => null,
      unlinkAccount: async () => null,
      createVerification: async () => null,
      useVerification: async () => null,
    } as any;
  }

  // Normal mode - use SQLite directly
  // Use the pre-imported module from the top of the file
  try {
    if (!sqliteDbModule) {
      logger.error(
        "[Auth] SQLite module was not loaded - likely in Electron mode",
      );
      throw new Error("SQLite module not available");
    }

    const getSqliteDb = sqliteDbModule.getSqliteDb;

    if (!getSqliteDb) {
      logger.error("[Auth] getSqliteDb function not found in sqlite module");
      throw new Error("getSqliteDb function not found");
    }

    // Use getSqliteDb() to get the actual drizzle instance
    const db = getSqliteDb();

    if (!db) {
      logger.error("[Auth] getSqliteDb() returned null/undefined");
      throw new Error("Database instance is null");
    }

    // Verify db has the expected structure
    if (typeof db.select !== "function") {
      logger.error(
        "[Auth] Database instance missing select method",
        Object.keys(db),
      );
      throw new Error("Database instance missing select method");
    }

    logger.info("[Auth] SQLite database adapter initialized successfully");

    // Pass the full schema to the drizzle adapter
    return drizzleAdapter(db, {
      provider: "sqlite",
      schema: {
        user: UserTable,
        session: SessionTable,
        account: AccountTable,
        verification: VerificationTable,
      },
    });
  } catch (error: any) {
    const errorMsg = error?.message || String(error) || "";
    logger.error("[Auth] Failed to initialize database adapter:", errorMsg);

    // If it's a module version mismatch, mark as Electron mode
    if (
      errorMsg.includes("NODE_MODULE_VERSION") ||
      errorMsg.includes("was compiled against a different Node.js version") ||
      errorMsg.includes("SQLite is not available")
    ) {
      logger.warn(
        "[Auth] SQLite unavailable, falling back to local user session mode",
      );
      _isElectronDevMode = true;
      // Return stub adapter for local-first mode
      return {
        provider: "sqlite" as const,
        db: {},
        findSession: async () => null,
        findUser: async () => null,
        createSession: async () => null,
        updateSession: async () => null,
        deleteSession: async () => null,
        createUser: async () => null,
        updateUser: async () => null,
        deleteUser: async () => null,
        linkAccount: async () => null,
        unlinkAccount: async () => null,
        createVerification: async () => null,
        useVerification: async () => null,
      } as any;
    }

    throw error;
  }
};

const getAuthSecret = () => {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret === "****") {
    console.error(
      "\x1b[31m[AUTH ERROR]\x1b[0m BETTER_AUTH_SECRET environment variable is not set or invalid.\n" +
        "Please set a secure secret in your .env file.\n" +
        "Generate one with: npx @better-auth/cli@latest secret",
    );
    throw new Error(
      "BETTER_AUTH_SECRET is not configured. Check server logs for setup instructions.",
    );
  }
  return secret;
};

const {
  emailAndPasswordEnabled,
  signUpEnabled,
  socialAuthenticationProviders,
} = getAuthConfig();

// Get the base URL for OAuth callbacks - this MUST match the production URL exactly
const getBaseURL = () => {
  const url = process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_BASE_URL;
  if (!url) {
    console.warn(
      "\x1b[33m[AUTH WARNING]\x1b[0m BETTER_AUTH_URL is not set. OAuth may fail with state_mismatch error.\n" +
        "Set BETTER_AUTH_URL to your production URL (e.g., https://yourdomain.com)",
    );
  }
  return url;
};

// Only create options if NOT in Electron mode to prevent better-auth initialization
const createAuthOptions = (): BetterAuthOptions | null => {
  if (isElectronDevMode()) {
    return null; // Don't create options in Electron mode
  }

  return {
    secret: getAuthSecret(),
    plugins: [
      adminPlugin({
        defaultRole: DEFAULT_USER_ROLE,
        adminRoles: [USER_ROLES.ADMIN],
        ac,
        roles: {
          admin,
          editor,
          user,
        },
      }),
      nextCookies(),
    ],
    baseURL: getBaseURL(),
    user: {
      changeEmail: {
        enabled: true,
      },
      deleteUser: {
        enabled: true,
      },
    },
    database: getDatabaseAdapter(),
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            // This hook ONLY runs during user creation (sign-up), not on sign-in
            // Use our optimized getIsFirstUser function with caching
            const isFirstUser = await getIsFirstUser();

            // Set role based on whether this is the first user
            const role = isFirstUser ? USER_ROLES.ADMIN : DEFAULT_USER_ROLE;

            logger.info(
              `User creation hook: ${user.email} will get role: ${role} (isFirstUser: ${isFirstUser})`,
            );

            return {
              data: {
                ...user,
                role,
              },
            };
          },
        },
      },
    },
    emailAndPassword: {
      enabled: emailAndPasswordEnabled,
      disableSignUp: !signUpEnabled,
    },
    session: {
      cookieCache: {
        enabled: true,
        maxAge: 60 * 60,
      },
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // 1 day (every 1 day the session expiration is updated)
    },
    advanced: {
      useSecureCookies:
        process.env.NO_HTTPS == "1"
          ? false
          : process.env.NODE_ENV === "production",
      // Enable cross-site cookies for OAuth flow - required for state parameter to work
      // when redirecting back from OAuth providers (Google, GitHub, Microsoft)
      crossSubDomainCookies: {
        enabled: Boolean(process.env.COOKIE_DOMAIN),
        domain: process.env.COOKIE_DOMAIN, // e.g., ".example.com" for subdomains
      },
      // Default cookie attributes for OAuth state cookies
      defaultCookieAttributes: {
        sameSite: "lax", // Required for OAuth redirects to work
        path: "/",
      },
      database: {
        generateId: false,
      },
    },
    account: {
      accountLinking: {
        trustedProviders: (
          Object.keys(
            socialAuthenticationProviders,
          ) as (keyof typeof socialAuthenticationProviders)[]
        ).filter((key) => socialAuthenticationProviders[key]),
      },
    },
    socialProviders: socialAuthenticationProviders,
  } satisfies BetterAuthOptions;
};

// Only initialize better-auth if NOT in Electron mode
// This prevents better-auth from trying to use the database adapter
let authInstance: ReturnType<typeof betterAuth> | null = null;

const getAuthInstance = () => {
  // Never initialize better-auth in Electron mode
  if (isElectronDevMode()) {
    return null;
  }
  if (!authInstance) {
    try {
      const authOptions = createAuthOptions();
      if (!authOptions) {
        logger.error("[Auth] Failed to create auth options");
        return null;
      }
      authInstance = betterAuth({
        ...authOptions,
        plugins: [...(authOptions.plugins ?? [])],
      });
    } catch (error) {
      logger.error("[Auth] Failed to initialize better-auth:", error);
      return null;
    }
  }
  return authInstance;
};

// Create a proxy that lazy-loads better-auth only when needed and not in Electron mode
export const auth = new Proxy({} as ReturnType<typeof betterAuth>, {
  get(_target, prop) {
    // In Electron mode, return mock methods
    if (isElectronDevMode()) {
      if (prop === "api") {
        return {
          getSession: async () => null,
          signIn: {
            email: async () => ({ error: null, data: null }),
          },
          signUpEmail: async () => ({ error: null, data: null }),
          listUserAccounts: async () => [],
          listSessions: async () => [],
          updateUser: async () => ({ error: null, data: null }),
          changeEmail: async () => ({ error: null, data: null }),
          removeUser: async () => ({ error: null, data: null }),
          changePassword: async () => ({ error: null, data: null }),
          setUserPassword: async () => ({ error: null, data: null }),
          revokeUserSessions: async () => ({ error: null, data: null }),
          setRole: async () => ({ error: null, data: null }),
          banUser: async () => ({ error: null, data: null }),
          unbanUser: async () => ({ error: null, data: null }),
        };
      }
      if (prop === "handler") {
        // Return a mock handler that returns 404
        return async () =>
          new Response(
            JSON.stringify({ error: "Not available in Electron mode" }),
            {
              status: 404,
              headers: { "Content-Type": "application/json" },
            },
          );
      }
      return undefined;
    }

    // Normal mode - get the real instance
    const instance = getAuthInstance();
    if (!instance) {
      logger.error("[Auth] Auth instance not available");
      return undefined;
    }
    return (instance as any)[prop];
  },
});

// Create local user session object (reusable)
const createLocalUserSession = () => ({
  user: {
    id: "local-user",
    email: "local@shadower.app",
    name: "Local User",
    image: null,
    emailVerified: true,
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  session: {
    id: "local-session",
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
    token: "local-token",
    userId: "local-user",
  },
});

export const getSession = async () => {
  // ALWAYS check Electron mode first and return early - never call better-auth in Electron mode
  // Force a fresh check to ensure we detect Electron mode correctly
  const isElectron = isElectronDevMode(true); // Force recheck
  if (isElectron) {
    logger.info(
      "[Auth] Electron dev mode detected - returning local user session",
    );
    return createLocalUserSession() as any;
  }

  // Normal mode - use better-auth with SQLite
  // Only reach here if NOT in Electron mode
  try {
    // Double-check Electron mode before calling better-auth (force recheck)
    if (isElectronDevMode(true)) {
      logger.info(
        "[Auth] Electron mode detected in try block - returning local user session",
      );
      return createLocalUserSession() as any;
    }

    const authInst = getAuthInstance();
    if (!authInst) {
      logger.warn(
        "[Auth] Auth instance not available, returning local user session as fallback",
      );
      // Fallback to local user session if auth instance not available
      return createLocalUserSession() as any;
    }

    const session = await authInst.api.getSession({
      headers: await headers(),
    });
    if (!session) {
      logger.error("No session found");
      return null;
    }
    return session;
  } catch (error: any) {
    // If error mentions SQLite or database, we're likely in Electron mode
    const errorMsg = error?.message || String(error) || "";
    if (
      errorMsg.includes("SQLite") ||
      errorMsg.includes("database") ||
      errorMsg.includes("select") ||
      errorMsg.includes("NODE_MODULE_VERSION") ||
      errorMsg.includes("Cannot read properties of undefined")
    ) {
      logger.warn(
        "[Auth] Database error detected, returning local user session:",
        errorMsg.substring(0, 200),
      );
      // Reset cache and force recheck
      _isElectronDevMode = null;
      return createLocalUserSession() as any;
    }
    logger.error("Error getting session:", error);
    return null;
  }
};

// Cache the first user check to avoid repeated DB queries
let isFirstUserCache: boolean | null = null;

export const getIsFirstUser = async () => {
  // If we already know there's at least one user, return false immediately
  // This in-memory cache prevents any DB calls once we know users exist
  if (isFirstUserCache === false) {
    return false;
  }

  try {
    // In Electron dev mode, database is handled by IPC
    if (isElectronDevMode()) {
      // In Electron, we always have a local user, so it's not the first user
      isFirstUserCache = false;
      return false;
    }

    // Direct SQLite database query - simple and reliable
    // Use relative path for proper module resolution
    const sqliteModule = require("../db/sqlite/db.sqlite");
    const db = sqliteModule.getSqliteDb
      ? sqliteModule.getSqliteDb()
      : sqliteModule.sqliteDb;

    if (!db) {
      logger.warn("[Auth] Database not available for first user check");
      isFirstUserCache = false;
      return false;
    }

    const [result] = await db.select({ count: count() }).from(UserTable);
    const userCount = result?.count ?? 0;
    const isFirstUser = userCount === 0;

    // Once we have at least one user, cache it permanently in memory
    if (!isFirstUser) {
      isFirstUserCache = false;
    }

    return isFirstUser;
  } catch (error: any) {
    const errorMsg = error?.message || String(error) || "";
    logger.error("Error checking if first user:", errorMsg);
    // Cache as false on error to prevent repeated attempts
    isFirstUserCache = false;
    return false;
  }
};
