import {
  Archive,
  ArchiveItem,
  ArchiveRepository,
  ArchiveWithItemCount,
} from "app-types/archive";
import { and, count, eq } from "drizzle-orm";
import { generateUUID } from "lib/utils";
import { sqliteDb as db } from "../db.sqlite";
import { ArchiveItemTable, ArchiveTable } from "../schema.sqlite";

export const sqliteArchiveRepository: ArchiveRepository = {
  async createArchive(archive) {
    const [result] = await db
      .insert(ArchiveTable)
      .values({
        id: generateUUID(),
        name: archive.name,
        description: archive.description,
        userId: archive.userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    return result as Archive;
  },

  async getArchivesByUserId(userId) {
    const result = await db
      .select({
        id: ArchiveTable.id,
        name: ArchiveTable.name,
        description: ArchiveTable.description,
        userId: ArchiveTable.userId,
        createdAt: ArchiveTable.createdAt,
        updatedAt: ArchiveTable.updatedAt,
        itemCount: count(ArchiveItemTable.id),
      })
      .from(ArchiveTable)
      .leftJoin(
        ArchiveItemTable,
        eq(ArchiveTable.id, ArchiveItemTable.archiveId),
      )
      .where(eq(ArchiveTable.userId, userId))
      .groupBy(ArchiveTable.id)
      .orderBy(ArchiveTable.createdAt);

    return result.map((row) => ({
      ...row,
      itemCount: Number(row.itemCount),
    })) as ArchiveWithItemCount[];
  },

  async getArchiveById(id) {
    const [result] = await db
      .select()
      .from(ArchiveTable)
      .where(eq(ArchiveTable.id, id));
    return result as Archive | null;
  },

  async updateArchive(id, archive) {
    const [result] = await db
      .update(ArchiveTable)
      .set({
        name: archive.name,
        description: archive.description,
        updatedAt: new Date(),
      })
      .where(eq(ArchiveTable.id, id))
      .returning();
    return result as Archive;
  },

  async deleteArchive(id) {
    await db.delete(ArchiveItemTable).where(eq(ArchiveItemTable.archiveId, id));
    await db.delete(ArchiveTable).where(eq(ArchiveTable.id, id));
  },

  async addItemToArchive(archiveId, itemId, userId) {
    const [result] = await db
      .insert(ArchiveItemTable)
      .values({
        id: generateUUID(),
        archiveId,
        itemId,
        userId,
        addedAt: new Date(),
      })
      .onConflictDoNothing()
      .returning();

    if (!result) return null as unknown as ArchiveItem;

    return {
      id: result.id,
      archiveId: result.archiveId,
      itemId: result.itemId,
      userId: result.userId,
      addedAt: result.addedAt ?? new Date(),
    } as ArchiveItem;
  },

  async removeItemFromArchive(archiveId, itemId) {
    await db
      .delete(ArchiveItemTable)
      .where(
        and(
          eq(ArchiveItemTable.archiveId, archiveId),
          eq(ArchiveItemTable.itemId, itemId),
        ),
      );
  },

  async getArchiveItems(archiveId) {
    const results = await db
      .select()
      .from(ArchiveItemTable)
      .where(eq(ArchiveItemTable.archiveId, archiveId))
      .orderBy(ArchiveItemTable.addedAt);

    return results.map((result) => ({
      id: result.id,
      archiveId: result.archiveId,
      itemId: result.itemId,
      userId: result.userId,
      addedAt: result.addedAt ?? new Date(),
    })) as ArchiveItem[];
  },

  async getItemArchives(itemId, userId) {
    const result = await db
      .select({
        id: ArchiveTable.id,
        name: ArchiveTable.name,
        description: ArchiveTable.description,
        userId: ArchiveTable.userId,
        createdAt: ArchiveTable.createdAt,
        updatedAt: ArchiveTable.updatedAt,
      })
      .from(ArchiveTable)
      .innerJoin(
        ArchiveItemTable,
        eq(ArchiveTable.id, ArchiveItemTable.archiveId),
      )
      .where(
        and(
          eq(ArchiveItemTable.itemId, itemId),
          eq(ArchiveTable.userId, userId),
        ),
      )
      .orderBy(ArchiveTable.name);
    return result as Archive[];
  },
};
