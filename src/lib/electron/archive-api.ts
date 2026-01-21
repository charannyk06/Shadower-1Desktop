/**
 * Unified Archive API for Desktop (Electron)
 *
 * This module provides a unified API for archive operations using Electron IPC.
 * Desktop-only - no HTTP fallbacks.
 */

/**
 * Get current user ID from Electron auth
 */
async function getElectronUserId(): Promise<string> {
  const user = await window.electronAPI.auth.getCurrentUser();
  return user?.id || "local-user";
}

/**
 * Unified Archive API - Desktop Only (IPC)
 */
export const archiveApi = {
  /**
   * Get all archives for the current user
   */
  async getAll(): Promise<any[]> {
    const userId = await getElectronUserId();
    return window.electronAPI.db.archives.getAll(userId);
  },

  /**
   * Get a single archive by ID
   */
  async getById(id: string): Promise<any | null> {
    return window.electronAPI.db.archives.getById(id);
  },

  /**
   * Create a new archive
   */
  async create(data: any): Promise<any> {
    const userId = await getElectronUserId();
    return window.electronAPI.db.archives.create({
      ...data,
      userId,
    });
  },

  /**
   * Update an archive
   */
  async update(id: string, data: any): Promise<any> {
    return window.electronAPI.db.archives.update(id, data);
  },

  /**
   * Delete an archive
   */
  async delete(id: string): Promise<void> {
    await window.electronAPI.db.archives.delete(id);
  },

  /**
   * Archive a thread (move to archive)
   */
  async archiveThread(threadId: string, archiveId: string): Promise<void> {
    const userId = await getElectronUserId();
    await window.electronAPI.db.archives.archiveThread(
      threadId,
      archiveId,
      userId,
    );
  },

  /**
   * Unarchive a thread
   */
  async unarchiveThread(threadId: string, archiveId?: string): Promise<void> {
    await window.electronAPI.db.archives.unarchiveThread(threadId, archiveId);
  },

  /**
   * Get items in an archive
   */
  async getItems(archiveId: string): Promise<any[]> {
    return window.electronAPI.db.archives.getItems(archiveId);
  },

  /**
   * Get archives containing a specific item (e.g., thread)
   */
  async getItemArchives(itemId: string): Promise<any[]> {
    return window.electronAPI.db.archives.getItemArchives(itemId);
  },
};

/**
 * SWR-compatible fetcher that uses the archive API
 */
export async function archiveFetcher(url: string): Promise<any> {
  // Handle different endpoint patterns
  if (url === "/api/archive" || url === "/api/archive/") {
    return archiveApi.getAll();
  }

  const archiveMatch = url.match(/^\/api\/archive\/([^\/]+)$/);
  if (archiveMatch) {
    return archiveApi.getById(archiveMatch[1]);
  }

  // Unrecognized pattern - return empty array
  console.warn(
    `[archiveFetcher] Unrecognized URL pattern: ${url}, returning empty array`,
  );
  return [];
}

export default archiveApi;
