/**
 * Unified User API for Desktop (Electron)
 *
 * This module provides a unified API for user operations that automatically
 * uses Electron IPC for all database operations.
 */

import { UserPreferences, BasicUser } from "app-types/user";

/**
 * Check if we're running in Electron mode
 */
export function isElectronMode(): boolean {
  return (
    typeof window !== "undefined" &&
    window.electronAPI !== undefined &&
    window.electronAPI.auth !== undefined
  );
}

/**
 * Unified User API
 */
export const userApi = {
  /**
   * Get user preferences
   */
  async getPreferences(): Promise<UserPreferences> {
    if (isElectronMode()) {
      return window.electronAPI.auth.getPreferences();
    }
    const res = await fetch("/api/user/preferences");
    if (!res.ok) throw new Error(`Failed to get preferences: ${res.status}`);
    return res.json();
  },

  /**
   * Update user preferences
   */
  async updatePreferences(
    preferences: Partial<UserPreferences>,
  ): Promise<void> {
    if (isElectronMode()) {
      await window.electronAPI.auth.updatePreferences(preferences);
      return;
    }
    const res = await fetch("/api/user/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(preferences),
    });
    if (!res.ok) throw new Error(`Failed to update preferences: ${res.status}`);
  },

  /**
   * Get user details
   * @param userId - Optional user ID. If not provided, returns current user
   */
  async getDetails(userId?: string): Promise<BasicUser | null> {
    if (isElectronMode()) {
      if (userId) {
        // Get specific user by ID
        return window.electronAPI.db.user.getById(userId);
      }
      // Get current user
      return window.electronAPI.auth.getCurrentUser();
    }
    const url = userId ? `/api/user/details/${userId}` : "/api/user/details";
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to get user details: ${res.status}`);
    return res.json();
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
    if (isElectronMode()) {
      return window.electronAPI.db.user.getStats(userId);
    }
    const res = await fetch(`/api/user/stats/${userId}`);
    if (!res.ok) {
      // Return default stats on error
      return {
        threadCount: 0,
        messageCount: 0,
        modelStats: [],
        totalTokens: 0,
        period: "Last 30 Days",
      };
    }
    return res.json();
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
    if (isElectronMode()) {
      return window.electronAPI.auth.updateProfile(data);
    }
    const res = await fetch("/api/user/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Failed to update profile: ${res.status}`);
    return res.json();
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

  // Fallback - log warning and try to handle gracefully
  if (isElectronMode()) {
    console.warn(
      `[userFetcher] Unrecognized URL pattern: ${url}, returning null`,
    );
    return null;
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  return res.json();
}

export default userApi;
