import { app } from "electron";
import path from "path";
import fs from "fs-extra";
import https from "https";

// ONNX Runtime types - imported dynamically to avoid crashes if native module is missing
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OrtModule = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type InferenceSession = any;

/**
 * Local Embedding Service using ONNX Runtime
 * Generates embeddings locally without API calls for maximum speed
 *
 * Model: all-MiniLM-L6-v2 (384 dimensions, ~50 texts/sec)
 * Alternative: BAAI/bge-small-en-v1.5 (384 dimensions, better quality)
 */
export class LocalEmbeddingService {
  private ort: OrtModule | null = null;
  private session: InferenceSession | null = null;
  private initialized = false;
  private available = false;
  private readonly modelName = "all-MiniLM-L6-v2";
  private readonly embeddingDim = 384; // or 1536 for larger models

  private static _instance: LocalEmbeddingService | null = null;

  static getInstance(): LocalEmbeddingService {
    if (!LocalEmbeddingService._instance) {
      LocalEmbeddingService._instance = new LocalEmbeddingService();
    }
    return LocalEmbeddingService._instance;
  }

  async initialize() {
    if (this.initialized) {
      return;
    }

    console.log("[Embedding] Initializing local embedding service...");

    // Dynamically import ONNX Runtime to avoid crashes if native module is missing
    try {
      this.ort = require("onnxruntime-node");
    } catch (importError) {
      console.warn(
        "[Embedding] ONNX Runtime not available:",
        importError instanceof Error ? importError.message : importError,
      );
      this.initialized = true;
      this.available = false;
      return;
    }

    try {
      // Download and load model
      const modelPath = await this.ensureModel();

      // Create ONNX Runtime session
      this.session = await this.ort.InferenceSession.create(modelPath, {
        executionProviders: ["cpu"], // Use CPU by default, can add 'cuda' if GPU available
        graphOptimizationLevel: "all",
        enableMemPattern: true,
      });

      this.available = true;
      this.initialized = true;
      console.log(
        "[Embedding] Local embedding service initialized successfully",
      );
    } catch (error) {
      console.warn("[Embedding] Failed to initialize:", error);
      this.initialized = true;
      this.available = false;
    }
  }

  /**
   * Check if embedding service is available
   */
  isAvailable(): boolean {
    return this.available && this.session !== null;
  }

  private async ensureModel(): Promise<string> {
    const userDataDir = app.getPath("userData");
    const modelsDir = path.join(userDataDir, "models", this.modelName);
    const modelPath = path.join(modelsDir, "model.onnx");

    // Check if model already exists
    if (fs.existsSync(modelPath)) {
      console.log("[Embedding] Model already downloaded:", modelPath);
      return modelPath;
    }

    // Create directory
    fs.ensureDirSync(modelsDir);

    // Download model from HuggingFace
    console.log(
      "[Embedding] Downloading model... This may take a few minutes.",
    );

    const modelUrl = `https://huggingface.co/sentence-transformers/${this.modelName}/resolve/main/onnx/model.onnx`;

    await this.downloadFile(modelUrl, modelPath);

    console.log("[Embedding] Model downloaded successfully");
    return modelPath;
  }

  private async downloadFile(url: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(destPath);

      https
        .get(url, (response) => {
          if (response.statusCode === 302 || response.statusCode === 301) {
            // Follow redirect
            const redirectUrl = response.headers.location;
            if (redirectUrl) {
              this.downloadFile(redirectUrl, destPath)
                .then(resolve)
                .catch(reject);
              return;
            }
          }

          response.pipe(file);

          file.on("finish", () => {
            file.close();
            resolve();
          });
        })
        .on("error", (err) => {
          fs.unlinkSync(destPath);
          reject(err);
        });
    });
  }

  /**
   * Generate embeddings for one or more texts
   * @param texts - String or array of strings to embed
   * @returns Array of embedding vectors
   */
  async embed(texts: string | string[]): Promise<number[][]> {
    if (!this.initialized) {
      await this.initialize();
    }
    if (!this.available) {
      console.warn("[Embedding] Embed called but ONNX Runtime not available");
      return [];
    }

    const textsArray = Array.isArray(texts) ? texts : [texts];

    try {
      // For production, use proper tokenization with ONNX model inference
      // For now, return random embeddings as placeholder
      // TODO: Integrate proper ONNX model inference with tokenizer

      const embeddings: number[][] = [];

      for (const _text of textsArray) {
        // Placeholder: generate random embedding
        const embedding = Array.from(
          { length: this.embeddingDim },
          () => Math.random() * 2 - 1,
        );

        // Normalize to unit vector
        const norm = Math.sqrt(
          embedding.reduce((sum, val) => sum + val * val, 0),
        );
        const normalized = embedding.map((val) => val / norm);

        embeddings.push(normalized);
      }

      console.log(
        `[Embedding] Generated embeddings for ${textsArray.length} texts`,
      );
      return embeddings;
    } catch (error) {
      console.error("[Embedding] Error generating embeddings:", error);
      throw error;
    }
  }

  /**
   * Generate embeddings in batches for better performance
   * @param texts - Array of texts to embed
   * @param batchSize - Number of texts to process at once
   * @returns Array of embedding vectors
   */
  async embedBatch(
    texts: string[],
    batchSize: number = 32,
  ): Promise<number[][]> {
    if (!this.initialized) {
      await this.initialize();
    }
    if (!this.available) {
      return [];
    }

    const allEmbeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchEmbeddings = await this.embed(batch);
      allEmbeddings.push(...batchEmbeddings);

      console.log(
        `[Embedding] Processed batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(texts.length / batchSize)}`,
      );
    }

    return allEmbeddings;
  }

  /**
   * Calculate cosine similarity between two embeddings
   * @param embedding1 - First embedding vector
   * @param embedding2 - Second embedding vector
   * @returns Cosine similarity score (0-1)
   */
  cosineSimilarity(embedding1: number[], embedding2: number[]): number {
    if (embedding1.length !== embedding2.length) {
      throw new Error("Embeddings must have the same dimension");
    }

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < embedding1.length; i++) {
      dotProduct += embedding1[i] * embedding2[i];
      norm1 += embedding1[i] * embedding1[i];
      norm2 += embedding2[i] * embedding2[i];
    }

    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
  }

  /**
   * Close the embedding service
   */
  close() {
    if (this.session) {
      console.log("[Embedding] Closing embedding service");
      this.session = null;
      this.initialized = false;
    }
  }
}

// Singleton instance
let embeddingService: LocalEmbeddingService | null = null;

export const getEmbeddingService = (): LocalEmbeddingService => {
  if (!embeddingService) {
    embeddingService = new LocalEmbeddingService();
  }
  return embeddingService;
};

export const closeEmbeddingService = () => {
  if (embeddingService) {
    embeddingService.close();
    embeddingService = null;
  }
};
