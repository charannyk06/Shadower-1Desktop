import { Agent, AgentRepository, AgentSummary } from "app-types/agent";
import { and, desc, eq } from "drizzle-orm";
import { generateUUID } from "lib/utils";
import { sqliteDb as db } from "../db.sqlite";
import { AgentTable } from "../schema.sqlite";

export const sqliteAgentRepository: AgentRepository = {
  async insertAgent(agent) {
    const [result] = await db
      .insert(AgentTable)
      .values({
        id: generateUUID(),
        name: agent.name,
        description: agent.description,
        icon: agent.icon,
        userId: agent.userId,
        instructions: agent.instructions,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return {
      ...result,
      description: result.description ?? undefined,
      icon: result.icon ?? undefined,
      instructions: result.instructions ?? {},
      createdAt: result.createdAt ?? new Date(),
      updatedAt: result.updatedAt ?? new Date(),
    };
  },

  async selectAgentById(id, userId): Promise<Agent | null> {
    const [result] = await db
      .select({
        id: AgentTable.id,
        name: AgentTable.name,
        description: AgentTable.description,
        icon: AgentTable.icon,
        userId: AgentTable.userId,
        instructions: AgentTable.instructions,
        createdAt: AgentTable.createdAt,
        updatedAt: AgentTable.updatedAt,
      })
      .from(AgentTable)
      .where(and(eq(AgentTable.id, id), eq(AgentTable.userId, userId)));

    if (!result) return null;

    return {
      ...result,
      description: result.description ?? undefined,
      icon: result.icon ?? undefined,
      instructions: result.instructions ?? {},
      createdAt: result.createdAt ?? new Date(),
      updatedAt: result.updatedAt ?? new Date(),
    };
  },

  async selectAgentsByUserId(userId) {
    const results = await db
      .select({
        id: AgentTable.id,
        name: AgentTable.name,
        description: AgentTable.description,
        icon: AgentTable.icon,
        userId: AgentTable.userId,
        instructions: AgentTable.instructions,
        createdAt: AgentTable.createdAt,
        updatedAt: AgentTable.updatedAt,
      })
      .from(AgentTable)
      .where(eq(AgentTable.userId, userId))
      .orderBy(desc(AgentTable.createdAt));

    return results.map((result) => ({
      ...result,
      description: result.description ?? undefined,
      icon: result.icon ?? undefined,
      instructions: result.instructions ?? {},
      createdAt: result.createdAt ?? new Date(),
      updatedAt: result.updatedAt ?? new Date(),
    }));
  },

  async updateAgent(id, userId, agent) {
    const [result] = await db
      .update(AgentTable)
      .set({
        ...agent,
        updatedAt: new Date(),
      })
      .where(and(eq(AgentTable.id, id), eq(AgentTable.userId, userId)))
      .returning();

    return {
      ...result,
      description: result.description ?? undefined,
      icon: result.icon ?? undefined,
      instructions: result.instructions ?? {},
      createdAt: result.createdAt ?? new Date(),
      updatedAt: result.updatedAt ?? new Date(),
    };
  },

  async deleteAgent(id, userId) {
    await db
      .delete(AgentTable)
      .where(and(eq(AgentTable.id, id), eq(AgentTable.userId, userId)));
  },

  async selectAgents(
    currentUserId,
    _filters = ["all"],
    limit = 50,
  ): Promise<AgentSummary[]> {
    // Single-user mode: always return only user's own agents
    const results = await db
      .select({
        id: AgentTable.id,
        name: AgentTable.name,
        description: AgentTable.description,
        icon: AgentTable.icon,
        userId: AgentTable.userId,
        createdAt: AgentTable.createdAt,
        updatedAt: AgentTable.updatedAt,
      })
      .from(AgentTable)
      .where(eq(AgentTable.userId, currentUserId))
      .orderBy(desc(AgentTable.createdAt))
      .limit(limit);

    return results.map((result) => ({
      ...result,
      description: result.description ?? undefined,
      icon: result.icon ?? undefined,
      createdAt: result.createdAt ?? new Date(),
      updatedAt: result.updatedAt ?? new Date(),
    }));
  },

  async checkAccess(agentId, userId, _destructive = false) {
    // Single-user mode: only owner has access
    const [agent] = await db
      .select({
        userId: AgentTable.userId,
      })
      .from(AgentTable)
      .where(eq(AgentTable.id, agentId));

    if (!agent) {
      return false;
    }
    return userId === agent.userId;
  },
};
