/**
 * Qdrant Client Stub - Cloud services removed for local-first architecture
 *
 * This file provides stub exports for compatibility with existing code.
 * Vector search functionality is handled by DuckDB in Electron.
 */

import logger from "logger";

// Collection constants for compatibility
export const COLLECTIONS = {
  DOCUMENTS: "documents",
  MESSAGES: "messages",
  KNOWLEDGE_BASE: "knowledge_base",
} as const;

// Stub Qdrant client that returns empty/error responses
const stubClient = {
  async getCollections(): Promise<{ collections: Array<{ name: string }> }> {
    logger.warn(
      "Qdrant getCollections called - service not available in local-first mode",
    );
    return { collections: [] };
  },
  async getCollection(_name: string) {
    logger.warn(
      "Qdrant getCollection called - service not available in local-first mode",
    );
    return {
      points_count: 0,
      indexed_vectors_count: 0,
      config: {
        params: {
          vectors: { size: 1536, distance: "Cosine" },
        },
      },
    };
  },
  async createCollection(_name: string, _config: any) {
    logger.warn(
      "Qdrant createCollection called - service not available in local-first mode",
    );
  },
  async upsert(_collection: string, _params: any) {
    logger.warn(
      "Qdrant upsert called - service not available in local-first mode",
    );
  },
  async search(_collection: string, _params: any) {
    logger.warn(
      "Qdrant search called - service not available in local-first mode",
    );
    return [];
  },
  async scroll(_collection: string, _params: any) {
    logger.warn(
      "Qdrant scroll called - service not available in local-first mode",
    );
    return { points: [], next_page_offset: null };
  },
  async delete(_collection: string, _params: any) {
    logger.warn(
      "Qdrant delete called - service not available in local-first mode",
    );
  },
  async retrieve(_collection: string, _params: any) {
    logger.warn(
      "Qdrant retrieve called - service not available in local-first mode",
    );
    return [];
  },
  async count(_collection: string, _params: any) {
    logger.warn(
      "Qdrant count called - service not available in local-first mode",
    );
    return { count: 0 };
  },
};

export function getQdrantClient() {
  return stubClient;
}

export default stubClient;
