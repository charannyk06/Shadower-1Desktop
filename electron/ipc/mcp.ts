import { ipcMain } from 'electron';
import { getDatabase, schema } from '../services/database';
import { eq } from 'drizzle-orm';

export function registerMcpHandlers() {
  const db = getDatabase();

  // Get all MCP servers
  ipcMain.handle('db:mcp:getServers', async () => {
    try {
      const servers = await db.select().from(schema.McpServerTable);

      return servers;
    } catch (error) {
      console.error('[IPC] Error getting MCP servers:', error);
      throw error;
    }
  });

  // Save MCP server (create or update)
  ipcMain.handle('db:mcp:saveServer', async (event, data: any) => {
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
          })
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
            visibility: data.visibility || 'private',
          })
          .returning();

        return server;
      }
    } catch (error) {
      console.error('[IPC] Error saving MCP server:', error);
      throw error;
    }
  });

  // Delete MCP server
  ipcMain.handle('db:mcp:deleteServer', async (event, id: string) => {
    try {
      await db.delete(schema.McpServerTable).where(eq(schema.McpServerTable.id, id));

      return { success: true };
    } catch (error) {
      console.error('[IPC] Error deleting MCP server:', error);
      throw error;
    }
  });

  // Get MCP tool customizations
  ipcMain.handle('db:mcp:getToolCustomizations', async (event, serverId: string) => {
    try {
      const customizations = await db
        .select()
        .from(schema.McpToolCustomizationTable)
        .where(eq(schema.McpToolCustomizationTable.serverId, serverId));

      return customizations;
    } catch (error) {
      console.error('[IPC] Error getting MCP tool customizations:', error);
      throw error;
    }
  });

  // Save MCP tool customization
  ipcMain.handle('db:mcp:saveToolCustomization', async (event, data: any) => {
    try {
      if (data.id) {
        // Update
        const [customization] = await db
          .update(schema.McpToolCustomizationTable)
          .set({
            displayName: data.displayName,
            description: data.description,
            enabled: data.enabled,
            updatedAt: new Date(),
          })
          .where(eq(schema.McpToolCustomizationTable.id, data.id))
          .returning();

        return customization;
      } else {
        // Create
        const [customization] = await db
          .insert(schema.McpToolCustomizationTable)
          .values({
            userId: data.userId,
            serverId: data.serverId,
            toolName: data.toolName,
            displayName: data.displayName,
            description: data.description,
            enabled: data.enabled !== undefined ? data.enabled : true,
          })
          .returning();

        return customization;
      }
    } catch (error) {
      console.error('[IPC] Error saving MCP tool customization:', error);
      throw error;
    }
  });

  console.log('[IPC] MCP handlers registered');
}
