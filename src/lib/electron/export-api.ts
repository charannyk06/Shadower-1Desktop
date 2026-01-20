/**
 * Unified Export API for Desktop (Electron)
 *
 * This module provides a unified API for export operations.
 * In desktop mode, exports save locally to files instead of creating shareable web links.
 */

import { ChatExportSummary } from "app-types/chat-export";
import { threadApi } from "./thread-api";

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

  /**
   * Export chat to a local file (desktop mode)
   * Returns true if export was successful
   */
  async exportChatToFile(
    threadId: string,
    format: "json" | "markdown" = "json",
  ): Promise<boolean> {
    if (!isElectronMode()) {
      throw new Error("Local file export only available in desktop mode");
    }

    // Get thread with messages
    const threadWithMessages = await threadApi.getThreadWithMessages(threadId);
    if (!threadWithMessages) {
      throw new Error("Thread not found");
    }

    const { title, messages, createdAt } = threadWithMessages;

    let content: string;
    let filename: string;
    let mimeType: string;

    if (format === "markdown") {
      // Format as Markdown
      const lines: string[] = [
        `# ${title || "Chat Export"}`,
        "",
        `*Exported on ${new Date().toLocaleString()}*`,
        "",
        "---",
        "",
      ];

      for (const msg of messages) {
        const role = msg.role === "user" ? "**You**" : "**Assistant**";
        lines.push(`## ${role}`);
        lines.push("");

        // Extract text from message parts
        if (Array.isArray(msg.parts)) {
          for (const part of msg.parts) {
            if (part.type === "text" && part.text) {
              lines.push(part.text);
              lines.push("");
            }
          }
        }
        lines.push("---");
        lines.push("");
      }

      content = lines.join("\n");
      filename = `chat-export-${threadId.slice(0, 8)}.md`;
      mimeType = "text/markdown";
    } else {
      // Format as JSON
      content = JSON.stringify(
        {
          id: threadId,
          title,
          createdAt,
          exportedAt: new Date().toISOString(),
          messages: messages.map((msg) => ({
            id: msg.id,
            role: msg.role,
            createdAt: msg.createdAt,
            parts: msg.parts,
          })),
        },
        null,
        2,
      );
      filename = `chat-export-${threadId.slice(0, 8)}.json`;
      mimeType = "application/json";
    }

    // Use Electron's file dialog to save
    if (window.electronAPI?.files?.saveFile) {
      await window.electronAPI.files.saveFile(filename, content, mimeType);
      return true;
    }

    // Fallback: Create a download via blob
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    return true;
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
