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
 * In Electron, this returns null because session validation
 * happens via IPC in the renderer process (client-side).
 * Server components should not rely on this for auth checks.
 */
export async function getSession(): Promise<SessionResult | null> {
  // In Electron, auth is handled client-side via IPC
  // Server-side rendering should not depend on auth state
  logger.debug("[Auth] getSession called - deferring to client-side IPC auth");
  return null;
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
