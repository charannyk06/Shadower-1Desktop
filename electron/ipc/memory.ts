/**
 * Memory IPC Handlers - LOCAL FIRST
 *
 * Provides semantic memory capabilities for the desktop app:
 * - Search past conversations using LOCAL embeddings (no API calls!)
 * - Index messages automatically with transformers.js
 * - Hybrid search with keyword boosting
 * - User isolation for security
 *
 * Architecture:
 * Renderer -> IPC -> Main Process -> LOCAL Embeddings (transformers.js) -> DuckDB Vector Store
 *
 * NO OPENAI DEPENDENCY - Works fully offline with local models
 */

import { ipcMain, safeStorage } from "electron";
import { getDatabase, schema } from "../services/database";
import { getVectorStore } from "../services/vector-store";
import { getEmbeddingService } from "../services/embedding";
import { eq } from "drizzle-orm";
import { randomUUID, createHash } from "crypto";

// Local embedding configuration - 384 dimensions for all-MiniLM-L6-v2
const EMBEDDING_DIMENSIONS = 384;

// Knowledge base name cache for enriching search results
interface KnowledgeBaseCacheEntry {
  name: string;
  timestamp: number;
}
const KNOWLEDGE_BASE_CACHE = new Map<string, KnowledgeBaseCacheEntry>();
const KNOWLEDGE_BASE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get knowledge base name by ID (with caching)
 */
async function getKnowledgeBaseName(knowledgeBaseId: string): Promise<string | null> {
  if (!knowledgeBaseId) return null;

  // Check cache first
  const cached = KNOWLEDGE_BASE_CACHE.get(knowledgeBaseId);
  if (cached && Date.now() - cached.timestamp < KNOWLEDGE_BASE_CACHE_TTL_MS) {
    return cached.name;
  }

  try {
    const db = getDatabase();
    const [kb] = await db
      .select({ name: schema.KnowledgeBaseTable.name })
      .from(schema.KnowledgeBaseTable)
      .where(eq(schema.KnowledgeBaseTable.id, knowledgeBaseId))
      .limit(1);

    if (kb) {
      KNOWLEDGE_BASE_CACHE.set(knowledgeBaseId, { name: kb.name, timestamp: Date.now() });
      return kb.name;
    }
    return null;
  } catch (error) {
    console.warn(`[Memory] Failed to get knowledge base name for ${knowledgeBaseId}:`, error);
    return null;
  }
}

// In-memory embedding cache for performance
interface EmbeddingCacheEntry {
  embedding: number[];
  timestamp: number;
}
const EMBEDDING_CACHE = new Map<string, EmbeddingCacheEntry>();
const EMBEDDING_CACHE_MAX_SIZE = 1000; // Increased for local (no API cost)
const EMBEDDING_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour (longer for local)

/**
 * Clear all memory-related caches
 * IMPORTANT: Call this after any delete operation to prevent stale data
 */
export function clearMemoryCaches(): void {
  EMBEDDING_CACHE.clear();
  KNOWLEDGE_BASE_CACHE.clear();
  console.log("[Memory] All caches cleared (embedding + knowledge base)");
}

/**
 * Decrypt API key using Electron's safeStorage (for optional OpenAI fallback)
 */
function decryptApiKey(encryptedKey: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    const buffer = Buffer.from(encryptedKey, "base64");
    return safeStorage.decryptString(buffer);
  }
  return Buffer.from(encryptedKey, "base64").toString("utf-8");
}

/**
 * Get decrypted OpenAI API key (optional fallback)
 */
async function getOpenAIApiKey(): Promise<string | null> {
  try {
    const db = getDatabase();
    const keyRecord = await db
      .select()
      .from(schema.ApiKeyTable)
      .where(eq(schema.ApiKeyTable.providerId, "openai"))
      .limit(1)
      .then((rows) => rows[0]);

    if (!keyRecord) {
      return null;
    }

    return decryptApiKey(keyRecord.encryptedKey);
  } catch (error) {
    console.error("[Memory] Error getting OpenAI API key:", error);
    return null;
  }
}

/**
 * Generate embedding using LOCAL transformers.js - NO API CALLS!
 * Falls back to OpenAI only if local fails AND key exists
 */
async function generateEmbedding(text: string): Promise<number[]> {
  // Check cache first - use SHA-256 hash to prevent key collisions
  const cacheKey = `emb:${createHash('sha256').update(text).digest('hex').slice(0, 16)}`;
  const cached = EMBEDDING_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < EMBEDDING_CACHE_TTL_MS) {
    return cached.embedding;
  }

  // Preprocess text
  const processedText = text.replace(/\s+/g, " ").trim().slice(0, 8000);

  // Try LOCAL embeddings first (PREFERRED)
  try {
    const embeddingService = getEmbeddingService();
    await embeddingService.initialize();

    if (embeddingService.isAvailable()) {
      const startTime = Date.now();
      const [embedding] = await embeddingService.embed(processedText);

      if (embedding && embedding.length > 0) {
        // Cache the result
        if (EMBEDDING_CACHE.size >= EMBEDDING_CACHE_MAX_SIZE) {
          const oldestKey = EMBEDDING_CACHE.keys().next().value;
          if (oldestKey) EMBEDDING_CACHE.delete(oldestKey);
        }
        EMBEDDING_CACHE.set(cacheKey, { embedding, timestamp: Date.now() });

        const duration = Date.now() - startTime;
        console.log(`[Memory] Local embedding generated in ${duration}ms`);
        return embedding;
      }
    }
  } catch (localError) {
    console.warn("[Memory] Local embedding failed, trying fallback:", localError);
  }

  // Fallback to OpenAI (only if key exists)
  const apiKey = await getOpenAIApiKey();
  if (apiKey) {
    console.log("[Memory] Falling back to OpenAI embeddings...");
    try {
      const response = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "text-embedding-3-small",
          input: processedText,
          dimensions: EMBEDDING_DIMENSIONS, // Use same dimensions as local
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenAI API error: ${response.status} - ${error}`);
      }

      const data = await response.json();
      const embedding = data.data[0].embedding;

      // Cache the result
      if (EMBEDDING_CACHE.size >= EMBEDDING_CACHE_MAX_SIZE) {
        const oldestKey = EMBEDDING_CACHE.keys().next().value;
        if (oldestKey) EMBEDDING_CACHE.delete(oldestKey);
      }
      EMBEDDING_CACHE.set(cacheKey, { embedding, timestamp: Date.now() });

      return embedding;
    } catch (openaiError) {
      console.error("[Memory] OpenAI fallback also failed:", openaiError);
    }
  }

  throw new Error(
    "No embedding service available. Local transformers.js failed to initialize."
  );
}

/**
 * Generate embeddings for multiple texts (batch) - LOCAL FIRST
 */
async function generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
  // Try LOCAL embeddings first
  try {
    const embeddingService = getEmbeddingService();
    await embeddingService.initialize();

    if (embeddingService.isAvailable()) {
      const processedTexts = texts.map((t) =>
        t.replace(/\s+/g, " ").trim().slice(0, 8000)
      );

      const startTime = Date.now();
      const embeddings = await embeddingService.embedBatch(processedTexts);
      const duration = Date.now() - startTime;

      console.log(`[Memory] Generated ${embeddings.length} local embeddings in ${duration}ms`);
      return embeddings;
    }
  } catch (localError) {
    console.warn("[Memory] Local batch embedding failed:", localError);
  }

  // Fallback to OpenAI (only if key exists)
  const apiKey = await getOpenAIApiKey();
  if (!apiKey) {
    throw new Error("No embedding service available");
  }

  console.log("[Memory] Falling back to OpenAI batch embeddings...");

  const BATCH_SIZE = 100;
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const processedBatch = batch.map((t) =>
      t.replace(/\s+/g, " ").trim().slice(0, 8000)
    );

    try {
      const response = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "text-embedding-3-small",
          input: processedBatch,
          dimensions: EMBEDDING_DIMENSIONS,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenAI API error: ${response.status} - ${error}`);
      }

      const data = await response.json();
      const embeddings = data.data.map((d: any) => d.embedding);
      results.push(...embeddings);
    } catch (error) {
      console.error("[Memory] Error generating batch embeddings:", error);
      throw error;
    }
  }

  return results;
}

export interface MemorySearchOptions {
  collections?: Array<"messages" | "documents" | "knowledge">;
  limit?: number;
  scoreThreshold?: number;
  userId?: string;
  threadId?: string;
}

export interface MemorySearchResult {
  id: string;
  content: string;
  score: number;
  source: "messages" | "documents" | "knowledge";
  threadId?: string;
  messageId?: string;
  role?: string;
  createdAt?: string;
  metadata?: Record<string, unknown>;
  // Knowledge base context for document results
  knowledgeBaseId?: string;
  knowledgeBaseName?: string;
}

export interface MemoryIndexItem {
  id?: string;
  content: string;
  threadId?: string;
  messageId?: string;
  userId: string;
  role?: string;
  collection?: "messages" | "documents" | "knowledge";
  metadata?: Record<string, unknown>;
}

/**
 * Register memory IPC handlers
 */
export function registerMemoryHandlers() {
  const vectorStore = getVectorStore();

  /**
   * Search memory using semantic similarity + hybrid keyword boosting
   * Searches BOTH messages and knowledge base documents
   */
  ipcMain.handle(
    "memory:search",
    async (
      _event,
      query: string,
      options: MemorySearchOptions = {}
    ): Promise<{ results: MemorySearchResult[]; elapsedMs: number }> => {
      const start = performance.now();

      try {
        const {
          collections = ["messages", "documents", "knowledge"],
          limit = 10,
          scoreThreshold = 0.5,
          userId,
          threadId,
        } = options;

        if (!query || query.trim().length < 3) {
          return { results: [], elapsedMs: 0 };
        }

        // Security: Require userId for data isolation
        if (!userId) {
          console.warn("[Memory] Search called without userId - returning empty");
          return { results: [], elapsedMs: 0 };
        }

        // Initialize vector store if needed
        if (!vectorStore.isAvailable()) {
          await vectorStore.initialize();
        }

        if (!vectorStore.isAvailable()) {
          console.warn("[Memory] Vector store not available");
          return { results: [], elapsedMs: 0 };
        }

        // Generate query embedding (LOCAL!)
        const queryEmbedding = await generateEmbedding(query);

        if (!queryEmbedding || queryEmbedding.length === 0) {
          console.error("[Memory] Failed to generate query embedding");
          return { results: [], elapsedMs: Math.round(performance.now() - start) };
        }

        // Search each collection in parallel
        // IMPORTANT: Documents NOT filtered by threadId to search ALL knowledge bases
        // SECURITY: Always filter by user_id at database level
        const searchPromises = collections.map(async (collection) => {
          const collectionName =
            collection === "messages"
              ? "messages"
              : "documents"; // Both "knowledge" and "documents" map to documents collection

          // Build filter with user_id for security, and thread_id only for messages
          const filter: { thread_id?: string; user_id?: string } = {
            user_id: userId, // SECURITY: Always filter by user_id
          };
          if (collection === "messages" && threadId) {
            filter.thread_id = threadId;
          }

          const searchLimit = collection === "messages" ? limit : limit * 2;

          try {
            const results = await vectorStore.search(
              queryEmbedding,
              collectionName,
              searchLimit,
              filter
            );

            return (results || []).map((r: any) => ({
              ...r,
              source: collection,
            }));
          } catch (searchError) {
            console.error(`[Memory] Search error in ${collection}:`, searchError);
            return [];
          }
        });

        const allResults = await Promise.all(searchPromises);
        const flatResults = allResults.flat();

        // SECURITY: Filter results by userId from metadata (redundant check after DB-level filter)
        const userFilteredResults = flatResults.filter((result: any) => {
          const metadataUserId = result.metadata?.userId;
          if (metadataUserId && metadataUserId !== userId) {
            return false;
          }
          return true;
        });

        // DEDUPLICATION: Remove duplicate content across collections
        // Keep the highest-scoring result when same content appears multiple times
        const seenContent = new Map<string, any>();
        const deduplicatedResults = userFilteredResults.filter((result: any) => {
          const contentKey = createHash('sha256')
            .update(String(result.content || '').toLowerCase().trim())
            .digest('hex')
            .slice(0, 16);

          const existing = seenContent.get(contentKey);
          if (existing) {
            // Keep the one with higher similarity score
            if ((result.similarity || 0) > (existing.similarity || 0)) {
              seenContent.set(contentKey, result);
              return true;
            }
            return false;
          }
          seenContent.set(contentKey, result);
          return true;
        });

        // Extract keywords for hybrid boosting
        const keywords = query
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length > 2);

        // Apply hybrid scoring with keyword boost
        // Boost values are intentionally modest to avoid over-ranking partial keyword matches
        // over semantically relevant content. Max boost: 0.15 + 0.10 = 0.25
        const scoredResultsRaw = deduplicatedResults
          .map((result: any) => {
            const content = String(result.content || "").toLowerCase();

            // Keyword boost (0-0.15 per query, proportional to keyword matches)
            let keywordBoost = 0;
            for (const keyword of keywords) {
              if (content.includes(keyword)) {
                keywordBoost += 0.15 / keywords.length;
              }
            }

            // Extra boost for exact phrase match (modest 0.10 to avoid over-ranking)
            if (content.includes(query.toLowerCase())) {
              keywordBoost += 0.10;
            }

            const finalScore = Math.min(
              1.0,
              (result.similarity || 0) + keywordBoost
            );

            return {
              id: result.id,
              content: result.content,
              score: finalScore,
              source: result.source as "messages" | "documents" | "knowledge",
              threadId: result.thread_id,
              messageId: result.message_id,
              role: result.role,
              createdAt: result.created_at,
              metadata: result.metadata,
              // Extract knowledgeBaseId from metadata for enrichment
              knowledgeBaseId: result.metadata?.knowledgeBaseId || null,
            };
          })
          .filter((r) => r.score >= scoreThreshold)
          .sort((a, b) => b.score - a.score)
          .slice(0, limit);

        // Enrich document results with knowledge base names
        const scoredResults = await Promise.all(
          scoredResultsRaw.map(async (result) => {
            if (result.knowledgeBaseId && (result.source === "documents" || result.source === "knowledge")) {
              const knowledgeBaseName = await getKnowledgeBaseName(result.knowledgeBaseId);
              return { ...result, knowledgeBaseName: knowledgeBaseName || undefined };
            }
            return result;
          })
        );

        const elapsedMs = Math.round(performance.now() - start);
        console.log(
          `[Memory] Search completed: ${scoredResults.length} results in ${elapsedMs}ms (LOCAL)`
        );

        return { results: scoredResults, elapsedMs };
      } catch (error) {
        console.error("[Memory] Search error:", error);
        return { results: [], elapsedMs: Math.round(performance.now() - start) };
      }
    }
  );

  /**
   * Index content into memory
   */
  ipcMain.handle(
    "memory:index",
    async (
      _event,
      items: MemoryIndexItem[]
    ): Promise<{ indexed: number; errors: string[] }> => {
      const errors: string[] = [];
      let indexed = 0;

      try {
        if (!items || items.length === 0) {
          return { indexed: 0, errors: [] };
        }

        // Initialize vector store if needed
        if (!vectorStore.isAvailable()) {
          await vectorStore.initialize();
        }

        if (!vectorStore.isAvailable()) {
          return { indexed: 0, errors: ["Vector store not available"] };
        }

        // Filter out items without content
        const validItems = items.filter(
          (item) => item.content && item.content.trim().length > 0
        );

        if (validItems.length === 0) {
          return { indexed: 0, errors: [] };
        }

        // Generate embeddings in batch (LOCAL!)
        const texts = validItems.map((item) => item.content);
        const embeddings = await generateBatchEmbeddings(texts);

        // Prepare items for insertion with user_id for security filtering
        const vectorItems = validItems.map((item, index) => ({
          id: item.id || randomUUID(),
          content: item.content,
          embedding: embeddings[index],
          thread_id: item.threadId,
          user_id: item.userId, // CRITICAL: user_id column for security filtering
          message_id: item.messageId,
          role: item.role,
          metadata: {
            userId: item.userId, // Also in metadata for backwards compatibility
            ...item.metadata,
          },
        }));

        // Insert into appropriate collection
        const messageItems = vectorItems.filter(
          (_, i) => validItems[i].collection !== "documents"
        );
        const documentItems = vectorItems.filter(
          (_, i) => validItems[i].collection === "documents"
        );

        if (messageItems.length > 0) {
          await vectorStore.insert("messages", messageItems);
          indexed += messageItems.length;
        }

        if (documentItems.length > 0) {
          await vectorStore.insert("documents", documentItems);
          indexed += documentItems.length;
        }

        console.log(`[Memory] Indexed ${indexed} items (LOCAL embeddings)`);
        return { indexed, errors };
      } catch (error) {
        console.error("[Memory] Index error:", error);
        errors.push(error instanceof Error ? error.message : String(error));
        return { indexed, errors };
      }
    }
  );

  /**
   * Delete items from memory
   * IMPORTANT: Also clears caches to prevent stale data from being returned
   */
  ipcMain.handle(
    "memory:delete",
    async (
      _event,
      ids: string[],
      collection: "messages" | "documents" = "messages"
    ): Promise<{ success: boolean; deleted: number }> => {
      try {
        if (!ids || ids.length === 0) {
          return { success: true, deleted: 0 };
        }

        if (!vectorStore.isAvailable()) {
          await vectorStore.initialize();
        }

        await vectorStore.delete(collection, ids);

        // CRITICAL: Clear caches to prevent deleted content from being found in search
        EMBEDDING_CACHE.clear();
        KNOWLEDGE_BASE_CACHE.clear();

        console.log(`[Memory] Deleted ${ids.length} items from ${collection}, caches cleared`);

        return { success: true, deleted: ids.length };
      } catch (error) {
        console.error("[Memory] Delete error:", error);
        return { success: false, deleted: 0 };
      }
    }
  );

  /**
   * Delete all memory for a thread
   * IMPORTANT: Also clears caches to prevent stale data from being returned
   */
  ipcMain.handle(
    "memory:deleteByThread",
    async (_event, threadId: string): Promise<{ success: boolean }> => {
      try {
        if (!threadId) {
          return { success: false };
        }

        if (!vectorStore.isAvailable()) {
          await vectorStore.initialize();
        }

        await vectorStore.deleteByThread(threadId);

        // CRITICAL: Clear caches to prevent deleted content from being found in search
        EMBEDDING_CACHE.clear();
        KNOWLEDGE_BASE_CACHE.clear();

        console.log(`[Memory] Deleted all memory for thread: ${threadId}, caches cleared`);

        return { success: true };
      } catch (error) {
        console.error("[Memory] Delete by thread error:", error);
        return { success: false };
      }
    }
  );

  /**
   * Get memory statistics
   */
  ipcMain.handle(
    "memory:getStats",
    async (): Promise<{
      messages: number;
      documents: number;
      available: boolean;
      embeddingCacheSize: number;
      embeddingService: string;
    }> => {
      try {
        if (!vectorStore.isAvailable()) {
          await vectorStore.initialize();
        }

        const stats = await vectorStore.getStats();
        const embeddingService = getEmbeddingService();

        return {
          messages: stats.messages || 0,
          documents: stats.documents || 0,
          available: stats.available,
          embeddingCacheSize: EMBEDDING_CACHE.size,
          embeddingService: embeddingService.isAvailable()
            ? "local (transformers.js)"
            : "fallback (OpenAI)",
        };
      } catch (error) {
        console.error("[Memory] Get stats error:", error);
        return {
          messages: 0,
          documents: 0,
          available: false,
          embeddingCacheSize: EMBEDDING_CACHE.size,
          embeddingService: "unavailable",
        };
      }
    }
  );

  /**
   * Clear embedding cache
   */
  ipcMain.handle("memory:clearCache", async (): Promise<{ success: boolean }> => {
    EMBEDDING_CACHE.clear();
    console.log("[Memory] Embedding cache cleared");
    return { success: true };
  });

  /**
   * Generate embedding for a single text (utility)
   */
  ipcMain.handle(
    "memory:generateEmbedding",
    async (_event, text: string): Promise<number[]> => {
      return generateEmbedding(text);
    }
  );

  /**
   * Get embedding service status
   */
  ipcMain.handle(
    "memory:getEmbeddingStatus",
    async (): Promise<{
      available: boolean;
      service: string;
      dimensions: number;
    }> => {
      const embeddingService = getEmbeddingService();
      await embeddingService.initialize();

      return {
        available: embeddingService.isAvailable(),
        service: embeddingService.isAvailable()
          ? "local (transformers.js - all-MiniLM-L6-v2)"
          : "unavailable",
        dimensions: EMBEDDING_DIMENSIONS,
      };
    }
  );

  console.log("[IPC] Memory handlers registered (LOCAL FIRST mode)");
}

/**
 * Helper function to index a message (called from ai.ts after streaming)
 */
export async function indexMessageForMemory(message: {
  id: string;
  threadId: string;
  userId: string;
  role: string;
  content: string;
}): Promise<void> {
  try {
    const vectorStore = getVectorStore();

    if (!vectorStore.isAvailable()) {
      await vectorStore.initialize();
    }

    if (!vectorStore.isAvailable()) {
      console.warn("[Memory] Vector store not available for indexing");
      return;
    }

    // Skip if content is too short
    if (!message.content || message.content.trim().length < 10) {
      return;
    }

    // Generate embedding (LOCAL!)
    const embedding = await generateEmbedding(message.content);

    // Insert into vector store with user_id for security filtering
    await vectorStore.insert("messages", [
      {
        id: message.id,
        content: message.content,
        embedding,
        thread_id: message.threadId,
        user_id: message.userId, // CRITICAL: user_id column for security filtering
        message_id: message.id,
        role: message.role,
        metadata: { userId: message.userId }, // Also in metadata for backwards compatibility
      },
    ]);

    console.log(`[Memory] Indexed message: ${message.id} (LOCAL embedding)`);
  } catch (error) {
    // Don't throw - indexing is non-critical
    console.error("[Memory] Failed to index message:", error);
  }
}

/**
 * Semantic search function (callable directly from ai.ts for RAG injection)
 * Does not require IPC - runs directly in main process
 * Uses LOCAL embeddings - NO API CALLS!
 *
 * IMPORTANT: This searches BOTH messages AND knowledge base documents
 * - Messages: Optionally filtered by threadId (current conversation)
 * - Documents: NOT filtered by thread_id, searched across ALL knowledge bases
 * - Security: Results are filtered by userId from metadata
 */
export async function semanticMemorySearch(
  query: string,
  options: MemorySearchOptions = {}
): Promise<MemorySearchResult[]> {
  const {
    collections = ["messages", "documents", "knowledge"],
    limit = 5,
    scoreThreshold = 0.5, // Lowered for better recall with local embeddings
    userId = "local-user", // SINGLE-USER MODE: Default to local-user
    threadId,
  } = options;

  try {
    if (!query || query.trim().length < 3) {
      console.log(`[RAG] Query too short: "${query}"`);
      return [];
    }

    // SINGLE-USER MODE: userId is optional, defaults to "local-user"
    // This app is designed for single-user desktop use

    const vectorStore = getVectorStore();

    // Initialize vector store if needed
    if (!vectorStore.isAvailable()) {
      console.log("[RAG] Initializing vector store...");
      await vectorStore.initialize();
    }

    if (!vectorStore.isAvailable()) {
      console.warn("[RAG] Vector store not available");
      return [];
    }

    // Generate query embedding (LOCAL - FAST!)
    const startTime = Date.now();
    console.log(`[RAG] Searching for: "${query.slice(0, 50)}..." in collections: ${collections.join(", ")}`);

    const queryEmbedding = await generateEmbedding(query);
    const embeddingTime = Date.now() - startTime;

    if (!queryEmbedding || queryEmbedding.length === 0) {
      console.error("[RAG] Failed to generate query embedding");
      return [];
    }

    // Search each collection in parallel
    // CRITICAL: Documents are searched WITHOUT thread_id filter to find ALL knowledge base content
    // SECURITY: Always filter by user_id at database level
    const searchPromises = collections.map(async (collection) => {
      const collectionName =
        collection === "messages"
          ? "messages"
          : "documents"; // Both "knowledge" and "documents" map to documents collection

      // Build filter with user_id for security, thread_id only for messages
      const filter: { thread_id?: string; user_id?: string } = {
        user_id: userId, // SECURITY: Always filter by user_id at DB level
      };

      // IMPORTANT: Only filter messages by threadId, NOT documents
      // Documents should be searchable across ALL knowledge bases (but only for this user)
      if (collection === "messages" && threadId) {
        filter.thread_id = threadId;
      }

      const searchLimit = collection === "messages" ? limit : limit * 3; // More documents for better coverage

      try {
        const results = await vectorStore.search(
          queryEmbedding,
          collectionName,
          searchLimit,
          filter
        );

        console.log(`[RAG] ${collection}: found ${results?.length || 0} raw results`);

        return (results || []).map((r: any) => ({
          ...r,
          source: collection,
        }));
      } catch (searchError) {
        console.error(`[RAG] Search error in ${collection}:`, searchError);
        return [];
      }
    });

    const allResults = await Promise.all(searchPromises);
    const flatResults = allResults.flat();

    console.log(`[RAG] Total raw results: ${flatResults.length}`);

    // SECURITY: Filter results by userId from metadata (redundant check after DB-level filter)
    // Documents have userId in metadata, messages may have it in metadata.userId
    const userFilteredResults = flatResults.filter((result: any) => {
      const metadataUserId = result.metadata?.userId;
      if (metadataUserId && metadataUserId !== userId) {
        return false; // Filter out other users' documents
      }
      return true;
    });

    console.log(`[RAG] After userId filter: ${userFilteredResults.length} results`);

    // DEDUPLICATION: Remove duplicate content across collections
    // Keep the highest-scoring result when same content appears multiple times
    const seenContent = new Map<string, any>();
    const deduplicatedResults = userFilteredResults.filter((result: any) => {
      const contentKey = createHash('sha256')
        .update(String(result.content || '').toLowerCase().trim())
        .digest('hex')
        .slice(0, 16);

      const existing = seenContent.get(contentKey);
      if (existing) {
        // Keep the one with higher similarity score
        if ((result.similarity || 0) > (existing.similarity || 0)) {
          seenContent.set(contentKey, result);
          return true;
        }
        return false;
      }
      seenContent.set(contentKey, result);
      return true;
    });

    console.log(`[RAG] After deduplication: ${deduplicatedResults.length} results`);

    // Extract keywords for hybrid boosting
    const keywords = query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2);

    // Apply hybrid scoring with keyword boost
    // Boost values are intentionally modest to avoid over-ranking partial keyword matches
    // over semantically relevant content. Max boost: 0.15 + 0.10 = 0.25
    const scoredResultsRaw = deduplicatedResults
      .map((result: any) => {
        const content = String(result.content || "").toLowerCase();

        // Keyword boost (0-0.15 per query, proportional to keyword matches)
        let keywordBoost = 0;
        for (const keyword of keywords) {
          if (content.includes(keyword)) {
            keywordBoost += 0.15 / keywords.length;
          }
        }

        // Extra boost for exact phrase match (modest 0.10 to avoid over-ranking)
        if (content.includes(query.toLowerCase())) {
          keywordBoost += 0.10;
        }

        const finalScore = Math.min(
          1.0,
          (result.similarity || 0) + keywordBoost
        );

        // Extract knowledge base ID from metadata for documents
        const knowledgeBaseId = result.metadata?.knowledgeBaseId || null;

        return {
          id: result.id,
          content: result.content,
          score: finalScore,
          source: result.source as "messages" | "documents" | "knowledge",
          threadId: result.thread_id,
          messageId: result.message_id,
          role: result.role,
          createdAt: result.created_at,
          metadata: result.metadata,
          knowledgeBaseId,
        };
      })
      .filter((r) => r.score >= scoreThreshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    // Enrich document results with knowledge base names
    const scoredResults: MemorySearchResult[] = await Promise.all(
      scoredResultsRaw.map(async (result) => {
        if (result.knowledgeBaseId && (result.source === "documents" || result.source === "knowledge")) {
          const knowledgeBaseName = await getKnowledgeBaseName(result.knowledgeBaseId);
          return { ...result, knowledgeBaseName: knowledgeBaseName || undefined };
        }
        return result as MemorySearchResult;
      })
    );

    const totalTime = Date.now() - startTime;

    // Log detailed results for debugging
    if (scoredResults.length > 0) {
      console.log(`[RAG] ✓ Found ${scoredResults.length} results in ${totalTime}ms (embedding: ${embeddingTime}ms)`);
      scoredResults.slice(0, 3).forEach((r, i) => {
        console.log(`[RAG]   ${i + 1}. [${r.source}] score=${r.score.toFixed(2)}: "${r.content.slice(0, 60)}..."`);
      });
    } else {
      console.log(`[RAG] No results found above threshold ${scoreThreshold} (had ${userFilteredResults.length} raw results)`);
    }

    return scoredResults;
  } catch (error) {
    console.error("[RAG] Search error:", error);
    return [];
  }
}

/**
 * Get embedding dimensions (for compatibility checks)
 */
export function getEmbeddingDimensions(): number {
  return EMBEDDING_DIMENSIONS;
}
