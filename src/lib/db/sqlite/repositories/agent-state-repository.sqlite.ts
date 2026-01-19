import {
  AgentState,
  AgentStateCreate,
  AgentStateRepository,
  AgentStateUpdate,
} from "app-types/agent-state";
import { eq, lt } from "drizzle-orm";
import { generateUUID } from "lib/utils";
import { sqliteDb as db } from "../db.sqlite";
import { AgentStateTable } from "../schema.sqlite";

export const sqliteAgentStateRepository: AgentStateRepository = {
  async create(data: AgentStateCreate): Promise<AgentState> {
    const [result] = await db
      .insert(AgentStateTable)
      .values({
        id: generateUUID(),
        userId: data.userId,
        threadId: data.threadId ?? null,
        planData: data.planData,
        sharedContext: data.sharedContext,
        status: data.status ?? "planning",
        errorMessage: null,
        stepsExecuted: 0,
        maxSteps: data.maxSteps ?? 50,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return mapEntityToAgentState(result);
  },

  async getById(id: string): Promise<AgentState | null> {
    const [result] = await db
      .select()
      .from(AgentStateTable)
      .where(eq(AgentStateTable.id, id));

    if (!result) return null;
    return mapEntityToAgentState(result);
  },

  async getByThreadId(threadId: string): Promise<AgentState | null> {
    const [result] = await db
      .select()
      .from(AgentStateTable)
      .where(eq(AgentStateTable.threadId, threadId));

    if (!result) return null;
    return mapEntityToAgentState(result);
  },

  async getActiveByUserId(userId: string): Promise<AgentState[]> {
    const activeStatuses = ["planning", "executing", "paused"] as const;
    const results = await db
      .select()
      .from(AgentStateTable)
      .where(eq(AgentStateTable.userId, userId));

    // Filter by status
    return results
      .filter((entity) => activeStatuses.includes(entity.status as any))
      .map(mapEntityToAgentState);
  },

  async update(id: string, data: AgentStateUpdate): Promise<AgentState> {
    const updateData: Partial<typeof AgentStateTable.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (data.planData !== undefined) updateData.planData = data.planData;
    if (data.sharedContext !== undefined)
      updateData.sharedContext = data.sharedContext;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.errorMessage !== undefined)
      updateData.errorMessage = data.errorMessage;
    if (data.stepsExecuted !== undefined)
      updateData.stepsExecuted = data.stepsExecuted;

    const [result] = await db
      .update(AgentStateTable)
      .set(updateData)
      .where(eq(AgentStateTable.id, id))
      .returning();

    if (!result) {
      throw new Error(`AgentState with id ${id} not found`);
    }

    return mapEntityToAgentState(result);
  },

  async delete(id: string): Promise<void> {
    await db.delete(AgentStateTable).where(eq(AgentStateTable.id, id));
  },

  async deleteOlderThan(olderThanDays: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    // Get all states older than cutoff with completed/failed status
    const completedStatuses = ["completed", "failed"];
    const results = await db
      .select()
      .from(AgentStateTable)
      .where(lt(AgentStateTable.updatedAt, cutoffDate));

    // Filter by status
    const toDelete = results.filter((entity) =>
      completedStatuses.includes(entity.status),
    );

    // Delete each one
    for (const entity of toDelete) {
      await db.delete(AgentStateTable).where(eq(AgentStateTable.id, entity.id));
    }

    return toDelete.length;
  },

  async incrementSteps(id: string): Promise<boolean> {
    // Get current state
    const [current] = await db
      .select()
      .from(AgentStateTable)
      .where(eq(AgentStateTable.id, id));

    if (!current) return false;

    const newStepsExecuted = (current.stepsExecuted || 0) + 1;

    await db
      .update(AgentStateTable)
      .set({
        stepsExecuted: newStepsExecuted,
        updatedAt: new Date(),
      })
      .where(eq(AgentStateTable.id, id));

    // Return true if we can continue (haven't reached max)
    return newStepsExecuted < (current.maxSteps || 50);
  },
};

function mapEntityToAgentState(
  entity: typeof AgentStateTable.$inferSelect,
): AgentState {
  return {
    id: entity.id,
    userId: entity.userId,
    threadId: entity.threadId ?? undefined,
    planData: entity.planData ?? undefined,
    sharedContext: entity.sharedContext ?? undefined,
    status: entity.status,
    errorMessage: entity.errorMessage ?? undefined,
    stepsExecuted: entity.stepsExecuted,
    maxSteps: entity.maxSteps,
    createdAt: entity.createdAt ?? new Date(),
    updatedAt: entity.updatedAt ?? new Date(),
  };
}
