/**
 * Shared MCP Client Service
 *
 * This service provides a single source of truth for MCP client management.
 * Both the MCP IPC handlers and AI IPC handlers should use this service
 * to avoid duplicate client Maps and ensure state consistency.
 */

import {
  createMCPClient,
  MCPClient,
} from "../../src/lib/ai/mcp/create-mcp-client";
import type { MCPServerConfig } from "../../src/types/mcp";

// Single source of truth for MCP clients
const mcpClients = new Map<string, MCPClient>();

/**
 * Get or create an MCP client for a server
 */
export async function getMcpClient(
  serverId: string,
  serverName: string,
  config: MCPServerConfig,
): Promise<MCPClient> {
  let client = mcpClients.get(serverId);

  if (!client) {
    console.log(
      `[MCP Service] Creating new client for server: ${serverName} (${serverId})`,
    );
    client = createMCPClient(serverId, serverName, config, {
      autoDisconnectSeconds: 60 * 30, // 30 minutes
    });
    mcpClients.set(serverId, client);
  }

  return client;
}

/**
 * Get an existing MCP client by server ID (doesn't create if not exists)
 */
export function getExistingClient(serverId: string): MCPClient | undefined {
  return mcpClients.get(serverId);
}

/**
 * Get all active MCP clients
 */
export function getAllClients(): Map<string, MCPClient> {
  return mcpClients;
}

/**
 * Check if a client exists for a server
 */
export function hasClient(serverId: string): boolean {
  return mcpClients.has(serverId);
}

/**
 * Get the status of an MCP client
 */
export function getClientStatus(serverId: string): string {
  const client = mcpClients.get(serverId);
  return client?.status || "disconnected";
}

/**
 * Get tool info from an MCP client
 */
export function getClientToolInfo(serverId: string): any[] {
  const client = mcpClients.get(serverId);
  return client?.toolInfo || [];
}

/**
 * Disconnect and remove an MCP client
 */
export async function disconnectClient(serverId: string): Promise<void> {
  const client = mcpClients.get(serverId);
  if (client) {
    console.log(`[MCP Service] Disconnecting client: ${serverId}`);
    try {
      await client.disconnect();
    } catch (error) {
      console.warn(
        `[MCP Service] Error disconnecting client ${serverId}:`,
        error,
      );
    }
    mcpClients.delete(serverId);
  }
}

/**
 * Disconnect all MCP clients (cleanup on app quit)
 */
export async function disconnectAllClients(): Promise<void> {
  console.log(`[MCP Service] Disconnecting all ${mcpClients.size} clients...`);
  const disconnectPromises: Promise<void>[] = [];

  for (const [serverId, client] of mcpClients.entries()) {
    disconnectPromises.push(
      client.disconnect().catch((error) => {
        console.warn(`[MCP Service] Error disconnecting ${serverId}:`, error);
      }),
    );
  }

  await Promise.all(disconnectPromises);
  mcpClients.clear();
  console.log("[MCP Service] All clients disconnected");
}

/**
 * Connect an MCP client if not already connected
 */
export async function ensureClientConnected(
  serverId: string,
  serverName: string,
  config: MCPServerConfig,
): Promise<MCPClient> {
  const client = await getMcpClient(serverId, serverName, config);

  if (
    client.status !== "connected" &&
    client.status !== "loading" &&
    client.status !== "authorizing"
  ) {
    console.log(`[MCP Service] Connecting client: ${serverName}`);
    try {
      await client.connect();
    } catch (error: any) {
      // Check if this is an auth-related error that requires user interaction
      const isAuthError =
        error?.name === "OAuthAuthorizationRequiredError" ||
        error?.message?.includes("OAuth") ||
        error?.message?.includes("Incompatible auth server") ||
        error?.message?.includes(
          "does not support dynamic client registration",
        );

      // If OAuth authorization is required, the error sets authorizationUrl
      // and status becomes "authorizing" - check status after error
      // Use type assertion since status can change after connect() call
      const statusAfterError = client.status as
        | "loading"
        | "authorizing"
        | "connected"
        | "disconnected";
      if (statusAfterError === "authorizing") {
        console.log(
          `[MCP Service] OAuth authorization required for ${serverName}`,
        );
        // Status is now "authorizing" - return client with this status
        return client;
      }

      // For auth errors (including dynamic registration errors), store the error
      // The IPC handler will check for this error and set status to "authorizing"
      if (isAuthError) {
        console.log(
          `[MCP Service] Auth error detected for ${serverName}: ${error?.message}`,
        );
        // Store the error so the IPC handler can detect it
        // The error will be checked in getServersWithStatus to set status to "authorizing"
      }

      // For other errors, log but don't throw - let the status remain as "disconnected"
      console.warn(
        `[MCP Service] Connection failed for ${serverName}:`,
        error?.message || error,
      );
      return client;
    }

    // Wait for tool info to be populated (with timeout) - only if connected
    // Use type assertion since status can change after connect() call
    const finalStatus = client.status as
      | "loading"
      | "authorizing"
      | "connected"
      | "disconnected";
    if (finalStatus === "connected") {
      let attempts = 0;
      const maxAttempts = 50; // 5 seconds max
      while (
        (!client.toolInfo || client.toolInfo.length === 0) &&
        attempts < maxAttempts
      ) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        attempts++;
      }
    }
  }

  return client;
}

/**
 * Refresh an MCP client (disconnect and reconnect)
 */
export async function refreshClient(
  serverId: string,
  serverName: string,
  config: MCPServerConfig,
): Promise<{
  success: boolean;
  status: string;
  toolInfo: any[];
  error?: string;
}> {
  try {
    const client = await getMcpClient(serverId, serverName, config);

    // Disconnect first
    await client.disconnect();

    // Wait a bit before reconnecting
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Reconnect - OAuth errors will set authorizationUrl and status to "authorizing"
    try {
      await client.connect();
    } catch (error: any) {
      // Check status after error - if OAuth is required, status will be "authorizing"
      const statusAfterError = client.status;
      if (statusAfterError === "authorizing") {
        console.log(
          `[MCP Service] OAuth authorization required for ${serverName}`,
        );
        return {
          success: true,
          status: "authorizing",
          toolInfo: [],
        };
      }
      // For other errors, rethrow to be caught by outer catch
      throw error;
    }

    // Wait for tool info - only if connected
    if (client.status === "connected") {
      let attempts = 0;
      while (
        (!client.toolInfo || client.toolInfo.length === 0) &&
        attempts < 50
      ) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        attempts++;
      }
    }

    return {
      success: true,
      status: client.status,
      toolInfo: client.toolInfo || [],
    };
  } catch (error: any) {
    console.error(`[MCP Service] Error refreshing client ${serverId}:`, error);
    // Check if status is authorizing even after error
    const client = getExistingClient(serverId);
    if (client?.status === "authorizing") {
      return {
        success: true,
        status: "authorizing",
        toolInfo: [],
      };
    }
    return {
      success: false,
      status: "error",
      toolInfo: [],
      error: error.message,
    };
  }
}

/**
 * Call a tool on an MCP client
 */
export async function callTool(
  serverId: string,
  serverName: string,
  config: MCPServerConfig,
  toolName: string,
  args: any,
): Promise<{ success: boolean; result?: any; error?: string }> {
  try {
    const client = await ensureClientConnected(serverId, serverName, config);

    if (client.status !== "connected") {
      return {
        success: false,
        error: `Client not connected. Status: ${client.status}`,
      };
    }

    const result = await client.callTool(toolName, args);
    return { success: true, result };
  } catch (error: any) {
    console.error(`[MCP Service] Error calling tool ${toolName}:`, error);
    return { success: false, error: error.message };
  }
}

// Export for use in main.ts cleanup
export { mcpClients };
