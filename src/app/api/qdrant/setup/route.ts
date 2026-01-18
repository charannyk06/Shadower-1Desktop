import "server-only";

import { getSession } from "auth/server";
import {
  COLLECTIONS,
  getQdrantClient,
  testQdrantConnection,
} from "lib/vector-search/qdrant-client";
import {
  getCollectionInfo,
  initializeCollections,
} from "lib/vector-search/qdrant-service";
import logger from "logger";

/**
 * POST /api/qdrant/setup
 *
 * High-performance Qdrant setup endpoint
 * - Tests connection with latency metrics
 * - Initializes collections in parallel
 * - Returns comprehensive status
 *
 * Requires authentication
 */
export async function POST() {
  const session = await getSession();

  if (!session?.user.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const start = performance.now();

  try {
    const results: {
      connection: { success: boolean; latencyMs: number };
      collections: Array<{
        name: string;
        exists: boolean;
        pointsCount?: number;
        indexedVectorsCount?: number;
        status?: string;
        config?: {
          vectorSize: number;
          distance: string;
        };
        error?: string;
      }>;
      errors: string[];
      totalTimeMs: number;
    } = {
      connection: { success: false, latencyMs: 0 },
      collections: [],
      errors: [],
      totalTimeMs: 0,
    };

    // Test connection with latency
    logger.info("[Qdrant Setup] Testing connection...");
    try {
      const connectionResult = await testQdrantConnection();
      results.connection = connectionResult;

      if (!connectionResult.success) {
        results.errors.push("Failed to connect to Qdrant");
        return Response.json(
          {
            success: false,
            ...results,
            totalTimeMs: Math.round(performance.now() - start),
          },
          { status: 500 },
        );
      }
    } catch (error) {
      results.errors.push(`Connection error: ${String(error)}`);
      return Response.json(
        {
          success: false,
          ...results,
          totalTimeMs: Math.round(performance.now() - start),
        },
        { status: 500 },
      );
    }

    // Initialize collections in parallel
    logger.info("[Qdrant Setup] Initializing collections...");
    try {
      await initializeCollections();
    } catch (error) {
      results.errors.push(`Failed to initialize collections: ${String(error)}`);
    }

    // Get collection status in parallel
    const client = getQdrantClient();
    const expectedCollections = [
      COLLECTIONS.DOCUMENTS,
      COLLECTIONS.MESSAGES,
      COLLECTIONS.KNOWLEDGE_BASE,
    ];

    const collectionStatuses = await Promise.all(
      expectedCollections.map(async (collectionName) => {
        try {
          const collections = await client.getCollections();
          const exists = collections.collections.some(
            (c) => c.name === collectionName,
          );

          if (exists) {
            const info = await getCollectionInfo(collectionName);
            return {
              name: collectionName,
              exists: true,
              pointsCount: info.pointsCount,
              indexedVectorsCount: info.indexedVectorsCount,
              status: info.status,
              config: {
                vectorSize: info.vectorSize,
                distance: info.distance,
              },
            };
          }
          return { name: collectionName, exists: false };
        } catch (error) {
          results.errors.push(
            `Failed to check ${collectionName}: ${String(error)}`,
          );
          return { name: collectionName, exists: false, error: String(error) };
        }
      }),
    );

    results.collections = collectionStatuses;
    results.totalTimeMs = Math.round(performance.now() - start);

    const allCollectionsExist = results.collections.every((c) => c.exists);
    const success = results.connection.success && allCollectionsExist;

    logger.info("[Qdrant Setup] Complete", {
      success,
      totalTimeMs: results.totalTimeMs,
    });

    return Response.json(
      {
        success,
        ...results,
        message: success
          ? `Qdrant setup complete in ${results.totalTimeMs}ms`
          : "Qdrant setup completed with errors",
      },
      { status: success ? 200 : 500 },
    );
  } catch (error) {
    logger.error("[Qdrant Setup] Fatal error:", error);
    return Response.json(
      {
        success: false,
        error: "Internal server error",
        details: String(error),
        totalTimeMs: Math.round(performance.now() - start),
      },
      { status: 500 },
    );
  }
}

/**
 * GET /api/qdrant/setup
 *
 * Get Qdrant status without making changes
 * Fast endpoint for health checks
 */
export async function GET() {
  const session = await getSession();

  if (!session?.user.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const start = performance.now();

  try {
    // Quick connection test
    const connectionResult = await testQdrantConnection();

    if (!connectionResult.success) {
      return Response.json(
        {
          success: false,
          connection: connectionResult,
          totalTimeMs: Math.round(performance.now() - start),
        },
        { status: 500 },
      );
    }

    const client = getQdrantClient();
    const collections = await client.getCollections();

    const expectedCollections = [
      COLLECTIONS.DOCUMENTS,
      COLLECTIONS.MESSAGES,
      COLLECTIONS.KNOWLEDGE_BASE,
    ];

    // Get all collection statuses in parallel
    const status = await Promise.all(
      expectedCollections.map(async (name) => {
        const exists = collections.collections.some((c) => c.name === name);
        if (exists) {
          const info = await getCollectionInfo(name);
          return {
            name,
            exists: true,
            pointsCount: info.pointsCount,
            indexedVectorsCount: info.indexedVectorsCount,
            status: info.status,
            config: {
              vectorSize: info.vectorSize,
              distance: info.distance,
            },
          };
        }
        return { name, exists: false };
      }),
    );

    const totalTimeMs = Math.round(performance.now() - start);

    return Response.json({
      success: true,
      connection: connectionResult,
      collections: status,
      totalTimeMs,
    });
  } catch (error) {
    logger.error("[Qdrant Setup] Status check error:", error);
    return Response.json(
      {
        success: false,
        connection: { success: false, latencyMs: 0 },
        error: String(error),
        totalTimeMs: Math.round(performance.now() - start),
      },
      { status: 500 },
    );
  }
}
