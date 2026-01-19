import type { MCPRepository } from "app-types/mcp";
import { desc, eq, or } from "drizzle-orm";
import { generateUUID } from "lib/utils";
import { sqliteDb as db } from "../db.sqlite";
import { McpServerTable, UserTable } from "../schema.sqlite";

export const sqliteMcpRepository: MCPRepository = {
  async save(server) {
    const [result] = await db
      .insert(McpServerTable)
      .values({
        id: server.id ?? generateUUID(),
        name: server.name,
        config: server.config,
        userId: server.userId,
        visibility: server.visibility ?? "private",
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [McpServerTable.id],
        set: {
          config: server.config,
          updatedAt: new Date(),
        },
      })
      .returning();

    return result;
  },

  async selectById(id) {
    const [result] = await db
      .select()
      .from(McpServerTable)
      .where(eq(McpServerTable.id, id));
    return result;
  },

  async selectAll() {
    const results = await db.select().from(McpServerTable);
    return results;
  },

  async selectAllForUser(userId) {
    const results = await db
      .select({
        id: McpServerTable.id,
        name: McpServerTable.name,
        config: McpServerTable.config,
        enabled: McpServerTable.enabled,
        userId: McpServerTable.userId,
        visibility: McpServerTable.visibility,
        createdAt: McpServerTable.createdAt,
        updatedAt: McpServerTable.updatedAt,
        userName: UserTable.name,
        userAvatar: UserTable.image,
      })
      .from(McpServerTable)
      .leftJoin(UserTable, eq(McpServerTable.userId, UserTable.id))
      .where(
        or(
          eq(McpServerTable.userId, userId),
          eq(McpServerTable.visibility, "public"),
        ),
      )
      .orderBy(desc(McpServerTable.createdAt));
    return results;
  },

  async updateVisibility(id, visibility) {
    await db
      .update(McpServerTable)
      .set({ visibility, updatedAt: new Date() })
      .where(eq(McpServerTable.id, id));
  },

  async deleteById(id) {
    await db.delete(McpServerTable).where(eq(McpServerTable.id, id));
  },

  async selectByServerName(name) {
    const [result] = await db
      .select()
      .from(McpServerTable)
      .where(eq(McpServerTable.name, name));
    return result;
  },

  async existsByServerName(name) {
    const [result] = await db
      .select({ id: McpServerTable.id })
      .from(McpServerTable)
      .where(eq(McpServerTable.name, name));

    return !!result;
  },
};
