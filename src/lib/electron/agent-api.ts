/**
 * Unified Agent API for Desktop (Electron)
 *
 * This module provides a unified API for agent operations using Electron IPC.
 * Desktop-only - no HTTP fallbacks.
 */

/**
 * Get current user ID from Electron auth
 */
async function getElectronUserId(): Promise<string> {
  const user = await window.electronAPI.auth.getCurrentUser();
  return user?.id || "local-user";
}

/**
 * Unified Agent API - Desktop Only (IPC)
 */
export const agentApi = {
  /**
   * Get all agents for the current user
   */
  async getAll(): Promise<any[]> {
    const userId = await getElectronUserId();
    return window.electronAPI.db.agents.getAll(userId);
  },

  /**
   * Get agents with filters
   */
  async selectAgents(
    filters: string[] = ["all"],
    limit: number = 50,
  ): Promise<any[]> {
    const userId = await getElectronUserId();
    return window.electronAPI.db.agents.selectAgents(userId, filters, limit);
  },

  /**
   * Get a single agent by ID
   */
  async getById(id: string): Promise<any | null> {
    return window.electronAPI.db.agents.getById(id);
  },

  /**
   * Create a new agent
   */
  async create(data: any): Promise<any> {
    const userId = await getElectronUserId();
    return window.electronAPI.db.agents.create({
      ...data,
      userId,
    });
  },

  /**
   * Update an agent
   */
  async update(id: string, data: any): Promise<any> {
    return window.electronAPI.db.agents.update(id, data);
  },

  /**
   * Delete an agent
   */
  async delete(id: string): Promise<void> {
    await window.electronAPI.db.agents.delete(id);
  },
};

/**
 * SWR-compatible fetcher that uses the agent API
 */
export async function agentFetcher(url: string): Promise<any> {
  // Handle different endpoint patterns
  if (url === "/api/agent" || url === "/api/agent/") {
    return agentApi.getAll();
  }

  // Handle URL with query params like /api/agent/?filters=all&limit=50
  if (url.startsWith("/api/agent/?") || url.startsWith("/api/agent?")) {
    const urlObj = new URL(url, "http://localhost");
    const filters = urlObj.searchParams.get("filters")?.split(",") || ["all"];
    const limit = parseInt(urlObj.searchParams.get("limit") || "50", 10);
    return agentApi.selectAgents(filters, limit);
  }

  const agentMatch = url.match(/^\/api\/agent\/([^\/\?]+)$/);
  if (agentMatch) {
    return agentApi.getById(agentMatch[1]);
  }

  // Unrecognized pattern - return empty array
  console.warn(
    `[agentFetcher] Unrecognized URL pattern: ${url}, returning empty array`,
  );
  return [];
}

export default agentApi;
