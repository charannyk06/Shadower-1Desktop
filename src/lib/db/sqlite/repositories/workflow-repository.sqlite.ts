import { ObjectJsonSchema7 } from "app-types/util";
import {
  DBEdge,
  DBNode,
  DBWorkflow,
  WorkflowRepository,
  WorkflowSummary,
} from "app-types/workflow";
import { and, desc, eq, inArray, not, or } from "drizzle-orm";
import { sqliteDb as db } from "../db.sqlite";
import {
  UserTable,
  WorkflowEdgeTable,
  WorkflowNodeDataTable,
  WorkflowTable,
} from "../schema.sqlite";

// Default schema for input nodes
const defaultObjectJsonSchema: ObjectJsonSchema7 = {
  type: "object",
  properties: {},
  required: [],
};

export const sqliteWorkflowRepository: WorkflowRepository = {
  async selectToolByIds(ids) {
    if (!ids.length) return [];
    // SQLite version - simplified query
    const workflows = await db
      .select()
      .from(WorkflowTable)
      .where(inArray(WorkflowTable.id, ids));

    return workflows.map((w) => ({
      id: w.id,
      name: w.name,
      description: w.description ?? undefined,
      schema: defaultObjectJsonSchema,
    }));
  },

  async selectExecuteAbility(userId) {
    const rows = await db
      .select({
        id: WorkflowTable.id,
        name: WorkflowTable.name,
        description: WorkflowTable.description,
        userId: WorkflowTable.userId,
        visibility: WorkflowTable.visibility,
        updatedAt: WorkflowTable.updatedAt,
        userName: UserTable.name,
        userAvatar: UserTable.image,
      })
      .from(WorkflowTable)
      .innerJoin(UserTable, eq(WorkflowTable.userId, UserTable.id))
      .where(
        or(
          eq(WorkflowTable.userId, userId),
          not(eq(WorkflowTable.visibility, "private")),
        ),
      );
    return rows as WorkflowSummary[];
  },

  async selectAll(userId) {
    const rows = await db
      .select({
        id: WorkflowTable.id,
        name: WorkflowTable.name,
        description: WorkflowTable.description,
        userId: WorkflowTable.userId,
        visibility: WorkflowTable.visibility,
        updatedAt: WorkflowTable.updatedAt,
        userName: UserTable.name,
        userAvatar: UserTable.image,
      })
      .from(WorkflowTable)
      .innerJoin(UserTable, eq(WorkflowTable.userId, UserTable.id))
      .where(
        or(
          inArray(WorkflowTable.visibility, ["public", "readonly"]),
          eq(WorkflowTable.userId, userId),
        ),
      )
      .orderBy(desc(WorkflowTable.createdAt));
    return rows as WorkflowSummary[];
  },

  async selectById(id) {
    const [workflow] = await db
      .select()
      .from(WorkflowTable)
      .where(eq(WorkflowTable.id, id));
    if (!workflow) return null as unknown as DBWorkflow;
    return {
      ...workflow,
      createdAt: workflow.createdAt ?? new Date(),
      updatedAt: workflow.updatedAt ?? new Date(),
      version: 1,
      isPublished: false,
    } as unknown as DBWorkflow;
  },

  async checkAccess(workflowId, userId, readOnly = true) {
    const [workflow] = await db
      .select({
        visibility: WorkflowTable.visibility,
        userId: WorkflowTable.userId,
      })
      .from(WorkflowTable)
      .where(eq(WorkflowTable.id, workflowId));
    if (!workflow) {
      return false;
    }
    if (userId == workflow.userId) return true;
    if (workflow.visibility === "private") {
      return false;
    }
    if (workflow.visibility == "readonly" && !readOnly) return false;
    return true;
  },

  async delete(id) {
    await db.delete(WorkflowTable).where(eq(WorkflowTable.id, id));
  },

  async selectByUserId(userId) {
    const rows = await db
      .select()
      .from(WorkflowTable)
      .where(eq(WorkflowTable.userId, userId))
      .orderBy(desc(WorkflowTable.createdAt));
    return rows.map((workflow) => ({
      ...workflow,
      createdAt: workflow.createdAt ?? new Date(),
      updatedAt: workflow.updatedAt ?? new Date(),
      version: 1,
      isPublished: false,
    })) as unknown as DBWorkflow[];
  },

  async save(workflow, _noGenerateInputNode = false) {
    const workflowId = workflow.id ?? crypto.randomUUID();
    const now = new Date();

    // Construct a complete DBWorkflow for the data field
    const completeWorkflow: DBWorkflow = {
      ...workflow,
      id: workflowId,
      createdAt: workflow.createdAt ?? now,
      updatedAt: now,
      visibility: workflow.visibility ?? "private",
      version: workflow.version ?? 1,
      isPublished: workflow.isPublished ?? false,
    } as DBWorkflow;

    const [row] = await db
      .insert(WorkflowTable)
      .values({
        id: workflowId,
        name: workflow.name,
        description: workflow.description ?? null,
        userId: workflow.userId,
        visibility: workflow.visibility ?? "private",
        version: String(workflow.version ?? 1),
        isPublished: workflow.isPublished ?? false,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [WorkflowTable.id],
        set: {
          name: workflow.name,
          description: workflow.description ?? null,
          visibility: workflow.visibility ?? "private",
          version: String(workflow.version ?? 1),
          isPublished: workflow.isPublished ?? false,
          updatedAt: now,
        },
      })
      .returning();

    return {
      ...completeWorkflow,
      createdAt: row.createdAt ?? now,
      updatedAt: row.updatedAt ?? now,
    } as DBWorkflow;
  },

  async saveStructure({ workflowId, nodes, edges, deleteNodes, deleteEdges }) {
    // SQLite doesn't have native transactions via Drizzle the same way
    // Execute operations sequentially
    if (deleteNodes?.length) {
      await db
        .delete(WorkflowNodeDataTable)
        .where(
          and(
            eq(WorkflowNodeDataTable.workflowId, workflowId),
            inArray(WorkflowNodeDataTable.id, deleteNodes),
          ),
        );
    }
    if (deleteEdges?.length) {
      await db
        .delete(WorkflowEdgeTable)
        .where(
          and(
            eq(WorkflowEdgeTable.workflowId, workflowId),
            inArray(WorkflowEdgeTable.id, deleteEdges),
          ),
        );
    }
    if (nodes?.length) {
      for (const node of nodes) {
        // Map DBNode to WorkflowNodeDataTable schema
        const nodeData = {
          id: node.id,
          workflowId: node.workflowId,
          kind: node.kind,
          name: node.name ?? node.kind,
          description: (node as { description?: string }).description ?? null,
          uiConfig: node.uiConfig ?? {},
          nodeConfig: node.nodeConfig ?? {},
          createdAt: node.createdAt ?? new Date(),
          updatedAt: new Date(),
        };
        await db
          .insert(WorkflowNodeDataTable)
          .values(nodeData)
          .onConflictDoUpdate({
            target: [WorkflowNodeDataTable.id],
            set: {
              kind: nodeData.kind,
              name: nodeData.name,
              uiConfig: nodeData.uiConfig,
              nodeConfig: nodeData.nodeConfig,
              updatedAt: new Date(),
            },
          });
      }
    }
    if (edges?.length) {
      for (const edge of edges) {
        await db.insert(WorkflowEdgeTable).values(edge).onConflictDoNothing();
      }
    }
  },

  async selectStructureById(id, _opt) {
    const [workflow] = await db
      .select()
      .from(WorkflowTable)
      .where(eq(WorkflowTable.id, id));

    if (!workflow) return null;

    const nodeRows = await db
      .select()
      .from(WorkflowNodeDataTable)
      .where(eq(WorkflowNodeDataTable.workflowId, id));

    const edgeRows = await db
      .select()
      .from(WorkflowEdgeTable)
      .where(eq(WorkflowEdgeTable.workflowId, id));

    // Map WorkflowNodeDataTable rows back to DBNode type
    const nodes: DBNode[] = nodeRows.map((row) => ({
      id: row.id,
      workflowId: row.workflowId,
      kind: row.kind,
      name: row.name,
      nodeConfig: row.nodeConfig ?? {},
      uiConfig: row.uiConfig ?? {},
      createdAt: row.createdAt ?? new Date(),
      updatedAt: row.updatedAt ?? new Date(),
    }));

    // Map WorkflowEdgeTable rows back to DBEdge type
    const edges: DBEdge[] = edgeRows.map((row) => ({
      id: row.id,
      workflowId: row.workflowId,
      source: row.source,
      target: row.target,
      uiConfig: row.uiConfig ?? {},
      createdAt: row.createdAt ?? new Date(),
    }));

    return {
      ...workflow,
      createdAt: workflow.createdAt ?? new Date(),
      updatedAt: workflow.updatedAt ?? new Date(),
      version: 1,
      isPublished: false,
      nodes,
      edges,
    } as unknown as DBWorkflow & { nodes: DBNode[]; edges: DBEdge[] };
  },
};
