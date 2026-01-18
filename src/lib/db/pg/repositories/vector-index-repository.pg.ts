import { and, eq } from "drizzle-orm";
import { pgDb as db } from "../db.pg";
import { VectorIndexEntity, VectorIndexTable } from "../schema.pg";

/**
 * Repository for managing vector index tracking
 * Links Qdrant point IDs to PostgreSQL records
 */

export interface VectorIndexRepository {
  /**
   * Create a vector index entry
   */
  create(data: {
    qdrantPointId: string;
    collectionName: string;
    entityType: "document" | "message" | "knowledge";
    entityId: string;
    userId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<VectorIndexEntity>;

  /**
   * Get vector index by Qdrant point ID
   */
  getByQdrantPointId(qdrantPointId: string): Promise<VectorIndexEntity | null>;

  /**
   * Get vector index by entity
   */
  getByEntity(
    entityType: "document" | "message" | "knowledge",
    entityId: string,
  ): Promise<VectorIndexEntity | null>;

  /**
   * Get all vector indices for a user
   */
  getByUserId(userId: string): Promise<VectorIndexEntity[]>;

  /**
   * Get all vector indices for a collection
   */
  getByCollection(collectionName: string): Promise<VectorIndexEntity[]>;

  /**
   * Delete vector index by Qdrant point ID
   */
  deleteByQdrantPointId(qdrantPointId: string): Promise<void>;

  /**
   * Delete vector index by entity
   */
  deleteByEntity(
    entityType: "document" | "message" | "knowledge",
    entityId: string,
  ): Promise<void>;

  /**
   * Delete all vector indices for a user
   */
  deleteByUserId(userId: string): Promise<void>;
}

export const pgVectorIndexRepository: VectorIndexRepository = {
  async create(data) {
    const [result] = await db
      .insert(VectorIndexTable)
      .values({
        qdrantPointId: data.qdrantPointId,
        collectionName: data.collectionName,
        entityType: data.entityType,
        entityId: data.entityId,
        userId: data.userId || null,
        metadata: data.metadata || null,
      })
      .returning();

    return result;
  },

  async getByQdrantPointId(qdrantPointId: string) {
    const [result] = await db
      .select()
      .from(VectorIndexTable)
      .where(eq(VectorIndexTable.qdrantPointId, qdrantPointId))
      .limit(1);

    return result || null;
  },

  async getByEntity(entityType, entityId) {
    const [result] = await db
      .select()
      .from(VectorIndexTable)
      .where(
        and(
          eq(VectorIndexTable.entityType, entityType),
          eq(VectorIndexTable.entityId, entityId),
        ),
      )
      .limit(1);

    return result || null;
  },

  async getByUserId(userId: string) {
    return await db
      .select()
      .from(VectorIndexTable)
      .where(eq(VectorIndexTable.userId, userId));
  },

  async getByCollection(collectionName: string) {
    return await db
      .select()
      .from(VectorIndexTable)
      .where(eq(VectorIndexTable.collectionName, collectionName));
  },

  async deleteByQdrantPointId(qdrantPointId: string) {
    await db
      .delete(VectorIndexTable)
      .where(eq(VectorIndexTable.qdrantPointId, qdrantPointId));
  },

  async deleteByEntity(entityType, entityId) {
    await db
      .delete(VectorIndexTable)
      .where(
        and(
          eq(VectorIndexTable.entityType, entityType),
          eq(VectorIndexTable.entityId, entityId),
        ),
      );
  },

  async deleteByUserId(userId: string) {
    await db
      .delete(VectorIndexTable)
      .where(eq(VectorIndexTable.userId, userId));
  },
};
