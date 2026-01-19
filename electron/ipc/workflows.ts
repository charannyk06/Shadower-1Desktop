import { ipcMain } from "electron";
import { getDatabase, schema } from "../services/database";
import { eq, desc } from "drizzle-orm";

export function registerWorkflowHandlers() {
  const db = getDatabase();

  // Get all workflows for a user
  ipcMain.handle("db:workflows:getAll", async (_event, userId: string) => {
    try {
      const workflows = await db
        .select()
        .from(schema.WorkflowTable)
        .where(eq(schema.WorkflowTable.userId, userId))
        .orderBy(desc(schema.WorkflowTable.createdAt));

      return workflows;
    } catch (error) {
      console.error("[IPC] Error getting workflows:", error);
      throw error;
    }
  });

  // Get workflow by ID with nodes and edges
  ipcMain.handle("db:workflows:getById", async (_event, id: string) => {
    try {
      const [workflow] = await db
        .select()
        .from(schema.WorkflowTable)
        .where(eq(schema.WorkflowTable.id, id))
        .limit(1);

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
      console.error("[IPC] Error getting workflow:", error);
      throw error;
    }
  });

  // Create a new workflow
  ipcMain.handle("db:workflows:create", async (_event, data: any) => {
    try {
      const [workflow] = await db
        .insert(schema.WorkflowTable)
        .values({
          name: data.name,
          description: data.description,
          userId: data.userId,
          icon: data.icon,
          visibility: data.visibility || "private",
          isPublished: data.isPublished || false,
        } as typeof schema.WorkflowTable.$inferInsert)
        .returning();

      return workflow;
    } catch (error) {
      console.error("[IPC] Error creating workflow:", error);
      throw error;
    }
  });

  // Update a workflow
  ipcMain.handle(
    "db:workflows:update",
    async (_event, id: string, data: any) => {
      try {
        const [workflow] = await db
          .update(schema.WorkflowTable)
          .set({
            name: data.name,
            description: data.description,
            icon: data.icon,
            visibility: data.visibility,
            isPublished: data.isPublished,
            updatedAt: new Date(),
          } as Partial<typeof schema.WorkflowTable.$inferInsert>)
          .where(eq(schema.WorkflowTable.id, id))
          .returning();

        return workflow;
      } catch (error) {
        console.error("[IPC] Error updating workflow:", error);
        throw error;
      }
    },
  );

  // Delete a workflow (cascade will delete nodes and edges)
  ipcMain.handle("db:workflows:delete", async (_event, id: string) => {
    try {
      await db
        .delete(schema.WorkflowTable)
        .where(eq(schema.WorkflowTable.id, id));

      return { success: true };
    } catch (error) {
      console.error("[IPC] Error deleting workflow:", error);
      throw error;
    }
  });

  // Save workflow nodes
  ipcMain.handle(
    "db:workflows:saveNodes",
    async (_event, workflowId: string, nodes: any[]) => {
      try {
        // Delete existing nodes and insert new ones
        await db
          .delete(schema.WorkflowNodeDataTable)
          .where(eq(schema.WorkflowNodeDataTable.workflowId, workflowId));

        if (nodes.length > 0) {
          const nodeInserts = nodes.map(
            (node) =>
              ({
                workflowId,
                kind: node.kind || node.type,
                name: node.name || node.data?.name || "Untitled",
                description: node.description || node.data?.description,
                uiConfig:
                  node.uiConfig || node.position
                    ? { position: node.position }
                    : {},
                nodeConfig: node.nodeConfig || node.data || {},
              }) as typeof schema.WorkflowNodeDataTable.$inferInsert,
          );

          await db.insert(schema.WorkflowNodeDataTable).values(nodeInserts);
        }

        return { success: true };
      } catch (error) {
        console.error("[IPC] Error saving workflow nodes:", error);
        throw error;
      }
    },
  );

  // Save workflow edges
  ipcMain.handle(
    "db:workflows:saveEdges",
    async (_event, workflowId: string, edges: any[]) => {
      try {
        // Delete existing edges and insert new ones
        await db
          .delete(schema.WorkflowEdgeTable)
          .where(eq(schema.WorkflowEdgeTable.workflowId, workflowId));

        if (edges.length > 0) {
          const edgeInserts = edges.map(
            (edge) =>
              ({
                id: edge.id,
                workflowId,
                source: edge.source,
                target: edge.target,
                uiConfig: edge.uiConfig || {},
              }) as typeof schema.WorkflowEdgeTable.$inferInsert,
          );

          await db.insert(schema.WorkflowEdgeTable).values(edgeInserts);
        }

        return { success: true };
      } catch (error) {
        console.error("[IPC] Error saving workflow edges:", error);
        throw error;
      }
    },
  );

  console.log("[IPC] Workflow handlers registered");
}
