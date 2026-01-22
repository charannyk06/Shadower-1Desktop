import { ipcMain } from "electron";
import {
  ElectronAuthService,
  RegisterData,
  SignInData,
} from "../services/auth";

/**
 * SECURITY: Simple in-memory rate limiter for authentication
 * Prevents brute-force attacks on login/registration
 */
class RateLimiter {
  private attempts: Map<string, { count: number; resetAt: number }> = new Map();
  private maxAttempts: number;
  private windowMs: number;
  private blockDurationMs: number;

  constructor(
    maxAttempts: number = 5,
    windowMs: number = 15 * 60 * 1000, // 15 minutes
    blockDurationMs: number = 30 * 60 * 1000, // 30 minutes
  ) {
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;
    this.blockDurationMs = blockDurationMs;

    // Clean up old entries every 5 minutes
    setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  /**
   * Check if the key is rate limited
   * Returns true if blocked, false if allowed
   */
  isBlocked(key: string): boolean {
    const entry = this.attempts.get(key);
    if (!entry) return false;

    const now = Date.now();
    if (now > entry.resetAt) {
      this.attempts.delete(key);
      return false;
    }

    return entry.count >= this.maxAttempts;
  }

  /**
   * Record an attempt for the key
   * Returns true if now blocked, false if still allowed
   */
  recordAttempt(key: string): boolean {
    const now = Date.now();
    const entry = this.attempts.get(key);

    if (!entry || now > entry.resetAt) {
      this.attempts.set(key, {
        count: 1,
        resetAt: now + this.windowMs,
      });
      return false;
    }

    entry.count++;

    // If exceeded, extend the block duration
    if (entry.count >= this.maxAttempts) {
      entry.resetAt = now + this.blockDurationMs;
      console.warn(
        `[Auth] Rate limit exceeded for ${key}, blocked until ${new Date(entry.resetAt).toISOString()}`,
      );
      return true;
    }

    return false;
  }

  /**
   * Clear rate limit on successful auth
   */
  clear(key: string): void {
    this.attempts.delete(key);
  }

  /**
   * Clean up expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.attempts.entries()) {
      if (now > entry.resetAt) {
        this.attempts.delete(key);
      }
    }
  }
}

// SECURITY: Rate limiters for auth endpoints
const signInLimiter = new RateLimiter(5, 15 * 60 * 1000, 30 * 60 * 1000);
const registerLimiter = new RateLimiter(3, 60 * 60 * 1000, 60 * 60 * 1000);

/**
 * Register IPC handlers for authentication operations
 * Full authentication support with registration, sign-in, sign-out, and session management
 * SECURITY: Includes rate limiting to prevent brute-force attacks
 */
export function registerAuthHandlers() {
  console.log("[IPC] Registering auth handlers...");

  let authService: ElectronAuthService;
  try {
    authService = ElectronAuthService.getInstance();
  } catch (error) {
    console.error("[IPC] Failed to get auth service instance:", error);
    throw error;
  }

  // Check if this is first launch (no users with passwords)
  ipcMain.handle("auth:isFirstLaunch", async () => {
    try {
      return await authService.isFirstLaunch();
    } catch (error) {
      console.error("[IPC] Error checking first launch:", error);
      return true; // Assume first launch on error
    }
  });

  // Register new user
  // SECURITY: Rate limited to prevent abuse
  ipcMain.handle("auth:register", async (_event, data: RegisterData) => {
    try {
      // SECURITY: Check rate limit by email
      const rateLimitKey = data.email?.toLowerCase() || "unknown";
      if (registerLimiter.isBlocked(rateLimitKey)) {
        return {
          success: false,
          error:
            "Too many registration attempts. Please try again later.",
        };
      }

      const result = await authService.register(data);

      if (!result.success) {
        registerLimiter.recordAttempt(rateLimitKey);
      } else {
        registerLimiter.clear(rateLimitKey);
      }

      return result;
    } catch (error) {
      console.error("[IPC] Error registering user:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Registration failed",
      };
    }
  });

  // Sign in with credentials
  // SECURITY: Rate limited to prevent brute-force attacks
  ipcMain.handle("auth:signIn", async (_event, data: SignInData) => {
    try {
      // SECURITY: Check rate limit by email
      const rateLimitKey = data.email?.toLowerCase() || "unknown";
      if (signInLimiter.isBlocked(rateLimitKey)) {
        return {
          success: false,
          error:
            "Too many login attempts. Please try again later.",
        };
      }

      const result = await authService.signIn(data);

      if (!result.success) {
        // Record failed attempt
        signInLimiter.recordAttempt(rateLimitKey);
      } else {
        // Clear rate limit on successful login
        signInLimiter.clear(rateLimitKey);
      }

      return result;
    } catch (error) {
      console.error("[IPC] Error signing in:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Sign in failed",
      };
    }
  });

  // Sign out
  ipcMain.handle("auth:signOut", async () => {
    try {
      return await authService.signOut();
    } catch (error) {
      console.error("[IPC] Error signing out:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Sign out failed",
      };
    }
  });

  // Validate current session
  ipcMain.handle("auth:validateSession", async () => {
    try {
      return await authService.validateSession();
    } catch (error) {
      console.error("[IPC] Error validating session:", error);
      return null;
    }
  });

  // Get current session (backwards compatible)
  ipcMain.handle("auth:getSession", async () => {
    try {
      return await authService.getSession();
    } catch (error) {
      console.error("[IPC] Error getting session:", error);
      return null;
    }
  });

  // Get current user
  ipcMain.handle("auth:getCurrentUser", async () => {
    try {
      return await authService.getCurrentUser();
    } catch (error) {
      console.error("[IPC] Error getting current user:", error);
      return null;
    }
  });

  // Check if authenticated
  ipcMain.handle("auth:isAuthenticated", async () => {
    try {
      return await authService.isAuthenticated();
    } catch (error) {
      console.error("[IPC] Error checking authentication:", error);
      return false;
    }
  });

  // Update user profile
  ipcMain.handle(
    "auth:updateProfile",
    async (_event, data: { name?: string; image?: string | null }) => {
      try {
        return await authService.updateProfile(data);
      } catch (error) {
        console.error("[IPC] Error updating profile:", error);
        return null;
      }
    },
  );

  // Get user preferences (includes API keys)
  ipcMain.handle("auth:getPreferences", async () => {
    try {
      return await authService.getPreferences();
    } catch (error) {
      console.error("[IPC] Error getting preferences:", error);
      return {};
    }
  });

  // Update user preferences
  ipcMain.handle("auth:updatePreferences", async (_event, preferences: any) => {
    try {
      await authService.updatePreferences(preferences);
      return { success: true };
    } catch (error) {
      console.error("[IPC] Error updating preferences:", error);
      return { success: false, error: "Failed to update preferences" };
    }
  });

  console.log("[IPC] Auth handlers registered");
}
