import { ipcMain } from 'electron';
import { getDatabase, schema } from '../services/database';
import { eq, desc } from 'drizzle-orm';

export function registerWorkflowHandlers() {
  const db = getDatabase();

  // Get all workflows for a user
  ipcMain.handle('db:workflows:getAll', async (event, userId: string) => {
    try {
      const workflows = await db
        .select()
        .from(schema.WorkflowTable)
        .where(eq(schema.WorkflowTable.userId, userId))
        .orderBy(desc(schema.WorkflowTable.createdAt));

      return workflows;
    } catch (error) {
      console.error('[IPC] Error getting workflows:', error);
      throw error;
    }
  });

  // Get workflow by ID
  ipcMain.handle('db:workflows:getById', async (event, id: string) => {
    try {
      const workflow = await db.query.WorkflowTable.findFirst({
        where: eq(schema.WorkflowTable.id, id),
      });

      // Also get nodes and edges
      if (workflow) {
        const nodes = await db
          .select()
          .from(schema.WorkflowNodeDataTable)
          .where(eq(schema.WorkflowNodeDataTable.workflowId, id));

        const edges = await db
          .select()
          .from(schema.WorkflowEdgeTable)
          .where(eq(schema.WorkflowEdgeTable.workflowId, id));

        return {
          ...workflow,
          nodes,
          edges,
        };
      }

      return workflow;
    } catch (error) {
      console.error('[IPC] Error getting workflow:', error);
      throw error;
    }
  });

  // Create a new workflow
  ipcMain.handle('db:workflows:create', async (event, data: any) => {
    try {
      const [workflow] = await db
        .insert(schema.WorkflowTable)
        .values({
          name: data.name,
          description: data.description,
          userId: data.userId,
          data: data.data,
          visibility: data.visibility || 'private',
        })
        .returning();

      return workflow;
    } catch (error) {
      console.error('[IPC] Error creating workflow:', error);
      throw error;
    }
  });

  // Update a workflow
  ipcMain.handle('db:workflows:update', async (event, id: string, data: any) => {
    try {
      const [workflow] = await db
        .update(schema.WorkflowTable)
        .set({
          name: data.name,
          description: data.description,
          data: data.data,
          visibility: data.visibility,
          updatedAt: new Date(),
        })
        .where(eq(schema.WorkflowTable.id, id))
        .returning();

      return workflow;
    } catch (error) {
      console.error('[IPC] Error updating workflow:', error);
      throw error;
    }
  });

  // Delete a workflow
  ipcMain.handle('db:workflows:delete', async (event, id: string) => {
    try {
      await db.delete(schema.WorkflowTable).where(eq(schema.WorkflowTable.id, id));

      return { success: true };
    } catch (error) {
      console.error('[IPC] Error deleting workflow:', error);
      throw error;
    }
  });

  console.log('[IPC] Workflow handlers registered');
}
