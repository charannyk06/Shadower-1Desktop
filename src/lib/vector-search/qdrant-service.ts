import "server-only";

import type { Schemas } from "@qdrant/js-client-rest";
import logger from "logger";
import { COLLECTIONS, VECTOR_CONFIG, getQdrantClient } from "./qdrant-client";

// Type aliases for Qdrant types
type Filter = Schemas["Filter"];
type PointStruct = Schemas["PointStruct"];

/**
 * HIGH-PERFORMANCE Qdrant Service
 *
 * Optimizations:
 * - Parallel batch operations
 * - Optimized HNSW parameters for speed
 * - Minimal retries with fast failure
 * - Efficient payload indexing
 * - Quantization support for faster search
 */

export interface QdrantPoint {
  id: string | number;
  vector: number[];
  payload?: Record<string, unknown>;
}

export interface SearchOptions {
  limit?: number;
  scoreThreshold?: number;
  filter?: Filter;
  offset?: number;
  // Performance options
  exactSearch?: boolean; // Skip HNSW for exact results (slower but precise)
  withPayload?: boolean | string[]; // Limit payload fields returned
  withVector?: boolean; // Skip vector in response for speed
}

export interface ScrollOptions {
  limit?: number;
  offset?: string | number;
  filter?: Filter;
  withPayload?: boolean | string[];
  withVector?: boolean;
}

/**
 * HNSW configuration optimized for speed
 * - Higher m = more connections = faster search but more memory
 * - Higher ef_construction = better index quality
 */
const HNSW_CONFIG = {
  m: 32, // Increased from 16 for faster search
  ef_construction: 200, // Increased for better index quality
  full_scan_threshold: 10000,
} as const;

/**
 * Quantization config for faster search with slight accuracy tradeoff
 */
const QUANTIZATION_CONFIG = {
  scalar: {
    type: "int8" as const,
    quantile: 0.99,
    always_ram: true, // Keep quantized vectors in RAM for speed
  },
} as const;

/**
 * Create a collection with speed-optimized settings
 */
export async function ensureCollection(
  collectionName: string,
  vectorSize: number = VECTOR_CONFIG.DIMENSIONS,
  options: { withQuantization?: boolean } = {},
): Promise<void> {
  const client = getQdrantClient();
  const start = performance.now();

  try {
    // Check if collection exists
    const collections = await client.getCollections();
    const exists = collections.collections.some(
      (c) => c.name === collectionName,
    );

    if (exists) {
      logger.debug(`Collection ${collectionName} already exists`);
      return;
    }

    // Create collection with optimized settings
    await client.createCollection(collectionName, {
      vectors: {
        size: vectorSize,
        distance: VECTOR_CONFIG.DISTANCE,
        on_disk: false, // Keep vectors in RAM for speed
      },
      hnsw_config: HNSW_CONFIG,
      // Enable quantization for large collections (optional)
      ...(options.withQuantization && {
        quantization_config: QUANTIZATION_CONFIG,
      }),
      // Optimizers config
      optimizers_config: {
        indexing_threshold: 10000, // Start indexing after 10k points
        memmap_threshold: 50000, // Use mmap after 50k points
      },
      // Replication factor for production
      replication_factor: 1,
      // Write consistency
      write_consistency_factor: 1,
    });

    // Create payload indexes for common filter fields
    await Promise.all([
      client
        .createPayloadIndex(collectionName, {
          field_name: "userId",
          field_schema: "keyword",
          wait: false, // Don't block
        })
        .catch(() => {}), // Ignore if exists
      client
        .createPayloadIndex(collectionName, {
          field_name: "threadId",
          field_schema: "keyword",
          wait: false,
        })
        .catch(() => {}),
      client
        .createPayloadIndex(collectionName, {
          field_name: "documentType",
          field_schema: "keyword",
          wait: false,
        })
        .catch(() => {}),
      client
        .createPayloadIndex(collectionName, {
          field_name: "createdAt",
          field_schema: "datetime",
          wait: false,
        })
        .catch(() => {}),
    ]);

    const elapsed = Math.round(performance.now() - start);
    logger.info(`Created Qdrant collection: ${collectionName}`, { elapsed });
  } catch (error) {
    logger.error(`Failed to create collection ${collectionName}:`, error);
    throw error;
  }
}

/**
 * Initialize all required collections in parallel
 */
export async function initializeCollections(): Promise<void> {
  const start = performance.now();

  await Promise.all([
    ensureCollection(COLLECTIONS.DOCUMENTS),
    ensureCollection(COLLECTIONS.MESSAGES),
    ensureCollection(COLLECTIONS.KNOWLEDGE_BASE),
  ]);

  const elapsed = Math.round(performance.now() - start);
  logger.info("All Qdrant collections initialized", { elapsed });
}

/**
 * High-performance batch upsert
 * - Processes in parallel chunks for speed
 * - Uses wait: false for async indexing
 */
export async function upsertPoints(
  collectionName: string,
  points: QdrantPoint[],
  options: { wait?: boolean; batchSize?: number } = {},
): Promise<void> {
  if (points.length === 0) {
    return;
  }

  const client = getQdrantClient();
  const { wait = false, batchSize = 100 } = options;
  const start = performance.now();

  // Process in batches for optimal throughput
  const batches: QdrantPoint[][] = [];
  for (let i = 0; i < points.length; i += batchSize) {
    batches.push(points.slice(i, i + batchSize));
  }

  try {
    // Validate points before upserting
    if (points.length === 0) {
      logger.warn(`No points to upsert to ${collectionName}`);
      return;
    }

    // Check vector dimensions
    const firstVector = points[0]?.vector;
    if (
      !firstVector ||
      !Array.isArray(firstVector) ||
      firstVector.length === 0
    ) {
      throw new Error(
        `Invalid vector: expected array of numbers, got ${typeof firstVector}`,
      );
    }

    const vectorSize = firstVector.length;
    const invalidVectors = points.filter(
      (p) => !p.vector || p.vector.length !== vectorSize,
    );
    if (invalidVectors.length > 0) {
      throw new Error(
        `Vector dimension mismatch: expected ${vectorSize} dimensions, found ${invalidVectors.length} invalid vectors`,
      );
    }

    // Process batches in parallel (max 4 concurrent)
    const concurrency = Math.min(4, batches.length);
    for (let i = 0; i < batches.length; i += concurrency) {
      const batchPromises = batches
        .slice(i, i + concurrency)
        .map(async (batch) => {
          const pointsToUpsert: PointStruct[] = batch.map((point) => ({
            id: point.id,
            vector: point.vector,
            payload: point.payload || {},
          }));

          try {
            return await client.upsert(collectionName, {
              wait,
              points: pointsToUpsert,
            });
          } catch (upsertError: any) {
            // Log detailed error for this batch
            logger.error(`[Qdrant] Upsert batch failed:`, {
              collectionName,
              batchSize: batch.length,
              firstPointId: batch[0]?.id,
              vectorSize: batch[0]?.vector?.length,
              error: upsertError?.message,
              status: upsertError?.status,
              response: upsertError?.response,
              data: upsertError?.response?.data,
            });
            console.error(
              "[Qdrant] Batch upsert error:",
              JSON.stringify(
                {
                  error: upsertError?.message,
                  status: upsertError?.status,
                  response:
                    upsertError?.response?.data || upsertError?.response,
                },
                null,
                2,
              ),
            );
            throw upsertError;
          }
        });

      await Promise.all(batchPromises);
    }

    const elapsed = Math.round(performance.now() - start);
    logger.debug(`Upserted ${points.length} points to ${collectionName}`, {
      elapsed,
    });
  } catch (error: any) {
    const errorMessage = error?.message || String(error);

    // Try to extract Qdrant error details from various possible structures
    let qdrantErrorDetails: any = null;
    if (error?.response) {
      qdrantErrorDetails = error.response.data || error.response;
    } else if (error?.data) {
      qdrantErrorDetails = error.data;
    } else if (error?.body) {
      qdrantErrorDetails = error.body;
    }

    const errorDetails = {
      collectionName,
      pointsCount: points.length,
      firstPointId: points[0]?.id,
      vectorSize: points[0]?.vector?.length,
      errorMessage,
      errorName: error?.name,
      errorStatus: error?.status,
      errorCode: error?.code,
      qdrantErrorDetails,
      fullError: error,
    };

    logger.error(`Failed to upsert points to ${collectionName}:`, errorDetails);
    console.error("[Qdrant Service] ========== UPSERT ERROR ==========");
    console.error("[Qdrant Service] Collection:", collectionName);
    console.error("[Qdrant Service] Points count:", points.length);
    console.error("[Qdrant Service] Vector size:", points[0]?.vector?.length);
    console.error("[Qdrant Service] Error message:", errorMessage);
    console.error("[Qdrant Service] Error status:", error?.status);
    console.error("[Qdrant Service] Error code:", error?.code);
    console.error(
      "[Qdrant Service] Qdrant error details:",
      JSON.stringify(qdrantErrorDetails, null, 2),
    );
    console.error(
      "[Qdrant Service] Full error:",
      JSON.stringify(error, Object.getOwnPropertyNames(error), 2),
    );
    console.error("[Qdrant Service] ==================================");

    // Re-throw with more context
    if (qdrantErrorDetails) {
      const qdrantErrorStr =
        typeof qdrantErrorDetails === "string"
          ? qdrantErrorDetails
          : JSON.stringify(qdrantErrorDetails);
      throw new Error(
        `Qdrant upsert failed: ${errorMessage}. Qdrant error: ${qdrantErrorStr}`,
      );
    }

    throw new Error(`Failed to upsert points: ${errorMessage}`);
  }
}

/**
 * High-performance vector search
 * - Optimized search parameters
 * - Minimal payload transfer
 */
export async function searchPoints(
  collectionName: string,
  vector: number[],
  options: SearchOptions = {},
): Promise<
  Array<{
    id: string | number;
    score: number;
    payload: Record<string, unknown>;
  }>
> {
  const client = getQdrantClient();
  const {
    limit = 10,
    scoreThreshold = 0.7,
    filter,
    offset = 0,
    exactSearch = false,
    withPayload = true,
    withVector = false,
  } = options;

  const start = performance.now();

  const response = await client.search(collectionName, {
    vector,
    limit,
    score_threshold: scoreThreshold,
    filter,
    offset,
    with_payload: withPayload,
    with_vector: withVector,
    params: {
      // HNSW search parameters for speed
      hnsw_ef: exactSearch ? 512 : 128, // Higher = more accurate, slower
      exact: exactSearch,
    },
  });

  const elapsed = Math.round(performance.now() - start);

  // Qdrant client returns array directly
  const results = Array.isArray(response) ? response : [];

  logger.debug(`Search in ${collectionName}`, {
    results: results.length,
    elapsed,
    threshold: scoreThreshold,
  });

  return results.map((r) => ({
    id: r.id,
    score: r.score || 0,
    payload: (r.payload || {}) as Record<string, unknown>,
  }));
}

/**
 * Batch search - search multiple queries in parallel
 */
export async function searchPointsBatch(
  collectionName: string,
  queries: Array<{ vector: number[]; options?: SearchOptions }>,
): Promise<
  Array<
    Array<{
      id: string | number;
      score: number;
      payload: Record<string, unknown>;
    }>
  >
> {
  const start = performance.now();

  const results = await Promise.all(
    queries.map(({ vector, options }) =>
      searchPoints(collectionName, vector, options),
    ),
  );

  const elapsed = Math.round(performance.now() - start);
  logger.debug(`Batch search in ${collectionName}`, {
    queries: queries.length,
    elapsed,
  });

  return results;
}

/**
 * Delete points by IDs - fast batch delete
 */
export async function deletePoints(
  collectionName: string,
  pointIds: (string | number)[],
): Promise<void> {
  if (pointIds.length === 0) {
    return;
  }

  const client = getQdrantClient();
  const start = performance.now();

  await client.delete(collectionName, {
    wait: false, // Async delete for speed
    points: pointIds,
  });

  const elapsed = Math.round(performance.now() - start);
  logger.debug(`Deleted ${pointIds.length} points from ${collectionName}`, {
    elapsed,
  });
}

/**
 * Delete points by filter - useful for bulk cleanup
 */
export async function deletePointsByFilter(
  collectionName: string,
  filter: Filter,
): Promise<void> {
  const client = getQdrantClient();
  const start = performance.now();

  await client.delete(collectionName, {
    wait: false,
    filter,
  });

  const elapsed = Math.round(performance.now() - start);
  logger.debug(`Deleted points by filter from ${collectionName}`, { elapsed });
}

/**
 * Scroll through collection with pagination
 */
export async function scrollPoints(
  collectionName: string,
  options: ScrollOptions = {},
): Promise<{
  points: Array<{
    id: string | number;
    payload?: Record<string, unknown> | null;
  }>;
  nextOffset: string | number | null;
}> {
  const client = getQdrantClient();
  const {
    limit = 100,
    offset,
    filter,
    withPayload = true,
    withVector = false,
  } = options;

  const result = await client.scroll(collectionName, {
    limit,
    offset: offset as string | undefined,
    filter,
    with_payload: withPayload,
    with_vector: withVector,
  });

  // Handle next_page_offset which can be string | number | Record<string, unknown> | null
  const nextOffset = result.next_page_offset;
  const normalizedOffset: string | number | null =
    typeof nextOffset === "string" || typeof nextOffset === "number"
      ? nextOffset
      : null;

  return {
    points: result.points.map((p) => ({
      id: p.id,
      payload: p.payload as Record<string, unknown> | null,
    })),
    nextOffset: normalizedOffset,
  };
}

/**
 * Get collection info with stats
 */
export async function getCollectionInfo(collectionName: string): Promise<{
  pointsCount: number;
  indexedVectorsCount: number;
  status: string;
  vectorSize: number;
  distance: string;
}> {
  const client = getQdrantClient();
  const info = await client.getCollection(collectionName);

  const vectors = info.config?.params?.vectors;
  const vectorSize =
    typeof vectors === "object" && vectors && "size" in vectors
      ? vectors.size
      : VECTOR_CONFIG.DIMENSIONS;
  const distance =
    typeof vectors === "object" && vectors && "distance" in vectors
      ? String(vectors.distance)
      : VECTOR_CONFIG.DISTANCE;

  return {
    pointsCount: info.points_count ?? 0,
    indexedVectorsCount: info.indexed_vectors_count ?? 0,
    status: info.status ?? "unknown",
    vectorSize:
      typeof vectorSize === "number" ? vectorSize : VECTOR_CONFIG.DIMENSIONS,
    distance,
  };
}

/**
 * Get point by ID
 */
export async function getPoint(
  collectionName: string,
  pointId: string | number,
): Promise<{
  id: string | number;
  payload: Record<string, unknown>;
  vector?: number[];
} | null> {
  const client = getQdrantClient();

  try {
    const result = await client.retrieve(collectionName, {
      ids: [pointId],
      with_payload: true,
      with_vector: false,
    });

    if (result.length === 0) {
      return null;
    }

    return {
      id: result[0].id,
      payload: (result[0].payload || {}) as Record<string, unknown>,
      vector: result[0].vector as number[] | undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Count points in collection (with optional filter)
 */
export async function countPoints(
  collectionName: string,
  filter?: Filter,
): Promise<number> {
  const client = getQdrantClient();

  const result = await client.count(collectionName, {
    filter,
    exact: false, // Fast approximate count
  });

  return result.count;
}

// Export COLLECTIONS for use in other modules
export { COLLECTIONS };
