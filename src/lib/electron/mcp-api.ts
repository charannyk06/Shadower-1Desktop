/**
 * Unified MCP API for Desktop (Electron)
 *
 * This module provides a unified API for MCP server operations using Electron IPC.
 * Desktop-only - no HTTP fallbacks.
 */

import {
  MCPServerInfo,
  McpServerCustomization,
  McpToolCustomization,
} from "app-types/mcp";

/**
 * Get current user ID from Electron auth
 */
async function getElectronUserId(): Promise<string> {
  const user = await window.electronAPI.auth.getCurrentUser();
  return user?.id || "local-user";
}

/**
 * Unified MCP API - Desktop Only (IPC)
 */
export const mcpApi = {
  /**
   * Get a single MCP server by ID
   */
  async getById(id: string): Promise<any | null> {
    try {
      return await window.electronAPI.db.mcp.getServerById(id);
    } catch (error) {
      console.error("[mcpApi] Error getting MCP server by ID:", error);
      return null;
    }
  },

  /**
   * Get all MCP servers for the current user (list endpoint)
   * Returns servers with their ACTUAL connection status and tool info
   */
  async getList(): Promise<MCPServerInfo[]> {
    try {
      // Use getServersWithStatus to get ACTUAL connection status from MCP clients
      return await window.electronAPI.db.mcp.getServersWithStatus();
    } catch (error) {
      console.error("[mcpApi] Error getting MCP servers:", error);
      return [];
    }
  },

  /**
   * Create or update an MCP server
   */
  async save(data: { id?: string; name: string; config: any }): Promise<any> {
    const userId = await getElectronUserId();
    return window.electronAPI.db.mcp.saveServer({
      ...data,
      userId,
    });
  },

  /**
   * Delete an MCP server
   */
  async delete(id: string): Promise<void> {
    await window.electronAPI.db.mcp.deleteServer(id);
  },

  /**
   * Get server customization for an MCP server
   * Note: Server customizations are limited in desktop mode
   */
  async getServerCustomization(
    serverId: string,
  ): Promise<McpServerCustomization | null> {
    console.log(
      "[mcpApi] Server customizations not fully supported in desktop mode",
    );
    return null;
  },

  /**
   * Save server customization
   */
  async saveServerCustomization(
    serverId: string,
    data: { prompt: string },
  ): Promise<any> {
    console.log(
      "[mcpApi] Server customizations not fully supported in desktop mode",
    );
    return { success: true };
  },

  /**
   * Delete server customization
   */
  async deleteServerCustomization(serverId: string): Promise<void> {
    console.log(
      "[mcpApi] Server customizations not fully supported in desktop mode",
    );
  },

  /**
   * Get tool customizations for an MCP server
   */
  async getToolCustomizations(
    serverId: string,
  ): Promise<McpToolCustomization[]> {
    try {
      return await window.electronAPI.db.mcp.getToolCustomizations(serverId);
    } catch (error) {
      console.error("[mcpApi] Error getting tool customizations:", error);
      return [];
    }
  },

  /**
   * Get a specific tool customization
   */
  async getToolCustomization(
    serverId: string,
    toolName: string,
  ): Promise<McpToolCustomization | null> {
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
  },

  /**
   * Save tool customization
   */
  async saveToolCustomization(
    serverId: string,
    toolName: string,
    data: { prompt: string },
  ): Promise<any> {
    const userId = await getElectronUserId();
    return window.electronAPI.db.mcp.saveToolCustomization({
      userId,
      serverId,
      toolName,
      prompt: data.prompt,
    });
  },

  /**
   * Delete tool customization
   */
  async deleteToolCustomization(
    serverId: string,
    toolName: string,
  ): Promise<void> {
    console.log(
      "[mcpApi] Tool customization deletion not fully supported in desktop mode",
    );
  },

  /**
   * Check if an MCP server exists by name
   */
  async existsByServerName(name: string): Promise<boolean> {
    try {
      return await window.electronAPI.db.mcp.existsByServerName(name);
    } catch (error) {
      console.error("[mcpApi] Error checking if server exists:", error);
      return false;
    }
  },

  /**
   * Refresh an MCP client (reconnect)
   */
  async refreshClient(serverId: string): Promise<{
    success: boolean;
    status?: string;
    toolInfo?: any[];
    error?: string;
  }> {
    try {
      return await window.electronAPI.db.mcp.refreshClient(serverId);
    } catch (error: any) {
      console.error("[mcpApi] Error refreshing MCP client:", error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Call an MCP tool directly
   */
  async callTool(
    serverId: string,
    toolName: string,
    args: any,
  ): Promise<{ success: boolean; result?: any; error?: string }> {
    try {
      return await window.electronAPI.db.mcp.callTool({
        serverId,
        toolName,
        args,
      });
    } catch (error: any) {
      console.error("[mcpApi] Error calling MCP tool:", error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Call an MCP tool by server name
   */
  async callToolByServerName(
    serverName: string,
    toolName: string,
    args: any,
  ): Promise<{ success: boolean; result?: any; error?: string }> {
    try {
      return await window.electronAPI.db.mcp.callToolByServerName({
        serverName,
        toolName,
        args,
      });
    } catch (error: any) {
      console.error("[mcpApi] Error calling MCP tool by server name:", error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Get MCP server status with tool info
   */
  async getServerStatus(serverId: string): Promise<any | null> {
    try {
      return await window.electronAPI.db.mcp.getServerStatus(serverId);
    } catch (error) {
      console.error("[mcpApi] Error getting server status:", error);
      return null;
    }
  },

  /**
   * Update MCP server visibility
   */
  async updateVisibility(
    serverId: string,
    visibility: "public" | "private",
  ): Promise<any> {
    try {
      return await window.electronAPI.db.mcp.updateVisibility({
        serverId,
        visibility,
      });
    } catch (error) {
      console.error("[mcpApi] Error updating visibility:", error);
      throw error;
    }
  },

  /**
   * Get all MCP servers with their connection status
   */
  async getServersWithStatus(): Promise<MCPServerInfo[]> {
    try {
      return await window.electronAPI.db.mcp.getServersWithStatus();
    } catch (error) {
      console.error("[mcpApi] Error getting servers with status:", error);
      return [];
    }
  },

  /**
   * Authorize an MCP client (OAuth flow)
   * Returns the authorization URL to redirect to
   */
  async authorize(serverId: string): Promise<string | null> {
    try {
      const result = await window.electronAPI.db.mcp.authorize(serverId);
      if (!result.success) {
        throw new Error(result.error || "Failed to get authorization URL");
      }
      return result.authUrl || null;
    } catch (error: any) {
      console.error("[mcpApi] Error authorizing MCP client:", error);
      throw error;
    }
  },

  /**
   * Check if an MCP client has a valid token
   */
  async checkToken(serverId: string): Promise<boolean> {
    try {
      const result = await window.electronAPI.db.mcp.checkToken(serverId);
      return result.valid || false;
    } catch (error: any) {
      console.error("[mcpApi] Error checking MCP token:", error);
      return false;
    }
  },

  /**
   * Finish OAuth flow with authorization code
   * Called from the OAuth callback page after receiving code and state
   */
  async finishOAuth(
    code: string,
    state: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await window.electronAPI.db.mcp.finishOAuth({
        code,
        state,
      });
      return result;
    } catch (error: any) {
      console.error("[mcpApi] Error finishing OAuth:", error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Quick install an MCP server from the marketplace
   * Creates the server and attempts to connect immediately
   */
  async quickInstall(mcpConfig: {
    name: string;
    config: any;
    requiresAuth?: boolean;
  }): Promise<{
    success: boolean;
    serverId?: string;
    needsAuth?: boolean;
    status?: string;
    toolInfo?: any[];
    error?: string;
  }> {
    try {
      // 1. Check if server with this name already exists
      const exists = await this.existsByServerName(mcpConfig.name);
      if (exists) {
        return { success: false, error: "Server already installed" };
      }

      // 2. Save the server config
      const result = await this.save({
        name: mcpConfig.name,
        config: mcpConfig.config,
      });

      if (!result?.id) {
        return { success: false, error: "Failed to save server configuration" };
      }

      // 3. Attempt to connect immediately to detect OAuth requirements
      try {
        const refreshResult = await this.refreshClient(result.id);
        return {
          success: true,
          serverId: result.id,
          needsAuth: refreshResult.status === "authorizing",
          status: refreshResult.status || "disconnected",
          toolInfo: refreshResult.toolInfo || [],
        };
      } catch (refreshError: any) {
        // Connection failed but server was saved - return success with disconnected status
        console.log(
          "[mcpApi] Initial connection attempt failed:",
          refreshError?.message,
        );
        return {
          success: true,
          serverId: result.id,
          needsAuth: mcpConfig.requiresAuth || false,
          status: "disconnected",
          toolInfo: [],
        };
      }
    } catch (error: any) {
      console.error("[mcpApi] Error in quickInstall:", error);
      return { success: false, error: error.message };
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

  // Unrecognized pattern
  console.warn(
    `[mcpFetcher] Unrecognized URL pattern: ${url}, returning empty array`,
  );
  return [];
}

export default mcpApi;
