import { ipcMain, IpcMainInvokeEvent } from "electron";
import { getDatabase, schema } from "../services/database";
import { eq, desc, inArray, and } from "drizzle-orm";
import { ElectronAuthService } from "../services/auth";

// Track active workflow executions for cancellation
const activeWorkflowExecutions = new Map<string, AbortController>();

// SECURITY: Helper to require authenticated user
async function requireAuth(authService: ElectronAuthService) {
  const user = await authService.getCurrentUser();
  if (!user) {
    throw new Error("Authentication required");
  }
  return user;
}

export function registerWorkflowHandlers() {
  const db = getDatabase();
  const authService = ElectronAuthService.getInstance();

  // Get all workflows for authenticated user
  // SECURITY: Uses authenticated user's ID, not client-provided userId
  ipcMain.handle("db:workflows:getAll", async (_event, _userId: string) => {
    try {
      const user = await requireAuth(authService);

      const workflows = await db
        .select({
          id: schema.WorkflowTable.id,
          name: schema.WorkflowTable.name,
          description: schema.WorkflowTable.description,
          icon: schema.WorkflowTable.icon,
          isPublished: schema.WorkflowTable.isPublished,
          userId: schema.WorkflowTable.userId,
          updatedAt: schema.WorkflowTable.updatedAt,
          createdAt: schema.WorkflowTable.createdAt,
        })
        .from(schema.WorkflowTable)
        .where(eq(schema.WorkflowTable.userId, user.id)) // SECURITY: Use authenticated user's ID
        .orderBy(desc(schema.WorkflowTable.createdAt));

      return workflows;
    } catch (error) {
      console.error("[IPC] Error getting workflows:", error);
      throw error;
    }
  });

  // Get workflow by ID with nodes and edges
  // SECURITY: Verifies user owns the workflow before returning
  ipcMain.handle("db:workflows:getById", async (_event, id: string) => {
    try {
      const user = await requireAuth(authService);

      // SECURITY: Only return workflow if user owns it
      const [workflow] = await db
        .select()
        .from(schema.WorkflowTable)
        .where(
          and(
            eq(schema.WorkflowTable.id, id),
            eq(schema.WorkflowTable.userId, user.id),
          ),
        )
        .limit(1);

      if (!workflow) {
        return null; // Don't reveal if workflow exists but user doesn't own it
      }

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
  // SECURITY: Verifies user owns the workflow before updating
  ipcMain.handle(
    "db:workflows:update",
    async (_event, id: string, data: any) => {
      try {
        const user = await requireAuth(authService);

        // SECURITY: Only update if user owns the workflow
        const [workflow] = await db
          .update(schema.WorkflowTable)
          .set({
            name: data.name,
            description: data.description,
            icon: data.icon,
            isPublished: data.isPublished,
            updatedAt: new Date(),
          } as Partial<typeof schema.WorkflowTable.$inferInsert>)
          .where(
            and(
              eq(schema.WorkflowTable.id, id),
              eq(schema.WorkflowTable.userId, user.id),
            ),
          )
          .returning();

        if (!workflow) {
          throw new Error("Workflow not found or access denied");
        }

        return workflow;
      } catch (error) {
        console.error("[IPC] Error updating workflow:", error);
        throw error;
      }
    },
  );

  // Delete a workflow (cascade will delete nodes and edges)
  // SECURITY: Verifies user owns the workflow before deleting
  ipcMain.handle("db:workflows:delete", async (_event, id: string) => {
    try {
      const user = await requireAuth(authService);

      // SECURITY: Only delete if user owns the workflow
      await db
        .delete(schema.WorkflowTable)
        .where(
          and(
            eq(schema.WorkflowTable.id, id),
            eq(schema.WorkflowTable.userId, user.id),
          ),
        );

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

  // Execute a workflow with streaming events
  // This is the core streaming execution for desktop mode
  ipcMain.handle(
    "workflow:execute",
    async (
      event: IpcMainInvokeEvent,
      workflowId: string,
      input: Record<string, any>,
    ) => {
      try {
        const user = await requireAuth(authService);

        // Get the workflow with nodes and edges
        const [workflow] = await db
          .select()
          .from(schema.WorkflowTable)
          .where(
            and(
              eq(schema.WorkflowTable.id, workflowId),
              eq(schema.WorkflowTable.userId, user.id),
            ),
          )
          .limit(1);

        if (!workflow) {
          throw new Error("Workflow not found or access denied");
        }

        const nodes = await db
          .select()
          .from(schema.WorkflowNodeDataTable)
          .where(eq(schema.WorkflowNodeDataTable.workflowId, workflowId));

        const edges = await db
          .select()
          .from(schema.WorkflowEdgeTable)
          .where(eq(schema.WorkflowEdgeTable.workflowId, workflowId));

        // Set up abort controller for cancellation
        const abortController = new AbortController();
        activeWorkflowExecutions.set(workflowId, abortController);

        // Dynamic import to avoid bundling issues
        const { createWorkflowExecutor } = await import(
          "../../src/lib/ai/workflow/executor/workflow-executor"
        );

        // Create executor with nodes and edges
        // Map null to undefined for optional fields
        const executor = createWorkflowExecutor({
          nodes: nodes.map((n) => ({
            ...n,
            description: n.description ?? undefined,
            createdAt: n.createdAt ?? new Date(),
            updatedAt: n.updatedAt ?? new Date(),
            nodeConfig: n.nodeConfig as any,
            uiConfig: n.uiConfig as any,
          })),
          edges: edges.map((e) => ({
            ...e,
            createdAt: e.createdAt ?? new Date(),
            uiConfig: e.uiConfig as any,
          })),
          userId: user.id,
        });

        // Execute and stream events back to renderer
        console.log(`[Workflow IPC] Starting execution of workflow ${workflowId}`);

        try {
          // Subscribe to workflow events and forward them to the renderer
          executor.subscribe((graphEvent: any) => {
            // Check if aborted
            if (abortController.signal.aborted) {
              return;
            }

            // Send event to renderer
            event.sender.send("workflow:event", {
              workflowId,
              event: graphEvent,
            });
          });

          // Execute the workflow with the input
          const result = await executor.run(input);

          console.log(`[Workflow IPC] Execution completed for ${workflowId}`);

          // Send completion event with result
          event.sender.send("workflow:event", {
            workflowId,
            event: { type: "complete", result },
          });

          return { success: true };
        } finally {
          // Clean up
          activeWorkflowExecutions.delete(workflowId);
        }
      } catch (error) {
        console.error("[Workflow IPC] Execution error:", error);

        // Send error event
        event.sender.send("workflow:event", {
          workflowId,
          event: {
            type: "error",
            error: error instanceof Error ? error.message : "Unknown error",
          },
        });

        throw error;
      }
    },
  );

  // Cancel a running workflow execution
  ipcMain.handle("workflow:cancel", async (_event, workflowId: string) => {
    const controller = activeWorkflowExecutions.get(workflowId);
    if (controller) {
      controller.abort();
      activeWorkflowExecutions.delete(workflowId);
      console.log(`[Workflow IPC] Cancelled execution of ${workflowId}`);
      return { success: true, cancelled: true };
    }
    return { success: true, cancelled: false };
  });

  console.log("[IPC] Workflow handlers registered");
}
