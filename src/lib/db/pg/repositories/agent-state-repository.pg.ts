import {
  AgentState,
  AgentStateCreate,
  AgentStateRepository,
  AgentStateUpdate,
} from "app-types/agent-state";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { generateUUID } from "lib/utils";
import { pgDb as db } from "../db.pg";
import { AgentStateTable } from "../schema.pg";

/**
 * PostgreSQL implementation of AgentStateRepository
 * Provides persistent storage for autonomous agent execution state
 */
export const pgAgentStateRepository: AgentStateRepository = {
  async create(data: AgentStateCreate): Promise<AgentState> {
    const [result] = await db
      .insert(AgentStateTable)
      .values({
        id: generateUUID(),
        userId: data.userId,
        threadId: data.threadId,
        planData: data.planData,
        sharedContext: data.sharedContext,
        status: data.status ?? "planning",
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
    const results = await db
      .select()
      .from(AgentStateTable)
      .where(
        and(
          eq(AgentStateTable.userId, userId),
          inArray(AgentStateTable.status, ["planning", "executing", "paused"]),
        ),
      );

    return results.map(mapEntityToAgentState);
  },

  async update(id: string, data: AgentStateUpdate): Promise<AgentState> {
    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (data.planData !== undefined) {
      updateData.planData = data.planData;
    }
    if (data.sharedContext !== undefined) {
      updateData.sharedContext = data.sharedContext;
    }
    if (data.status !== undefined) {
      updateData.status = data.status;
    }
    if (data.errorMessage !== undefined) {
      updateData.errorMessage = data.errorMessage;
    }
    if (data.stepsExecuted !== undefined) {
      updateData.stepsExecuted = data.stepsExecuted;
    }

    const [result] = await db
      .update(AgentStateTable)
      .set(updateData)
      .where(eq(AgentStateTable.id, id))
      .returning();

    return mapEntityToAgentState(result);
  },

  async delete(id: string): Promise<void> {
    await db.delete(AgentStateTable).where(eq(AgentStateTable.id, id));
  },

  async deleteOlderThan(olderThanDays: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const result = await db
      .delete(AgentStateTable)
      .where(
        and(
          lt(AgentStateTable.updatedAt, cutoffDate),
          inArray(AgentStateTable.status, ["completed", "failed"]),
        ),
      )
      .returning({ id: AgentStateTable.id });

    return result.length;
  },

  async incrementSteps(id: string): Promise<boolean> {
    // Atomically increment steps and check against max
    const [result] = await db
      .update(AgentStateTable)
      .set({
        stepsExecuted: sql`${AgentStateTable.stepsExecuted} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(AgentStateTable.id, id))
      .returning({
        stepsExecuted: AgentStateTable.stepsExecuted,
        maxSteps: AgentStateTable.maxSteps,
      });

    if (!result) return false;

    // Return true if we can continue (haven't reached max)
    return result.stepsExecuted < result.maxSteps;
  },
};

/**
 * Map database entity to AgentState type
 */
function mapEntityToAgentState(
  entity: typeof AgentStateTable.$inferSelect,
): AgentState {
  return {
    id: entity.id,
    userId: entity.userId,
    threadId: entity.threadId,
    planData: entity.planData,
    sharedContext: entity.sharedContext,
    status: entity.status,
    errorMessage: entity.errorMessage,
    stepsExecuted: entity.stepsExecuted,
    maxSteps: entity.maxSteps,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}
