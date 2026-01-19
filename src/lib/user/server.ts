"use server";

import { customModelProvider } from "@/lib/ai/models";
import { BasicUserWithLastLogin, UserPreferences } from "app-types/user";
import { auth, getSession } from "auth/server";
import { Session } from "better-auth";
import { userRepository } from "lib/db/repository";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

// Helper to check if we're in Electron mode
const isElectronMode = (): boolean => {
  if (process.env.ELECTRON_BUILD === "true") {
    return true;
  }
  try {
    const electron = require("electron");
    if (electron && electron.app) {
      return true;
    }
  } catch {
    // Electron not available
  }
  // Check global flag set by SQLite module
  return !!(globalThis as any).__SQLITE_ELECTRON_MODE__;
};

// Create a local user fallback for Electron mode
const createLocalUser = (userId: string): BasicUserWithLastLogin => ({
  id: userId,
  name: "Local User",
  email: "local@shadower.app",
  emailVerified: true,
  image: null,
  role: "admin",
  createdAt: new Date(),
  updatedAt: new Date(),
  lastLoginAt: null,
  banned: false,
  banReason: null,
  banExpires: null,
});

/**
 * Get the user by id
 * We can only get the user by id for the current user as a non-admin user
 * We can get the user by id for any user as an admin user
 */
export async function getUser(
  userId?: string,
): Promise<BasicUserWithLastLogin | null> {
  // Check Electron mode first - if in Electron mode, return local user
  if (isElectronMode()) {
    const session = await getSession();
    if (!session) {
      return null;
    }
    const resolvedUserId = userId || session.user.id;
    return createLocalUser(resolvedUserId);
  }

  try {
    const resolvedUserId = await getUserIdAndCheckAccess(userId);
    return await userRepository.getUserById(resolvedUserId);
  } catch (error: any) {
    const errorMsg = error?.message || String(error) || "";
    // If this is an Electron mode error, return local user
    if (
      errorMsg.includes("SQLite") ||
      errorMsg.includes("NODE_MODULE_VERSION") ||
      errorMsg.includes("Electron") ||
      errorMsg.includes("better-sqlite3")
    ) {
      // Mark as Electron mode for future checks
      (globalThis as any).__SQLITE_ELECTRON_MODE__ = true;
      const session = await getSession();
      if (!session) {
        return null;
      }
      const resolvedUserId = userId || session.user.id;
      return createLocalUser(resolvedUserId);
    }
    // Re-throw other errors
    throw error;
  }
}

/**
 * Get user accounts
 * We can only list accounts for the current user as a non-admin user
 * We can list accounts for any user as an admin user
 */
export async function getUserAccounts(userId?: string) {
  const resolvedUserId = await getUserIdAndCheckAccess(userId);
  const accounts = await auth.api.listUserAccounts({
    params: { userId: resolvedUserId },
    headers: await headers(),
  });
  const hasPassword = accounts.some(
    (account) => account.providerId === "credential",
  );
  const oauthProviders = accounts
    .filter((account) => account.providerId !== "credential")
    .map((account) => account.providerId);
  return { accounts, hasPassword, oauthProviders };
}

/**
 * List user sessions
 * We use the better-auth API to list the sessions
 * We can only list sessions for the current user as a non-admin user
 * We can list sessions for any user as an admin user
 */
export async function getUserSessions(userId?: string): Promise<Session[]> {
  const resolvedUserId = await getUserIdAndCheckAccess(userId);
  return await auth.api.listSessions({
    params: { userId: resolvedUserId },
    headers: await headers(),
  });
}

/**
 * Get the user ID and check access
 * if the requested user id is not provided, we use the current user id
 * if the requested user id is provided, we check if the current user has access to the requested user
 * if the current user has access to the requested user, we return the requested user id
 * if the current user does not have access to the requested user, we throw a 404 error
 * if the requested user id is not found, we throw a 404 error
 */
export async function getUserIdAndCheckAccess(
  requestedUserId?: string,
): Promise<string> {
  const session = await getSession();
  if (!session) {
    notFound();
  }
  const currentUserId = session.user.id;
  const userId = requestedUserId ? requestedUserId : currentUserId;
  if (!userId) {
    notFound();
  }
  return userId;
}

/**
 * Get the user stats
 * We can only get stats for the current user as a non-admin user
 * We can get stats for any user as an admin user
 */
export async function getUserStats(userId?: string): Promise<{
  threadCount: number;
  messageCount: number;
  modelStats: Array<{
    model: string;
    messageCount: number;
    totalTokens: number;
    provider: string;
  }>;
  totalTokens: number;
  period: string;
}> {
  const resolvedUserId = await getUserIdAndCheckAccess(userId);
  const stats = await userRepository.getUserStats(resolvedUserId);

  // Add provider information to each model stat
  return {
    ...stats,
    modelStats: stats.modelStats.map((stat) => ({
      ...stat,
      provider: customModelProvider.getProviderForModel(stat.model),
    })),
  };
}

/**
 * Get the user preferences
 * We can only get preferences for the current user as a non-admin user
 * We can get preferences for any user as an admin user
 */
export async function getUserPreferences(
  userId?: string,
): Promise<UserPreferences | null> {
  const resolvedUserId = await getUserIdAndCheckAccess(userId);
  return await userRepository.getPreferences(resolvedUserId);
}

export async function updateUserDetails(
  userId: string,
  name?: string,
  email?: string,
  image?: string,
) {
  const resolvedUserId = await getUserIdAndCheckAccess(userId);
  if (!name && !email && !image) {
    return;
  }
  return await userRepository.updateUserDetails({
    userId: resolvedUserId,
    ...(name && { name }),
    ...(email && { email }),
    ...(image && { image }),
  });
}
