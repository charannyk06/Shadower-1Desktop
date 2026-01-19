/**
 * Unified Archive API for Desktop (Electron)
 *
 * This module provides a unified API for archive operations that automatically
 * uses Electron IPC for all database operations.
 */

/**
 * Check if we're running in Electron mode with archive support
 */
export function isElectronMode(): boolean {
  return (
    typeof window !== "undefined" &&
    window.electronAPI !== undefined &&
    window.electronAPI.db !== undefined &&
    window.electronAPI.db.archives !== undefined
  );
}

/**
 * Get current user ID from Electron auth
 */
async function getElectronUserId(): Promise<string> {
  if (
    typeof window === "undefined" ||
    !window.electronAPI ||
    !window.electronAPI.auth
  ) {
    throw new Error("Not in Electron mode");
  }
  const user = await window.electronAPI.auth.getCurrentUser();
  return user?.id || "local-user";
}

/**
 * Unified Archive API
 */
export const archiveApi = {
  /**
   * Get all archives for the current user
   */
  async getAll(): Promise<any[]> {
    if (isElectronMode()) {
      const userId = await getElectronUserId();
      return window.electronAPI.db.archives.getAll(userId);
    }
    const res = await fetch("/api/archive");
    if (!res.ok) throw new Error(`Failed to get archives: ${res.status}`);
    return res.json();
  },

  /**
   * Get a single archive by ID
   */
  async getById(id: string): Promise<any | null> {
    if (isElectronMode()) {
      return window.electronAPI.db.archives.getById(id);
    }
    const res = await fetch(`/api/archive/${id}`);
    if (!res.ok) throw new Error(`Failed to get archive: ${res.status}`);
    return res.json();
  },

  /**
   * Create a new archive
   */
  async create(data: any): Promise<any> {
    if (isElectronMode()) {
      const userId = await getElectronUserId();
      return window.electronAPI.db.archives.create({
        ...data,
        userId,
      });
    }
    const res = await fetch("/api/archive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Failed to create archive: ${res.status}`);
    return res.json();
  },

  /**
   * Update an archive
   */
  async update(id: string, data: any): Promise<any> {
    if (isElectronMode()) {
      return window.electronAPI.db.archives.update(id, data);
    }
    const res = await fetch(`/api/archive/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Failed to update archive: ${res.status}`);
    return res.json();
  },

  /**
   * Delete an archive
   */
  async delete(id: string): Promise<void> {
    if (isElectronMode()) {
      await window.electronAPI.db.archives.delete(id);
      return;
    }
    const res = await fetch(`/api/archive/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error(`Failed to delete archive: ${res.status}`);
  },

  /**
   * Archive a thread (move to archive)
   */
  async archiveThread(threadId: string, archiveId: string): Promise<void> {
    if (isElectronMode()) {
      await window.electronAPI.db.archives.archiveThread(threadId, archiveId);
      return;
    }
    const res = await fetch(`/api/archive/${archiveId}/threads/${threadId}`, {
      method: "POST",
    });
    if (!res.ok) throw new Error(`Failed to archive thread: ${res.status}`);
  },

  /**
   * Unarchive a thread
   */
  async unarchiveThread(threadId: string): Promise<void> {
    if (isElectronMode()) {
      await window.electronAPI.db.archives.unarchiveThread(threadId);
      return;
    }
    const res = await fetch(`/api/thread/${threadId}/unarchive`, {
      method: "POST",
    });
    if (!res.ok) throw new Error(`Failed to unarchive thread: ${res.status}`);
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

  // Fallback - log warning and try to handle gracefully
  if (isElectronMode()) {
    console.warn(
      `[archiveFetcher] Unrecognized URL pattern: ${url}, returning empty array`,
    );
    return [];
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  return res.json();
}

export default archiveApi;
