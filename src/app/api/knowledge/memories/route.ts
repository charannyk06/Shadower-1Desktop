import { getSession } from "auth/server";
import { NextResponse } from "next/server";
import { scrollPoints } from "lib/vector-search/qdrant-service";
import { COLLECTIONS } from "lib/vector-search/qdrant-client";
import { semanticSearch } from "lib/vector-search/vector-search-service";
import logger from "logger";

export const dynamic = "force-dynamic";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/**
 * GET /api/knowledge/memories
 * List memories with pagination, search, and role filtering
 * Query params:
 * - page: page number (default: 1)
 * - limit: items per page (default: 20, max: 100)
 * - search: search query (optional, uses semantic search)
 * - role: filter by role "user" | "assistant" (optional, only for messages)
 * - source: filter by source "all" | "messages" | "knowledge" | "documents" (default: "messages")
 */
export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(
      MAX_PAGE_SIZE,
      Math.max(
        1,
        parseInt(searchParams.get("limit") || String(DEFAULT_PAGE_SIZE), 10),
      ),
    );
    const searchQuery = searchParams.get("search")?.trim() || undefined;
    const roleFilter = searchParams.get("role") as
      | "user"
      | "assistant"
      | undefined;
    const sourceFilter = (searchParams.get("source") || "all") as
      | "all"
      | "messages"
      | "knowledge"
      | "documents";

    // Build base filter for userId
    const baseFilter: any = {
      must: [
        {
          key: "userId",
          match: { value: session.user.id },
        },
      ],
    };

    // Add role filter if specified
    if (roleFilter) {
      baseFilter.must.push({
        key: "role",
        match: { value: roleFilter },
      });
    }

    type MemoryItem = {
      id: string;
      content: string;
      role?: string;
      source: "memory" | "knowledge" | "documents";
      threadId?: string;
      messageId?: string;
      createdAt?: string;
      userId?: string;
      // Knowledge base specific
      knowledgeBaseId?: string;
      knowledgeBaseName?: string;
      fileName?: string;
      // Document specific
      documentType?: string;
      title?: string;
    };

    let memories: MemoryItem[] = [];
    let total = 0;

    // Determine which collections to search
    const collectionsToSearch: Array<{
      name: "messages" | "knowledge" | "documents";
      collection: string;
    }> = [];

    if (sourceFilter === "all") {
      collectionsToSearch.push(
        { name: "messages", collection: COLLECTIONS.MESSAGES },
        { name: "knowledge", collection: COLLECTIONS.KNOWLEDGE_BASE },
        { name: "documents", collection: COLLECTIONS.DOCUMENTS },
      );
    } else if (sourceFilter === "messages") {
      collectionsToSearch.push({
        name: "messages",
        collection: COLLECTIONS.MESSAGES,
      });
    } else if (sourceFilter === "knowledge") {
      collectionsToSearch.push({
        name: "knowledge",
        collection: COLLECTIONS.KNOWLEDGE_BASE,
      });
    } else if (sourceFilter === "documents") {
      collectionsToSearch.push({
        name: "documents",
        collection: COLLECTIONS.DOCUMENTS,
      });
    }

    if (searchQuery && searchQuery.length > 0) {
      // Use semantic search for text queries across selected collections
      try {
        const searchPromises = collectionsToSearch.map(({ name }) =>
          semanticSearch(searchQuery, name, {
            limit: 1000, // Get more results for pagination
            scoreThreshold: 0.3, // Lower threshold for broader results
            filters: {
              userId: session.user.id,
              ...(roleFilter && name === "messages"
                ? { role: roleFilter }
                : {}),
            },
            useCache: true,
          })
            .then((results) =>
              results.map((result) => {
                const payload = result.payload || {};
                const baseItem: MemoryItem = {
                  id: String(result.id),
                  content: String(payload.content || ""),
                  source: name === "messages" ? "memory" : name,
                  createdAt: payload.createdAt as string | undefined,
                  userId: payload.userId as string | undefined,
                };

                if (name === "messages") {
                  return {
                    ...baseItem,
                    role: String(payload.role || "user"),
                    threadId: payload.threadId as string | undefined,
                    messageId: payload.messageId as string | undefined,
                  };
                } else if (name === "knowledge") {
                  return {
                    ...baseItem,
                    knowledgeBaseId: payload.knowledgeBaseId as
                      | string
                      | undefined,
                    knowledgeBaseName: payload.knowledgeBaseName as
                      | string
                      | undefined,
                    fileName: payload.fileName as string | undefined,
                  };
                } else {
                  // documents
                  return {
                    ...baseItem,
                    fileName: payload.fileName as string | undefined,
                    documentType: payload.documentType as string | undefined,
                    title: payload.title as string | undefined,
                    threadId: payload.threadId as string | undefined,
                  };
                }
              }),
            )
            .catch((error) => {
              logger.warn(
                `[Knowledge API] Failed to search ${name} collection:`,
                error,
              );
              return [];
            }),
        );

        const allResults = await Promise.all(searchPromises);
        memories = allResults.flat();

        // Sort by createdAt (newest first), then by source priority
        memories.sort((a, b) => {
          const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          if (dateB !== dateA) {
            return dateB - dateA; // Newest first
          }
          // If same date, prioritize: knowledge > documents > memory
          const priority = { knowledge: 3, documents: 2, memory: 1 };
          return (
            priority[b.source as keyof typeof priority] -
            priority[a.source as keyof typeof priority]
          );
        });

        total = memories.length;

        // Apply pagination to search results
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;
        memories = memories.slice(startIndex, endIndex);
      } catch (searchError: any) {
        logger.warn(
          "[Knowledge API] Semantic search failed, falling back to scroll:",
          searchError,
        );
        // Fallback to scroll if semantic search fails
        const scrollPromises = collectionsToSearch.map(({ name, collection }) =>
          scrollPoints(collection, {
            limit: limit * page * 2, // Get enough for current page
            filter: baseFilter,
            withPayload: true,
            withVector: false,
          })
            .then((result) =>
              result.points
                .map((point) => {
                  const payload = point.payload || {};
                  const baseItem: MemoryItem = {
                    id: String(point.id),
                    content: String(payload.content || ""),
                    source: name === "messages" ? "memory" : name,
                    createdAt: payload.createdAt as string | undefined,
                    userId: payload.userId as string | undefined,
                  };

                  if (name === "messages") {
                    return {
                      ...baseItem,
                      role: String(payload.role || "user"),
                      threadId: payload.threadId as string | undefined,
                      messageId: payload.messageId as string | undefined,
                    };
                  } else if (name === "knowledge") {
                    return {
                      ...baseItem,
                      knowledgeBaseId: payload.knowledgeBaseId as
                        | string
                        | undefined,
                      knowledgeBaseName: payload.knowledgeBaseName as
                        | string
                        | undefined,
                      fileName: payload.fileName as string | undefined,
                    };
                  } else {
                    // documents
                    return {
                      ...baseItem,
                      fileName: payload.fileName as string | undefined,
                      documentType: payload.documentType as string | undefined,
                      title: payload.title as string | undefined,
                      threadId: payload.threadId as string | undefined,
                    };
                  }
                })
                .filter((m) =>
                  searchQuery
                    ? m.content
                        .toLowerCase()
                        .includes(searchQuery.toLowerCase())
                    : true,
                ),
            )
            .catch((error) => {
              logger.warn(
                `[Knowledge API] Failed to scroll ${name} collection:`,
                error,
              );
              return [];
            }),
        );

        const allResults = await Promise.all(scrollPromises);
        memories = allResults.flat();

        // Sort by createdAt (newest first)
        memories.sort((a, b) => {
          const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return dateB - dateA; // Newest first
        });

        total = memories.length;
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;
        memories = memories.slice(startIndex, endIndex);
      }
    } else {
      // Use scrollPoints for non-search queries
      // For multiple collections, we need to merge and paginate across all
      if (collectionsToSearch.length > 1) {
        // Fetch from all collections and merge
        const scrollPromises = collectionsToSearch.map(({ name, collection }) =>
          scrollPoints(collection, {
            limit: limit * page * 2, // Get enough for pagination
            filter: baseFilter,
            withPayload: true,
            withVector: false,
          })
            .then((result) =>
              result.points.map((point) => {
                const payload = point.payload || {};
                const baseItem: MemoryItem = {
                  id: String(point.id),
                  content: String(payload.content || ""),
                  source: name === "messages" ? "memory" : name,
                  createdAt: payload.createdAt as string | undefined,
                  userId: payload.userId as string | undefined,
                };

                if (name === "messages") {
                  return {
                    ...baseItem,
                    role: String(payload.role || "user"),
                    threadId: payload.threadId as string | undefined,
                    messageId: payload.messageId as string | undefined,
                  };
                } else if (name === "knowledge") {
                  return {
                    ...baseItem,
                    knowledgeBaseId: payload.knowledgeBaseId as
                      | string
                      | undefined,
                    knowledgeBaseName: payload.knowledgeBaseName as
                      | string
                      | undefined,
                    fileName: payload.fileName as string | undefined,
                  };
                } else {
                  // documents
                  return {
                    ...baseItem,
                    fileName: payload.fileName as string | undefined,
                    documentType: payload.documentType as string | undefined,
                    title: payload.title as string | undefined,
                    threadId: payload.threadId as string | undefined,
                  };
                }
              }),
            )
            .catch((error) => {
              logger.warn(
                `[Knowledge API] Failed to scroll ${name} collection:`,
                error,
              );
              return [];
            }),
        );

        const allResults = await Promise.all(scrollPromises);
        const allMemories = allResults.flat();

        // Sort by createdAt (newest first), then by source priority
        allMemories.sort((a, b) => {
          const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          if (dateB !== dateA) {
            return dateB - dateA; // Newest first
          }
          // If same date, prioritize: knowledge > documents > memory
          const priority = { knowledge: 3, documents: 2, memory: 1 };
          return (
            priority[b.source as keyof typeof priority] -
            priority[a.source as keyof typeof priority]
          );
        });

        total = allMemories.length;
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;
        memories = allMemories.slice(startIndex, endIndex);
      } else {
        // Single collection - use efficient scrolling
        const { name, collection } = collectionsToSearch[0]!;
        let currentOffset: string | number | undefined = undefined;
        let currentPageNum = 1;

        // Scroll to the desired page (skip previous pages)
        while (currentPageNum < page) {
          const batch = await scrollPoints(collection, {
            limit,
            offset: currentOffset,
            filter: baseFilter,
            withPayload: false, // Don't need payload for skipping pages
            withVector: false,
          });
          if (!batch.nextOffset) {
            // Reached end before desired page
            return NextResponse.json({
              memories: [],
              pagination: {
                page,
                limit,
                total: (currentPageNum - 1) * limit,
                totalPages: currentPageNum - 1,
                hasMore: false,
              },
            });
          }
          currentOffset = batch.nextOffset;
          currentPageNum++;
        }

        // Get the actual page data
        const result = await scrollPoints(collection, {
          limit,
          offset: currentOffset,
          filter: baseFilter,
          withPayload: true,
          withVector: false,
        });

        memories = result.points.map((point) => {
          const payload = point.payload || {};
          const baseItem: MemoryItem = {
            id: String(point.id),
            content: String(payload.content || ""),
            source: name === "messages" ? "memory" : name,
            createdAt: payload.createdAt as string | undefined,
            userId: payload.userId as string | undefined,
          };

          if (name === "messages") {
            return {
              ...baseItem,
              role: String(payload.role || "user"),
              threadId: payload.threadId as string | undefined,
              messageId: payload.messageId as string | undefined,
            };
          } else if (name === "knowledge") {
            return {
              ...baseItem,
              knowledgeBaseId: payload.knowledgeBaseId as string | undefined,
              knowledgeBaseName: payload.knowledgeBaseName as
                | string
                | undefined,
              fileName: payload.fileName as string | undefined,
            };
          } else {
            // documents
            return {
              ...baseItem,
              fileName: payload.fileName as string | undefined,
              documentType: payload.documentType as string | undefined,
              title: payload.title as string | undefined,
              threadId: payload.threadId as string | undefined,
            };
          }
        });

        // Calculate total: if there's a next page, estimate; otherwise exact
        if (result.nextOffset !== null) {
          // More pages exist - estimate total
          total = page * limit + limit; // Conservative estimate
        } else {
          // Last page - exact total
          total = (page - 1) * limit + memories.length;
        }
      }
    }

    const totalPages = Math.ceil(total / limit);

    return NextResponse.json({
      memories,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasMore: page < totalPages,
      },
    });
  } catch (error: any) {
    logger.error("[Knowledge API] Failed to list memories:", error);
    return NextResponse.json(
      { error: error.message || "Failed to list memories" },
      { status: 500 },
    );
  }
}
