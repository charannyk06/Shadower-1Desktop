/**
 * Unified Export API for Desktop (Electron)
 *
 * This module provides a unified API for export operations.
 * Note: Exports functionality may be limited in desktop mode as it's primarily
 * designed for web sharing. This provides a fallback that returns empty data.
 */

import { ChatExportSummary } from "app-types/chat-export";

/**
 * Check if we're running in Electron mode
 */
export function isElectronMode(): boolean {
  return typeof window !== "undefined" && window.electronAPI !== undefined;
}

/**
 * Unified Export API
 */
export const exportApi = {
  /**
   * Get all exports for the current user
   * Note: Exports are primarily a web feature, returns empty in desktop mode
   */
  async getAll(): Promise<ChatExportSummary[]> {
    if (isElectronMode()) {
      // Exports are a web-sharing feature, not fully supported in desktop
      console.log("[exportApi] Exports feature is limited in desktop mode");
      return [];
    }
    const res = await fetch("/api/export");
    if (!res.ok) throw new Error(`Failed to get exports: ${res.status}`);
    return res.json();
  },

  /**
   * Delete an export
   */
  async delete(id: string): Promise<void> {
    if (isElectronMode()) {
      console.log("[exportApi] Delete export not supported in desktop mode");
      return;
    }
    const res = await fetch(`/api/export/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error(`Failed to delete export: ${res.status}`);
  },
};

/**
 * SWR-compatible fetcher that uses the export API
 */
export async function exportFetcher(url: string): Promise<any> {
  // Handle different endpoint patterns
  if (url === "/api/export" || url === "/api/export/") {
    return exportApi.getAll();
  }

  // Handle comments endpoint: /api/export/{id}/comments
  const commentsMatch = url.match(/^\/api\/export\/([^/]+)\/comments\/?$/);
  if (commentsMatch) {
    if (isElectronMode()) {
      // Comments are a web-sharing feature, not supported in desktop mode
      console.log(
        "[exportFetcher] Comments feature is limited in desktop mode",
      );
      return [];
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to get comments: ${res.status}`);
    return res.json();
  }

  // Fallback - log warning and try to handle gracefully
  if (isElectronMode()) {
    console.warn(
      `[exportFetcher] Unrecognized URL pattern: ${url}, returning empty array`,
    );
    return [];
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  return res.json();
}

export default exportApi;
