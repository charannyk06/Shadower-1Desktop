import { ipcMain } from 'electron';
import { getDatabase, schema } from '../services/database';
import { eq, desc } from 'drizzle-orm';

export function registerAgentHandlers() {
  const db = getDatabase();

  // Get all agents for a user
  ipcMain.handle('db:agents:getAll', async (event, userId: string) => {
    try {
      const agents = await db
        .select()
        .from(schema.AgentTable)
        .where(eq(schema.AgentTable.userId, userId))
        .orderBy(desc(schema.AgentTable.createdAt));

      return agents;
    } catch (error) {
      console.error('[IPC] Error getting agents:', error);
      throw error;
    }
  });

  // Get agent by ID
  ipcMain.handle('db:agents:getById', async (event, id: string) => {
    try {
      const agent = await db.query.AgentTable.findFirst({
        where: eq(schema.AgentTable.id, id),
      });

      return agent;
    } catch (error) {
      console.error('[IPC] Error getting agent:', error);
      throw error;
    }
  });

  // Create a new agent
  ipcMain.handle('db:agents:create', async (event, data: any) => {
    try {
      const [agent] = await db
        .insert(schema.AgentTable)
        .values({
          name: data.name,
          description: data.description,
          icon: data.icon,
          userId: data.userId,
          instructions: data.instructions,
          visibility: data.visibility || 'private',
        })
        .returning();

      return agent;
    } catch (error) {
      console.error('[IPC] Error creating agent:', error);
      throw error;
    }
  });

  // Update an agent
  ipcMain.handle('db:agents:update', async (event, id: string, data: any) => {
    try {
      const [agent] = await db
        .update(schema.AgentTable)
        .set({
          name: data.name,
          description: data.description,
          icon: data.icon,
          instructions: data.instructions,
          visibility: data.visibility,
          updatedAt: new Date(),
        })
        .where(eq(schema.AgentTable.id, id))
        .returning();

      return agent;
    } catch (error) {
      console.error('[IPC] Error updating agent:', error);
      throw error;
    }
  });

  // Delete an agent
  ipcMain.handle('db:agents:delete', async (event, id: string) => {
    try {
      await db.delete(schema.AgentTable).where(eq(schema.AgentTable.id, id));

      return { success: true };
    } catch (error) {
      console.error('[IPC] Error deleting agent:', error);
      throw error;
    }
  });

  console.log('[IPC] Agent handlers registered');
}
