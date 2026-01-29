"use client";

import { useEffect, useState, useCallback } from "react";
import { navigateTo } from "@/router";

/**
 * Electron Auth Client
 *
 * Full authentication client for Electron desktop app.
 * Uses Electron IPC for all auth operations.
 */

export interface AuthSession {
  user: {
    id: string;
    email: string;
    name: string;
    image: string | null;
    emailVerified: boolean;
  };
  session: {
    id: string;
    expiresAt: Date;
    token: string;
  };
}

export interface AuthResult {
  success: boolean;
  error?: string;
  session?: AuthSession;
}

// Helper to check if running in Electron
const isElectron = () => typeof window !== "undefined" && !!window.electronAPI;

// Session state management
let cachedSession: AuthSession | null = null;
let sessionListeners: ((session: AuthSession | null) => void)[] = [];

const notifySessionListeners = (session: AuthSession | null) => {
  cachedSession = session;
  for (const listener of sessionListeners) {
    listener(session);
  }
};

export const authClient = {
  /**
   * Check if this is the first launch (no users with passwords)
   */
  isFirstLaunch: async (): Promise<boolean> => {
    if (!isElectron()) return true;
    try {
      return await window.electronAPI.auth.isFirstLaunch();
    } catch (error) {
      console.error("[AuthClient] Error checking first launch:", error);
      return true;
    }
  },

  /**
   * Register a new user
   */
  register: async (params: {
    email: string;
    password: string;
    name: string;
  }): Promise<AuthResult> => {
    if (!isElectron()) {
      return { success: false, error: "Not running in Electron" };
    }

    try {
      const result = await window.electronAPI.auth.register(params);

      if (result.success && result.session) {
        notifySessionListeners({
          user: {
            ...result.session.user,
            emailVerified: true,
          },
          session: {
            id: `session-${result.session.user.id}`,
            expiresAt: new Date(result.session.expiresAt),
            token: result.session.token,
          },
        });
      }

      return result;
    } catch (error) {
      console.error("[AuthClient] Registration error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Registration failed",
      };
    }
  },

  signIn: {
    /**
     * Sign in with email and password
     */
    email: async (
      params: { email: string; password: string; callbackURL?: string },
      options?: {
        onSuccess?: () => void;
        onError?: (ctx: {
          error: { message?: string; statusText?: string };
        }) => void;
      },
    ): Promise<AuthResult> => {
      if (!isElectron()) {
        const error = {
          message: "Not running in Electron",
          statusText: "Not Electron",
        };
        options?.onError?.({ error });
        return { success: false, error: error.message };
      }

      try {
        const result = await window.electronAPI.auth.signIn(params);

        if (result.success && result.session) {
          const authSession = {
            user: {
              ...result.session.user,
              emailVerified: true,
            },
            session: {
              id: `session-${result.session.user.id}`,
              expiresAt: new Date(result.session.expiresAt),
              token: result.session.token,
            },
          };
          notifySessionListeners(authSession);

          options?.onSuccess?.();

          // Handle callback URL - redirect to the specified path
          // Use navigateTo for Electron hash-based routing compatibility
          if (params.callbackURL && typeof window !== "undefined") {
            navigateTo(params.callbackURL);
          }
        } else if (result.error) {
          options?.onError?.({
            error: { message: result.error, statusText: result.error },
          });
        }

        return result;
      } catch (error) {
        console.error("[AuthClient] Sign in error:", error);
        const errorMsg =
          error instanceof Error ? error.message : "Sign in failed";
        options?.onError?.({
          error: { message: errorMsg, statusText: errorMsg },
        });
        return {
          success: false,
          error: errorMsg,
        };
      }
    },

    /**
     * OAuth sign in (not supported in Electron desktop app)
     */
    social: async (_params: {
      provider: string;
      callbackURL?: string;
      errorCallbackURL?: string;
    }): Promise<AuthResult> => {
      console.warn("[AuthClient] OAuth not available in Electron-only mode");
      return {
        success: false,
        error: "OAuth not available in Electron desktop app",
      };
    },
  },

  signUp: {
    /**
     * Sign up with email and password
     */
    email: async (params: {
      email: string;
      password: string;
      name: string;
    }): Promise<AuthResult> => {
      return authClient.register(params);
    },
  },

  /**
   * Sign out the current user
   */
  signOut: async (): Promise<{ success: boolean; error?: string }> => {
    if (!isElectron()) {
      return { success: false, error: "Not running in Electron" };
    }

    try {
      const result = await window.electronAPI.auth.signOut();
      notifySessionListeners(null);
      return result;
    } catch (error) {
      console.error("[AuthClient] Sign out error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Sign out failed",
      };
    }
  },

  /**
   * Validate the current session
   */
  validateSession: async (): Promise<AuthSession | null> => {
    if (!isElectron()) {
      return null;
    }

    try {
      const session = await window.electronAPI.auth.validateSession();

      if (session) {
        const authSession: AuthSession = {
          user: {
            ...session.user,
            emailVerified: true,
          },
          session: {
            id: `session-${session.user.id}`,
            expiresAt: new Date(session.expiresAt),
            token: session.token,
          },
        };
        cachedSession = authSession;
        return authSession;
      }

      cachedSession = null;
      return null;
    } catch (error) {
      console.error("[AuthClient] Session validation error:", error);
      cachedSession = null;
      return null;
    }
  },

  /**
   * Get current session (for compatibility)
   */
  getSession: async (): Promise<AuthSession | null> => {
    return authClient.validateSession();
  },

  /**
   * Check if user is authenticated
   */
  isAuthenticated: async (): Promise<boolean> => {
    const session = await authClient.validateSession();
    return session !== null;
  },

  /**
   * React hook for session state
   */
  useSession: () => {
    const [session, setSession] = useState<AuthSession | null>(cachedSession);
    const [isPending, setIsPending] = useState(!cachedSession);
    const [error, setError] = useState<Error | null>(null);

    const refreshSession = useCallback(async () => {
      setIsPending(true);
      try {
        const result = await authClient.validateSession();
        setSession(result);
        setError(null);
      } catch (err) {
        setError(
          err instanceof Error ? err : new Error("Failed to get session"),
        );
        setSession(null);
      } finally {
        setIsPending(false);
      }
    }, []);

    useEffect(() => {
      // Add listener for session changes
      const listener = (newSession: AuthSession | null) => {
        setSession(newSession);
      };
      sessionListeners.push(listener);

      // Initial session fetch
      if (!cachedSession) {
        refreshSession();
      }

      return () => {
        sessionListeners = sessionListeners.filter((l) => l !== listener);
      };
    }, [refreshSession]);

    return {
      data: session,
      isPending,
      error,
      refresh: refreshSession,
    };
  },
};
