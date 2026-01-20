import { randomUUID } from "crypto";
import {
  generateBatchEmbeddings,
  generateTextEmbedding,
} from "lib/ai/embeddings/embedding-service";
import { vectorIndexRepository } from "lib/db/repository";
import logger from "logger";

// Qdrant service was removed for local-first architecture
// Using DuckDB vector store in Electron, stub functions for web compatibility
const COLLECTIONS = {
  DOCUMENTS: "documents",
  MESSAGES: "messages",
  KNOWLEDGE_BASE: "knowledge_base",
};

// Type for filter (previously from @qdrant/js-client-rest)
type Filter = {
  must?: Array<{
    key: string;
    match?: { value: string | number | boolean };
    range?: Record<string, string>;
  }>;
};

// Stub Qdrant functions - these will fail gracefully if called
const countPoints = async (_collectionName: string): Promise<number> => {
  logger.warn(
    "Qdrant countPoints called - service not available in local-first mode",
  );
  return 0;
};
const deletePoints = async (
  _collectionName: string,
  _pointIds: (string | number)[],
): Promise<void> => {
  logger.warn(
    "Qdrant deletePoints called - service not available in local-first mode",
  );
};
const deletePointsByFilter = async (
  _collectionName: string,
  _filter: Filter,
): Promise<void> => {
  logger.warn(
    "Qdrant deletePointsByFilter called - service not available in local-first mode",
  );
};
const searchPoints = async (
  _collectionName: string,
  _vector: number[],
  _options?: any,
): Promise<SearchResult[]> => {
  logger.warn(
    "Qdrant searchPoints called - service not available in local-first mode",
  );
  return [];
};
const searchPointsBatch = async (
  _collectionName: string,
  _requests: any[],
): Promise<SearchResult[][]> => {
  logger.warn(
    "Qdrant searchPointsBatch called - service not available in local-first mode",
  );
  return [];
};
const upsertPoints = async (
  _collectionName: string,
  _points: any[],
  _options?: any,
): Promise<void> => {
  logger.warn(
    "Qdrant upsertPoints called - service not available in local-first mode",
  );
};

/**
 * ULTRA-FAST Vector Search Service
 *
 * Features:
 * - In-memory LRU cache for hot queries
 * - Parallel embedding + search pipeline
 * - PostgreSQL tracking for data consistency
 * - Hybrid search with keyword boosting
 * - Sub-100ms query latency target
 */

export type CollectionType = "documents" | "messages" | "knowledge";

export interface SearchResult {
  id: string | number;
  score: number;
  payload: Record<string, unknown>;
}

export interface SearchFilters {
  userId?: string;
  documentType?: "word" | "excel" | "presentation" | "pdf";
  threadId?: string;
  role?: "user" | "assistant";
  dateFrom?: string;
  dateTo?: string;
}

// ============================================================================
// IN-MEMORY SEARCH CACHE (LRU)
// ============================================================================

interface CacheEntry {
  results: SearchResult[];
  timestamp: number;
}

const SEARCH_CACHE = new Map<string, CacheEntry>();
const CACHE_MAX_SIZE = 1000;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCacheKey(
  query: string,
  collectionType: CollectionType,
  filters?: SearchFilters,
  limit?: number,
): string {
  return `${collectionType}:${limit || 10}:${JSON.stringify(filters || {})}:${query}`;
}

function getFromCache(key: string): SearchResult[] | null {
  const entry = SEARCH_CACHE.get(key);
  if (!entry) return null;

  // Check TTL
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    SEARCH_CACHE.delete(key);
    return null;
  }

  return entry.results;
}

function setInCache(key: string, results: SearchResult[]): void {
  // Evict oldest entries if cache is full
  if (SEARCH_CACHE.size >= CACHE_MAX_SIZE) {
    const oldestKey = SEARCH_CACHE.keys().next().value;
    if (oldestKey) {
      SEARCH_CACHE.delete(oldestKey);
    }
  }

  SEARCH_CACHE.set(key, {
    results,
    timestamp: Date.now(),
  });
}

export function clearSearchCache(): void {
  SEARCH_CACHE.clear();
}

export function getSearchCacheStats(): { size: number; maxSize: number } {
  return { size: SEARCH_CACHE.size, maxSize: CACHE_MAX_SIZE };
}

// ============================================================================
// FILTER BUILDING
// ============================================================================

function buildFilter(filters?: SearchFilters): Filter | undefined {
  if (!filters || Object.keys(filters).length === 0) {
    return undefined;
  }

  const must: Filter["must"] = [];

  if (filters.userId) {
    must.push({
      key: "userId",
      match: { value: filters.userId },
    });
  }

  if (filters.documentType) {
    must.push({
      key: "documentType",
      match: { value: filters.documentType },
    });
  }

  if (filters.threadId) {
    must.push({
      key: "threadId",
      match: { value: filters.threadId },
    });
  }

  if (filters.role) {
    must.push({
      key: "role",
      match: { value: filters.role },
    });
  }

  if (filters.dateFrom || filters.dateTo) {
    const range: Record<string, string> = {};
    if (filters.dateFrom) {
      range.gte = filters.dateFrom;
    }
    if (filters.dateTo) {
      range.lte = filters.dateTo;
    }
    must.push({
      key: "createdAt",
      range,
    });
  }

  return must.length > 0 ? { must } : undefined;
}

function getCollectionName(type: CollectionType): string {
  switch (type) {
    case "documents":
      return COLLECTIONS.DOCUMENTS;
    case "messages":
      return COLLECTIONS.MESSAGES;
    case "knowledge":
      return COLLECTIONS.KNOWLEDGE_BASE;
    default:
      throw new Error(`Unknown collection type: ${type}`);
  }
}

// ============================================================================
// SEMANTIC SEARCH (BLAZING FAST)
// ============================================================================

/**
 * Ultra-fast semantic search with caching
 * Target: <100ms for cached, <300ms for uncached
 */
export async function semanticSearch(
  query: string,
  collectionType: CollectionType,
  options: {
    limit?: number;
    scoreThreshold?: number;
    filters?: SearchFilters;
    useCache?: boolean;
  } = {},
): Promise<SearchResult[]> {
  if (!query.trim()) {
    return [];
  }

  const {
    limit = 10,
    scoreThreshold = 0.7,
    filters,
    useCache = true,
  } = options;

  const collectionName = getCollectionName(collectionType);
  const start = performance.now();

  // Check cache first
  if (useCache) {
    const cacheKey = getCacheKey(query, collectionType, filters, limit);
    const cached = getFromCache(cacheKey);
    if (cached) {
      const elapsed = Math.round(performance.now() - start);
      logger.debug("Semantic search cache hit", {
        elapsed,
        results: cached.length,
      });
      return cached;
    }
  }

  try {
    // Generate embedding (uses its own cache)
    const queryEmbedding = await generateTextEmbedding(query);
    const embeddingTime = Math.round(performance.now() - start);

    // Build filter
    const qdrantFilter = buildFilter(filters);

    // Search Qdrant
    const searchStart = performance.now();
    const results = await searchPoints(collectionName, queryEmbedding, {
      limit,
      scoreThreshold,
      filter: qdrantFilter,
      withVector: false, // Don't return vectors for speed
    });
    const searchTime = Math.round(performance.now() - searchStart);

    // Cache results
    if (useCache) {
      const cacheKey = getCacheKey(query, collectionType, filters, limit);
      setInCache(cacheKey, results);
    }

    const totalTime = Math.round(performance.now() - start);
    logger.debug("Semantic search completed", {
      results: results.length,
      embeddingTime,
      searchTime,
      totalTime,
    });

    return results;
  } catch (error) {
    logger.error("Semantic search failed:", error);
    throw error;
  }
}

/**
 * Batch semantic search - search multiple queries in parallel
 */
export async function batchSemanticSearch(
  queries: string[],
  collectionType: CollectionType,
  options: {
    limit?: number;
    scoreThreshold?: number;
    filters?: SearchFilters;
  } = {},
): Promise<SearchResult[][]> {
  if (queries.length === 0) {
    return [];
  }

  const { limit = 10, scoreThreshold = 0.7, filters } = options;
  const collectionName = getCollectionName(collectionType);
  const start = performance.now();

  try {
    // Generate all embeddings in batch (much faster)
    const embeddings = await generateBatchEmbeddings(queries);
    const embeddingTime = Math.round(performance.now() - start);

    // Build filter once
    const qdrantFilter = buildFilter(filters);

    // Search all in parallel
    const searchStart = performance.now();
    const results = await searchPointsBatch(
      collectionName,
      embeddings.map((vector) => ({
        vector,
        options: {
          limit,
          scoreThreshold,
          filter: qdrantFilter,
          withVector: false,
        },
      })),
    );
    const searchTime = Math.round(performance.now() - searchStart);

    const totalTime = Math.round(performance.now() - start);
    logger.debug("Batch semantic search completed", {
      queries: queries.length,
      embeddingTime,
      searchTime,
      totalTime,
    });

    return results;
  } catch (error) {
    logger.error("Batch semantic search failed:", error);
    throw error;
  }
}

// ============================================================================
// HYBRID SEARCH (Semantic + Keyword Boosting)
// ============================================================================

/**
 * Hybrid search combines semantic similarity with keyword matching
 * Results with exact keyword matches get score boost
 */
export async function hybridSearch(
  query: string,
  collectionType: CollectionType,
  options: {
    limit?: number;
    scoreThreshold?: number;
    filters?: SearchFilters;
    keywordBoost?: number; // Boost factor for keyword matches (0-1)
  } = {},
): Promise<SearchResult[]> {
  const {
    limit = 10,
    scoreThreshold = 0.5, // Lower threshold for hybrid
    filters,
    keywordBoost = 0.15,
  } = options;

  // Get more results than needed for re-ranking
  const semanticResults = await semanticSearch(query, collectionType, {
    limit: limit * 2,
    scoreThreshold: scoreThreshold * 0.8, // More lenient for re-ranking
    filters,
    useCache: false, // Don't cache intermediate results
  });

  if (semanticResults.length === 0) {
    return [];
  }

  // Extract keywords from query (simple tokenization)
  const keywords = query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 2);

  // Re-rank based on keyword presence
  const rerankedResults = semanticResults.map((result) => {
    const content = String(result.payload.content || "").toLowerCase();

    // Count keyword matches
    let keywordScore = 0;
    for (const keyword of keywords) {
      if (content.includes(keyword)) {
        keywordScore += keywordBoost / keywords.length;
      }
    }

    // Boost score (cap at 1.0)
    const boostedScore = Math.min(1.0, result.score + keywordScore);

    return {
      ...result,
      score: boostedScore,
    };
  });

  // Sort by boosted score and take top results
  return rerankedResults
    .sort((a, b) => b.score - a.score)
    .filter((r) => r.score >= scoreThreshold)
    .slice(0, limit);
}

// ============================================================================
// INDEXING (with PostgreSQL tracking)
// ============================================================================

/**
 * Index content to Qdrant with PostgreSQL tracking
 * Ensures data consistency between Qdrant and PostgreSQL
 */
export async function indexContent(
  collectionType: CollectionType,
  items: Array<{
    id?: string | number;
    content: string;
    payload?: Record<string, unknown>;
  }>,
  options: {
    userId?: string;
    trackInPostgres?: boolean;
  } = {},
): Promise<{ indexed: number; pointIds: string[] }> {
  if (items.length === 0) {
    return { indexed: 0, pointIds: [] };
  }

  const { userId, trackInPostgres = true } = options;
  const collectionName = getCollectionName(collectionType);
  const start = performance.now();

  // Declare variables outside try block for error handling
  let validItems: typeof items = [];
  let points: Array<{
    id: string;
    vector: number[];
    payload: Record<string, unknown>;
  }> = [];

  try {
    // Filter out empty content
    validItems = items.filter((item) => item.content.trim().length > 0);
    if (validItems.length === 0) {
      return { indexed: 0, pointIds: [] };
    }

    // Generate embeddings in batch
    const texts = validItems.map((item) => item.content);
    const embeddings = await generateBatchEmbeddings(texts);
    const embeddingTime = Math.round(performance.now() - start);

    // Prepare points with generated IDs
    // Qdrant only accepts unsigned integers or UUIDs (not arbitrary strings)
    // Always generate a proper UUID for the point ID, store original ID in payload if needed
    const pointIds: string[] = [];
    points = validItems.map((item, index) => {
      // Generate a proper UUID for Qdrant (required format)
      const pointId = randomUUID();
      pointIds.push(pointId);

      // Clean payload to ensure all values are Qdrant-compatible types
      // Qdrant supports: string, number, boolean, null, arrays, objects
      // Dates should be ISO strings, not Date objects
      const cleanPayload: Record<string, unknown> = {
        content: String(item.content || ""),
        userId: String(userId || item.payload?.userId || ""),
        indexedAt: new Date().toISOString(),
        // Store original ID in payload if provided (for reference, since point ID must be UUID)
        ...(item.id ? { originalId: String(item.id) } : {}),
      };

      // Merge additional payload fields, ensuring types are correct
      if (item.payload) {
        for (const [key, value] of Object.entries(item.payload)) {
          // Skip null/undefined
          if (value === null || value === undefined) continue;

          // Convert Date objects to ISO strings
          if (value instanceof Date) {
            cleanPayload[key] = value.toISOString();
          }
          // Ensure numbers are actually numbers
          else if (typeof value === "number" && !isNaN(value)) {
            cleanPayload[key] = value;
          }
          // Ensure booleans are booleans
          else if (typeof value === "boolean") {
            cleanPayload[key] = value;
          }
          // Convert everything else to string
          else {
            cleanPayload[key] = String(value);
          }
        }
      }

      return {
        id: pointId,
        vector: embeddings[index],
        payload: cleanPayload,
      };
    });

    // Upsert to Qdrant (async for speed)
    const upsertStart = performance.now();
    await upsertPoints(collectionName, points, { wait: false });
    const upsertTime = Math.round(performance.now() - upsertStart);

    // Track in database for consistency (only if userId is provided)
    if (trackInPostgres && userId) {
      const trackStart = performance.now();
      await Promise.all(
        points.map((point, index) =>
          vectorIndexRepository
            .create({
              qdrantPointId: String(point.id),
              collectionName,
              entityType:
                collectionType === "messages"
                  ? "message"
                  : collectionType === "documents"
                    ? "document"
                    : "knowledge",
              entityId: String(validItems[index].id || point.id),
              userId,
              metadata: validItems[index].payload,
            })
            .catch((err) => {
              // Ignore duplicate key errors
              if (!String(err).includes("duplicate")) {
                logger.warn("Failed to track vector index:", err);
              }
            }),
        ),
      );
      const trackTime = Math.round(performance.now() - trackStart);
      logger.debug("Database tracking completed", { trackTime });
    }

    const totalTime = Math.round(performance.now() - start);
    logger.info(`Indexed ${points.length} items to ${collectionName}`, {
      embeddingTime,
      upsertTime,
      totalTime,
    });

    // Clear search cache for this collection type
    clearSearchCache();

    return { indexed: points.length, pointIds };
  } catch (error: any) {
    const errorMessage = error?.message || String(error);
    const errorDetails = {
      collectionName,
      collectionType,
      itemsCount: items.length,
      validItemsCount: validItems.length,
      pointsCount: points.length,
      errorMessage,
      errorName: error?.name,
      errorStatus: error?.status,
      errorResponse: error?.response,
    };

    logger.error("Failed to index content:", errorDetails);
    console.error(
      "[Vector Search] Indexing error details:",
      JSON.stringify(errorDetails, null, 2),
    );

    // If it's a Qdrant API error, try to extract more details
    if (error?.response || error?.status) {
      const qdrantError =
        error.response?.data || error.response || error.message;
      throw new Error(
        `Failed to index content: ${errorMessage}. Qdrant error: ${JSON.stringify(qdrantError)}`,
      );
    }

    throw new Error(`Failed to index content: ${errorMessage}`);
  }
}

/**
 * Remove content from Qdrant index and PostgreSQL tracking
 */
export async function removeFromIndex(
  collectionType: CollectionType,
  pointIds: (string | number)[],
  options: {
    removeFromPostgres?: boolean;
  } = {},
): Promise<void> {
  if (pointIds.length === 0) {
    return;
  }

  const { removeFromPostgres = true } = options;
  const collectionName = getCollectionName(collectionType);
  const start = performance.now();

  try {
    // Delete from Qdrant
    await deletePoints(collectionName, pointIds);

    // Remove from PostgreSQL tracking
    if (removeFromPostgres) {
      await Promise.all(
        pointIds.map((id) =>
          vectorIndexRepository
            .deleteByQdrantPointId(String(id))
            .catch(() => {}),
        ),
      );
    }

    const elapsed = Math.round(performance.now() - start);
    logger.debug(`Removed ${pointIds.length} items from ${collectionName}`, {
      elapsed,
    });

    // Clear search cache
    clearSearchCache();
  } catch (error) {
    logger.error("Failed to remove from index:", error);
    throw error;
  }
}

/**
 * Remove all content for a user
 */
export async function removeUserContent(
  userId: string,
  collectionType?: CollectionType,
): Promise<void> {
  const start = performance.now();
  const collections = collectionType
    ? [getCollectionName(collectionType)]
    : [COLLECTIONS.DOCUMENTS, COLLECTIONS.MESSAGES, COLLECTIONS.KNOWLEDGE_BASE];

  try {
    // Delete from Qdrant by filter
    await Promise.all(
      collections.map((collection) =>
        deletePointsByFilter(collection, {
          must: [{ key: "userId", match: { value: userId } }],
        }),
      ),
    );

    // Remove from PostgreSQL tracking
    await vectorIndexRepository.deleteByUserId(userId);

    const elapsed = Math.round(performance.now() - start);
    logger.info(`Removed all content for user ${userId}`, {
      elapsed,
      collections,
    });

    // Clear search cache
    clearSearchCache();
  } catch (error) {
    logger.error("Failed to remove user content:", error);
    throw error;
  }
}

// ============================================================================
// STATS & UTILITIES
// ============================================================================

/**
 * Get collection statistics
 */
export async function getCollectionStats(
  collectionType: CollectionType,
): Promise<{
  pointsCount: number;
  userCount?: number;
}> {
  const collectionName = getCollectionName(collectionType);

  const pointsCount = await countPoints(collectionName);

  return {
    pointsCount,
  };
}

/**
 * Check if content exists in index
 */
export async function isIndexed(
  collectionType: CollectionType,
  entityId: string,
): Promise<boolean> {
  const entityType =
    collectionType === "messages"
      ? "message"
      : collectionType === "documents"
        ? "document"
        : "knowledge";

  const record = await vectorIndexRepository.getByEntity(entityType, entityId);
  return record !== null;
}
