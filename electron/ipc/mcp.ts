import { ipcMain } from "electron";
import { getDatabase, schema } from "../services/database";
import { eq } from "drizzle-orm";
import {
  getMcpClient,
  getExistingClient,
  refreshClient,
  callTool,
  ensureClientConnected,
} from "../services/mcp-client-service";
import type { MCPServerConfig } from "../../src/types/mcp";

export function registerMcpHandlers() {
  const db = getDatabase();

  // Get all MCP servers
  ipcMain.handle("db:mcp:getServers", async () => {
    try {
      const servers = await db.select().from(schema.McpServerTable);
      return servers;
    } catch (error) {
      console.error("[IPC] Error getting MCP servers:", error);
      throw error;
    }
  });

  // Get MCP server by ID
  ipcMain.handle("db:mcp:getServerById", async (_event, id: string) => {
    try {
      const [server] = await db
        .select()
        .from(schema.McpServerTable)
        .where(eq(schema.McpServerTable.id, id))
        .limit(1);

      return server || null;
    } catch (error) {
      console.error("[IPC] Error getting MCP server by ID:", error);
      throw error;
    }
  });

  // Save MCP server (create or update)
  ipcMain.handle("db:mcp:saveServer", async (_event, data: any) => {
    try {
      if (data.id) {
        // Update existing
        const [server] = await db
          .update(schema.McpServerTable)
          .set({
            name: data.name,
            config: data.config,
            enabled: data.enabled,
            updatedAt: new Date(),
          } as Partial<typeof schema.McpServerTable.$inferInsert>)
          .where(eq(schema.McpServerTable.id, data.id))
          .returning();

        return server;
      } else {
        // Create new
        const [server] = await db
          .insert(schema.McpServerTable)
          .values({
            name: data.name,
            config: data.config,
            enabled: data.enabled !== undefined ? data.enabled : true,
            userId: data.userId,
          } as typeof schema.McpServerTable.$inferInsert)
          .returning();

        return server;
      }
    } catch (error) {
      console.error("[IPC] Error saving MCP server:", error);
      throw error;
    }
  });

  // Delete MCP server
  ipcMain.handle("db:mcp:deleteServer", async (_event, id: string) => {
    try {
      await db
        .delete(schema.McpServerTable)
        .where(eq(schema.McpServerTable.id, id));

      return { success: true };
    } catch (error) {
      console.error("[IPC] Error deleting MCP server:", error);
      throw error;
    }
  });

  // Get MCP tool customizations
  ipcMain.handle(
    "db:mcp:getToolCustomizations",
    async (_event, serverId: string) => {
      try {
        const customizations = await db
          .select()
          .from(schema.McpToolCustomizationTable)
          .where(eq(schema.McpToolCustomizationTable.mcpServerId, serverId));

        return customizations;
      } catch (error) {
        console.error("[IPC] Error getting MCP tool customizations:", error);
        throw error;
      }
    },
  );

  // Save MCP tool customization
  ipcMain.handle("db:mcp:saveToolCustomization", async (_event, data: any) => {
    try {
      if (data.id) {
        // Update
        const [customization] = await db
          .update(schema.McpToolCustomizationTable)
          .set({
            prompt: data.prompt,
            updatedAt: new Date(),
          } as Partial<typeof schema.McpToolCustomizationTable.$inferInsert>)
          .where(eq(schema.McpToolCustomizationTable.id, data.id))
          .returning();

        return customization;
      } else {
        // Create
        const [customization] = await db
          .insert(schema.McpToolCustomizationTable)
          .values({
            userId: data.userId,
            mcpServerId: data.serverId || data.mcpServerId,
            toolName: data.toolName,
            prompt: data.prompt,
          } as typeof schema.McpToolCustomizationTable.$inferInsert)
          .returning();

        return customization;
      }
    } catch (error) {
      console.error("[IPC] Error saving MCP tool customization:", error);
      throw error;
    }
  });

  // Check if MCP server exists by name
  ipcMain.handle("db:mcp:existsByServerName", async (_event, name: string) => {
    try {
      const servers = await db
        .select()
        .from(schema.McpServerTable)
        .where(eq(schema.McpServerTable.name, name))
        .limit(1);

      return servers.length > 0;
    } catch (error) {
      console.error("[IPC] Error checking MCP server by name:", error);
      return false;
    }
  });

  // Refresh MCP client (reconnect)
  ipcMain.handle("db:mcp:refreshClient", async (_event, serverId: string) => {
    try {
      const [server] = await db
        .select()
        .from(schema.McpServerTable)
        .where(eq(schema.McpServerTable.id, serverId))
        .limit(1);

      if (!server) {
        return { success: false, error: "Server not found" };
      }

      // Use shared service to refresh client
      return await refreshClient(
        serverId,
        server.name,
        server.config as MCPServerConfig,
      );
    } catch (error: any) {
      console.error("[IPC] Error refreshing MCP client:", error);
      return { success: false, error: error.message };
    }
  });

  // Call MCP tool
  ipcMain.handle(
    "db:mcp:callTool",
    async (_event, data: { serverId: string; toolName: string; args: any }) => {
      try {
        const { serverId, toolName, args } = data;

        const [server] = await db
          .select()
          .from(schema.McpServerTable)
          .where(eq(schema.McpServerTable.id, serverId))
          .limit(1);

        if (!server) {
          return { success: false, error: "Server not found" };
        }

        // Use shared service to call tool
        return await callTool(
          serverId,
          server.name,
          server.config as MCPServerConfig,
          toolName,
          args,
        );
      } catch (error: any) {
        console.error("[IPC] Error calling MCP tool:", error);
        return { success: false, error: error.message };
      }
    },
  );

  // Call MCP tool by server name
  ipcMain.handle(
    "db:mcp:callToolByServerName",
    async (
      _event,
      data: { serverName: string; toolName: string; args: any },
    ) => {
      try {
        const { serverName, toolName, args } = data;

        const [server] = await db
          .select()
          .from(schema.McpServerTable)
          .where(eq(schema.McpServerTable.name, serverName))
          .limit(1);

        if (!server) {
          return { success: false, error: `Server "${serverName}" not found` };
        }

        // Use shared service to call tool
        return await callTool(
          server.id,
          server.name,
          server.config as MCPServerConfig,
          toolName,
          args,
        );
      } catch (error: any) {
        console.error("[IPC] Error calling MCP tool by server name:", error);
        return { success: false, error: error.message };
      }
    },
  );

  // Get MCP server status/info (with tools)
  ipcMain.handle("db:mcp:getServerStatus", async (_event, serverId: string) => {
    try {
      const [server] = await db
        .select()
        .from(schema.McpServerTable)
        .where(eq(schema.McpServerTable.id, serverId))
        .limit(1);

      if (!server) {
        return null;
      }

      // Use shared service to get client status
      const client = getExistingClient(serverId);

      return {
        ...server,
        status: client?.status || "disconnected",
        toolInfo: client?.toolInfo || [],
      };
    } catch (error) {
      console.error("[IPC] Error getting MCP server status:", error);
      return null;
    }
  });

  // Get all MCP servers with status
  ipcMain.handle("db:mcp:getServersWithStatus", async () => {
    try {
      const servers = await db.select().from(schema.McpServerTable);

      // Auto-connect enabled servers that aren't already connected
      const connectPromises = servers
        .filter((server: any) => server.enabled)
        .map(async (server: any) => {
          const client = getExistingClient(server.id);
          // If no client exists or it's disconnected, try to connect
          if (!client || client.status === "disconnected") {
            try {
              const connectedClient = await ensureClientConnected(
                server.id,
                server.name,
                server.config as MCPServerConfig,
              );
              // Log the final status after connection attempt
              console.log(
                `[IPC] Auto-connect for ${server.name}: status = ${connectedClient.status}`,
              );
            } catch (error: any) {
              // Check status after error - OAuth errors set status to "authorizing"
              const clientAfterError = getExistingClient(server.id);
              const statusAfterError = clientAfterError?.status;

              if (statusAfterError === "authorizing") {
                console.log(
                  `[IPC] OAuth authorization required for ${server.name} - status set to authorizing`,
                );
                return;
              }

              // OAuth errors are expected - they set status to "authorizing"
              if (
                error?.name === "OAuthAuthorizationRequiredError" ||
                error?.message?.includes("OAuth")
              ) {
                console.log(
                  `[IPC] OAuth authorization required for ${server.name}`,
                );
                // Status should now be "authorizing" - this is correct
                return;
              }
              // For other errors, log but don't fail - status will remain "disconnected"
              console.log(
                `[IPC] Auto-connect failed for ${server.name}:`,
                error?.message || error,
              );
            }
          }
        });

      // Wait for all connection attempts (with timeout)
      await Promise.allSettled(connectPromises);

      return servers.map((server: any) => {
        // Use shared service to get client status
        // The MCPClient.status getter now properly handles "authorizing" state
        // via the needsOAuthAuthorization flag, so we can trust client.status directly
        const client = getExistingClient(server.id);
        const finalStatus = client?.status || "disconnected";

        // Log status for debugging (only for known OAuth servers)
        if (server.name === "github" || server.name === "GitHub") {
          console.log(
            `[IPC] Server ${server.name} status: ${finalStatus}, has client: ${!!client}, toolInfo: ${client?.toolInfo?.length || 0}`,
          );
        }

        return {
          ...server,
          status: finalStatus,
          toolInfo: client?.toolInfo || [],
        };
      });
    } catch (error) {
      console.error("[IPC] Error getting MCP servers with status:", error);
      return [];
    }
  });

  // Authorize MCP client (get OAuth authorization URL)
  ipcMain.handle("db:mcp:authorize", async (_event, serverId: string) => {
    try {
      const [server] = await db
        .select()
        .from(schema.McpServerTable)
        .where(eq(schema.McpServerTable.id, serverId))
        .limit(1);

      if (!server) {
        return { success: false, error: "Server not found" };
      }

      const client = await getMcpClient(
        serverId,
        server.name,
        server.config as MCPServerConfig,
      );

      // If client already has an authorization URL, return it
      if (client.status === "authorizing") {
        const authUrl = client.getAuthorizationUrl?.();
        if (authUrl) {
          return {
            success: true,
            authUrl: authUrl.toString(),
            needsAuth: true,
          };
        }

        // Status is authorizing but no URL - this happens with servers that don't support dynamic registration
        // Try to force OAuth provider creation to get the URL
        console.log(
          `[IPC] Client is authorizing but no URL - attempting to get OAuth URL for ${server.name}`,
        );
      }

      // Try to connect which will trigger OAuth flow if needed
      // This is necessary because some servers require connecting to discover OAuth endpoints
      try {
        await client.connect();

        // Check if connection succeeded
        if (client.status === "connected") {
          return { success: true, needsAuth: false };
        }

        // Check if OAuth is now required
        if (client.status === "authorizing") {
          const authUrl = client.getAuthorizationUrl?.();
          if (authUrl) {
            return {
              success: true,
              authUrl: authUrl.toString(),
              needsAuth: true,
            };
          }
          // Status is authorizing but no URL - OAuth is required but URL not available
          // This happens with servers that don't support dynamic registration
          return {
            success: false,
            error:
              "OAuth authorization required but authorization URL not available. This server doesn't support automatic client registration. Please check the server documentation for manual OAuth setup instructions.",
          };
        }

        return { success: true, needsAuth: false };
      } catch (error: any) {
        // Re-check status after connect attempt (may have changed to authorizing)
        const statusAfterConnect = client.status as
          | "loading"
          | "authorizing"
          | "connected"
          | "disconnected";
        if (statusAfterConnect === "authorizing") {
          const authUrl = client.getAuthorizationUrl?.();
          if (authUrl) {
            return {
              success: true,
              authUrl: authUrl.toString(),
              needsAuth: true,
            };
          }
          // Status is authorizing but no URL
          return {
            success: false,
            error:
              "OAuth authorization required but authorization URL not available. This server doesn't support automatic client registration.",
          };
        }

        // If error is about incompatible auth server, return helpful message
        if (
          error?.message?.includes("Incompatible auth server") ||
          error?.message?.includes(
            "does not support dynamic client registration",
          )
        ) {
          return {
            success: false,
            error:
              "This MCP server requires OAuth but doesn't support automatic client registration. Please check the server documentation for manual OAuth setup instructions.",
          };
        }

        throw error;
      }
    } catch (error: any) {
      console.error("[IPC] Error authorizing MCP client:", error);
      return { success: false, error: error.message };
    }
  });

  // Check if MCP client has valid OAuth token
  ipcMain.handle("db:mcp:checkToken", async (_event, serverId: string) => {
    try {
      const client = getExistingClient(serverId);
      if (!client) {
        return { valid: false, reason: "Client not initialized" };
      }

      // Check if client is connected (implies valid token)
      if (client.status === "connected") {
        return { valid: true };
      }

      if (client.status === "authorizing") {
        return { valid: false, reason: "Authorization required" };
      }

      return { valid: false, reason: "Not connected" };
    } catch (error: any) {
      console.error("[IPC] Error checking MCP token:", error);
      return { valid: false, reason: error.message };
    }
  });

  // Finish OAuth flow with authorization code
  ipcMain.handle(
    "db:mcp:finishOAuth",
    async (_event, data: { code: string; state: string }) => {
      try {
        const { code, state } = data;

        if (!code || !state) {
          return { success: false, error: "Missing code or state parameter" };
        }

        // Find the server that has this OAuth state
        // We need to check all clients to find which one has this state
        const servers = await db.select().from(schema.McpServerTable);

        for (const server of servers) {
          const client = getExistingClient(server.id);
          if (client && client.status === "authorizing") {
            try {
              // Try to finish auth with this client
              // The client will validate the state internally
              await client.finishAuth(code, state);

              // Status changes after finishAuth - re-read it
              // Cast is needed because TypeScript narrowed the type based on earlier check
              const newStatus = client.status as string;
              console.log(
                `[IPC] OAuth completed for ${server.name}, new status: ${newStatus}`,
              );

              // Refresh to get tools
              if (newStatus === "connected") {
                await client.updateToolInfo?.();
              }

              return {
                success: true,
                serverId: server.id,
                serverName: server.name,
                status: client.status,
                toolInfo: client.toolInfo || [],
              };
            } catch (authError: any) {
              // State mismatch or other error - try next server
              if (authError?.message?.includes("state")) {
                continue;
              }
              // Other error - report it
              console.error(
                `[IPC] OAuth finish error for ${server.name}:`,
                authError,
              );
              return { success: false, error: authError.message };
            }
          }
        }

        return {
          success: false,
          error:
            "No MCP server found awaiting OAuth authorization with matching state",
        };
      } catch (error: any) {
        console.error("[IPC] Error finishing OAuth:", error);
        return { success: false, error: error.message };
      }
    },
  );

  console.log("[IPC] MCP handlers registered");
}
