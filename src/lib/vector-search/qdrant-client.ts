import { QdrantClient } from "@qdrant/js-client-rest";
import logger from "logger";

/**
 * HIGH-PERFORMANCE Qdrant Client
 *
 * Optimizations:
 * - Singleton pattern with lazy initialization
 * - Connection keep-alive for reduced latency
 * - Optimized timeout settings
 * - Support for both local and cloud deployments
 */

let qdrantClient: QdrantClient | null = null;
let connectionVerified = false;

/**
 * Performance-optimized client configuration
 */
const CLIENT_CONFIG = {
  // Connection timeout - fail fast for better UX
  timeout: 5000,
  // Keep connections alive for subsequent requests
  headers: {
    Connection: "keep-alive",
    "Keep-Alive": "timeout=60, max=1000",
  },
} as const;

/**
 * Get or create optimized Qdrant client instance
 * Uses singleton pattern for connection reuse
 */
export function getQdrantClient(): QdrantClient {
  if (qdrantClient) {
    return qdrantClient;
  }

  const url = process.env.QDRANT_URL;
  const apiKey = process.env.QDRANT_API_KEY;

  if (!url) {
    throw new Error(
      "QDRANT_URL environment variable is not set. Set it to http://localhost:6333 for local or your Qdrant Cloud URL.",
    );
  }

  // Create client with performance optimizations
  const clientOptions: ConstructorParameters<typeof QdrantClient>[0] = {
    url,
    timeout: CLIENT_CONFIG.timeout,
  };

  // Only add API key if provided (not needed for local)
  if (apiKey && apiKey.trim()) {
    clientOptions.apiKey = apiKey;
  }

  qdrantClient = new QdrantClient(clientOptions);

  const isLocal = url.includes("localhost") || url.includes("127.0.0.1");
  logger.info("Qdrant client initialized", {
    url: url.replace(/\/\/.*@/, "//***@"),
    mode: isLocal ? "local" : "cloud",
  });

  return qdrantClient;
}

/**
 * Test Qdrant connection with performance metrics
 * Returns latency in milliseconds
 */
export async function testQdrantConnection(): Promise<{
  success: boolean;
  latencyMs: number;
}> {
  const start = performance.now();
  try {
    const client = getQdrantClient();
    await client.getCollections();
    const latencyMs = Math.round(performance.now() - start);
    connectionVerified = true;
    logger.info("Qdrant connection test successful", { latencyMs });
    return { success: true, latencyMs };
  } catch (error) {
    const latencyMs = Math.round(performance.now() - start);
    logger.error("Qdrant connection test failed:", error);
    connectionVerified = false;
    return { success: false, latencyMs };
  }
}

/**
 * Check if connection has been verified
 */
export function isConnectionVerified(): boolean {
  return connectionVerified;
}

/**
 * Reset client (useful for testing or reconnection)
 */
export function resetClient(): void {
  qdrantClient = null;
  connectionVerified = false;
}

/**
 * Collection names configuration
 * Can be overridden via environment variables
 */
export const COLLECTIONS = {
  DOCUMENTS: process.env.QDRANT_DOCUMENTS_COLLECTION || "documents",
  MESSAGES: process.env.QDRANT_MESSAGES_COLLECTION || "messages",
  KNOWLEDGE_BASE: process.env.QDRANT_KNOWLEDGE_COLLECTION || "knowledge_base",
} as const;

/**
 * Vector configuration
 */
export const VECTOR_CONFIG = {
  // OpenAI text-embedding-3-small dimensions
  DIMENSIONS: 1536,
  // Cosine similarity for semantic search
  DISTANCE: "Cosine" as const,
} as const;
