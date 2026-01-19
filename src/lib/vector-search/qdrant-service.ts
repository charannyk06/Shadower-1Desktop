/**
 * Qdrant Service Stub - Cloud services removed for local-first architecture
 *
 * This file provides stub exports for compatibility with existing code.
 * Vector search functionality is handled by DuckDB in Electron.
 */

import logger from "logger";
import { COLLECTIONS } from "./qdrant-client";

// Re-export COLLECTIONS for convenience
export { COLLECTIONS };

// Type definitions for compatibility
export interface ScrollResult {
  points: Array<{
    id: string | number;
    payload?: Record<string, unknown> | null;
    vector?: number[];
  }>;
  nextOffset: string | number | null;
}

export interface SearchResult {
  id: string | number;
  score: number;
  payload?: Record<string, unknown> | null;
  vector?: number[];
}

// Stub functions that log warnings and return empty/default values

export async function initializeCollections(): Promise<void> {
  logger.warn(
    "Qdrant initializeCollections called - service not available in local-first mode",
  );
}

export async function ensureCollection(_name: string): Promise<void> {
  logger.warn(
    "Qdrant ensureCollection called - service not available in local-first mode",
  );
}

export async function scrollPoints(
  _collection: string,
  _options?: {
    limit?: number;
    offset?: string | number;
    filter?: any;
    withPayload?: boolean;
    withVector?: boolean;
  },
): Promise<ScrollResult> {
  logger.warn(
    "Qdrant scrollPoints called - service not available in local-first mode",
  );
  return { points: [], nextOffset: null };
}

export async function searchPoints(
  _collection: string,
  _vector: number[],
  _options?: {
    limit?: number;
    scoreThreshold?: number;
    filter?: any;
    withVector?: boolean;
  },
): Promise<SearchResult[]> {
  logger.warn(
    "Qdrant searchPoints called - service not available in local-first mode",
  );
  return [];
}

export async function upsertPoints(
  _collection: string,
  _points: Array<{
    id: string | number;
    vector: number[];
    payload?: Record<string, unknown>;
  }>,
  _options?: { wait?: boolean },
): Promise<void> {
  logger.warn(
    "Qdrant upsertPoints called - service not available in local-first mode",
  );
}

export async function deletePoints(
  _collection: string,
  _pointIds: (string | number)[],
): Promise<void> {
  logger.warn(
    "Qdrant deletePoints called - service not available in local-first mode",
  );
}

export async function deletePointsByFilter(
  _collection: string,
  _filter: any,
): Promise<void> {
  logger.warn(
    "Qdrant deletePointsByFilter called - service not available in local-first mode",
  );
}

export async function getPoint(
  _collection: string,
  _pointId: string | number,
): Promise<{
  id: string | number;
  payload?: Record<string, unknown> | null;
  vector?: number[];
} | null> {
  logger.warn(
    "Qdrant getPoint called - service not available in local-first mode",
  );
  return null;
}

export async function countPoints(_collection: string): Promise<number> {
  logger.warn(
    "Qdrant countPoints called - service not available in local-first mode",
  );
  return 0;
}
