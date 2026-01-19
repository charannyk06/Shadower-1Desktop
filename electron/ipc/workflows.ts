import { ipcMain } from "electron";
import { getDatabase, schema } from "../services/database";
import { eq, desc, inArray, and } from "drizzle-orm";

export function registerWorkflowHandlers() {
  const db = getDatabase();

  // Get all workflows for a user - returns WorkflowSummary with user info
  ipcMain.handle("db:workflows:getAll", async (_event, userId: string) => {
    try {
      // Join with user table to get userName and userAvatar for WorkflowSummary
      const workflows = await db
        .select({
          id: schema.WorkflowTable.id,
          name: schema.WorkflowTable.name,
          description: schema.WorkflowTable.description,
          icon: schema.WorkflowTable.icon,
          visibility: schema.WorkflowTable.visibility,
          isPublished: schema.WorkflowTable.isPublished,
          userId: schema.WorkflowTable.userId,
          updatedAt: schema.WorkflowTable.updatedAt,
          createdAt: schema.WorkflowTable.createdAt,
          userName: schema.UserTable.name,
          userAvatar: schema.UserTable.image,
        })
        .from(schema.WorkflowTable)
        .innerJoin(
          schema.UserTable,
          eq(schema.WorkflowTable.userId, schema.UserTable.id),
        )
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

  // Create a new workflow with default Input node only
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

      // Create default Input node for new workflows (user adds Output while building)
      const inputNodeId = crypto.randomUUID();
      const now = new Date();

      const inputNode = {
        id: inputNodeId,
        workflowId: workflow.id,
        kind: "input",
        name: "Input",
        description: "Workflow input",
        uiConfig: { position: { x: 100, y: 200 }, type: "default" },
        nodeConfig: {
          kind: "input",
          id: inputNodeId,
          name: "Input",
          outputSchema: {
            type: "object",
            properties: {},
            required: [],
          },
        },
        createdAt: now,
        updatedAt: now,
      };

      await db
        .insert(schema.WorkflowNodeDataTable)
        .values([
          inputNode as typeof schema.WorkflowNodeDataTable.$inferInsert,
        ]);

      // Return workflow WITH nodes so UI can display them immediately
      return {
        ...workflow,
        nodes: [inputNode],
        edges: [],
      };
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

  // Save workflow structure (handles diffs properly - upserts nodes/edges, deletes removed ones)
  ipcMain.handle(
    "db:workflows:saveStructure",
    async (
      _event,
      workflowId: string,
      data: {
        nodes?: any[];
        edges?: any[];
        deleteNodes?: string[];
        deleteEdges?: string[];
      },
    ) => {
      try {
        const { nodes, edges, deleteNodes, deleteEdges } = data;

        // Delete specified nodes
        if (deleteNodes && deleteNodes.length > 0) {
          await db
            .delete(schema.WorkflowNodeDataTable)
            .where(
              and(
                eq(schema.WorkflowNodeDataTable.workflowId, workflowId),
                inArray(schema.WorkflowNodeDataTable.id, deleteNodes),
              ),
            );
        }

        // Delete specified edges
        if (deleteEdges && deleteEdges.length > 0) {
          await db
            .delete(schema.WorkflowEdgeTable)
            .where(
              and(
                eq(schema.WorkflowEdgeTable.workflowId, workflowId),
                inArray(schema.WorkflowEdgeTable.id, deleteEdges),
              ),
            );
        }

        // Upsert nodes (insert or update)
        if (nodes && nodes.length > 0) {
          for (const node of nodes) {
            const nodeData = {
              id: node.id,
              workflowId,
              kind: node.kind,
              name: node.name || "Untitled",
              description: node.description || null,
              uiConfig: node.uiConfig || {},
              nodeConfig: node.nodeConfig || {},
              updatedAt: new Date(),
            };

            await db
              .insert(schema.WorkflowNodeDataTable)
              .values({
                ...nodeData,
                createdAt: new Date(),
              } as typeof schema.WorkflowNodeDataTable.$inferInsert)
              .onConflictDoUpdate({
                target: schema.WorkflowNodeDataTable.id,
                set: {
                  kind: nodeData.kind,
                  name: nodeData.name,
                  description: nodeData.description,
                  uiConfig: nodeData.uiConfig,
                  nodeConfig: nodeData.nodeConfig,
                  updatedAt: nodeData.updatedAt,
                },
              });
          }
        }

        // Upsert edges (insert or ignore if exists)
        if (edges && edges.length > 0) {
          for (const edge of edges) {
            await db
              .insert(schema.WorkflowEdgeTable)
              .values({
                id: edge.id,
                workflowId,
                source: edge.source,
                target: edge.target,
                uiConfig: edge.uiConfig || {},
                createdAt: new Date(),
              } as typeof schema.WorkflowEdgeTable.$inferInsert)
              .onConflictDoNothing();
          }
        }

        return { success: true };
      } catch (error) {
        console.error("[IPC] Error saving workflow structure:", error);
        throw error;
      }
    },
  );

  console.log("[IPC] Workflow handlers registered");
}
