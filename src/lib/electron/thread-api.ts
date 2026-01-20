/**
 * Unified Thread API for Desktop (Electron)
 *
 * This module provides a unified API for thread operations that automatically
 * uses Electron IPC for all database operations.
 */

import { ChatThread } from "app-types/chat";

/**
 * Check if we're running in Electron mode
 */
export function isElectronMode(): boolean {
  return (
    typeof window !== "undefined" &&
    window.electronAPI !== undefined &&
    window.electronAPI.db?.chat !== undefined
  );
}

/**
 * Get current user ID from Electron auth
 */
async function getElectronUserId(): Promise<string> {
  if (!isElectronMode()) {
    throw new Error("Not in Electron mode");
  }
  const user = await window.electronAPI.auth.getCurrentUser();
  return user?.id || "local-user";
}

/**
 * Unified Thread API
 */
export const threadApi = {
  /**
   * Get all threads for the current user
   */
  async getAll(): Promise<ChatThread[]> {
    if (isElectronMode()) {
      const userId = await getElectronUserId();
      return window.electronAPI.db.chat.getThreads(userId);
    }
    // Web fallback (shouldn't be used in desktop app)
    const res = await fetch("/api/thread");
    if (!res.ok) throw new Error(`Failed to get threads: ${res.status}`);
    return res.json();
  },

  /**
   * Get a single thread by ID
   */
  async getById(id: string): Promise<ChatThread | null> {
    if (isElectronMode()) {
      return window.electronAPI.db.chat.getThread(id);
    }
    const res = await fetch(`/api/thread/${id}`);
    if (!res.ok) throw new Error(`Failed to get thread: ${res.status}`);
    return res.json();
  },

  /**
   * Get a thread with its messages
   */
  async getThreadWithMessages(
    threadId: string,
  ): Promise<(ChatThread & { messages: any[] }) | null> {
    if (isElectronMode()) {
      const userId = await getElectronUserId();
      return window.electronAPI.db.chat.getThreadWithMessages(threadId, userId);
    }
    // Web fallback
    const res = await fetch(`/api/thread/${threadId}`);
    if (!res.ok) return null;
    const thread = await res.json();
    return thread;
  },

  /**
   * Create a new thread
   */
  async create(data: Partial<ChatThread>): Promise<ChatThread> {
    if (isElectronMode()) {
      const userId = await getElectronUserId();
      return window.electronAPI.db.chat.createThread({
        ...data,
        userId,
      });
    }
    const res = await fetch("/api/thread", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Failed to create thread: ${res.status}`);
    return res.json();
  },

  /**
   * Update a thread
   */
  async update(id: string, data: Partial<ChatThread>): Promise<void> {
    if (isElectronMode()) {
      await window.electronAPI.db.chat.updateThread(id, data);
      return;
    }
    const res = await fetch(`/api/thread/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Failed to update thread: ${res.status}`);
  },

  /**
   * Delete a thread
   */
  async delete(id: string): Promise<void> {
    if (isElectronMode()) {
      await window.electronAPI.db.chat.deleteThread(id);
      return;
    }
    const res = await fetch(`/api/thread/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error(`Failed to delete thread: ${res.status}`);
  },

  /**
   * Delete all threads for the current user
   */
  async deleteAll(): Promise<void> {
    if (isElectronMode()) {
      const userId = await getElectronUserId();
      await window.electronAPI.db.chat.deleteAllThreads(userId);
      return;
    }
    const res = await fetch("/api/thread", {
      method: "DELETE",
    });
    if (!res.ok) throw new Error(`Failed to delete all threads: ${res.status}`);
  },

  /**
   * Delete all unarchived threads for the current user
   */
  async deleteUnarchived(): Promise<void> {
    if (isElectronMode()) {
      const userId = await getElectronUserId();
      await window.electronAPI.db.chat.deleteUnarchivedThreads(userId);
      return;
    }
    const res = await fetch("/api/thread/unarchived", {
      method: "DELETE",
    });
    if (!res.ok)
      throw new Error(`Failed to delete unarchived threads: ${res.status}`);
  },

  /**
   * Upsert a message (create or update)
   */
  async upsertMessage(message: any, threadId: string): Promise<any> {
    if (isElectronMode()) {
      return window.electronAPI.db.chat.upsertMessage({ message, threadId });
    }
    throw new Error("Not in Electron mode");
  },

  /**
   * Delete a single message
   */
  async deleteMessage(messageId: string): Promise<{ success: boolean }> {
    if (isElectronMode()) {
      return window.electronAPI.db.chat.deleteMessage(messageId);
    }
    throw new Error("Not in Electron mode");
  },

  /**
   * Delete messages after a specific message (by timestamp)
   */
  async deleteMessagesAfterTimestamp(
    threadId: string,
    messageId: string,
  ): Promise<{ success: boolean }> {
    if (isElectronMode()) {
      return window.electronAPI.db.chat.deleteMessagesAfterTimestamp({
        threadId,
        messageId,
      });
    }
    throw new Error("Not in Electron mode");
  },

  /**
   * Update message parts
   */
  async updateMessageParts(messageId: string, parts: any[]): Promise<any> {
    if (isElectronMode()) {
      return window.electronAPI.db.chat.updateMessageParts({
        messageId,
        parts,
      });
    }
    throw new Error("Not in Electron mode");
  },

  /**
   * Get messages for a thread
   */
  async getMessages(threadId: string): Promise<any[]> {
    if (isElectronMode()) {
      return window.electronAPI.db.chat.getMessages(threadId);
    }
    throw new Error("Not in Electron mode");
  },
};

/**
 * SWR-compatible fetcher that uses the thread API
 */
export async function threadFetcher(url: string): Promise<any> {
  // Handle different endpoint patterns
  if (url === "/api/thread" || url === "/api/thread/") {
    return threadApi.getAll();
  }

  const threadMatch = url.match(/^\/api\/thread\/([^\/]+)$/);
  if (threadMatch) {
    return threadApi.getById(threadMatch[1]);
  }

  // Fallback - log warning and try to handle gracefully
  if (isElectronMode()) {
    console.warn(
      `[threadFetcher] Unrecognized URL pattern: ${url}, returning empty array`,
    );
    return [];
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  return res.json();
}

export default threadApi;
