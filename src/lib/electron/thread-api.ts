/**
 * Unified Thread API for Desktop (Electron)
 *
 * This module provides a unified API for thread operations using Electron IPC.
 * Desktop-only - no HTTP fallbacks.
 */

import { ChatThread } from "app-types/chat";

/**
 * Get current user ID from Electron auth
 */
async function getElectronUserId(): Promise<string> {
  const user = await window.electronAPI.auth.getCurrentUser();
  return user?.id || "local-user";
}

/**
 * Unified Thread API - Desktop Only (IPC)
 */
export const threadApi = {
  /**
   * Get all threads for the current user
   */
  async getAll(): Promise<ChatThread[]> {
    const userId = await getElectronUserId();
    return window.electronAPI.db.chat.getThreads(userId);
  },

  /**
   * Get a single thread by ID
   */
  async getById(id: string): Promise<ChatThread | null> {
    return window.electronAPI.db.chat.getThread(id);
  },

  /**
   * Get a thread with its messages
   */
  async getThreadWithMessages(
    threadId: string,
  ): Promise<(ChatThread & { messages: any[] }) | null> {
    const userId = await getElectronUserId();
    return window.electronAPI.db.chat.getThreadWithMessages(threadId, userId);
  },

  /**
   * Create a new thread
   */
  async create(data: Partial<ChatThread>): Promise<ChatThread> {
    const userId = await getElectronUserId();
    return window.electronAPI.db.chat.createThread({
      ...data,
      userId,
    });
  },

  /**
   * Update a thread
   */
  async update(id: string, data: Partial<ChatThread>): Promise<void> {
    await window.electronAPI.db.chat.updateThread(id, data);
  },

  /**
   * Delete a thread
   */
  async delete(id: string): Promise<void> {
    await window.electronAPI.db.chat.deleteThread(id);
  },

  /**
   * Delete all threads for the current user
   */
  async deleteAll(): Promise<void> {
    const userId = await getElectronUserId();
    await window.electronAPI.db.chat.deleteAllThreads(userId);
  },

  /**
   * Delete all unarchived threads for the current user
   */
  async deleteUnarchived(): Promise<void> {
    const userId = await getElectronUserId();
    await window.electronAPI.db.chat.deleteUnarchivedThreads(userId);
  },

  /**
   * Upsert a message (create or update)
   */
  async upsertMessage(message: any, threadId: string): Promise<any> {
    return window.electronAPI.db.chat.upsertMessage({ message, threadId });
  },

  /**
   * Delete a single message
   */
  async deleteMessage(messageId: string): Promise<{ success: boolean }> {
    return window.electronAPI.db.chat.deleteMessage(messageId);
  },

  /**
   * Delete messages after a specific message (by timestamp)
   */
  async deleteMessagesAfterTimestamp(
    threadId: string,
    messageId: string,
  ): Promise<{ success: boolean }> {
    return window.electronAPI.db.chat.deleteMessagesAfterTimestamp({
      threadId,
      messageId,
    });
  },

  /**
   * Update message parts
   */
  async updateMessageParts(messageId: string, parts: any[]): Promise<any> {
    return window.electronAPI.db.chat.updateMessageParts({
      messageId,
      parts,
    });
  },

  /**
   * Get messages for a thread
   */
  async getMessages(threadId: string): Promise<any[]> {
    return window.electronAPI.db.chat.getMessages(threadId);
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

  // Unrecognized pattern - return empty array
  console.warn(
    `[threadFetcher] Unrecognized URL pattern: ${url}, returning empty array`,
  );
  return [];
}

export default threadApi;
