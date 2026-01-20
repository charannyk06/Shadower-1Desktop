import { ipcMain } from "electron";
import { getDatabase, schema } from "../services/database";
import { eq, desc, ne, or, and, sql } from "drizzle-orm";

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

  // Select agents with filters (mine, shared, bookmarked, all) - matches selectAgents from repository
  ipcMain.handle(
    "db:agents:selectAgents",
    async (
      _event,
      currentUserId: string,
      filters: string[] = ["all"],
      limit: number = 50,
    ) => {
      try {
        let orConditions: any[] = [];

        for (const filter of filters) {
          if (filter === "mine") {
            orConditions.push(eq(schema.AgentTable.userId, currentUserId));
          } else if (filter === "shared") {
            orConditions.push(
              and(
                ne(schema.AgentTable.userId, currentUserId),
                or(
                  eq(schema.AgentTable.visibility, "public"),
                  eq(schema.AgentTable.visibility, "readonly"),
                ),
              ),
            );
          } else if (filter === "bookmarked") {
            orConditions.push(
              and(
                ne(schema.AgentTable.userId, currentUserId),
                or(
                  eq(schema.AgentTable.visibility, "public"),
                  eq(schema.AgentTable.visibility, "readonly"),
                ),
                sql`${schema.BookmarkTable.id} IS NOT NULL`,
              ),
            );
          } else if (filter === "all") {
            orConditions = [
              or(
                eq(schema.AgentTable.userId, currentUserId),
                and(
                  ne(schema.AgentTable.userId, currentUserId),
                  or(
                    eq(schema.AgentTable.visibility, "public"),
                    eq(schema.AgentTable.visibility, "readonly"),
                  ),
                ),
              ),
            ];
            break;
          }
        }

        const results = await db
          .select({
            id: schema.AgentTable.id,
            name: schema.AgentTable.name,
            description: schema.AgentTable.description,
            icon: schema.AgentTable.icon,
            userId: schema.AgentTable.userId,
            visibility: schema.AgentTable.visibility,
            createdAt: schema.AgentTable.createdAt,
            updatedAt: schema.AgentTable.updatedAt,
            userName: schema.UserTable.name,
            userAvatar: schema.UserTable.image,
            isBookmarked: sql<boolean>`CASE WHEN ${schema.BookmarkTable.id} IS NOT NULL THEN 1 ELSE 0 END`,
          })
          .from(schema.AgentTable)
          .innerJoin(
            schema.UserTable,
            eq(schema.AgentTable.userId, schema.UserTable.id),
          )
          .leftJoin(
            schema.BookmarkTable,
            and(
              eq(schema.BookmarkTable.itemId, schema.AgentTable.id),
              eq(schema.BookmarkTable.itemType, "agent"),
              eq(schema.BookmarkTable.userId, currentUserId),
            ),
          )
          .where(
            orConditions.length > 1 ? or(...orConditions) : orConditions[0],
          )
          .orderBy(
            sql`CASE WHEN ${schema.AgentTable.userId} = ${currentUserId} THEN 0 ELSE 1 END`,
            desc(schema.AgentTable.createdAt),
          )
          .limit(limit);

        return results.map((result) => ({
          ...result,
          description: result.description ?? undefined,
          icon: result.icon ?? undefined,
          userName: result.userName ?? undefined,
          userAvatar: result.userAvatar ?? undefined,
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
      // Use select query instead of db.query which may not be available
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
          visibility: data.visibility || "private",
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
          visibility: data.visibility,
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

  // Toggle bookmark for an item (agent, workflow, or mcp)
  ipcMain.handle(
    "db:bookmark:toggle",
    async (
      _event,
      userId: string,
      itemId: string,
      itemType: "agent" | "workflow" | "mcp",
      isCurrentlyBookmarked: boolean,
    ) => {
      try {
        if (isCurrentlyBookmarked) {
          // Remove bookmark
          await db
            .delete(schema.BookmarkTable)
            .where(
              and(
                eq(schema.BookmarkTable.userId, userId),
                eq(schema.BookmarkTable.itemId, itemId),
                eq(schema.BookmarkTable.itemType, itemType),
              ),
            );
          return { success: true, isBookmarked: false };
        } else {
          // Create bookmark
          await db
            .insert(schema.BookmarkTable)
            .values({
              userId,
              itemId,
              itemType,
            })
            .onConflictDoNothing();
          return { success: true, isBookmarked: true };
        }
      } catch (error) {
        console.error("[IPC] Error toggling bookmark:", error);
        throw error;
      }
    },
  );

  console.log("[IPC] Agent handlers registered");
}
