import { ipcMain } from "electron";
import { getDatabase, schema } from "../services/database";
import { eq } from "drizzle-orm";
import {
  createMCPClient,
  MCPClient,
} from "../../src/lib/ai/mcp/create-mcp-client";
import type { MCPServerConfig } from "../../src/types/mcp";

// Track active MCP clients
const mcpClients = new Map<string, MCPClient>();

/**
 * Get or create an MCP client for a server
 */
async function getMcpClient(
  serverId: string,
  serverName: string,
  config: MCPServerConfig,
): Promise<MCPClient> {
  let client = mcpClients.get(serverId);
  if (!client) {
    client = createMCPClient(serverId, serverName, config, {
      autoDisconnectSeconds: 60 * 30,
    });
    mcpClients.set(serverId, client);
  }
  return client;
}

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
            visibility: data.visibility,
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
            visibility: data.visibility || "private",
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

      // Get or create client
      const client = await getMcpClient(
        serverId,
        server.name,
        server.config as MCPServerConfig,
      );

      // Disconnect and reconnect
      await client.disconnect();
      await client.connect();

      return {
        success: true,
        status: client.status,
        toolInfo: client.toolInfo,
      };
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

        const client = await getMcpClient(
          serverId,
          server.name,
          server.config as MCPServerConfig,
        );

        // Connect if not connected
        if (client.status !== "connected") {
          await client.connect();
        }

        const result = await client.callTool(toolName, args);
        return { success: true, result };
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

        const client = await getMcpClient(
          server.id,
          server.name,
          server.config as MCPServerConfig,
        );

        if (client.status !== "connected") {
          await client.connect();
        }

        const result = await client.callTool(toolName, args);
        return { success: true, result };
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

      const client = mcpClients.get(serverId);

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

  // Update MCP server visibility
  ipcMain.handle(
    "db:mcp:updateVisibility",
    async (
      _event,
      data: { serverId: string; visibility: "public" | "private" },
    ) => {
      try {
        const [server] = await db
          .update(schema.McpServerTable)
          .set({ visibility: data.visibility })
          .where(eq(schema.McpServerTable.id, data.serverId))
          .returning();

        return server;
      } catch (error) {
        console.error("[IPC] Error updating MCP visibility:", error);
        throw error;
      }
    },
  );

  // Get all MCP servers with status
  ipcMain.handle("db:mcp:getServersWithStatus", async () => {
    try {
      const servers = await db.select().from(schema.McpServerTable);

      return servers.map((server: any) => {
        const client = mcpClients.get(server.id);
        return {
          ...server,
          status: client?.status || "disconnected",
          toolInfo: client?.toolInfo || [],
        };
      });
    } catch (error) {
      console.error("[IPC] Error getting MCP servers with status:", error);
      return [];
    }
  });

  console.log("[IPC] MCP handlers registered");
}
