import { ipcMain } from 'electron';
import { getVectorStore } from '../services/vector-store';
import { getEmbeddingService } from '../services/embedding';

export function registerVectorHandlers() {
  const vectorStore = getVectorStore();
  const embeddingService = getEmbeddingService();

  // Initialize services
  ipcMain.handle('vector:initialize', async () => {
    try {
      await vectorStore.initialize();
      await embeddingService.initialize();
      return { success: true };
    } catch (error) {
      console.error('[IPC] Error initializing vector services:', error);
      throw error;
    }
  });

  // Search for similar documents/messages
  ipcMain.handle('vector:search', async (event, queryEmbedding: number[], options: any) => {
    try {
      const results = await vectorStore.search(
        queryEmbedding,
        options.collection || 'documents',
        options.limit || 10,
        options.filter
      );

      return results;
    } catch (error) {
      console.error('[IPC] Error searching vectors:', error);
      throw error;
    }
  });

  // Insert embeddings
  ipcMain.handle('vector:insert', async (event, documents: any[]) => {
    try {
      await vectorStore.insert(
        documents[0]?.collection || 'documents',
        documents
      );

      return { success: true };
    } catch (error) {
      console.error('[IPC] Error inserting vectors:', error);
      throw error;
    }
  });

  // Delete embeddings
  ipcMain.handle('vector:delete', async (event, ids: string[]) => {
    try {
      await vectorStore.delete('documents', ids);
      return { success: true };
    } catch (error) {
      console.error('[IPC] Error deleting vectors:', error);
      throw error;
    }
  });

  // Delete by thread
  ipcMain.handle('vector:deleteByThread', async (event, threadId: string) => {
    try {
      await vectorStore.deleteByThread(threadId);
      return { success: true };
    } catch (error) {
      console.error('[IPC] Error deleting vectors by thread:', error);
      throw error;
    }
  });

  // Get vector store stats
  ipcMain.handle('vector:getStats', async () => {
    try {
      const stats = await vectorStore.getStats();
      return stats;
    } catch (error) {
      console.error('[IPC] Error getting vector stats:', error);
      throw error;
    }
  });

  // Generate embeddings
  ipcMain.handle('embeddings:generate', async (event, texts: string[]) => {
    try {
      const embeddings = await embeddingService.embed(texts);
      return embeddings;
    } catch (error) {
      console.error('[IPC] Error generating embeddings:', error);
      throw error;
    }
  });

  // Generate embeddings in batches
  ipcMain.handle('embeddings:generateBatch', async (event, texts: string[], batchSize?: number) => {
    try {
      const embeddings = await embeddingService.embedBatch(texts, batchSize);
      return embeddings;
    } catch (error) {
      console.error('[IPC] Error generating batch embeddings:', error);
      throw error;
    }
  });

  // Calculate cosine similarity
  ipcMain.handle('embeddings:cosineSimilarity', async (event, embedding1: number[], embedding2: number[]) => {
    try {
      const similarity = embeddingService.cosineSimilarity(embedding1, embedding2);
      return similarity;
    } catch (error) {
      console.error('[IPC] Error calculating cosine similarity:', error);
      throw error;
    }
  });

  console.log('[IPC] Vector and embedding handlers registered');
}
