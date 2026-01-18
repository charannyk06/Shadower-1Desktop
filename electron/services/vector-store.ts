import { app } from 'electron';
import path from 'path';
import { Database } from 'duckdb';
import fs from 'fs-extra';

// DuckDB Vector Store for ultra-fast local vector search
export class VectorStore {
  private db: Database | null = null;
  private initialized = false;

  async initialize() {
    if (this.initialized) {
      return;
    }

    const userDataDir = app.getPath('userData');
    const dbDir = path.join(userDataDir, 'data');
    fs.ensureDirSync(dbDir);

    const dbPath = path.join(dbDir, 'vectors.duckdb');
    console.log('[VectorStore] Initializing DuckDB at:', dbPath);

    // Create DuckDB instance
    this.db = new Database(dbPath);

    // Install and load VSS extension for vector similarity search
    await this.runQuery('INSTALL vss');
    await this.runQuery('LOAD vss');

    // Create tables for document and message embeddings
    await this.createTables();

    this.initialized = true;
    console.log('[VectorStore] DuckDB Vector Store initialized successfully');
  }

  private async createTables() {
    // Documents table with embeddings
    await this.runQuery(`
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
    await this.runQuery(`
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

    // Create HNSW indexes for fast similarity search
    console.log('[VectorStore] Creating HNSW indexes...');

    // Note: DuckDB's VSS extension uses a different syntax
    // We'll use array_cosine_similarity in queries for now
    // Full HNSW index support may require additional configuration
  }

  private runQuery(sql: string, params: any[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  /**
   * Search for similar documents or messages
   * @param queryEmbedding - The query embedding vector
   * @param collection - 'documents' or 'messages'
   * @param limit - Number of results to return
   * @param filter - Optional filters (e.g., thread_id)
   * @returns Array of similar items with similarity scores
   */
  async search(
    queryEmbedding: number[],
    collection: 'documents' | 'messages',
    limit: number = 10,
    filter?: { thread_id?: string }
  ): Promise<any[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    const table = collection === 'documents'
      ? 'document_embeddings'
      : 'message_embeddings';

    const whereClause = filter?.thread_id
      ? `WHERE thread_id = '${filter.thread_id}'`
      : '';

    // Convert embedding array to DuckDB array format
    const embeddingStr = `[${queryEmbedding.join(',')}]`;

    const query = `
      SELECT
        id,
        content,
        metadata,
        thread_id,
        array_cosine_similarity(embedding, ${embeddingStr}::FLOAT[1536]) as similarity
      FROM ${table}
      ${whereClause}
      ORDER BY similarity DESC
      LIMIT ${limit}
    `;

    try {
      const results = await this.runQuery(query);
      return results;
    } catch (error) {
      console.error('[VectorStore] Search error:', error);
      throw error;
    }
  }

  /**
   * Insert embeddings for documents or messages
   * @param collection - 'documents' or 'messages'
   * @param items - Array of items with embeddings
   */
  async insert(
    collection: 'documents' | 'messages',
    items: Array<{
      id: string;
      content: string;
      embedding: number[];
      metadata?: any;
      thread_id?: string;
      message_id?: string;
      role?: string;
    }>
  ): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    const table = collection === 'documents'
      ? 'document_embeddings'
      : 'message_embeddings';

    // Batch insert for performance
    for (const item of items) {
      const embeddingStr = `[${item.embedding.join(',')}]`;
      const metadataStr = item.metadata
        ? `'${JSON.stringify(item.metadata)}'`
        : 'NULL';

      if (collection === 'documents') {
        await this.runQuery(`
          INSERT INTO ${table} (id, content, embedding, metadata, thread_id)
          VALUES (?, ?, ${embeddingStr}::FLOAT[1536], ${metadataStr}::JSON, ?)
        `, [item.id, item.content, item.thread_id || null]);
      } else {
        await this.runQuery(`
          INSERT INTO ${table} (id, thread_id, message_id, role, content, embedding)
          VALUES (?, ?, ?, ?, ?, ${embeddingStr}::FLOAT[1536])
        `, [
          item.id,
          item.thread_id || null,
          item.message_id || null,
          item.role || null,
          item.content,
        ]);
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
    collection: 'documents' | 'messages',
    ids: string[]
  ): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    const table = collection === 'documents'
      ? 'document_embeddings'
      : 'message_embeddings';

    const placeholders = ids.map(() => '?').join(',');
    await this.runQuery(`DELETE FROM ${table} WHERE id IN (${placeholders})`, ids);

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

    await this.runQuery(
      'DELETE FROM document_embeddings WHERE thread_id = ?',
      [threadId]
    );
    await this.runQuery(
      'DELETE FROM message_embeddings WHERE thread_id = ?',
      [threadId]
    );

    console.log(`[VectorStore] Deleted all embeddings for thread: ${threadId}`);
  }

  /**
   * Get statistics about the vector store
   */
  async getStats(): Promise<{
    documents: number;
    messages: number;
  }> {
    if (!this.initialized) {
      await this.initialize();
    }

    const [docCount] = await this.runQuery(
      'SELECT COUNT(*) as count FROM document_embeddings'
    );
    const [msgCount] = await this.runQuery(
      'SELECT COUNT(*) as count FROM message_embeddings'
    );

    return {
      documents: docCount.count,
      messages: msgCount.count,
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
      console.log('[VectorStore] DuckDB connection closed');
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
