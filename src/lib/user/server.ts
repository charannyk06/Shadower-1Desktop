"use server";

import { customModelProvider } from "@/lib/ai/models";
import { BasicUserWithLastLogin, UserPreferences } from "app-types/user";
import { getSession } from "auth/server";
import { userRepository } from "lib/db/repository";
import { notFound } from "next/navigation";

/**
 * Electron-Only User Server Functions
 *
 * All user authentication is handled via Electron IPC.
 * These functions work with the local user session.
 */

// Create a local user fallback
const createLocalUser = (userId: string): BasicUserWithLastLogin => ({
  id: userId,
  name: "Local User",
  email: "local@shadower.app",
  emailVerified: true,
  image: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastLogin: null,
});

/**
 * Get the user by id
 * In Electron mode, always returns the local user
 */
export async function getUser(
  userId?: string,
): Promise<BasicUserWithLastLogin | null> {
  try {
    const session = await getSession();
    if (!session) {
      return null;
    }
    const resolvedUserId = userId || session.user.id;

    // Try to get from database first
    try {
      const dbUser = await userRepository.getUserById(resolvedUserId);
      if (dbUser) return dbUser;
    } catch {
      // Database not available, use local user
    }

    return createLocalUser(resolvedUserId);
  } catch {
    return null;
  }
}

/**
 * Get user accounts
 * In Electron-only mode, returns mock data
 */
export async function getUserAccounts(_userId?: string) {
  // In Electron mode, no OAuth accounts, just local credential
  return {
    accounts: [],
    hasPassword: false,
    oauthProviders: [],
  };
}

/**
 * List user sessions
 * In Electron-only mode, returns empty list
 */
export async function getUserSessions(_userId?: string): Promise<any[]> {
  // Electron handles sessions via IPC
  return [];
}

/**
 * Get the user ID and check access
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

  try {
    const stats = await userRepository.getUserStats(resolvedUserId);

    // Add provider information to each model stat
    return {
      ...stats,
      modelStats: stats.modelStats.map((stat) => ({
        ...stat,
        provider: customModelProvider.getProviderForModel(stat.model),
      })),
    };
  } catch {
    // Return empty stats on error
    return {
      threadCount: 0,
      messageCount: 0,
      modelStats: [],
      totalTokens: 0,
      period: "Last 30 Days",
    };
  }
}

/**
 * Get the user preferences
 */
export async function getUserPreferences(
  userId?: string,
): Promise<UserPreferences | null> {
  const resolvedUserId = await getUserIdAndCheckAccess(userId);
  try {
    return await userRepository.getPreferences(resolvedUserId);
  } catch {
    // Return default preferences on error
    return {
      displayName: undefined,
      profession: undefined,
      responseStyleExample: undefined,
      botName: undefined,
    };
  }
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
  try {
    return await userRepository.updateUserDetails({
      userId: resolvedUserId,
      ...(name && { name }),
      ...(email && { email }),
      ...(image && { image }),
    });
  } catch {
    // In Electron mode, updates are handled via IPC, so just return success
    return;
  }
}
