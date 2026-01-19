/**
 * Unified MCP API for Desktop (Electron) and Web
 *
 * This module provides a unified API for MCP server operations that automatically
 * detects if we're running in Electron mode and uses IPC, or falls back to
 * fetch calls for web mode.
 */

import {
  MCPServerInfo,
  McpServerCustomization,
  McpToolCustomization,
} from "app-types/mcp";

/**
 * Check if we're running in Electron mode with MCP IPC available
 */
export function isElectronMode(): boolean {
  return (
    typeof window !== "undefined" &&
    window.electronAPI !== undefined &&
    window.electronAPI.db?.mcp !== undefined
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
 * Unified MCP API
 */
export const mcpApi = {
  /**
   * Get a single MCP server by ID
   */
  async getById(id: string): Promise<any | null> {
    if (isElectronMode()) {
      try {
        return await window.electronAPI.db.mcp.getServerById(id);
      } catch (error) {
        console.error("[mcpApi] Error getting MCP server by ID:", error);
        return null;
      }
    }

    const res = await fetch(`/api/mcp/${id}`);
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error(`Failed to get MCP server: ${res.status}`);
    }
    return res.json();
  },

  /**
   * Get all MCP servers for the current user (list endpoint)
   * Returns servers with their status and tool info
   */
  async getList(): Promise<MCPServerInfo[]> {
    if (isElectronMode()) {
      try {
        // In Electron mode, get servers from IPC
        const servers = await window.electronAPI.db.mcp.getServers();
        // Note: In desktop mode, we return servers but tool info
        // may not be available until MCP client connects
        return servers.map((server: any) => ({
          id: server.id,
          name: server.name,
          status: server.enabled ? "connected" : "disconnected",
          toolInfo: [],
          error: null,
          config: server.config,
        }));
      } catch (error) {
        console.error("[mcpApi] Error getting MCP servers:", error);
        return [];
      }
    }

    const res = await fetch("/api/mcp/list");
    if (!res.ok) {
      throw new Error(`Failed to get MCP list: ${res.status}`);
    }
    return res.json();
  },

  /**
   * Create or update an MCP server
   */
  async save(data: {
    id?: string;
    name: string;
    config: any;
  }): Promise<any> {
    if (isElectronMode()) {
      const userId = await getElectronUserId();
      return window.electronAPI.db.mcp.saveServer({
        ...data,
        userId,
      });
    }

    const res = await fetch("/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      throw new Error(`Failed to save MCP server: ${res.status}`);
    }
    return res.json();
  },

  /**
   * Delete an MCP server
   */
  async delete(id: string): Promise<void> {
    if (isElectronMode()) {
      await window.electronAPI.db.mcp.deleteServer(id);
      return;
    }

    const res = await fetch(`/api/mcp/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      throw new Error(`Failed to delete MCP server: ${res.status}`);
    }
  },

  /**
   * Get server customization for an MCP server
   */
  async getServerCustomization(
    serverId: string,
  ): Promise<McpServerCustomization | null> {
    if (isElectronMode()) {
      // In Electron desktop mode, customizations are limited
      // We could store these in a separate table or localStorage
      console.log(
        "[mcpApi] Server customizations not fully supported in desktop mode",
      );
      return null;
    }

    const res = await fetch(`/api/mcp/server-customizations/${serverId}`);
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error(`Failed to get server customization: ${res.status}`);
    }
    return res.json();
  },

  /**
   * Save server customization
   */
  async saveServerCustomization(
    serverId: string,
    data: { prompt: string },
  ): Promise<any> {
    if (isElectronMode()) {
      console.log(
        "[mcpApi] Server customizations not fully supported in desktop mode",
      );
      return { success: true };
    }

    const res = await fetch(`/api/mcp/server-customizations/${serverId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      throw new Error(`Failed to save server customization: ${res.status}`);
    }
    return res.json();
  },

  /**
   * Delete server customization
   */
  async deleteServerCustomization(serverId: string): Promise<void> {
    if (isElectronMode()) {
      console.log(
        "[mcpApi] Server customizations not fully supported in desktop mode",
      );
      return;
    }

    const res = await fetch(`/api/mcp/server-customizations/${serverId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      throw new Error(`Failed to delete server customization: ${res.status}`);
    }
  },

  /**
   * Get tool customizations for an MCP server
   */
  async getToolCustomizations(
    serverId: string,
  ): Promise<McpToolCustomization[]> {
    if (isElectronMode()) {
      try {
        return await window.electronAPI.db.mcp.getToolCustomizations(serverId);
      } catch (error) {
        console.error("[mcpApi] Error getting tool customizations:", error);
        return [];
      }
    }

    const res = await fetch(`/api/mcp/tool-customizations/${serverId}`);
    if (!res.ok) {
      throw new Error(`Failed to get tool customizations: ${res.status}`);
    }
    return res.json();
  },

  /**
   * Get a specific tool customization
   */
  async getToolCustomization(
    serverId: string,
    toolName: string,
  ): Promise<McpToolCustomization | null> {
    if (isElectronMode()) {
      try {
        const customizations =
          await window.electronAPI.db.mcp.getToolCustomizations(serverId);
        return (
          customizations.find(
            (c: McpToolCustomization) => c.toolName === toolName,
          ) || null
        );
      } catch (error) {
        console.error("[mcpApi] Error getting tool customization:", error);
        return null;
      }
    }

    const res = await fetch(
      `/api/mcp/tool-customizations/${serverId}/${toolName}`,
    );
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error(`Failed to get tool customization: ${res.status}`);
    }
    return res.json();
  },

  /**
   * Save tool customization
   */
  async saveToolCustomization(
    serverId: string,
    toolName: string,
    data: { prompt: string },
  ): Promise<any> {
    if (isElectronMode()) {
      const userId = await getElectronUserId();
      return window.electronAPI.db.mcp.saveToolCustomization({
        userId,
        serverId,
        toolName,
        prompt: data.prompt,
      });
    }

    const res = await fetch(
      `/api/mcp/tool-customizations/${serverId}/${toolName}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      },
    );
    if (!res.ok) {
      throw new Error(`Failed to save tool customization: ${res.status}`);
    }
    return res.json();
  },

  /**
   * Delete tool customization
   */
  async deleteToolCustomization(
    serverId: string,
    toolName: string,
  ): Promise<void> {
    if (isElectronMode()) {
      // Note: Deletion of tool customizations would require adding a delete handler
      console.log(
        "[mcpApi] Tool customization deletion not fully supported in desktop mode",
      );
      return;
    }

    const res = await fetch(
      `/api/mcp/tool-customizations/${serverId}/${toolName}`,
      {
        method: "DELETE",
      },
    );
    if (!res.ok) {
      throw new Error(`Failed to delete tool customization: ${res.status}`);
    }
  },
};

/**
 * SWR-compatible fetcher for MCP API
 */
export async function mcpFetcher(url: string): Promise<any> {
  // Handle /api/mcp/list
  if (url === "/api/mcp/list" || url === "/api/mcp/list/") {
    return mcpApi.getList();
  }

  // Handle /api/mcp/server-customizations/:serverId
  const serverCustomizationMatch = url.match(
    /^\/api\/mcp\/server-customizations\/([^\/]+)$/,
  );
  if (serverCustomizationMatch) {
    return mcpApi.getServerCustomization(serverCustomizationMatch[1]);
  }

  // Handle /api/mcp/tool-customizations/:serverId
  const toolCustomizationsMatch = url.match(
    /^\/api\/mcp\/tool-customizations\/([^\/]+)$/,
  );
  if (toolCustomizationsMatch) {
    return mcpApi.getToolCustomizations(toolCustomizationsMatch[1]);
  }

  // Handle /api/mcp/tool-customizations/:serverId/:toolName
  const toolCustomizationMatch = url.match(
    /^\/api\/mcp\/tool-customizations\/([^\/]+)\/([^\/]+)$/,
  );
  if (toolCustomizationMatch) {
    return mcpApi.getToolCustomization(
      toolCustomizationMatch[1],
      toolCustomizationMatch[2],
    );
  }

  // Fallback to regular fetch for unrecognized patterns
  if (isElectronMode()) {
    console.warn(
      `[mcpFetcher] Unrecognized URL pattern: ${url}, using fetch fallback`,
    );
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  return res.json();
}

export default mcpApi;
