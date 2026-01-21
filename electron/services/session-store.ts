/**
 * Session Store Service
 *
 * Uses electron-store to persist session token across app restarts.
 * This provides secure, encrypted storage for auth credentials.
 *
 * Note: electron-store v11+ is ESM-only, so we use dynamic import.
 *
 * SECURITY:
 * - Encryption key is generated per-installation and stored in OS keychain
 * - Sync file only written in development mode with token redacted
 */

import { app, safeStorage } from "electron";
import * as fs from "fs";
import * as path from "path";
import { randomBytes } from "crypto";

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
// SECURITY: Only writes in development mode with token REDACTED
const writeSyncFile = (data: {
  userId: string | null;
  token: string | null;
  expiresAt: number | null;
}) => {
  // Only write sync file in development mode
  if (process.env.NODE_ENV !== "development") {
    return;
  }

  try {
    const syncPath = getSyncFilePath();

    // SECURITY: Never write actual token to disk - only write metadata
    const safeData = {
      userId: data.userId,
      token: data.token ? "[REDACTED]" : null, // Don't write actual token
      expiresAt: data.expiresAt,
      hasSession: !!data.token,
    };

    fs.writeFileSync(syncPath, JSON.stringify(safeData, null, 2), "utf-8");

    // Set restrictive file permissions (owner read/write only)
    try {
      fs.chmodSync(syncPath, 0o600);
    } catch {
      // chmod may fail on Windows, that's okay
    }

    console.log(`[SessionStore] Sync file written (dev mode): ${syncPath}`);
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
const ENCRYPTION_KEY_FILE = "session-encryption-key";

// Store instance - loaded dynamically
let storeInstance: any = null;
let storeInitPromise: Promise<void> | null = null;
let encryptionKey: string | null = null;

/**
 * Get or create a unique encryption key for this installation
 * SECURITY: Key is stored encrypted using OS-level safeStorage
 */
async function getOrCreateEncryptionKey(): Promise<string> {
  if (encryptionKey) {
    return encryptionKey;
  }

  const keyFilePath = path.join(app.getPath("userData"), ENCRYPTION_KEY_FILE);

  try {
    // Try to read existing encrypted key
    if (fs.existsSync(keyFilePath)) {
      const encryptedKeyBuffer = fs.readFileSync(keyFilePath);

      if (safeStorage.isEncryptionAvailable()) {
        encryptionKey = safeStorage.decryptString(encryptedKeyBuffer);
        console.log("[SessionStore] Loaded existing encryption key");
        return encryptionKey;
      } else {
        // safeStorage unavailable - use raw key (less secure but maintains functionality)
        encryptionKey = encryptedKeyBuffer.toString("utf-8");
        console.warn(
          "[SessionStore] safeStorage unavailable, using unencrypted key file",
        );
        return encryptionKey;
      }
    }
  } catch (error) {
    console.warn("[SessionStore] Could not read existing key:", error);
  }

  // Generate new key
  encryptionKey = randomBytes(32).toString("hex");
  console.log("[SessionStore] Generated new encryption key");

  try {
    // Store encrypted key
    if (safeStorage.isEncryptionAvailable()) {
      const encryptedKey = safeStorage.encryptString(encryptionKey);
      fs.writeFileSync(keyFilePath, encryptedKey);
      // Set restrictive permissions
      try {
        fs.chmodSync(keyFilePath, 0o600);
      } catch {
        // chmod may fail on Windows
      }
    } else {
      // Fallback: store raw key (less secure)
      console.warn(
        "[SessionStore] safeStorage unavailable, storing key unencrypted",
      );
      fs.writeFileSync(keyFilePath, encryptionKey, "utf-8");
      try {
        fs.chmodSync(keyFilePath, 0o600);
      } catch {
        // chmod may fail on Windows
      }
    }
  } catch (error) {
    console.error("[SessionStore] Could not persist encryption key:", error);
  }

  return encryptionKey;
}

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
      // Get unique encryption key for this installation
      const key = await getOrCreateEncryptionKey();
      console.log(
        `[SessionStore] Using encryption key (first 8 chars): ${key.substring(0, 8)}...`,
      );

      // Dynamic import for ESM-only electron-store
      const Store = (await import("electron-store")).default;

      // Try to initialize the store
      try {
        storeInstance = new Store<SessionStoreSchema>({
          name: "session",
          encryptionKey: key,
          defaults: {
            sessionToken: null,
            userId: null,
            expiresAt: null,
          },
        });

        // Log the store path to verify it's persistent
        console.log(`[SessionStore] Store path: ${storeInstance.path}`);
        console.log(
          `[SessionStore] Store size: ${storeInstance.size} entries`,
        );

        // Read existing values to see what's persisted
        const existingToken = storeInstance.get("sessionToken");
        const existingUserId = storeInstance.get("userId");
        console.log(
          `[SessionStore] Existing data on init - token: ${existingToken ? "present" : "null"}, userId: ${existingUserId || "null"}`,
        );

        console.log("[SessionStore] Initialized successfully (persistent)");
      } catch (storeError: any) {
        // If decryption failed, the store file is corrupted or encrypted with a different key
        // Delete it and create a fresh one
        console.error(
          "[SessionStore] Store decryption failed, attempting recovery:",
          storeError.message,
        );

        const storePath = path.join(app.getPath("userData"), "session.json");
        if (fs.existsSync(storePath)) {
          console.log(
            `[SessionStore] Deleting corrupted store file: ${storePath}`,
          );
          fs.unlinkSync(storePath);
        }

        // Try again with fresh store
        storeInstance = new Store<SessionStoreSchema>({
          name: "session",
          encryptionKey: key,
          defaults: {
            sessionToken: null,
            userId: null,
            expiresAt: null,
          },
        });

        console.log(
          "[SessionStore] Created fresh store after recovery, path:",
          storeInstance.path,
        );
      }
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
    path: null, // Mark as in-memory
    _isInMemory: true,
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

    // Log store info for debugging
    const isInMemory = !store.path;
    console.log(
      `[SessionStore] Getting token, store type: ${isInMemory ? "in-memory" : "persistent"}, path: ${store.path || "N/A"}`,
    );

    const token = store.get("sessionToken");
    const expiresAt = store.get("expiresAt");
    const userId = store.get("userId");

    console.log(
      `[SessionStore] Read values - token: ${token ? token.substring(0, 10) + "..." : "null"}, userId: ${userId || "null"}, expiresAt: ${expiresAt ? new Date(expiresAt).toISOString() : "null"}`,
    );

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

    // Log store type for debugging
    const isInMemory = !store.path;
    console.log(
      `[SessionStore] Setting token, store type: ${isInMemory ? "in-memory" : "persistent"}, path: ${store.path || "N/A"}`,
    );

    store.set("sessionToken", token);
    store.set("userId", userId);
    store.set("expiresAt", expiresAt);

    // Verify the write was successful by reading back
    const storedToken = store.get("sessionToken");
    const storedUserId = store.get("userId");
    console.log(
      `[SessionStore] Verification - token stored: ${!!storedToken}, userId stored: ${storedUserId === userId}`,
    );

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
