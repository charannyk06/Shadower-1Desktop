import { app } from "electron";
import path from "path";
import fs from "fs-extra";

// DuckDB is imported dynamically to avoid crashes if native module is missing
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DuckDBDatabase = any;

// DuckDB Vector Store for ultra-fast local vector search
export class VectorStore {
  private static _instance: VectorStore | null = null;
  private db: DuckDBDatabase | null = null;
  private initialized = false;
  private available = false;

  static getInstance(): VectorStore {
    if (!VectorStore._instance) {
      VectorStore._instance = new VectorStore();
    }
    return VectorStore._instance;
  }

  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      // Dynamically import DuckDB to avoid crashes if native module is missing
      let Database: new (path: string) => DuckDBDatabase;
      try {
        const duckdb = require("duckdb");
        Database = duckdb.Database;
      } catch (importError) {
        console.warn(
          "[VectorStore] DuckDB module not available:",
          importError instanceof Error ? importError.message : importError,
        );
        this.initialized = true;
        this.available = false;
        return;
      }

      const userDataDir = app.getPath("userData");
      const dbDir = path.join(userDataDir, "data");
      fs.ensureDirSync(dbDir);

      const dbPath = path.join(dbDir, "vectors.duckdb");
      console.log("[VectorStore] Initializing DuckDB at:", dbPath);

      // Try to create DuckDB instance - may fail if native module not available
      try {
        this.db = new Database(dbPath);
        this.available = true;
      } catch (dbError) {
        console.warn(
          "[VectorStore] DuckDB native module not available:",
          dbError,
        );
        this.initialized = true;
        this.available = false;
        return;
      }
    } catch (error) {
      console.warn(
        "[VectorStore] DuckDB not available, vector search will be disabled:",
        error,
      );
      this.initialized = true;
      this.available = false;
      return;
    }

    // Install and load VSS extension for vector similarity search
    try {
      await this.runStatement("INSTALL vss");
      await this.runStatement("LOAD vss");
      console.log("[VectorStore] VSS extension loaded successfully");
    } catch (vssError) {
      console.warn(
        "[VectorStore] VSS extension not available, using basic array operations:",
        vssError instanceof Error ? vssError.message : vssError,
      );
      // Continue without VSS - we'll use array_cosine_similarity which is built-in
    }

    // Create tables for document and message embeddings
    await this.createTables();

    this.initialized = true;
    console.log("[VectorStore] DuckDB Vector Store initialized successfully");
  }

  // Run a statement without parameters (for DDL, INSTALL, LOAD, etc.)
  private runStatement(sql: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Database not initialized"));
        return;
      }

      this.db.run(sql, (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private async createTables() {
    // Documents table with embeddings
    await this.runStatement(`
      CREATE TABLE IF NOT EXISTS document_embeddings (
        id VARCHAR PRIMARY KEY,
        thread_id VARCHAR,
        content TEXT,
        embedding FLOAT[1536],
        metadata JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Message embeddings for conversation context
    await this.runStatement(`
      CREATE TABLE IF NOT EXISTS message_embeddings (
        id VARCHAR PRIMARY KEY,
        thread_id VARCHAR,
        message_id VARCHAR,
        role VARCHAR,
        content TEXT,
        embedding FLOAT[1536],
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log("[VectorStore] Tables created successfully");
  }

  private runQuery(sql: string, params: any[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Database not initialized"));
        return;
      }

      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  /**
   * Check if vector store is available
   */
  isAvailable(): boolean {
    return this.available && this.db !== null;
  }

  /**
   * Validate thread_id to prevent SQL injection
   * Only allows alphanumeric characters, hyphens, and underscores (valid UUIDs)
   */
  private validateThreadId(threadId: string): boolean {
    // UUID format: alphanumeric with hyphens
    const validPattern = /^[a-zA-Z0-9-_]+$/;
    return validPattern.test(threadId) && threadId.length <= 64;
  }

  /**
   * Search for similar documents or messages
   * @param queryEmbedding - The query embedding vector
   * @param collection - 'documents' or 'messages'
   * @param limit - Number of results to return
   * @param filter - Optional filters (e.g., thread_id, user_id)
   * @returns Array of similar items with similarity scores
   */
  async search(
    queryEmbedding: number[],
    collection: "documents" | "messages",
    limit: number = 10,
    filter?: { thread_id?: string; user_id?: string },
  ): Promise<any[]> {
    if (!this.initialized) {
      await this.initialize();
    }
    if (!this.available) {
      console.warn("[VectorStore] Search called but DuckDB not available");
      return [];
    }

    const table =
      collection === "documents" ? "document_embeddings" : "message_embeddings";

    // SECURITY: Validate and sanitize inputs
    const params: any[] = [];

    // Build WHERE clause with parameterized queries
    const conditions: string[] = [];
    if (filter?.thread_id) {
      // SECURITY: Validate thread_id format before use
      if (!this.validateThreadId(filter.thread_id)) {
        console.error(
          "[VectorStore] Invalid thread_id format:",
          filter.thread_id,
        );
        throw new Error("Invalid thread_id format");
      }
      conditions.push(`thread_id = ?`);
      params.push(filter.thread_id);
    }
    // Note: userId is stored in metadata JSON for security filtering

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Convert embedding array to DuckDB array format
    // SECURITY: Validate embedding is array of numbers only
    if (
      !Array.isArray(queryEmbedding) ||
      !queryEmbedding.every((n) => typeof n === "number" && Number.isFinite(n))
    ) {
      throw new Error("Invalid embedding format");
    }
    const embeddingStr = `[${queryEmbedding.join(",")}]`;

    // SECURITY: Validate limit is a positive integer
    const safeLimit = Math.min(Math.max(1, Math.floor(Number(limit))), 1000);

    // Query with all relevant fields for messages
    const query =
      collection === "messages"
        ? `
      SELECT
        id,
        content,
        metadata,
        thread_id,
        message_id,
        role,
        created_at,
        array_cosine_similarity(embedding, ${embeddingStr}::FLOAT[1536]) as similarity
      FROM ${table}
      ${whereClause}
      ORDER BY similarity DESC
      LIMIT ${safeLimit}
    `
        : `
      SELECT
        id,
        content,
        metadata,
        thread_id,
        created_at,
        array_cosine_similarity(embedding, ${embeddingStr}::FLOAT[1536]) as similarity
      FROM ${table}
      ${whereClause}
      ORDER BY similarity DESC
      LIMIT ${safeLimit}
    `;

    try {
      const results = await this.runQuery(query, params);
      return results;
    } catch (error) {
      console.error("[VectorStore] Search error:", error);
      throw error;
    }
  }

  /**
   * Insert embeddings for documents or messages
   * @param collection - 'documents' or 'messages'
   * @param items - Array of items with embeddings
   */
  async insert(
    collection: "documents" | "messages",
    items: Array<{
      id: string;
      content: string;
      embedding: number[];
      metadata?: any;
      thread_id?: string;
      message_id?: string;
      role?: string;
    }>,
  ): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
    if (!this.available) {
      console.warn("[VectorStore] Insert called but DuckDB not available");
      return;
    }

    const table =
      collection === "documents" ? "document_embeddings" : "message_embeddings";

    // Batch insert for performance
    for (const item of items) {
      // SECURITY: Validate embedding is array of numbers only
      if (
        !Array.isArray(item.embedding) ||
        !item.embedding.every((n) => typeof n === "number" && Number.isFinite(n))
      ) {
        console.error("[VectorStore] Invalid embedding format for item:", item.id);
        continue;
      }
      const embeddingStr = `[${item.embedding.join(",")}]`;

      // SECURITY: Safely serialize metadata as JSON string for parameterized query
      const metadataJson = item.metadata ? JSON.stringify(item.metadata) : null;

      if (collection === "documents") {
        await this.runQuery(
          `
          INSERT INTO ${table} (id, content, embedding, metadata, thread_id)
          VALUES (?, ?, ${embeddingStr}::FLOAT[1536], ?::JSON, ?)
        `,
          [item.id, item.content, metadataJson, item.thread_id || null],
        );
      } else {
        await this.runQuery(
          `
          INSERT INTO ${table} (id, thread_id, message_id, role, content, embedding)
          VALUES (?, ?, ?, ?, ?, ${embeddingStr}::FLOAT[1536])
        `,
          [
            item.id,
            item.thread_id || null,
            item.message_id || null,
            item.role || null,
            item.content,
          ],
        );
      }
    }

    console.log(`[VectorStore] Inserted ${items.length} items into ${table}`);
  }

  /**
   * Delete embeddings by IDs
   * @param collection - 'documents' or 'messages'
   * @param ids - Array of IDs to delete
   */
  async delete(
    collection: "documents" | "messages",
    ids: string[],
  ): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
    if (!this.available) {
      return;
    }

    const table =
      collection === "documents" ? "document_embeddings" : "message_embeddings";

    const placeholders = ids.map(() => "?").join(",");
    await this.runQuery(
      `DELETE FROM ${table} WHERE id IN (${placeholders})`,
      ids,
    );

    console.log(`[VectorStore] Deleted ${ids.length} items from ${table}`);
  }

  /**
   * Delete all embeddings for a specific thread
   * @param threadId - Thread ID to delete embeddings for
   */
  async deleteByThread(threadId: string): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
    if (!this.available) {
      return;
    }

    await this.runQuery("DELETE FROM document_embeddings WHERE thread_id = ?", [
      threadId,
    ]);
    await this.runQuery("DELETE FROM message_embeddings WHERE thread_id = ?", [
      threadId,
    ]);

    console.log(`[VectorStore] Deleted all embeddings for thread: ${threadId}`);
  }

  /**
   * Get statistics about the vector store
   */
  async getStats(): Promise<{
    documents: number;
    messages: number;
    available: boolean;
  }> {
    if (!this.initialized) {
      await this.initialize();
    }
    if (!this.available) {
      return { documents: 0, messages: 0, available: false };
    }

    const [docCount] = await this.runQuery(
      "SELECT COUNT(*) as count FROM document_embeddings",
    );
    const [msgCount] = await this.runQuery(
      "SELECT COUNT(*) as count FROM message_embeddings",
    );

    return {
      documents: docCount.count,
      messages: msgCount.count,
      available: true,
    };
  }

  /**
   * Close the database connection
   */
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initialized = false;
      console.log("[VectorStore] DuckDB connection closed");
    }
  }
}

// Singleton instance
let vectorStore: VectorStore | null = null;

export const getVectorStore = (): VectorStore => {
  if (!vectorStore) {
    vectorStore = new VectorStore();
  }
  return vectorStore;
};

export const closeVectorStore = () => {
  if (vectorStore) {
    vectorStore.close();
    vectorStore = null;
  }
};
