import "server-only";

import { validateCronAuth } from "lib/cron/auth";
import { pgChatRepository } from "lib/db/pg/repositories/chat-repository.pg";
import { getQdrantClient } from "lib/vector-search/qdrant-client";
import { initializeCollections } from "lib/vector-search/qdrant-service";
import { indexContent } from "lib/vector-search/vector-search-service";
import logger from "logger";

/**
 * POST /api/cron/index-embeddings
 *
 * Background job to index existing messages and documents to Qdrant
 * Can be called manually or via cron job
 */
export async function POST(request: Request) {
  const authError = validateCronAuth(request, "IndexEmbeddings");
  if (authError) return authError;

  try {
    // Initialize collections if needed
    await initializeCollections();

    const body = await request.json().catch(() => ({}));
    const {
      threadId,
      limit = 100,
      offset = 0,
    } = body as {
      threadId?: string;
      limit?: number;
      offset?: number;
    };

    let indexed = 0;
    let errors = 0;

    // Index messages (if threadId provided)
    if (threadId) {
      try {
        // Fetch thread to get userId for security filtering
        const thread = await pgChatRepository.selectThread(threadId);
        const userId = thread?.userId;

        if (!userId) {
          logger.warn(
            `Thread ${threadId} has no userId, skipping indexing for security`,
          );
        } else {
          const messages =
            await pgChatRepository.selectMessagesByThreadId(threadId);

          if (messages.length > 0) {
            const itemsToIndex = messages
              .slice(offset, offset + limit)
              .map((message) => {
                // Extract text content from message parts
                const textParts = message.parts
                  .filter((part: any) => part.type === "text")
                  .map((part: any) => part.text)
                  .join(" ");

                return {
                  id: message.id,
                  content: textParts || "",
                  payload: {
                    userId, // Include userId for security filtering
                    messageId: message.id,
                    threadId: message.threadId,
                    role: message.role,
                    createdAt: message.createdAt.toISOString(),
                  },
                };
              })
              .filter((item) => item.content.trim().length > 0);

            if (itemsToIndex.length > 0) {
              await indexContent("messages", itemsToIndex, { userId });
              indexed += itemsToIndex.length;
            }
          }
        }
      } catch (error) {
        logger.error("Failed to index messages:", error);
        errors++;
      }
    }

    logger.info(`Indexed ${indexed} items, ${errors} errors`);

    return Response.json({
      success: true,
      indexed,
      errors,
    });
  } catch (error) {
    logger.error("Index embeddings cron error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * GET /api/cron/index-embeddings
 *
 * Initialize collections (useful for one-time setup)
 * Also returns collection status and statistics
 */
export async function GET(request: Request) {
  const authError = validateCronAuth(request, "IndexEmbeddings");
  if (authError) return authError;

  try {
    await initializeCollections();

    // Get collection info
    const client = getQdrantClient();
    const collections = await client.getCollections();
    const collectionInfo = await Promise.all(
      collections.collections.map(async (c) => {
        const info = await client.getCollection(c.name);
        const vectors = info.config.params.vectors;
        return {
          name: c.name,
          pointsCount: info.points_count || 0,
          indexedVectorsCount: info.indexed_vectors_count || 0,
          config: {
            vectorSize:
              typeof vectors === "object" && "size" in vectors
                ? vectors.size
                : 1536,
            distance:
              typeof vectors === "object" && "distance" in vectors
                ? vectors.distance
                : "Cosine",
          },
        };
      }),
    );

    return Response.json({
      success: true,
      message: "Collections initialized",
      collections: collectionInfo,
    });
  } catch (error) {
    logger.error("Failed to initialize collections:", error);
    return Response.json(
      { error: "Internal server error", details: String(error) },
      { status: 500 },
    );
  }
}
