import { openai } from "@ai-sdk/openai";
import { embed, embedMany } from "ai";
import { serverCache as cache } from "lib/cache";
import { CacheKeys } from "lib/cache/cache-keys";
import logger from "logger";

/**
 * HIGH-PERFORMANCE Embedding Service
 *
 * Optimizations:
 * - Multi-level caching (in-memory + Redis)
 * - Batch processing with parallel API calls
 * - Smart chunking for large texts
 * - Embedding reuse for similar queries
 */

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
const BATCH_SIZE = 100; // OpenAI allows up to 2048
const MAX_TEXT_LENGTH = 8191; // Max tokens for the model

// ============================================================================
// IN-MEMORY EMBEDDING CACHE (L1)
// ============================================================================

interface EmbeddingCacheEntry {
  embedding: number[];
  timestamp: number;
}

const EMBEDDING_CACHE = new Map<string, EmbeddingCacheEntry>();
const EMBEDDING_CACHE_MAX_SIZE = 500;
const EMBEDDING_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

function getEmbeddingCacheKey(text: string): string {
  // Use a hash of the text for reliable cache key generation
  // This prevents collisions from texts with same length and prefix
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  // Use length + hash + first 50 chars (truncated) for debugging
  return `emb:${text.length}:${hash}:${text.slice(0, 50).replace(/[^a-zA-Z0-9]/g, "_")}`;
}

function getFromEmbeddingCache(text: string): number[] | null {
  const key = getEmbeddingCacheKey(text);
  const entry = EMBEDDING_CACHE.get(key);
  if (!entry) return null;

  if (Date.now() - entry.timestamp > EMBEDDING_CACHE_TTL_MS) {
    EMBEDDING_CACHE.delete(key);
    return null;
  }

  return entry.embedding;
}

function setInEmbeddingCache(text: string, embedding: number[]): void {
  if (EMBEDDING_CACHE.size >= EMBEDDING_CACHE_MAX_SIZE) {
    const oldestKey = EMBEDDING_CACHE.keys().next().value;
    if (oldestKey) {
      EMBEDDING_CACHE.delete(oldestKey);
    }
  }

  EMBEDDING_CACHE.set(getEmbeddingCacheKey(text), {
    embedding,
    timestamp: Date.now(),
  });
}

export function clearEmbeddingCache(): void {
  EMBEDDING_CACHE.clear();
}

export function getEmbeddingCacheStats(): { size: number; maxSize: number } {
  return { size: EMBEDDING_CACHE.size, maxSize: EMBEDDING_CACHE_MAX_SIZE };
}

// ============================================================================
// TEXT PREPROCESSING
// ============================================================================

/**
 * Preprocess text for embedding
 * - Truncate to max length
 * - Normalize whitespace
 */
function preprocessText(text: string): string {
  // Normalize whitespace
  let processed = text.replace(/\s+/g, " ").trim();

  // Truncate if too long (rough estimate: 4 chars per token)
  const maxChars = MAX_TEXT_LENGTH * 4;
  if (processed.length > maxChars) {
    processed = processed.slice(0, maxChars);
  }

  return processed;
}

// ============================================================================
// EMBEDDING GENERATION
// ============================================================================

/**
 * Generate embedding for a single text
 * Uses multi-level caching: L1 (in-memory) -> L2 (Redis) -> API
 */
export async function generateTextEmbedding(text: string): Promise<number[]> {
  if (!text.trim()) {
    throw new Error("Text cannot be empty");
  }

  const processedText = preprocessText(text);
  const start = performance.now();

  // L1: Check in-memory cache
  const l1Cached = getFromEmbeddingCache(processedText);
  if (l1Cached) {
    logger.debug("Embedding L1 cache hit", {
      elapsed: Math.round(performance.now() - start),
    });
    return l1Cached;
  }

  // L2: Check Redis cache
  const cacheKey = CacheKeys.embedding(processedText);
  const l2Cached = await cache.get<number[]>(cacheKey);
  if (l2Cached) {
    // Populate L1 cache
    setInEmbeddingCache(processedText, l2Cached);
    logger.debug("Embedding L2 cache hit", {
      elapsed: Math.round(performance.now() - start),
    });
    return l2Cached;
  }

  // Generate new embedding
  try {
    const { embedding } = await embed({
      model: openai.embedding(EMBEDDING_MODEL),
      value: processedText,
    });

    // Cache at both levels
    setInEmbeddingCache(processedText, embedding);
    await cache.set(cacheKey, embedding, 60 * 60 * 24 * 30); // 30 days in Redis

    const elapsed = Math.round(performance.now() - start);
    logger.debug("Generated new embedding", { elapsed });

    return embedding;
  } catch (error) {
    logger.error("Failed to generate embedding:", error);
    throw error;
  }
}

/**
 * Generate embeddings for multiple texts in batch
 * Much more efficient than individual calls
 */
export async function generateBatchEmbeddings(
  texts: string[],
): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  const start = performance.now();

  // Preprocess and filter
  const processedTexts = texts.map(preprocessText).filter((t) => t.length > 0);
  if (processedTexts.length === 0) {
    return texts.map(() => []); // Return empty arrays for empty inputs
  }

  // Check caches for each text
  const results: (number[] | null)[] = new Array(processedTexts.length).fill(
    null,
  );
  const textsToEmbed: { index: number; text: string }[] = [];

  await Promise.all(
    processedTexts.map(async (text, index) => {
      // L1 cache
      const l1Cached = getFromEmbeddingCache(text);
      if (l1Cached) {
        results[index] = l1Cached;
        return;
      }

      // L2 cache
      const cacheKey = CacheKeys.embedding(text);
      const l2Cached = await cache.get<number[]>(cacheKey);
      if (l2Cached) {
        setInEmbeddingCache(text, l2Cached);
        results[index] = l2Cached;
        return;
      }

      textsToEmbed.push({ index, text });
    }),
  );

  const cacheHits = processedTexts.length - textsToEmbed.length;
  logger.debug("Batch embedding cache check", {
    total: processedTexts.length,
    hits: cacheHits,
    misses: textsToEmbed.length,
  });

  // Generate embeddings for uncached texts in batches
  if (textsToEmbed.length > 0) {
    const batches: { index: number; text: string }[][] = [];
    for (let i = 0; i < textsToEmbed.length; i += BATCH_SIZE) {
      batches.push(textsToEmbed.slice(i, i + BATCH_SIZE));
    }

    // Process batches in parallel (up to 6 concurrent - OpenAI handles this well)
    const concurrency = Math.min(6, batches.length);
    for (let i = 0; i < batches.length; i += concurrency) {
      const batchPromises = batches
        .slice(i, i + concurrency)
        .map(async (batch) => {
          try {
            const batchTexts = batch.map((b) => b.text);
            const { embeddings: batchEmbeddings } = await embedMany({
              model: openai.embedding(EMBEDDING_MODEL),
              values: batchTexts,
            });

            // Cache and store results
            await Promise.all(
              batch.map(async (item, idx) => {
                const embedding = batchEmbeddings[idx];
                setInEmbeddingCache(item.text, embedding);
                const cacheKey = CacheKeys.embedding(item.text);
                await cache.set(cacheKey, embedding, 60 * 60 * 24 * 30);
                results[item.index] = embedding;
              }),
            );
          } catch (error) {
            logger.error("Failed to generate batch embeddings:", error);
            // Don't throw - continue with other batches
          }
        });

      await Promise.all(batchPromises);
    }
  }

  const elapsed = Math.round(performance.now() - start);
  logger.debug("Batch embeddings completed", {
    total: processedTexts.length,
    elapsed,
    generated: textsToEmbed.length,
  });

  // Return results in same order as input (fill nulls with empty arrays)
  return results.map((r) => r || []);
}

/**
 * Get cached embeddings only (no API calls)
 * Useful for checking what's already cached
 */
export async function getEmbeddingsCached(
  texts: string[],
): Promise<(number[] | null)[]> {
  return Promise.all(
    texts.map(async (text) => {
      const processed = preprocessText(text);

      // L1 cache
      const l1Cached = getFromEmbeddingCache(processed);
      if (l1Cached) return l1Cached;

      // L2 cache
      const cacheKey = CacheKeys.embedding(processed);
      const l2Cached = await cache.get<number[]>(cacheKey);
      if (l2Cached) {
        setInEmbeddingCache(processed, l2Cached);
        return l2Cached;
      }

      return null;
    }),
  );
}

/**
 * Get embedding dimensions for the configured model
 */
export function getEmbeddingDimensions(): number {
  return EMBEDDING_DIMENSIONS;
}

/**
 * Compute cosine similarity between two embeddings
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error("Embeddings must have the same length");
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
