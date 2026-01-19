/**
 * Unified Agent API for Desktop (Electron)
 *
 * This module provides a unified API for agent operations that automatically
 * uses Electron IPC for all database operations.
 */

/**
 * Check if we're running in Electron mode
 */
export function isElectronMode(): boolean {
  return (
    typeof window !== "undefined" &&
    window.electronAPI !== undefined &&
    window.electronAPI.db?.agents !== undefined
  );
}

/**
 * Get current user ID from Electron auth
 */
async function getElectronUserId(): Promise<string> {
  if (!isElectronMode()) {
    throw new Error("Not in Electron mode");
  }
  const user = await window.electronAPI.auth.getCurrentUser();
  return user?.id || "local-user";
}

/**
 * Unified Agent API
 */
export const agentApi = {
  /**
   * Get all agents for the current user
   */
  async getAll(): Promise<any[]> {
    if (isElectronMode()) {
      const userId = await getElectronUserId();
      return window.electronAPI.db.agents.getAll(userId);
    }
    const res = await fetch("/api/agent");
    if (!res.ok) throw new Error(`Failed to get agents: ${res.status}`);
    return res.json();
  },

  /**
   * Get agents with filters
   */
  async selectAgents(
    filters: string[] = ["all"],
    limit: number = 50,
  ): Promise<any[]> {
    if (isElectronMode()) {
      const userId = await getElectronUserId();
      return window.electronAPI.db.agents.selectAgents(userId, filters, limit);
    }
    const params = new URLSearchParams();
    if (filters.length > 0) params.set("filters", filters.join(","));
    if (limit) params.set("limit", limit.toString());
    const res = await fetch(`/api/agent?${params}`);
    if (!res.ok) throw new Error(`Failed to get agents: ${res.status}`);
    return res.json();
  },

  /**
   * Get a single agent by ID
   */
  async getById(id: string): Promise<any | null> {
    if (isElectronMode()) {
      return window.electronAPI.db.agents.getById(id);
    }
    const res = await fetch(`/api/agent/${id}`);
    if (!res.ok) throw new Error(`Failed to get agent: ${res.status}`);
    return res.json();
  },

  /**
   * Create a new agent
   */
  async create(data: any): Promise<any> {
    if (isElectronMode()) {
      const userId = await getElectronUserId();
      return window.electronAPI.db.agents.create({
        ...data,
        userId,
      });
    }
    const res = await fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Failed to create agent: ${res.status}`);
    return res.json();
  },

  /**
   * Update an agent
   */
  async update(id: string, data: any): Promise<any> {
    if (isElectronMode()) {
      return window.electronAPI.db.agents.update(id, data);
    }
    const res = await fetch(`/api/agent/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Failed to update agent: ${res.status}`);
    return res.json();
  },

  /**
   * Delete an agent
   */
  async delete(id: string): Promise<void> {
    if (isElectronMode()) {
      await window.electronAPI.db.agents.delete(id);
      return;
    }
    const res = await fetch(`/api/agent/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error(`Failed to delete agent: ${res.status}`);
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

  // Fallback - log warning and try to handle gracefully
  if (isElectronMode()) {
    console.warn(
      `[agentFetcher] Unrecognized URL pattern: ${url}, returning empty array`,
    );
    return [];
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  return res.json();
}

export default agentApi;
