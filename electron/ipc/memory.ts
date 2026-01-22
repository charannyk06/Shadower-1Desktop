/**
 * Memory IPC Handlers
 *
 * Provides semantic memory capabilities for the desktop app:
 * - Search past conversations using embeddings
 * - Index messages automatically
 * - Hybrid search with keyword boosting
 * - User isolation for security
 *
 * Architecture:
 * Renderer -> IPC -> Main Process -> OpenAI Embeddings -> DuckDB Vector Store
 */

import { ipcMain, safeStorage } from "electron";
import { getDatabase, schema } from "../services/database";
import { getVectorStore } from "../services/vector-store";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

// OpenAI embedding configuration
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;

// In-memory embedding cache for performance
interface EmbeddingCacheEntry {
  embedding: number[];
  timestamp: number;
}
const EMBEDDING_CACHE = new Map<string, EmbeddingCacheEntry>();
const EMBEDDING_CACHE_MAX_SIZE = 500;
const EMBEDDING_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Decrypt API key using Electron's safeStorage
 */
function decryptApiKey(encryptedKey: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    const buffer = Buffer.from(encryptedKey, "base64");
    return safeStorage.decryptString(buffer);
  }
  // Fallback: base64 decode
  return Buffer.from(encryptedKey, "base64").toString("utf-8");
}

/**
 * Get decrypted OpenAI API key
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
 * Generate embedding using OpenAI API
 */
async function generateEmbedding(text: string): Promise<number[]> {
  // Check cache first
  const cacheKey = `emb:${text.length}:${text.slice(0, 100)}`;
  const cached = EMBEDDING_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < EMBEDDING_CACHE_TTL_MS) {
    return cached.embedding;
  }

  const apiKey = await getOpenAIApiKey();
  if (!apiKey) {
    throw new Error(
      "OpenAI API key not configured. Please add your API key in Settings > Models."
    );
  }

  // Preprocess text
  const processedText = text
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 8191 * 4); // Rough token limit

  try {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: processedText,
        dimensions: EMBEDDING_DIMENSIONS,
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
  } catch (error) {
    console.error("[Memory] Error generating embedding:", error);
    throw error;
  }
}

/**
 * Generate embeddings for multiple texts (batch)
 */
async function generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
  const apiKey = await getOpenAIApiKey();
  if (!apiKey) {
    throw new Error("OpenAI API key not configured");
  }

  // Process in smaller batches to avoid rate limits
  const BATCH_SIZE = 100;
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const processedBatch = batch.map((t) =>
      t.replace(/\s+/g, " ").trim().slice(0, 8191 * 4)
    );

    try {
      const response = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
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

        // Generate query embedding
        const queryEmbedding = await generateEmbedding(query);

        // Search each collection in parallel
        const searchPromises = collections.map(async (collection) => {
          const collectionName =
            collection === "messages"
              ? "messages"
              : collection === "knowledge"
              ? "documents" // Knowledge stored in documents table
              : "documents";

          const filter: { thread_id?: string; user_id?: string } = {};
          if (threadId) filter.thread_id = threadId;
          // Note: userId filtering will be done in post-processing if needed

          const results = await vectorStore.search(
            queryEmbedding,
            collectionName,
            limit * 2, // Get more for filtering
            filter
          );

          return results.map((r: any) => ({
            ...r,
            source: collection,
          }));
        });

        const allResults = await Promise.all(searchPromises);
        const flatResults = allResults.flat();

        // Extract keywords for hybrid boosting
        const keywords = query
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length > 2);

        // Apply hybrid scoring with keyword boost
        const scoredResults = flatResults
          .map((result: any) => {
            const content = String(result.content || "").toLowerCase();

            // Keyword boost (0-0.15)
            let keywordBoost = 0;
            for (const keyword of keywords) {
              if (content.includes(keyword)) {
                keywordBoost += 0.15 / keywords.length;
              }
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
            };
          })
          .filter((r) => r.score >= scoreThreshold)
          .sort((a, b) => b.score - a.score)
          .slice(0, limit);

        const elapsedMs = Math.round(performance.now() - start);
        console.log(
          `[Memory] Search completed: ${scoredResults.length} results in ${elapsedMs}ms`
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

        // Generate embeddings in batch
        const texts = validItems.map((item) => item.content);
        const embeddings = await generateBatchEmbeddings(texts);

        // Prepare items for insertion
        const vectorItems = validItems.map((item, index) => ({
          id: item.id || randomUUID(),
          content: item.content,
          embedding: embeddings[index],
          thread_id: item.threadId,
          message_id: item.messageId,
          role: item.role,
          metadata: {
            userId: item.userId,
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

        console.log(`[Memory] Indexed ${indexed} items`);
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
        console.log(`[Memory] Deleted ${ids.length} items from ${collection}`);

        return { success: true, deleted: ids.length };
      } catch (error) {
        console.error("[Memory] Delete error:", error);
        return { success: false, deleted: 0 };
      }
    }
  );

  /**
   * Delete all memory for a thread
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
        console.log(`[Memory] Deleted all memory for thread: ${threadId}`);

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
    }> => {
      try {
        if (!vectorStore.isAvailable()) {
          await vectorStore.initialize();
        }

        const stats = await vectorStore.getStats();

        return {
          messages: stats.messages || 0,
          documents: stats.documents || 0,
          available: stats.available,
          embeddingCacheSize: EMBEDDING_CACHE.size,
        };
      } catch (error) {
        console.error("[Memory] Get stats error:", error);
        return {
          messages: 0,
          documents: 0,
          available: false,
          embeddingCacheSize: EMBEDDING_CACHE.size,
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

  console.log("[IPC] Memory handlers registered");
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

    // Generate embedding
    const embedding = await generateEmbedding(message.content);

    // Insert into vector store
    await vectorStore.insert("messages", [
      {
        id: message.id,
        content: message.content,
        embedding,
        thread_id: message.threadId,
        message_id: message.id,
        role: message.role,
        metadata: { userId: message.userId },
      },
    ]);

    console.log(`[Memory] Indexed message: ${message.id}`);
  } catch (error) {
    // Don't throw - indexing is non-critical
    console.error("[Memory] Failed to index message:", error);
  }
}
