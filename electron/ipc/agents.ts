import { ipcMain } from "electron";
import { getDatabase, schema } from "../services/database";
import { eq, desc } from "drizzle-orm";

export function registerAgentHandlers() {
  const db = getDatabase();

  // Get all agents for a user
  ipcMain.handle("db:agents:getAll", async (_event, userId: string) => {
    try {
      const agents = await db
        .select()
        .from(schema.AgentTable)
        .where(eq(schema.AgentTable.userId, userId))
        .orderBy(desc(schema.AgentTable.createdAt));

      return agents;
    } catch (error) {
      console.error("[IPC] Error getting agents:", error);
      throw error;
    }
  });

  // Select agents with filters - single-user mode: only return user's own agents
  ipcMain.handle(
    "db:agents:selectAgents",
    async (
      _event,
      currentUserId: string,
      _filters: string[] = ["all"],
      limit: number = 50,
    ) => {
      try {
        // Single-user mode: always return only user's own agents
        const results = await db
          .select({
            id: schema.AgentTable.id,
            name: schema.AgentTable.name,
            description: schema.AgentTable.description,
            icon: schema.AgentTable.icon,
            userId: schema.AgentTable.userId,
            createdAt: schema.AgentTable.createdAt,
            updatedAt: schema.AgentTable.updatedAt,
          })
          .from(schema.AgentTable)
          .where(eq(schema.AgentTable.userId, currentUserId))
          .orderBy(desc(schema.AgentTable.createdAt))
          .limit(limit);

        return results.map((result) => ({
          ...result,
          description: result.description ?? undefined,
          icon: result.icon ?? undefined,
          createdAt: result.createdAt ?? new Date(),
          updatedAt: result.updatedAt ?? new Date(),
        }));
      } catch (error) {
        console.error("[IPC] Error selecting agents:", error);
        throw error;
      }
    },
  );

  // Get agent by ID
  ipcMain.handle("db:agents:getById", async (_event, id: string) => {
    try {
      const [agent] = await db
        .select()
        .from(schema.AgentTable)
        .where(eq(schema.AgentTable.id, id))
        .limit(1);

      return agent || null;
    } catch (error) {
      console.error("[IPC] Error getting agent:", error);
      throw error;
    }
  });

  // Create a new agent
  ipcMain.handle("db:agents:create", async (_event, data: any) => {
    try {
      const [agent] = await db
        .insert(schema.AgentTable)
        .values({
          name: data.name,
          description: data.description,
          icon: data.icon,
          userId: data.userId,
          instructions: data.instructions,
        } as typeof schema.AgentTable.$inferInsert)
        .returning();

      return agent;
    } catch (error) {
      console.error("[IPC] Error creating agent:", error);
      throw error;
    }
  });

  // Update an agent
  ipcMain.handle("db:agents:update", async (_event, id: string, data: any) => {
    try {
      const [agent] = await db
        .update(schema.AgentTable)
        .set({
          name: data.name,
          description: data.description,
          icon: data.icon,
          instructions: data.instructions,
          updatedAt: new Date(),
        } as Partial<typeof schema.AgentTable.$inferInsert>)
        .where(eq(schema.AgentTable.id, id))
        .returning();

      return agent;
    } catch (error) {
      console.error("[IPC] Error updating agent:", error);
      throw error;
    }
  });

  // Delete an agent
  ipcMain.handle("db:agents:delete", async (_event, id: string) => {
    try {
      await db.delete(schema.AgentTable).where(eq(schema.AgentTable.id, id));

      return { success: true };
    } catch (error) {
      console.error("[IPC] Error deleting agent:", error);
      throw error;
    }
  });

  console.log("[IPC] Agent handlers registered");
}
