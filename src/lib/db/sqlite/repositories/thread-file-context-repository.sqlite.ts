import { eq, lt } from "drizzle-orm";
import { sqliteDb as db } from "../db.sqlite";
import {
  ThreadFileMetadata,
  ThreadFileContextEntity,
  ThreadFileContextTable,
} from "../schema.sqlite";

/**
 * Repository for managing per-thread file context persistence.
 * Handles storage keys for archived local working directories and file metadata.
 */
export interface ThreadFileContextRepository {
  /**
   * Get or create a context for a thread.
   * If the context doesn't exist, creates one with default values.
   */
  getOrCreate(
    threadId: string,
    userId: string,
  ): Promise<ThreadFileContextEntity>;

  /**
   * Get context by thread ID.
   */
  getByThreadId(threadId: string): Promise<ThreadFileContextEntity | null>;

  /**
   * Update the context storage key and size after archiving.
   */
  updateArchive(
    threadId: string,
    storageKey: string,
    sizeBytes: number,
  ): Promise<void>;

  /**
   * Update file metadata for a thread.
   */
  updateFileMetadata(
    threadId: string,
    fileMetadata: ThreadFileMetadata[],
  ): Promise<void>;

  /**
   * Add a single file to the metadata (for user uploads).
   */
  addFile(threadId: string, file: ThreadFileMetadata): Promise<void>;

  /**
   * Remove a file from metadata by name.
   */
  removeFile(threadId: string, fileName: string): Promise<void>;

  /**
   * Update last execution timestamp.
   */
  touchExecution(threadId: string): Promise<void>;

  /**
   * Update last accessed timestamp.
   */
  touchAccess(threadId: string): Promise<void>;

  /**
   * Delete context by thread ID.
   */
  deleteByThreadId(threadId: string): Promise<void>;

  /**
   * Get all contexts that haven't been accessed in the given number of days.
   * Used for cleanup.
   */
  getStaleContexts(inactiveDays: number): Promise<ThreadFileContextEntity[]>;

  /**
   * Delete stale contexts and return the storage keys that need cleanup.
   */
  deleteStaleContexts(inactiveDays: number): Promise<string[]>;
}

export const sqliteThreadFileContextRepository: ThreadFileContextRepository = {
  async getOrCreate(threadId, userId) {
    // Try to get existing
    const existing = await this.getByThreadId(threadId);
    if (existing) {
      return existing;
    }

    // Create new context
    const [result] = await db
      .insert(ThreadFileContextTable)
      .values({
        threadId,
        userId,
        fileMetadata: [],
        totalFilesCount: 0,
        contextSizeBytes: "0",
      })
      .returning();

    return result;
  },

  async getByThreadId(threadId) {
    const [result] = await db
      .select()
      .from(ThreadFileContextTable)
      .where(eq(ThreadFileContextTable.threadId, threadId));

    return result ?? null;
  },

  async updateArchive(threadId, storageKey, sizeBytes) {
    await db
      .update(ThreadFileContextTable)
      .set({
        contextStorageKey: storageKey,
        contextSizeBytes: sizeBytes.toString(),
        lastExecutionAt: new Date(),
        lastAccessedAt: new Date(),
      })
      .where(eq(ThreadFileContextTable.threadId, threadId));
  },

  async updateFileMetadata(threadId, fileMetadata) {
    await db
      .update(ThreadFileContextTable)
      .set({
        fileMetadata,
        totalFilesCount: fileMetadata.length,
        lastAccessedAt: new Date(),
      })
      .where(eq(ThreadFileContextTable.threadId, threadId));
  },

  async addFile(threadId, file) {
    const context = await this.getByThreadId(threadId);
    if (!context) {
      throw new Error(`Thread context not found: ${threadId}`);
    }

    const existingFiles = (context.fileMetadata as ThreadFileMetadata[]) ?? [];
    // Remove any existing file with the same name
    const updatedFiles = existingFiles.filter((f) => f.name !== file.name);
    updatedFiles.push(file);

    await this.updateFileMetadata(threadId, updatedFiles);
  },

  async removeFile(threadId, fileName) {
    const context = await this.getByThreadId(threadId);
    if (!context) {
      return;
    }

    const existingFiles = (context.fileMetadata as ThreadFileMetadata[]) ?? [];
    const updatedFiles = existingFiles.filter((f) => f.name !== fileName);

    await this.updateFileMetadata(threadId, updatedFiles);
  },

  async touchExecution(threadId) {
    await db
      .update(ThreadFileContextTable)
      .set({
        lastExecutionAt: new Date(),
        lastAccessedAt: new Date(),
      })
      .where(eq(ThreadFileContextTable.threadId, threadId));
  },

  async touchAccess(threadId) {
    await db
      .update(ThreadFileContextTable)
      .set({
        lastAccessedAt: new Date(),
      })
      .where(eq(ThreadFileContextTable.threadId, threadId));
  },

  async deleteByThreadId(threadId) {
    await db
      .delete(ThreadFileContextTable)
      .where(eq(ThreadFileContextTable.threadId, threadId));
  },

  async getStaleContexts(inactiveDays) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - inactiveDays);

    const result = await db
      .select()
      .from(ThreadFileContextTable)
      .where(lt(ThreadFileContextTable.lastAccessedAt, cutoffDate));

    return result;
  },

  async deleteStaleContexts(inactiveDays) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - inactiveDays);

    // Get storage keys before deletion
    const staleContexts = await db
      .select({ storageKey: ThreadFileContextTable.contextStorageKey })
      .from(ThreadFileContextTable)
      .where(lt(ThreadFileContextTable.lastAccessedAt, cutoffDate));

    const storageKeys = staleContexts
      .map((c) => c.storageKey)
      .filter((key): key is string => key !== null);

    // Delete the contexts
    await db
      .delete(ThreadFileContextTable)
      .where(lt(ThreadFileContextTable.lastAccessedAt, cutoffDate));

    return storageKeys;
  },
};

// Legacy alias for backwards compatibility
export const sqliteThreadSandboxContextRepository =
  sqliteThreadFileContextRepository;
