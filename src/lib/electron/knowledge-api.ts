/**
 * Unified Knowledge/Memory API for Desktop (Electron)
 *
 * This module provides a unified API for knowledge and memory operations using Electron IPC.
 * Full RAG system with knowledge bases, documents, and memories.
 * Desktop-only - no HTTP fallbacks.
 */

interface Memory {
  id: string;
  content: string;
  role?: "user" | "assistant";
  source?: "messages" | "knowledge" | "documents";
  threadId?: string;
  messageId?: string;
  createdAt?: string;
  knowledgeBaseId?: string;
  knowledgeBaseName?: string;
  fileName?: string;
  documentType?: string;
  title?: string;
  similarity?: number;
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
  documentCount: number;
  totalChunks: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Document {
  id: string;
  knowledgeBaseId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  chunkCount: number;
  status: "pending" | "processing" | "indexed" | "failed";
  errorMessage?: string;
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
 * Full RAG system with knowledge bases, documents, and memories
 */
export const knowledgeApi = {
  // ==========================================
  // MEMORY OPERATIONS
  // ==========================================

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
          similarity: r.similarity,
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

      // No search - use listMemories for paginated browsing
      // If role filter is specified, we need to fetch more data and filter client-side
      // to ensure consistent pagination (backend doesn't support role filter)
      if (role) {
        // Fetch more data to account for filtering
        const result = await window.electronAPI.knowledge.listMemories({
          userId,
          page: 1, // Start from beginning to get all for filtering
          limit: limit * 10, // Get more to have buffer after filtering
          source,
        });

        // Apply role filter
        const filteredMemories = result.memories.filter((m: Memory) => m.role === role);

        // Calculate correct pagination on filtered results
        const total = filteredMemories.length;
        const start = (page - 1) * limit;
        const paginatedMemories = filteredMemories.slice(start, start + limit);

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

      // No role filter - use backend pagination directly
      const result = await window.electronAPI.knowledge.listMemories({
        userId,
        page,
        limit,
        source,
      });

      return {
        memories: result.memories,
        pagination: result.pagination,
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
   * Update a memory (safe pattern: index new first, then delete old)
   * This prevents data loss if indexing fails
   */
  async updateMemory(
    id: string,
    content: string,
  ): Promise<{ success: boolean; content?: string; newId?: string }> {
    const userId = await getElectronUserId();

    // Generate new ID for the updated content
    // This ensures we don't lose data if anything fails
    const newId = `${id}_updated_${Date.now()}`;

    try {
      // Step 1: Index new content FIRST with new ID
      // If this fails, original data is preserved
      await window.electronAPI.memory.index([
        {
          id: newId,
          content,
          userId,
          collection: "messages",
        },
      ]);

      // Step 2: Only delete old after new is successfully indexed
      try {
        await window.electronAPI.memory.delete([id], "messages");
      } catch (deleteError) {
        // Log but don't fail - new content is saved, old will be cleaned up eventually
        console.warn("[knowledgeApi] Failed to delete old memory after update:", deleteError);
      }

      return { success: true, content, newId };
    } catch (error) {
      console.error("[knowledgeApi] Error updating memory (original preserved):", error);
      return { success: false };
    }
  },

  /**
   * Bulk delete memories
   */
  async bulkDeleteMemories(
    ids: string[],
    _role?: "user" | "assistant",
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
      return await window.electronAPI.knowledge.getStats();
    } catch (error) {
      console.error("[knowledgeApi] Error getting stats:", error);
      return { messages: 0, documents: 0, available: false };
    }
  },

  // ==========================================
  // KNOWLEDGE BASE OPERATIONS
  // ==========================================

  /**
   * Get all knowledge bases for current user
   */
  async getKnowledgeBases(): Promise<KnowledgeBase[]> {
    try {
      const userId = await getElectronUserId();
      const result = await window.electronAPI.knowledge.listBases(userId);
      return result.knowledgeBases || [];
    } catch (error) {
      console.error("[knowledgeApi] Error getting knowledge bases:", error);
      return [];
    }
  },

  /**
   * Get a single knowledge base by ID
   */
  async getKnowledgeBase(id: string): Promise<KnowledgeBase | null> {
    try {
      const userId = await getElectronUserId();
      const result = await window.electronAPI.knowledge.getBase(id, userId);
      return result.knowledgeBase || null;
    } catch (error) {
      console.error("[knowledgeApi] Error getting knowledge base:", error);
      return null;
    }
  },

  /**
   * Create a new knowledge base
   */
  async createKnowledgeBase(data: {
    name: string;
    description?: string;
  }): Promise<KnowledgeBase | null> {
    try {
      const userId = await getElectronUserId();
      const result = await window.electronAPI.knowledge.createBase({
        name: data.name,
        description: data.description,
        userId,
      });
      return result.knowledgeBase || null;
    } catch (error) {
      console.error("[knowledgeApi] Error creating knowledge base:", error);
      return null;
    }
  },

  /**
   * Update a knowledge base
   */
  async updateKnowledgeBase(
    id: string,
    data: { name?: string; description?: string },
  ): Promise<KnowledgeBase | null> {
    try {
      const userId = await getElectronUserId();
      const result = await window.electronAPI.knowledge.updateBase(id, userId, data);
      return result.knowledgeBase || null;
    } catch (error) {
      console.error("[knowledgeApi] Error updating knowledge base:", error);
      return null;
    }
  },

  /**
   * Delete a knowledge base and all its documents
   */
  async deleteKnowledgeBase(id: string): Promise<{ success: boolean }> {
    try {
      const userId = await getElectronUserId();
      const result = await window.electronAPI.knowledge.deleteBase(id, userId);
      return { success: result.success };
    } catch (error) {
      console.error("[knowledgeApi] Error deleting knowledge base:", error);
      return { success: false };
    }
  },

  // ==========================================
  // DOCUMENT OPERATIONS
  // ==========================================

  /**
   * Open file selection dialog
   */
  async selectFile(): Promise<{ filePath: string; fileName: string } | null> {
    try {
      const result = await window.electronAPI.knowledge.selectFile();
      if (!result || !result.filePath) {
        return null;
      }
      return {
        filePath: result.filePath,
        fileName: result.fileName,
      };
    } catch (error) {
      console.error("[knowledgeApi] Error selecting file:", error);
      return null;
    }
  },

  /**
   * Upload and index a document to a knowledge base
   */
  async uploadDocument(
    knowledgeBaseId: string,
    filePath: string,
    fileName: string,
  ): Promise<Document | null> {
    try {
      const userId = await getElectronUserId();
      const result = await window.electronAPI.knowledge.uploadDocument({
        knowledgeBaseId,
        userId,
        filePath,
        fileName,
      });
      return result.document || null;
    } catch (error) {
      console.error("[knowledgeApi] Error uploading document:", error);
      return null;
    }
  },

  /**
   * Get all documents in a knowledge base
   */
  async getDocuments(knowledgeBaseId: string): Promise<Document[]> {
    try {
      const userId = await getElectronUserId();
      const result = await window.electronAPI.knowledge.listDocuments(knowledgeBaseId, userId);
      return result.documents || [];
    } catch (error) {
      console.error("[knowledgeApi] Error getting documents:", error);
      return [];
    }
  },

  /**
   * Delete a document
   */
  async deleteDocument(documentId: string): Promise<{ success: boolean }> {
    try {
      const userId = await getElectronUserId();
      const result = await window.electronAPI.knowledge.deleteDocument(documentId, userId);
      return { success: result.success };
    } catch (error) {
      console.error("[knowledgeApi] Error deleting document:", error);
      return { success: false };
    }
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

  // Handle /api/knowledge/bases/:id
  if (url.match(/^\/api\/knowledge\/bases\/[^/]+$/)) {
    const id = url.split("/").pop()!;
    return knowledgeApi.getKnowledgeBase(id);
  }

  // Handle /api/knowledge/bases/:id/documents
  if (url.match(/^\/api\/knowledge\/bases\/[^/]+\/documents$/)) {
    const parts = url.split("/");
    const knowledgeBaseId = parts[parts.length - 2];
    return knowledgeApi.getDocuments(knowledgeBaseId);
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
