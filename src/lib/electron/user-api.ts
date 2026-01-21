/**
 * Unified User API for Desktop (Electron)
 *
 * This module provides a unified API for user operations using Electron IPC.
 * Desktop-only - no HTTP fallbacks.
 */

import { UserPreferences, BasicUser } from "app-types/user";

/**
 * Unified User API - Desktop Only (IPC)
 */
export const userApi = {
  /**
   * Get user preferences
   */
  async getPreferences(): Promise<UserPreferences> {
    return window.electronAPI.auth.getPreferences();
  },

  /**
   * Update user preferences
   */
  async updatePreferences(
    preferences: Partial<UserPreferences>,
  ): Promise<void> {
    await window.electronAPI.auth.updatePreferences(preferences);
  },

  /**
   * Get user details
   * @param userId - Optional user ID. If not provided, returns current user
   */
  async getDetails(userId?: string): Promise<BasicUser | null> {
    if (userId) {
      // Get specific user by ID
      return window.electronAPI.db.user.getById(userId);
    }
    // Get current user
    return window.electronAPI.auth.getCurrentUser();
  },

  /**
   * Get user statistics (thread count, message count, etc.)
   */
  async getStats(userId: string): Promise<{
    threadCount: number;
    messageCount: number;
    modelStats: any[];
    totalTokens: number;
    period: string;
  }> {
    try {
      return await window.electronAPI.db.user.getStats(userId);
    } catch {
      // Return default stats on error
      return {
        threadCount: 0,
        messageCount: 0,
        modelStats: [],
        totalTokens: 0,
        period: "Last 30 Days",
      };
    }
  },

  /**
   * Get user by ID (alias for getDetails with userId)
   */
  async getById(userId: string): Promise<BasicUser | null> {
    return this.getDetails(userId);
  },

  /**
   * Update user profile
   */
  async updateProfile(data: {
    name?: string;
    image?: string | null;
  }): Promise<any> {
    return window.electronAPI.auth.updateProfile(data);
  },
};

/**
 * SWR-compatible fetcher that uses the user API
 */
export async function userFetcher(url: string): Promise<any> {
  // Handle different endpoint patterns
  if (url === "/api/user/preferences" || url === "/api/user/preferences/") {
    return userApi.getPreferences();
  }

  if (url === "/api/user/details" || url === "/api/user/details/") {
    return userApi.getDetails();
  }

  // Unrecognized pattern - return null
  console.warn(
    `[userFetcher] Unrecognized URL pattern: ${url}, returning null`,
  );
  return null;
}

export default userApi;
