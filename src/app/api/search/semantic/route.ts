import "server-only";

import { getSession } from "auth/server";
import {
  type CollectionType,
  batchSemanticSearch,
  getSearchCacheStats,
  hybridSearch,
  semanticSearch,
} from "lib/vector-search/vector-search-service";
import logger from "logger";
import { z } from "zod";

const searchRequestSchema = z.object({
  query: z.string().min(1).max(10000),
  collectionType: z.enum(["documents", "messages", "knowledge"]),
  limit: z.number().int().min(1).max(100).optional().default(10),
  scoreThreshold: z.number().min(0).max(1).optional().default(0.7),
  searchType: z.enum(["semantic", "hybrid"]).optional().default("semantic"),
  filters: z
    .object({
      userId: z.string().uuid().optional(),
      documentType: z.enum(["word", "excel", "presentation", "pdf"]).optional(),
      threadId: z.string().uuid().optional(),
      role: z.enum(["user", "assistant"]).optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    })
    .optional(),
  // Performance options
  useCache: z.boolean().optional().default(true),
  keywordBoost: z.number().min(0).max(1).optional().default(0.15),
});

const batchSearchRequestSchema = z.object({
  queries: z.array(z.string().min(1).max(10000)).min(1).max(20),
  collectionType: z.enum(["documents", "messages", "knowledge"]),
  limit: z.number().int().min(1).max(100).optional().default(10),
  scoreThreshold: z.number().min(0).max(1).optional().default(0.7),
  filters: z
    .object({
      userId: z.string().uuid().optional(),
      documentType: z.enum(["word", "excel", "presentation", "pdf"]).optional(),
      threadId: z.string().uuid().optional(),
      role: z.enum(["user", "assistant"]).optional(),
    })
    .optional(),
});

/**
 * POST /api/search/semantic
 *
 * Ultra-fast semantic search endpoint
 *
 * Features:
 * - Sub-100ms cached queries
 * - Hybrid search with keyword boosting
 * - User security filters
 * - Performance metrics in response
 */
export async function POST(request: Request) {
  const session = await getSession();

  if (!session?.user.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const start = performance.now();

  try {
    const body = await request.json();
    const {
      query,
      collectionType,
      limit,
      scoreThreshold,
      searchType,
      filters,
      useCache,
      keywordBoost,
    } = searchRequestSchema.parse(body);

    // Ensure filters include userId for security
    const searchFilters = {
      ...filters,
      userId: filters?.userId || session.user.id,
    };

    // Choose search type
    const results =
      searchType === "hybrid"
        ? await hybridSearch(query, collectionType as CollectionType, {
            limit,
            scoreThreshold,
            filters: searchFilters,
            keywordBoost,
          })
        : await semanticSearch(query, collectionType as CollectionType, {
            limit,
            scoreThreshold,
            filters: searchFilters,
            useCache,
          });

    const totalTimeMs = Math.round(performance.now() - start);
    const cacheStats = getSearchCacheStats();

    return Response.json({
      results,
      count: results.length,
      query,
      collectionType,
      searchType,
      performance: {
        totalTimeMs,
        cacheSize: cacheStats.size,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: "Invalid request", details: error.issues },
        { status: 400 },
      );
    }

    const totalTimeMs = Math.round(performance.now() - start);
    logger.error("Semantic search API error:", error);
    return Response.json(
      {
        error: "Internal server error",
        totalTimeMs,
      },
      { status: 500 },
    );
  }
}

/**
 * PUT /api/search/semantic
 *
 * Batch semantic search - search multiple queries in parallel
 * Much more efficient for multi-query scenarios
 */
export async function PUT(request: Request) {
  const session = await getSession();

  if (!session?.user.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const start = performance.now();

  try {
    const body = await request.json();
    const { queries, collectionType, limit, scoreThreshold, filters } =
      batchSearchRequestSchema.parse(body);

    // Ensure filters include userId for security
    const searchFilters = {
      ...filters,
      userId: filters?.userId || session.user.id,
    };

    const results = await batchSemanticSearch(
      queries,
      collectionType as CollectionType,
      {
        limit,
        scoreThreshold,
        filters: searchFilters,
      },
    );

    const totalTimeMs = Math.round(performance.now() - start);
    const avgTimePerQuery = Math.round(totalTimeMs / queries.length);

    return Response.json({
      results,
      queriesCount: queries.length,
      totalResults: results.reduce((sum, r) => sum + r.length, 0),
      collectionType,
      performance: {
        totalTimeMs,
        avgTimePerQuery,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: "Invalid request", details: error.issues },
        { status: 400 },
      );
    }

    const totalTimeMs = Math.round(performance.now() - start);
    logger.error("Batch semantic search API error:", error);
    return Response.json(
      {
        error: "Internal server error",
        totalTimeMs,
      },
      { status: 500 },
    );
  }
}

/**
 * GET /api/search/semantic
 *
 * Get search service stats and health
 */
export async function GET() {
  const session = await getSession();

  if (!session?.user.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cacheStats = getSearchCacheStats();

  return Response.json({
    status: "healthy",
    cache: cacheStats,
  });
}
