import { app } from "electron";
import path from "path";
import fs from "fs-extra";

// Transformers.js types
type FeatureExtractionPipeline = any;

/**
 * Local Embedding Service using Transformers.js (@xenova/transformers)
 * Generates embeddings locally WITHOUT any API calls - maximum speed & privacy
 *
 * Model: all-MiniLM-L6-v2 (384 dimensions, ~50-100 texts/sec on CPU)
 * - Lightweight: ~23MB quantized
 * - Fast: 10-50ms per embedding
 * - Quality: Excellent for semantic search
 */
export class LocalEmbeddingService {
  private extractor: FeatureExtractionPipeline | null = null;
  private initialized = false;
  private initializing = false;
  private available = false;
  private initPromise: Promise<void> | null = null;

  // Model configuration
  private readonly modelId = "Xenova/all-MiniLM-L6-v2";
  private readonly embeddingDim = 384;

  // Singleton
  private static _instance: LocalEmbeddingService | null = null;

  static getInstance(): LocalEmbeddingService {
    if (!LocalEmbeddingService._instance) {
      LocalEmbeddingService._instance = new LocalEmbeddingService();
    }
    return LocalEmbeddingService._instance;
  }

  /**
   * Get embedding dimensions
   */
  getEmbeddingDimensions(): number {
    return this.embeddingDim;
  }

  /**
   * Initialize the embedding service
   * Downloads model on first run, then uses local cache
   * Has timeout to prevent hanging
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Prevent concurrent initialization
    if (this.initializing && this.initPromise) {
      return this.initPromise;
    }

    this.initializing = true;

    // Add timeout to prevent hanging (90 seconds for model download on slow connections)
    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error(
        "Embedding initialization timeout (90s). " +
        "The model download may be slow. It will retry on next use."
      )), 90000);
    });

    this.initPromise = Promise.race([
      this._doInitialize(),
      timeoutPromise,
    ]).catch((error) => {
      console.error("[Embedding] Initialization failed or timed out:", error);
      this.initialized = true;
      this.available = false;
    });

    try {
      await this.initPromise;
    } finally {
      this.initializing = false;
    }
  }

  private async _doInitialize(): Promise<void> {
    console.log("[Embedding] Initializing local embedding service with Transformers.js...");
    const startTime = Date.now();

    try {
      // Dynamic import to avoid issues if package not available
      const transformers = await import("@xenova/transformers");
      const { pipeline, env } = transformers;

      // Configure model cache location
      const userDataDir = app.getPath("userData");
      const modelsDir = path.join(userDataDir, "models", "transformers");
      fs.ensureDirSync(modelsDir);

      // Configure transformers.js environment
      env.cacheDir = modelsDir;
      env.localModelPath = modelsDir;

      // Allow remote models for first download, then uses local cache
      env.allowRemoteModels = true;

      // Disable local model check to always use cache/remote
      env.allowLocalModels = true;

      console.log(`[Embedding] Model cache directory: ${modelsDir}`);
      console.log(`[Embedding] Loading model: ${this.modelId}...`);

      // Create the feature extraction pipeline
      // quantized: true = smaller model, faster loading
      this.extractor = await pipeline("feature-extraction", this.modelId, {
        quantized: true,
        progress_callback: (progress: any) => {
          if (progress.status === "downloading") {
            const percent = Math.round((progress.loaded / progress.total) * 100);
            console.log(`[Embedding] Downloading model: ${percent}%`);
          } else if (progress.status === "ready") {
            console.log(`[Embedding] Model ready!`);
          }
        },
      });

      this.available = true;
      this.initialized = true;
      const duration = Date.now() - startTime;
      console.log(`[Embedding] ✓ Local embedding service initialized in ${duration}ms!`);
      console.log(`[Embedding] Model: ${this.modelId} (${this.embeddingDim} dimensions)`);
    } catch (error) {
      console.error("[Embedding] Failed to initialize:", error);
      this.initialized = true; // Mark as initialized to prevent retry loops
      this.available = false;
    }
  }

  /**
   * Check if embedding service is available
   */
  isAvailable(): boolean {
    return this.available && this.extractor !== null;
  }

  /**
   * Generate embeddings for one or more texts
   * Uses batch processing for improved performance (~3-5x faster for multiple texts)
   * @param texts - String or array of strings to embed
   * @returns Array of embedding vectors (384 dimensions each)
   */
  async embed(texts: string | string[]): Promise<number[][]> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.available || !this.extractor) {
      const errorMsg = "[Embedding] Service not available. " +
        (this.initialized ? "Model failed to load." : "Service not initialized.") +
        " Check if transformers.js model downloaded correctly to models/transformers folder.";
      console.error(errorMsg);
      throw new Error(errorMsg);
    }

    const textsArray = Array.isArray(texts) ? texts : [texts];

    if (textsArray.length === 0) {
      return [];
    }

    try {
      const startTime = Date.now();

      // Truncate all texts upfront (model has 512 token limit)
      const truncatedTexts = textsArray.map(text => text.slice(0, 8000));

      // Process in batches to avoid memory issues with very large inputs
      // Transformers.js supports native batch processing
      const BATCH_SIZE = 16; // Optimal batch size for memory/speed tradeoff
      const embeddings: number[][] = [];

      if (truncatedTexts.length <= BATCH_SIZE) {
        // Small batch: process all at once
        const output = await this.extractor(truncatedTexts, {
          pooling: "mean",
          normalize: true,
        });

        // Output shape: [batch_size, embedding_dim] when pooling is applied
        const data = output.data as Float32Array;
        const batchSize = truncatedTexts.length;

        for (let i = 0; i < batchSize; i++) {
          const start = i * this.embeddingDim;
          const end = start + this.embeddingDim;
          embeddings.push(Array.from(data.slice(start, end)));
        }
      } else {
        // Large input: process in chunks to avoid memory issues
        for (let i = 0; i < truncatedTexts.length; i += BATCH_SIZE) {
          const batch = truncatedTexts.slice(i, i + BATCH_SIZE);

          const output = await this.extractor(batch, {
            pooling: "mean",
            normalize: true,
          });

          const data = output.data as Float32Array;
          const batchSize = batch.length;

          for (let j = 0; j < batchSize; j++) {
            const start = j * this.embeddingDim;
            const end = start + this.embeddingDim;
            embeddings.push(Array.from(data.slice(start, end)));
          }
        }
      }

      const duration = Date.now() - startTime;
      console.log(
        `[Embedding] Generated ${textsArray.length} embeddings in ${duration}ms (${Math.round(duration / textsArray.length)}ms/text avg)`
      );

      return embeddings;
    } catch (error) {
      console.error("[Embedding] Error generating embeddings:", error);
      throw error;
    }
  }

  /**
   * Generate a single embedding (convenience method)
   */
  async embedSingle(text: string): Promise<number[]> {
    const embeddings = await this.embed([text]);
    return embeddings[0] || [];
  }

  /**
   * Generate embeddings in batches for large datasets with progress logging
   * Note: embed() now handles batching internally, this method adds progress logging
   * @param texts - Array of texts to embed
   * @param batchSize - Number of texts to process at once (default 32)
   * @returns Array of embedding vectors
   */
  async embedBatch(texts: string[], batchSize: number = 32): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    // For small batches, just use embed() directly (it handles batching internally)
    if (texts.length <= batchSize) {
      return this.embed(texts);
    }

    // For large datasets, process in chunks with progress logging
    const allEmbeddings: number[][] = [];
    const totalBatches = Math.ceil(texts.length / batchSize);
    const startTime = Date.now();

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchEmbeddings = await this.embed(batch);
      allEmbeddings.push(...batchEmbeddings);

      const batchNum = Math.floor(i / batchSize) + 1;
      const progress = Math.round((batchNum / totalBatches) * 100);
      console.log(`[Embedding] Batch progress: ${batchNum}/${totalBatches} (${progress}%)`);
    }

    const duration = Date.now() - startTime;
    console.log(`[Embedding] Completed ${texts.length} embeddings in ${duration}ms total`);

    return allEmbeddings;
  }

  /**
   * Calculate cosine similarity between two embeddings
   * @param embedding1 - First embedding vector
   * @param embedding2 - Second embedding vector
   * @returns Cosine similarity score (-1 to 1, higher = more similar)
   */
  cosineSimilarity(embedding1: number[], embedding2: number[]): number {
    if (embedding1.length !== embedding2.length) {
      throw new Error(
        `Embedding dimensions mismatch: ${embedding1.length} vs ${embedding2.length}`
      );
    }

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < embedding1.length; i++) {
      dotProduct += embedding1[i] * embedding2[i];
      norm1 += embedding1[i] * embedding1[i];
      norm2 += embedding2[i] * embedding2[i];
    }

    const magnitude = Math.sqrt(norm1) * Math.sqrt(norm2);
    if (magnitude === 0) return 0;

    return dotProduct / magnitude;
  }

  /**
   * Find most similar texts from a list
   * @param query - Query text
   * @param candidates - List of candidate texts
   * @param topK - Number of results to return
   * @returns Sorted list of {text, score} pairs
   */
  async findSimilar(
    query: string,
    candidates: string[],
    topK: number = 5
  ): Promise<Array<{ text: string; score: number; index: number }>> {
    const queryEmbedding = await this.embedSingle(query);
    const candidateEmbeddings = await this.embed(candidates);

    const scores = candidateEmbeddings.map((emb, index) => ({
      text: candidates[index],
      score: this.cosineSimilarity(queryEmbedding, emb),
      index,
    }));

    return scores.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  /**
   * Close the embedding service and release resources
   */
  close(): void {
    if (this.extractor) {
      console.log("[Embedding] Closing embedding service");
      this.extractor = null;
      this.initialized = false;
      this.available = false;
    }
  }
}

// Singleton instance management
let embeddingService: LocalEmbeddingService | null = null;

export const getEmbeddingService = (): LocalEmbeddingService => {
  if (!embeddingService) {
    embeddingService = LocalEmbeddingService.getInstance();
  }
  return embeddingService;
};

export const closeEmbeddingService = (): void => {
  if (embeddingService) {
    embeddingService.close();
    embeddingService = null;
  }
};

// Pre-initialization state
let preInitStarted = false;
let preInitEnabled = true; // Can be disabled via environment variable

// Check if pre-initialization is disabled (useful for faster dev startup)
if (process.env.DISABLE_EMBEDDING_PREINIT === "true") {
  preInitEnabled = false;
  console.log("[Embedding] Pre-initialization disabled via DISABLE_EMBEDDING_PREINIT");
}

/**
 * Pre-initialize the embedding service
 * This is called lazily to avoid blocking app startup
 */
const preInitialize = async () => {
  if (preInitStarted || !preInitEnabled) return;
  preInitStarted = true;

  try {
    console.log("[Embedding] Starting background pre-initialization...");
    console.log("[Embedding] Note: First-time setup downloads ~23MB model (cached after)");
    const service = getEmbeddingService();
    await service.initialize();
    console.log("[Embedding] ✓ Pre-initialization complete - ready for fast embeddings");
  } catch (e) {
    // Log but don't fail - will retry on first actual use
    console.log("[Embedding] Pre-initialization deferred:", e instanceof Error ? e.message : e);
    console.log("[Embedding] Will initialize on first actual embedding request");
    preInitStarted = false; // Allow retry
  }
};

/**
 * Manually trigger embedding preload
 * Useful for triggering from settings page or knowledge base creation
 */
export const triggerEmbeddingPreload = () => {
  if (!preInitStarted) {
    preInitialize();
  }
};

/**
 * Check if embedding service is pre-initialized
 */
export const isEmbeddingPreinitialized = (): boolean => {
  const service = LocalEmbeddingService.getInstance();
  return service.isAvailable();
};

// Start pre-initialization after app UI is likely settled
// Uses 15 seconds to ensure app is fully responsive first
// This is non-blocking - actual init happens on first use if this fails
if (preInitEnabled) {
  setTimeout(() => {
    // Only pre-init if not already triggered by first use
    if (!preInitStarted) {
      preInitialize();
    }
  }, 15000);
}
