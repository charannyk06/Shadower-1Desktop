/**
 * Unified Export API for Desktop (Electron)
 *
 * This module provides a unified API for export operations.
 * In desktop mode, exports save locally to files instead of creating shareable web links.
 * Desktop-only - no HTTP fallbacks.
 */

import { ChatExportSummary } from "app-types/chat-export";
import { threadApi } from "./thread-api";

/**
 * Unified Export API - Desktop Only
 */
export const exportApi = {
  /**
   * Get all exports for the current user
   * Note: Exports are primarily a web feature, returns empty in desktop mode
   */
  async getAll(): Promise<ChatExportSummary[]> {
    // Exports are a web-sharing feature, not fully supported in desktop
    console.log("[exportApi] Exports feature is limited in desktop mode");
    return [];
  },

  /**
   * Delete an export
   */
  async delete(id: string): Promise<void> {
    console.log("[exportApi] Delete export not supported in desktop mode");
  },

  /**
   * Export chat to a local file (desktop mode)
   * Returns true if export was successful
   */
  async exportChatToFile(
    threadId: string,
    format: "json" | "markdown" = "json",
  ): Promise<boolean> {
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

    // Use Electron's file dialog to save if available
    if (window.electronAPI?.files?.saveFile) {
      await (window.electronAPI.files as any).saveFile(filename, content, mimeType);
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
    // Comments are a web-sharing feature, not supported in desktop mode
    console.log(
      "[exportFetcher] Comments feature is limited in desktop mode",
    );
    return [];
  }

  // Unrecognized pattern - return empty array
  console.warn(
    `[exportFetcher] Unrecognized URL pattern: ${url}, returning empty array`,
  );
  return [];
}

export default exportApi;
