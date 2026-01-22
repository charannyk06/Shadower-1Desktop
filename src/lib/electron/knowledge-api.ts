/**
 * Unified Knowledge/Memory API for Desktop (Electron)
 *
 * This module provides a unified API for knowledge and memory operations using Electron IPC.
 * Desktop-only - no HTTP fallbacks.
 */

interface Memory {
  id: string;
  content: string;
  role?: "user" | "assistant";
  source?: "memory" | "knowledge" | "documents";
  threadId?: string;
  messageId?: string;
  createdAt?: string;
  knowledgeBaseId?: string;
  knowledgeBaseName?: string;
  fileName?: string;
  documentType?: string;
  title?: string;
}

interface MemoryPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

interface KnowledgeBase {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Get current user ID from Electron auth
 */
async function getElectronUserId(): Promise<string> {
  const user = await window.electronAPI.auth.getCurrentUser();
  return user?.id || "local-user";
}

/**
 * Unified Knowledge API - Desktop Only (IPC)
 */
export const knowledgeApi = {
  /**
   * Get memories with pagination and filters
   */
  async getMemories(params: {
    page?: number;
    limit?: number;
    search?: string;
    role?: "user" | "assistant";
    source?: "all" | "messages" | "knowledge" | "documents";
  }): Promise<{
    memories: Memory[];
    pagination: MemoryPagination;
  }> {
    const userId = await getElectronUserId();
    const {
      page = 1,
      limit = 20,
      search,
      role,
      source = "all",
    } = params;

    try {
      // If searching, use the vector search
      if (search && search.trim().length >= 3) {
        // Map source filter to collections
        let collections: Array<"messages" | "documents" | "knowledge"> = [
          "messages",
          "documents",
          "knowledge",
        ];
        if (source === "messages") {
          collections = ["messages"];
        } else if (source === "knowledge") {
          collections = ["knowledge"];
        } else if (source === "documents") {
          collections = ["documents"];
        }

        const searchResult = await window.electronAPI.memory.search(search, {
          collections,
          limit: limit * 2, // Get more for filtering
          userId,
        });

        let memories = searchResult.results.map((r: any) => ({
          id: r.id,
          content: r.content,
          role: r.role,
          source: r.source,
          threadId: r.threadId,
          messageId: r.messageId,
          createdAt: r.createdAt,
        }));

        // Apply role filter if specified
        if (role) {
          memories = memories.filter((m: Memory) => m.role === role);
        }

        // Apply pagination
        const total = memories.length;
        const start = (page - 1) * limit;
        const paginatedMemories = memories.slice(start, start + limit);

        return {
          memories: paginatedMemories,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
            hasMore: start + limit < total,
          },
        };
      }

      // No search - get stats and return empty for now
      // In a full implementation, we'd query the vector store directly
      const stats = await window.electronAPI.memory.getStats();

      return {
        memories: [],
        pagination: {
          page,
          limit,
          total: stats.messages + stats.documents,
          totalPages: 0,
          hasMore: false,
        },
      };
    } catch (error) {
      console.error("[knowledgeApi] Error getting memories:", error);
      return {
        memories: [],
        pagination: {
          page,
          limit,
          total: 0,
          totalPages: 0,
          hasMore: false,
        },
      };
    }
  },

  /**
   * Delete a memory
   */
  async deleteMemory(id: string): Promise<{ success: boolean }> {
    try {
      const result = await window.electronAPI.memory.delete([id], "messages");
      return { success: result.success };
    } catch (error) {
      console.error("[knowledgeApi] Error deleting memory:", error);
      return { success: false };
    }
  },

  /**
   * Update a memory
   */
  async updateMemory(
    id: string,
    content: string,
  ): Promise<{ success: boolean; content?: string }> {
    try {
      // Delete old and re-index with new content
      await window.electronAPI.memory.delete([id], "messages");

      const userId = await getElectronUserId();
      await window.electronAPI.memory.index([
        {
          id,
          content,
          userId,
          collection: "messages",
        },
      ]);

      return { success: true, content };
    } catch (error) {
      console.error("[knowledgeApi] Error updating memory:", error);
      return { success: false };
    }
  },

  /**
   * Bulk delete memories
   */
  async bulkDeleteMemories(
    ids: string[],
    role?: "user" | "assistant",
  ): Promise<{ success: boolean; deleted: number }> {
    try {
      const result = await window.electronAPI.memory.delete(ids, "messages");
      return { success: result.success, deleted: result.deleted };
    } catch (error) {
      console.error("[knowledgeApi] Error bulk deleting memories:", error);
      return { success: false, deleted: 0 };
    }
  },

  /**
   * Get memory statistics
   */
  async getStats(): Promise<{
    messages: number;
    documents: number;
    available: boolean;
  }> {
    try {
      return await window.electronAPI.memory.getStats();
    } catch (error) {
      console.error("[knowledgeApi] Error getting stats:", error);
      return { messages: 0, documents: 0, available: false };
    }
  },

  /**
   * Get knowledge bases
   * Note: Knowledge bases feature is limited in desktop mode
   */
  async getKnowledgeBases(): Promise<KnowledgeBase[]> {
    console.log("[knowledgeApi] Knowledge bases not fully supported in desktop mode");
    return [];
  },

  /**
   * Create a knowledge base
   * Note: Knowledge bases feature is limited in desktop mode
   */
  async createKnowledgeBase(data: {
    name: string;
    description?: string;
  }): Promise<KnowledgeBase | null> {
    console.log("[knowledgeApi] Knowledge bases not fully supported in desktop mode");
    return null;
  },
};

/**
 * SWR-compatible fetcher that uses the knowledge API
 */
export async function knowledgeFetcher(url: string): Promise<any> {
  // Handle /api/knowledge/memories
  if (url.startsWith("/api/knowledge/memories")) {
    const urlObj = new URL(url, "http://localhost");
    const params = {
      page: parseInt(urlObj.searchParams.get("page") || "1", 10),
      limit: parseInt(urlObj.searchParams.get("limit") || "20", 10),
      search: urlObj.searchParams.get("search") || undefined,
      role: urlObj.searchParams.get("role") as "user" | "assistant" | undefined,
      source: (urlObj.searchParams.get("source") || "all") as
        | "all"
        | "messages"
        | "knowledge"
        | "documents",
    };
    return knowledgeApi.getMemories(params);
  }

  // Handle /api/knowledge/bases
  if (url === "/api/knowledge/bases" || url === "/api/knowledge/bases/") {
    return knowledgeApi.getKnowledgeBases();
  }

  // Handle /api/knowledge/stats
  if (url === "/api/knowledge/stats" || url === "/api/knowledge/stats/") {
    return knowledgeApi.getStats();
  }

  // Unrecognized pattern
  console.warn(
    `[knowledgeFetcher] Unrecognized URL pattern: ${url}, returning empty`,
  );
  return { memories: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0, hasMore: false } };
}

export default knowledgeApi;
