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
 * Health check result for MCP clients
 */
export interface MCPHealthCheckResult {
  serverId: string;
  serverName: string;
  status: "healthy" | "degraded" | "unhealthy" | "unknown";
  connectionStatus: string;
  hasTools: boolean;
  toolCount: number;
  lastError?: string;
  recommendations: string[];
}

/**
 * Check the health of an MCP client
 * Returns detailed diagnostic information
 */
export async function checkClientHealth(
  serverId: string,
  serverName: string,
  config: MCPServerConfig,
): Promise<MCPHealthCheckResult> {
  const recommendations: string[] = [];
  let lastError: string | undefined;

  try {
    const client = await getMcpClient(serverId, serverName, config);
    const connectionStatus = client.status;
    const hasTools =
      Array.isArray(client.toolInfo) && client.toolInfo.length > 0;
    const toolCount = client.toolInfo?.length || 0;

    // Determine health status and recommendations
    let status: MCPHealthCheckResult["status"] = "unknown";

    if (connectionStatus === "connected" && hasTools) {
      status = "healthy";
    } else if (connectionStatus === "connected" && !hasTools) {
      status = "degraded";
      recommendations.push(
        "Server connected but no tools available. The MCP server may not expose any tools.",
      );
    } else if (connectionStatus === "authorizing") {
      status = "degraded";
      recommendations.push(
        "OAuth authorization required. Click 'Authorize' in MCP settings to complete setup.",
      );
    } else if (connectionStatus === "loading") {
      status = "degraded";
      recommendations.push(
        "Server is still connecting. Wait a moment and try again.",
      );
    } else if (connectionStatus === "disconnected") {
      status = "unhealthy";
      recommendations.push(
        "Server disconnected. Try refreshing the connection in MCP settings.",
      );

      // Try to reconnect and get more info
      try {
        await client.connect();
      } catch (error: any) {
        const errorMessage = error?.message || "Unknown connection error";
        lastError = errorMessage;

        if (errorMessage.includes("ECONNREFUSED")) {
          recommendations.push(
            "Connection refused. Ensure the MCP server is running and accessible.",
          );
        } else if (errorMessage.includes("ENOTFOUND")) {
          recommendations.push(
            "Server not found. Check the server URL or command path.",
          );
        } else if (errorMessage.includes("timeout")) {
          recommendations.push(
            "Connection timed out. The server may be slow to respond.",
          );
        } else if (errorMessage.includes("OAuth") || errorMessage.includes("401")) {
          recommendations.push(
            "Authentication required. Check your API keys or OAuth settings.",
          );
        }
      }
    }

    console.log(`[MCP Service] Health check for ${serverName}:`, {
      status,
      connectionStatus,
      hasTools,
      toolCount,
      lastError,
      recommendations,
    });

    return {
      serverId,
      serverName,
      status,
      connectionStatus,
      hasTools,
      toolCount,
      lastError,
      recommendations,
    };
  } catch (error: any) {
    console.error(
      `[MCP Service] Health check failed for ${serverName}:`,
      error,
    );
    return {
      serverId,
      serverName,
      status: "unhealthy",
      connectionStatus: "error",
      hasTools: false,
      toolCount: 0,
      lastError: error?.message || "Unknown error",
      recommendations: [
        "Failed to check server health. The server configuration may be invalid.",
        "Verify the server command or URL is correct.",
      ],
    };
  }
}

/**
 * Check health of all enabled MCP servers
 */
export async function checkAllClientsHealth(
  servers: Array<{
    id: string;
    name: string;
    config: MCPServerConfig;
    enabled: boolean;
  }>,
): Promise<MCPHealthCheckResult[]> {
  const results: MCPHealthCheckResult[] = [];

  for (const server of servers) {
    if (!server.enabled) continue;

    const result = await checkClientHealth(
      server.id,
      server.name,
      server.config,
    );
    results.push(result);
  }

  // Log summary
  const healthy = results.filter((r) => r.status === "healthy").length;
  const degraded = results.filter((r) => r.status === "degraded").length;
  const unhealthy = results.filter((r) => r.status === "unhealthy").length;

  console.log(
    `[MCP Service] Health check summary: ${healthy} healthy, ${degraded} degraded, ${unhealthy} unhealthy`,
  );

  return results;
}

/**
 * Coerce tool arguments based on JSON Schema
 * Local models often output "true"/"false" as strings instead of booleans
 */
function coerceMcpToolArguments(args: any, inputSchema: any): any {
  if (!args || typeof args !== "object" || !inputSchema?.properties) {
    return args;
  }

  const coerced: Record<string, any> = { ...args };

  for (const [key, value] of Object.entries(args)) {
    const propSchema = inputSchema.properties[key];
    if (!propSchema) continue;

    const expectedType = propSchema.type;

    // Coerce string booleans to actual booleans
    if (expectedType === "boolean" && typeof value === "string") {
      coerced[key] = value.toLowerCase() === "true" || value === "1";
      console.log(
        `[MCP Service] Coerced ${key}: "${value}" → ${coerced[key]} (boolean)`,
      );
    }
    // Coerce string numbers to actual numbers
    else if (expectedType === "number" || expectedType === "integer") {
      if (typeof value === "string") {
        const parsed =
          expectedType === "integer" ? parseInt(value, 10) : parseFloat(value);
        if (!isNaN(parsed)) {
          coerced[key] = parsed;
          console.log(
            `[MCP Service] Coerced ${key}: "${value}" → ${coerced[key]} (${expectedType})`,
          );
        }
      }
    }
    // Coerce arrays from strings (some models output "[item1, item2]" as a string)
    else if (expectedType === "array" && typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
          coerced[key] = parsed;
          console.log(`[MCP Service] Coerced ${key}: string → array`);
        }
      } catch {
        // Not valid JSON array, keep as-is
      }
    }
  }

  return coerced;
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

    // Get tool schema for argument coercion
    const toolInfo = client.toolInfo?.find((t: any) => t.name === toolName);
    let coercedArgs = args;

    if (toolInfo?.inputSchema) {
      coercedArgs = coerceMcpToolArguments(args, toolInfo.inputSchema);
    }

    const result = await client.callTool(toolName, coercedArgs);
    return { success: true, result };
  } catch (error: any) {
    console.error(`[MCP Service] Error calling tool ${toolName}:`, error);
    return { success: false, error: error.message };
  }
}

// Export for use in main.ts cleanup
export { mcpClients };
