/**
 * Knowledge Base IPC Handlers - Full RAG System
 *
 * Provides complete knowledge base and document management:
 * - Create, read, update, delete knowledge bases
 * - Upload and index documents (PDF, DOCX, TXT, MD)
 * - Chunk documents and store in vector database
 * - List all indexed memories with CRUD operations
 *
 * Architecture:
 * Renderer -> IPC -> Main Process -> SQLite (metadata) + DuckDB (vectors)
 */

import { ipcMain, dialog, app } from "electron";
import { randomUUID } from "crypto";
import path from "path";
import fs from "fs-extra";
import { getDatabase, schema } from "../services/database";
import { getVectorStore } from "../services/vector-store";
import { getEmbeddingService } from "../services/embedding";
import { eq, and, desc, sql } from "drizzle-orm";
import { clearMemoryCaches } from "./memory";

// Document processing settings
const CHUNK_SIZE = 1000; // Characters per chunk
const CHUNK_OVERLAP = 200; // Overlap between chunks
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

// Supported file types (including PDF with pdf-parse)
const SUPPORTED_TYPES = ["pdf", "docx", "txt", "md", "csv", "json"];

/**
 * Extract text from various document types
 */
async function extractTextFromFile(
  filePath: string,
  fileType: string
): Promise<{ text: string; metadata: Record<string, unknown> }> {
  const buffer = await fs.readFile(filePath);

  switch (fileType.toLowerCase()) {
    case "txt":
    case "md":
      return {
        text: buffer.toString("utf-8"),
        metadata: {},
      };

    case "json":
      try {
        const json = JSON.parse(buffer.toString("utf-8"));
        return {
          text: JSON.stringify(json, null, 2),
          metadata: { isJson: true },
        };
      } catch {
        return { text: buffer.toString("utf-8"), metadata: {} };
      }

    case "csv":
      return {
        text: buffer.toString("utf-8"),
        metadata: { isCsv: true },
      };

    case "docx":
      try {
        // Dynamic import mammoth
        const mammoth = await import("mammoth");
        const result = await mammoth.extractRawText({ buffer });
        return {
          text: result.value,
          metadata: { wordCount: result.value.split(/\s+/).length },
        };
      } catch (error) {
        console.error("[Knowledge] DOCX extraction failed:", error);
        throw new Error("Failed to extract text from DOCX file");
      }

    case "pdf":
      try {
        // Try pdf-parse - supports both v1 and v2 API
        const pdfParse = await import("pdf-parse");

        let text: string;
        let pageCount = 0;
        let pdfInfo: Record<string, unknown> = {};

        // Check which API version is available
        if (typeof pdfParse.PDFParse === 'function') {
          // v2 API: PDFParse is a class
          const parser = new pdfParse.PDFParse({ data: buffer });
          const textResult = await parser.getText();
          text = textResult.text;
          const infoResult = await parser.getInfo();
          pageCount = infoResult.total || textResult.pages?.length || 0;
          pdfInfo = infoResult.info || {};
          await parser.destroy();
        } else if (typeof pdfParse.default === 'function') {
          // v1 API: default export is a function
          const result = await pdfParse.default(buffer);
          text = result.text;
          pageCount = result.numpages || 0;
          pdfInfo = result.info || {};
        } else {
          throw new Error("pdf-parse module not found or has incompatible API");
        }

        if (!text || text.trim().length === 0) {
          throw new Error("PDF contains no extractable text. It may be image-based or scanned.");
        }

        console.log(`[Knowledge] PDF extracted: ${text.length} chars, ${pageCount} pages`);

        return {
          text: text,
          metadata: {
            pageCount,
            wordCount: text.split(/\s+/).length,
            info: pdfInfo,
          },
        };
      } catch (error) {
        console.error("[Knowledge] PDF extraction failed:", error);
        if (error instanceof Error && error.message.includes("no extractable text")) {
          throw error;
        }
        throw new Error(
          "Failed to extract text from PDF file. " +
          (error instanceof Error ? error.message : "The PDF may be corrupted or password-protected.")
        );
      }

    default:
      throw new Error(`Unsupported file type: ${fileType}`);
  }
}

/**
 * Split text into overlapping chunks for better retrieval
 */
function chunkText(
  text: string,
  chunkSize: number = CHUNK_SIZE,
  overlap: number = CHUNK_OVERLAP
): Array<{ content: string; startOffset: number; endOffset: number }> {
  const chunks: Array<{
    content: string;
    startOffset: number;
    endOffset: number;
  }> = [];

  if (text.length <= chunkSize) {
    return [{ content: text, startOffset: 0, endOffset: text.length }];
  }

  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    const content = text.slice(start, end);

    // Try to break at sentence boundary
    let actualEnd = end;
    if (end < text.length) {
      const lastSentence = content.lastIndexOf(". ");
      if (lastSentence > chunkSize * 0.5) {
        actualEnd = start + lastSentence + 2;
      }
    }

    chunks.push({
      content: text.slice(start, actualEnd).trim(),
      startOffset: start,
      endOffset: actualEnd,
    });

    start = actualEnd - overlap;
    if (start >= text.length) break;
  }

  return chunks;
}

/**
 * Register knowledge IPC handlers
 */
export function registerKnowledgeHandlers() {
  const db = getDatabase();
  const vectorStore = getVectorStore();
  const embeddingService = getEmbeddingService();

  // ============================================================
  // Knowledge Base CRUD
  // ============================================================

  /**
   * Create a new knowledge base
   */
  ipcMain.handle(
    "knowledge:createBase",
    async (
      _event,
      data: { name: string; description?: string; userId: string }
    ) => {
      try {
        const [knowledgeBase] = await db
          .insert(schema.KnowledgeBaseTable)
          .values({
            name: data.name,
            description: data.description,
            userId: data.userId,
          })
          .returning();

        console.log(`[Knowledge] Created knowledge base: ${knowledgeBase.id}`);
        return { success: true, knowledgeBase };
      } catch (error) {
        console.error("[Knowledge] Error creating knowledge base:", error);
        return { success: false, error: String(error) };
      }
    }
  );

  /**
   * List all knowledge bases for a user
   */
  ipcMain.handle(
    "knowledge:listBases",
    async (_event, userId: string) => {
      try {
        const bases = await db
          .select()
          .from(schema.KnowledgeBaseTable)
          .where(eq(schema.KnowledgeBaseTable.userId, userId))
          .orderBy(desc(schema.KnowledgeBaseTable.createdAt));

        return { success: true, knowledgeBases: bases };
      } catch (error) {
        console.error("[Knowledge] Error listing knowledge bases:", error);
        return { success: false, error: String(error), knowledgeBases: [] };
      }
    }
  );

  /**
   * Get a single knowledge base
   */
  ipcMain.handle(
    "knowledge:getBase",
    async (_event, id: string, userId: string) => {
      try {
        const [base] = await db
          .select()
          .from(schema.KnowledgeBaseTable)
          .where(
            and(
              eq(schema.KnowledgeBaseTable.id, id),
              eq(schema.KnowledgeBaseTable.userId, userId)
            )
          );

        if (!base) {
          return { success: false, error: "Knowledge base not found" };
        }

        // Get document count
        const [{ count }] = await db
          .select({ count: sql<number>`count(*)` })
          .from(schema.DocumentTable)
          .where(eq(schema.DocumentTable.knowledgeBaseId, id));

        return {
          success: true,
          knowledgeBase: { ...base, documentCount: Number(count) },
        };
      } catch (error) {
        console.error("[Knowledge] Error getting knowledge base:", error);
        return { success: false, error: String(error) };
      }
    }
  );

  /**
   * Update a knowledge base
   */
  ipcMain.handle(
    "knowledge:updateBase",
    async (
      _event,
      id: string,
      userId: string,
      data: { name?: string; description?: string }
    ) => {
      try {
        const [updated] = await db
          .update(schema.KnowledgeBaseTable)
          .set({
            ...data,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.KnowledgeBaseTable.id, id),
              eq(schema.KnowledgeBaseTable.userId, userId)
            )
          )
          .returning();

        return { success: true, knowledgeBase: updated };
      } catch (error) {
        console.error("[Knowledge] Error updating knowledge base:", error);
        return { success: false, error: String(error) };
      }
    }
  );

  /**
   * Delete a knowledge base and all its documents
   * IMPORTANT: Also clears caches to prevent stale data
   */
  ipcMain.handle(
    "knowledge:deleteBase",
    async (_event, id: string, userId: string) => {
      try {
        // Get all document chunks to delete from vector store
        const chunks = await db
          .select()
          .from(schema.DocumentChunkTable)
          .where(eq(schema.DocumentChunkTable.knowledgeBaseId, id));

        // Delete from vector store
        if (chunks.length > 0) {
          const vectorIds = chunks
            .filter((c) => c.vectorId)
            .map((c) => c.vectorId!);
          if (vectorIds.length > 0) {
            await vectorStore.delete("documents", vectorIds);
          }
        }

        // Delete knowledge base (cascades to documents and chunks)
        await db
          .delete(schema.KnowledgeBaseTable)
          .where(
            and(
              eq(schema.KnowledgeBaseTable.id, id),
              eq(schema.KnowledgeBaseTable.userId, userId)
            )
          );

        // CRITICAL: Clear caches to prevent deleted content from being found in search
        clearMemoryCaches();

        console.log(`[Knowledge] Deleted knowledge base: ${id}, caches cleared`);
        return { success: true };
      } catch (error) {
        console.error("[Knowledge] Error deleting knowledge base:", error);
        return { success: false, error: String(error) };
      }
    }
  );

  // ============================================================
  // Document Management
  // ============================================================

  /**
   * Upload and index a document
   */
  ipcMain.handle(
    "knowledge:uploadDocument",
    async (
      _event,
      data: {
        knowledgeBaseId: string;
        userId: string;
        filePath: string;
        fileName: string;
      }
    ) => {
      try {
        const { knowledgeBaseId, userId, filePath, fileName } = data;

        // Validate file exists
        if (!await fs.pathExists(filePath)) {
          return { success: false, error: "File not found" };
        }

        // Get file info
        const stats = await fs.stat(filePath);
        if (stats.size > MAX_FILE_SIZE) {
          return { success: false, error: "File too large (max 50MB)" };
        }

        const fileType = path.extname(fileName).slice(1).toLowerCase();
        if (!SUPPORTED_TYPES.includes(fileType)) {
          return {
            success: false,
            error: `Unsupported file type: ${fileType}. Supported: ${SUPPORTED_TYPES.join(", ")}`,
          };
        }

        // Copy file to app data directory
        const documentsDir = path.join(
          app.getPath("userData"),
          "documents",
          userId
        );
        await fs.ensureDir(documentsDir);
        const storedPath = path.join(documentsDir, `${randomUUID()}_${fileName}`);
        await fs.copy(filePath, storedPath);

        // Create document record
        const [document] = await db
          .insert(schema.DocumentTable)
          .values({
            knowledgeBaseId,
            userId,
            fileName,
            fileType,
            filePath: storedPath,
            fileSize: stats.size,
            status: "processing",
          })
          .returning();

        console.log(`[Knowledge] Created document: ${document.id}`);

        // Process document in background with timeout protection
        const processWithTimeout = async () => {
          const PROCESS_TIMEOUT = 120000; // 2 minutes max for document processing

          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => {
              reject(new Error(`Document processing timeout after ${PROCESS_TIMEOUT/1000}s`));
            }, PROCESS_TIMEOUT);
          });

          try {
            await Promise.race([
              processDocument(document.id, userId, knowledgeBaseId, storedPath, fileType),
              timeoutPromise,
            ]);
          } catch (err: any) {
            console.error(`[Knowledge] Document processing failed or timed out:`, err);
            // Ensure status is updated to failed
            try {
              await db
                .update(schema.DocumentTable)
                .set({
                  status: "failed",
                  errorMessage: err?.message || String(err),
                  updatedAt: new Date(),
                })
                .where(eq(schema.DocumentTable.id, document.id));
            } catch (updateErr) {
              console.error(`[Knowledge] Failed to update document status:`, updateErr);
            }
          }
        };

        // Fire and forget with proper error handling
        processWithTimeout();

        return { success: true, document };
      } catch (error) {
        console.error("[Knowledge] Error uploading document:", error);
        return { success: false, error: String(error) };
      }
    }
  );

  /**
   * Process document: extract text, chunk, and index
   * CRITICAL: This runs in background - must handle ALL errors gracefully
   */
  async function processDocument(
    documentId: string,
    userId: string,
    knowledgeBaseId: string,
    filePath: string,
    fileType: string
  ) {
    console.log(`[Knowledge] Starting document processing: ${documentId} (${fileType})`);

    try {
      // Extract text
      console.log(`[Knowledge] Extracting text from: ${filePath}`);
      const { text, metadata } = await extractTextFromFile(filePath, fileType);

      if (!text || text.trim().length === 0) {
        console.error(`[Knowledge] No text content found in document: ${documentId}`);
        await db
          .update(schema.DocumentTable)
          .set({
            status: "failed",
            errorMessage: "No text content found in document",
            updatedAt: new Date(),
          })
          .where(eq(schema.DocumentTable.id, documentId));
        return;
      }

      console.log(`[Knowledge] Extracted ${text.length} characters from document`);

      // Update document with extracted text
      const wordCount = text.split(/\s+/).length;
      await db
        .update(schema.DocumentTable)
        .set({
          extractedText: text,
          wordCount,
          metadata,
          updatedAt: new Date(),
        })
        .where(eq(schema.DocumentTable.id, documentId));

      // Chunk the text
      const chunks = chunkText(text);
      console.log(`[Knowledge] Document ${documentId}: ${chunks.length} chunks created`);

      if (chunks.length === 0) {
        console.error(`[Knowledge] No chunks created from document: ${documentId}`);
        await db
          .update(schema.DocumentTable)
          .set({
            status: "failed",
            errorMessage: "Failed to create text chunks",
            updatedAt: new Date(),
          })
          .where(eq(schema.DocumentTable.id, documentId));
        return;
      }

      // Initialize embedding service
      console.log(`[Knowledge] Initializing embedding service...`);
      await embeddingService.initialize();

      if (!embeddingService.isAvailable()) {
        console.error(`[Knowledge] Embedding service not available!`);
        await db
          .update(schema.DocumentTable)
          .set({
            status: "failed",
            errorMessage: "Embedding service not available. Please restart the app.",
            updatedAt: new Date(),
          })
          .where(eq(schema.DocumentTable.id, documentId));
        return;
      }

      // Initialize vector store
      if (!vectorStore.isAvailable()) {
        console.log(`[Knowledge] Initializing vector store...`);
        await vectorStore.initialize();
      }

      if (!vectorStore.isAvailable()) {
        console.error(`[Knowledge] Vector store not available!`);
        await db
          .update(schema.DocumentTable)
          .set({
            status: "failed",
            errorMessage: "Vector store not available. Please restart the app.",
            updatedAt: new Date(),
          })
          .where(eq(schema.DocumentTable.id, documentId));
        return;
      }

      console.log(`[Knowledge] Services initialized, processing ${chunks.length} chunks...`);

      // Process chunks in batches
      const BATCH_SIZE = 10;
      let indexedCount = 0;
      let failedCount = 0;

      for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
        const batch = chunks.slice(i, i + BATCH_SIZE);

        // Generate embeddings for batch
        console.log(`[Knowledge] Generating embeddings for batch ${Math.floor(i/BATCH_SIZE) + 1}...`);
        const embeddings = await embeddingService.embed(
          batch.map((c) => c.content)
        );

        // CRITICAL: Check if embeddings were generated
        if (!embeddings || embeddings.length === 0) {
          console.error(`[Knowledge] Failed to generate embeddings for batch!`);
          failedCount += batch.length;
          continue;
        }

        if (embeddings.length !== batch.length) {
          console.warn(`[Knowledge] Embedding count mismatch: ${embeddings.length} vs ${batch.length} chunks`);
        }

        // Create chunk records and index in vector store
        for (let j = 0; j < batch.length; j++) {
          const chunk = batch[j];
          const embedding = embeddings[j];
          const chunkIndex = i + j;
          const vectorId = `doc_${documentId}_chunk_${chunkIndex}`;

          // Skip if embedding is missing
          if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
            console.warn(`[Knowledge] Skipping chunk ${chunkIndex} - no embedding`);
            failedCount++;
            continue;
          }

          try {
            // Insert into SQLite
            await db.insert(schema.DocumentChunkTable).values({
              documentId,
              knowledgeBaseId,
              userId,
              chunkIndex,
              content: chunk.content,
              startOffset: chunk.startOffset,
              endOffset: chunk.endOffset,
              vectorId,
              isIndexed: true,
            });

            // Insert into vector store - NO thread_id filter needed for RAG search
            // user_id is stored BOTH in column AND metadata for robust filtering
            await vectorStore.insert("documents", [
              {
                id: vectorId,
                content: chunk.content,
                embedding: embedding,
                thread_id: knowledgeBaseId, // Used for knowledge base organization
                user_id: userId, // CRITICAL: userId column for security filtering
                metadata: {
                  documentId,
                  knowledgeBaseId,
                  userId, // Also in metadata for backwards compatibility
                  chunkIndex,
                  fileName: path.basename(filePath),
                },
              },
            ]);

            indexedCount++;
          } catch (insertError) {
            console.error(`[Knowledge] Failed to insert chunk ${chunkIndex}:`, insertError);
            failedCount++;
          }
        }

        console.log(
          `[Knowledge] Document ${documentId}: indexed ${indexedCount}/${chunks.length} chunks (${failedCount} failed)`
        );
      }

      // Determine final status
      if (indexedCount === 0) {
        console.error(`[Knowledge] Document ${documentId}: All chunks failed to index!`);
        await db
          .update(schema.DocumentTable)
          .set({
            status: "failed",
            errorMessage: `Failed to index any chunks (${failedCount} failed)`,
            updatedAt: new Date(),
          })
          .where(eq(schema.DocumentTable.id, documentId));
        return;
      }

      // Update document status - SUCCESS
      await db
        .update(schema.DocumentTable)
        .set({
          status: "indexed",
          chunkCount: indexedCount,
          indexedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.DocumentTable.id, documentId));

      // Update knowledge base counts
      await db
        .update(schema.KnowledgeBaseTable)
        .set({
          documentCount: sql`${schema.KnowledgeBaseTable.documentCount} + 1`,
          totalChunks: sql`${schema.KnowledgeBaseTable.totalChunks} + ${indexedCount}`,
          updatedAt: new Date(),
        })
        .where(eq(schema.KnowledgeBaseTable.id, knowledgeBaseId));

      console.log(`[Knowledge] ✓ Document ${documentId} fully indexed with ${indexedCount} chunks (${failedCount} failed)`);

      // Clear memory caches so newly indexed documents appear in searches immediately
      clearMemoryCaches();
      console.log(`[Knowledge] Cache cleared - new documents now searchable`);
    } catch (error) {
      console.error(`[Knowledge] FATAL error processing document ${documentId}:`, error);
      try {
        await db
          .update(schema.DocumentTable)
          .set({
            status: "failed",
            errorMessage: error instanceof Error ? error.message : String(error),
            updatedAt: new Date(),
          })
          .where(eq(schema.DocumentTable.id, documentId));
      } catch (updateError) {
        console.error(`[Knowledge] Failed to update document status:`, updateError);
      }
    }
  }

  /**
   * List documents in a knowledge base
   */
  ipcMain.handle(
    "knowledge:listDocuments",
    async (_event, knowledgeBaseId: string, userId: string) => {
      try {
        const documents = await db
          .select()
          .from(schema.DocumentTable)
          .where(
            and(
              eq(schema.DocumentTable.knowledgeBaseId, knowledgeBaseId),
              eq(schema.DocumentTable.userId, userId)
            )
          )
          .orderBy(desc(schema.DocumentTable.createdAt));

        return { success: true, documents };
      } catch (error) {
        console.error("[Knowledge] Error listing documents:", error);
        return { success: false, error: String(error), documents: [] };
      }
    }
  );

  /**
   * Delete a document
   * IMPORTANT: Also clears caches to prevent stale data
   */
  ipcMain.handle(
    "knowledge:deleteDocument",
    async (_event, documentId: string, userId: string) => {
      try {
        // Get document info
        const [document] = await db
          .select()
          .from(schema.DocumentTable)
          .where(
            and(
              eq(schema.DocumentTable.id, documentId),
              eq(schema.DocumentTable.userId, userId)
            )
          );

        if (!document) {
          return { success: false, error: "Document not found" };
        }

        // Get chunks to delete from vector store
        const chunks = await db
          .select()
          .from(schema.DocumentChunkTable)
          .where(eq(schema.DocumentChunkTable.documentId, documentId));

        // Delete from vector store
        const vectorIds = chunks.filter((c) => c.vectorId).map((c) => c.vectorId!);
        if (vectorIds.length > 0) {
          await vectorStore.delete("documents", vectorIds);
        }

        // Delete from SQLite (cascades to chunks)
        await db
          .delete(schema.DocumentTable)
          .where(eq(schema.DocumentTable.id, documentId));

        // Delete file from disk
        if (document.filePath && await fs.pathExists(document.filePath)) {
          await fs.remove(document.filePath);
        }

        // Update knowledge base counts
        await db
          .update(schema.KnowledgeBaseTable)
          .set({
            documentCount: sql`MAX(${schema.KnowledgeBaseTable.documentCount} - 1, 0)`,
            totalChunks: sql`MAX(${schema.KnowledgeBaseTable.totalChunks} - ${document.chunkCount || 0}, 0)`,
            updatedAt: new Date(),
          })
          .where(eq(schema.KnowledgeBaseTable.id, document.knowledgeBaseId));

        // CRITICAL: Clear caches to prevent deleted content from being found in search
        clearMemoryCaches();

        console.log(`[Knowledge] Deleted document: ${documentId}, caches cleared`);
        return { success: true };
      } catch (error) {
        console.error("[Knowledge] Error deleting document:", error);
        return { success: false, error: String(error) };
      }
    }
  );

  /**
   * Open file dialog for document upload
   */
  ipcMain.handle(
    "knowledge:selectFile",
    async () => {
      try {
        const result = await dialog.showOpenDialog({
          properties: ["openFile"],
          filters: [
            {
              name: "Documents",
              extensions: SUPPORTED_TYPES,
            },
          ],
        });

        if (result.canceled || result.filePaths.length === 0) {
          return { success: false, canceled: true };
        }

        const filePath = result.filePaths[0];
        const fileName = path.basename(filePath);

        return { success: true, filePath, fileName };
      } catch (error) {
        console.error("[Knowledge] Error selecting file:", error);
        return { success: false, error: String(error) };
      }
    }
  );

  // ============================================================
  // Memory List (All indexed content)
  // ============================================================

  /**
   * List all indexed memories with pagination
   */
  ipcMain.handle(
    "knowledge:listMemories",
    async (
      _event,
      params: {
        userId: string;
        page?: number;
        limit?: number;
        source?: "all" | "messages" | "documents";
        search?: string;
      }
    ) => {
      try {
        const { userId, page = 1, limit = 20, source = "all", search } = params;
        const offset = (page - 1) * limit;

        // If search query provided, use vector search
        if (search && search.trim().length >= 3) {
          await embeddingService.initialize();
          if (!vectorStore.isAvailable()) {
            await vectorStore.initialize();
          }

          const [queryEmbedding] = await embeddingService.embed(search);

          const collections: Array<"messages" | "documents"> =
            source === "all"
              ? ["messages", "documents"]
              : source === "messages"
              ? ["messages"]
              : ["documents"];

          const results: any[] = [];
          for (const collection of collections) {
            const searchResults = await vectorStore.search(
              queryEmbedding,
              collection,
              limit * 2,
              { thread_id: undefined }
            );
            results.push(
              ...searchResults.map((r: any) => ({
                ...r,
                source: collection,
              }))
            );
          }

          // Sort by similarity and paginate
          results.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
          const paginatedResults = results.slice(offset, offset + limit);

          return {
            success: true,
            memories: paginatedResults,
            pagination: {
              page,
              limit,
              total: results.length,
              totalPages: Math.ceil(results.length / limit),
              hasMore: offset + limit < results.length,
            },
          };
        }

        // No search - list from SQLite
        // For messages, we get from the vector index tracking table
        const memories: any[] = [];

        if (source === "all" || source === "messages") {
          // Note: For messages, we need search to retrieve from vector store
          // Vector store doesn't support listing without a search query
          // The stats are returned at the end to show total counts
        }

        if (source === "all" || source === "documents") {
          // Get documents from SQLite
          const documents = await db
            .select()
            .from(schema.DocumentTable)
            .where(eq(schema.DocumentTable.userId, userId))
            .orderBy(desc(schema.DocumentTable.createdAt))
            .limit(limit)
            .offset(offset);

          for (const doc of documents) {
            memories.push({
              id: doc.id,
              content: doc.extractedText?.slice(0, 500) || doc.fileName,
              source: "documents",
              fileName: doc.fileName,
              fileType: doc.fileType,
              createdAt: doc.createdAt,
              knowledgeBaseId: doc.knowledgeBaseId,
              chunkCount: doc.chunkCount,
              status: doc.status,
            });
          }
        }

        // Get total counts
        const stats = await vectorStore.getStats();

        return {
          success: true,
          memories,
          pagination: {
            page,
            limit,
            total: stats.messages + stats.documents,
            totalPages: Math.ceil((stats.messages + stats.documents) / limit),
            hasMore: memories.length === limit,
          },
          stats,
        };
      } catch (error) {
        console.error("[Knowledge] Error listing memories:", error);
        return {
          success: false,
          error: String(error),
          memories: [],
          pagination: { page: 1, limit: 20, total: 0, totalPages: 0, hasMore: false },
        };
      }
    }
  );

  /**
   * Get vector store statistics
   */
  ipcMain.handle("knowledge:getStats", async () => {
    try {
      const stats = await vectorStore.getStats();
      const embeddingAvailable = embeddingService.isAvailable();

      return {
        success: true,
        stats: {
          ...stats,
          embeddingAvailable,
          embeddingService: embeddingAvailable
            ? "local (transformers.js - all-MiniLM-L6-v2)"
            : "unavailable",
        },
      };
    } catch (error) {
      console.error("[Knowledge] Error getting stats:", error);
      return {
        success: false,
        error: String(error),
        stats: { messages: 0, documents: 0, available: false },
      };
    }
  });

  console.log("[IPC] Knowledge handlers registered (Full RAG System)");
}
