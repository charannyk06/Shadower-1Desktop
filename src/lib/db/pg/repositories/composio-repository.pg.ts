import type { ComposioRepository } from "app-types/composio";
import { eq } from "drizzle-orm";
import { generateUUID } from "lib/utils";
import { pgDb as db } from "../db.pg";
import { ComposioConnectionTable } from "../schema.pg";

export const pgComposioRepository: ComposioRepository = {
  async getEntityByUserId(userId) {
    const [result] = await db
      .select()
      .from(ComposioConnectionTable)
      .where(eq(ComposioConnectionTable.userId, userId));
    return result || null;
  },

  async createEntity(data) {
    const [result] = await db
      .insert(ComposioConnectionTable)
      .values({
        id: generateUUID(),
        userId: data.userId,
        entityId: data.entityId,
        connectedApps: data.appName ? [data.appName] : [],
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return result;
  },

  async updateEntity(userId, data) {
    const [result] = await db
      .update(ComposioConnectionTable)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(ComposioConnectionTable.userId, userId))
      .returning();

    return result;
  },

  async deleteEntity(userId) {
    await db
      .delete(ComposioConnectionTable)
      .where(eq(ComposioConnectionTable.userId, userId));
  },

  async addConnectedApp(userId, appName) {
    const existing = await this.getEntityByUserId(userId);
    if (!existing) {
      await this.createEntity({
        userId,
        entityId: userId,
        appName,
      });
      return;
    }

    const currentApps = existing.connectedApps || [];
    if (!currentApps.includes(appName)) {
      await db
        .update(ComposioConnectionTable)
        .set({
          connectedApps: [...currentApps, appName],
          updatedAt: new Date(),
        })
        .where(eq(ComposioConnectionTable.userId, userId));
    }
  },

  async removeConnectedApp(userId, appName) {
    const existing = await this.getEntityByUserId(userId);
    if (!existing) return;

    const currentApps = existing.connectedApps || [];
    const updatedApps = currentApps.filter((app) => app !== appName);

    await db
      .update(ComposioConnectionTable)
      .set({
        connectedApps: updatedApps,
        updatedAt: new Date(),
      })
      .where(eq(ComposioConnectionTable.userId, userId));
  },
};
