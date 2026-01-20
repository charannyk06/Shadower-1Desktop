/**
 * Session Store Service
 *
 * Uses electron-store to persist session token across app restarts.
 * This provides secure, encrypted storage for auth credentials.
 *
 * Note: electron-store v11+ is ESM-only, so we use dynamic import.
 *
 * DEV MODE INTEROP:
 * In dev mode, Next.js runs in a separate process with a different Node version
 * and cannot access SQLite or the encrypted electron-store. To enable auth
 * interop, we write an unencrypted sync file that Next.js can read.
 */

import { app } from "electron";
import * as fs from "fs";
import * as path from "path";

// Path for the sync file (readable by Next.js in dev mode)
const getSyncFilePath = (): string => {
  try {
    return path.join(app.getPath("userData"), "session-sync.json");
  } catch {
    // app not ready yet, use a fallback path
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
    return path.join(userDataDir, "session-sync.json");
  }
};

// Write sync file for dev mode interop with Next.js server
const writeSyncFile = (data: {
  userId: string | null;
  token: string | null;
  expiresAt: number | null;
}) => {
  try {
    const syncPath = getSyncFilePath();
    fs.writeFileSync(syncPath, JSON.stringify(data, null, 2), "utf-8");
    console.log(`[SessionStore] Sync file written: ${syncPath}`);
  } catch (error) {
    console.error("[SessionStore] Failed to write sync file:", error);
  }
};

// Clear sync file
const clearSyncFile = () => {
  try {
    const syncPath = getSyncFilePath();
    if (fs.existsSync(syncPath)) {
      fs.unlinkSync(syncPath);
      console.log(`[SessionStore] Sync file cleared: ${syncPath}`);
    }
  } catch (error) {
    console.error("[SessionStore] Failed to clear sync file:", error);
  }
};

interface SessionStoreSchema {
  sessionToken: string | null;
  userId: string | null;
  expiresAt: number | null; // Unix timestamp
}

const SESSION_EXPIRY_DAYS = 7;

// Store instance - loaded dynamically
let storeInstance: any = null;
let storeInitPromise: Promise<void> | null = null;

/**
 * Initialize the electron-store dynamically (ESM module)
 */
async function initializeStore(): Promise<void> {
  if (storeInstance) return;

  if (storeInitPromise) {
    await storeInitPromise;
    return;
  }

  storeInitPromise = (async () => {
    try {
      // Dynamic import for ESM-only electron-store
      const Store = (await import("electron-store")).default;
      storeInstance = new Store<SessionStoreSchema>({
        name: "session",
        encryptionKey: "shadower-session-encryption-key",
        defaults: {
          sessionToken: null,
          userId: null,
          expiresAt: null,
        },
      });
      console.log("[SessionStore] Initialized successfully");
    } catch (error) {
      console.error(
        "[SessionStore] Failed to initialize electron-store:",
        error,
      );
      // Fallback to in-memory storage
      storeInstance = createInMemoryStore();
      console.log("[SessionStore] Using in-memory fallback");
    }
  })();

  await storeInitPromise;
}

/**
 * Create an in-memory fallback store
 */
function createInMemoryStore(): any {
  const data: SessionStoreSchema = {
    sessionToken: null,
    userId: null,
    expiresAt: null,
  };

  return {
    get(key: keyof SessionStoreSchema) {
      return data[key];
    },
    set(key: keyof SessionStoreSchema, value: any) {
      data[key] = value;
    },
  };
}

/**
 * Get the store instance, initializing if needed
 */
async function getStore(): Promise<any> {
  await initializeStore();
  return storeInstance;
}

class SessionStore {
  private static instance: SessionStore;

  private constructor() {}

  static getInstance(): SessionStore {
    if (!SessionStore.instance) {
      SessionStore.instance = new SessionStore();
    }
    return SessionStore.instance;
  }

  /**
   * Initialize the store (call this early in app startup)
   */
  async initialize(): Promise<void> {
    await initializeStore();
  }

  /**
   * Get the current session token
   */
  async getToken(): Promise<string | null> {
    const store = await getStore();
    const token = store.get("sessionToken");
    const expiresAt = store.get("expiresAt");

    // Check if token has expired
    if (token && expiresAt && Date.now() > expiresAt) {
      console.log("[SessionStore] Token expired, clearing session");
      await this.clearToken();
      return null;
    }

    return token;
  }

  /**
   * Get the current session token (sync version for backwards compatibility)
   * Note: This will return null if store not yet initialized
   */
  getTokenSync(): string | null {
    if (!storeInstance) return null;

    const token = storeInstance.get("sessionToken");
    const expiresAt = storeInstance.get("expiresAt");

    if (token && expiresAt && Date.now() > expiresAt) {
      console.log("[SessionStore] Token expired, clearing session");
      this.clearTokenSync();
      return null;
    }

    return token;
  }

  /**
   * Get the user ID associated with the current session
   */
  async getUserId(): Promise<string | null> {
    const token = await this.getToken(); // This checks expiry
    if (!token) return null;
    const store = await getStore();
    return store.get("userId");
  }

  /**
   * Get user ID (sync version)
   */
  getUserIdSync(): string | null {
    const token = this.getTokenSync();
    if (!token || !storeInstance) return null;
    return storeInstance.get("userId");
  }

  /**
   * Store a new session token
   */
  async setToken(token: string, userId: string): Promise<void> {
    const store = await getStore();
    const expiresAt = Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
    store.set("sessionToken", token);
    store.set("userId", userId);
    store.set("expiresAt", expiresAt);

    // Write sync file for dev mode interop with Next.js
    writeSyncFile({ userId, token, expiresAt });

    console.log(
      `[SessionStore] Session token set for user ${userId}, expires: ${new Date(expiresAt).toISOString()}`,
    );
  }

  /**
   * Store token (sync version - only works if store already initialized)
   */
  setTokenSync(token: string, userId: string): void {
    if (!storeInstance) {
      console.warn(
        "[SessionStore] Store not initialized, cannot set token sync",
      );
      return;
    }
    const expiresAt = Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
    storeInstance.set("sessionToken", token);
    storeInstance.set("userId", userId);
    storeInstance.set("expiresAt", expiresAt);

    // Write sync file for dev mode interop with Next.js
    writeSyncFile({ userId, token, expiresAt });

    console.log(
      `[SessionStore] Session token set for user ${userId}, expires: ${new Date(expiresAt).toISOString()}`,
    );
  }

  /**
   * Clear the current session
   */
  async clearToken(): Promise<void> {
    const store = await getStore();
    store.set("sessionToken", null);
    store.set("userId", null);
    store.set("expiresAt", null);

    // Clear sync file
    clearSyncFile();

    console.log("[SessionStore] Session cleared");
  }

  /**
   * Clear token (sync version)
   */
  clearTokenSync(): void {
    if (!storeInstance) return;
    storeInstance.set("sessionToken", null);
    storeInstance.set("userId", null);
    storeInstance.set("expiresAt", null);

    // Clear sync file
    clearSyncFile();

    console.log("[SessionStore] Session cleared");
  }

  /**
   * Check if a session exists and is valid
   */
  async hasValidSession(): Promise<boolean> {
    return (await this.getToken()) !== null;
  }

  /**
   * Get the expiry date of the current session
   */
  async getExpiryDate(): Promise<Date | null> {
    const store = await getStore();
    const expiresAt = store.get("expiresAt");
    if (!expiresAt) return null;
    return new Date(expiresAt);
  }

  /**
   * Refresh the session expiry (called on valid activity)
   */
  async refreshExpiry(): Promise<void> {
    const store = await getStore();
    const token = store.get("sessionToken");
    const userId = store.get("userId");

    if (token && userId) {
      const newExpiresAt =
        Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
      store.set("expiresAt", newExpiresAt);
      console.log(
        `[SessionStore] Session expiry refreshed to ${new Date(newExpiresAt).toISOString()}`,
      );
    }
  }

  /**
   * Refresh expiry (sync version)
   */
  refreshExpirySync(): void {
    if (!storeInstance) return;
    const token = storeInstance.get("sessionToken");
    const userId = storeInstance.get("userId");

    if (token && userId) {
      const newExpiresAt =
        Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
      storeInstance.set("expiresAt", newExpiresAt);
      console.log(
        `[SessionStore] Session expiry refreshed to ${new Date(newExpiresAt).toISOString()}`,
      );
    }
  }
}

export const sessionStore = SessionStore.getInstance();
export { SessionStore };
