// Repository exports for local-first Electron app
// Using SQLite repositories for all database operations
// All DB access goes through Electron IPC - no HTTP proxy needed

import { ChatMessage, ChatRepository, ChatThread } from "app-types/chat";
import { isSqliteAvailable } from "./sqlite/db.sqlite";

export { sqliteUserRepository as userRepository } from "./sqlite/repositories/user-repository.sqlite";

// In-memory storage for dev mode fallback when SQLite is unavailable
const inMemoryThreads = new Map<
  string,
  ChatThread & { messages?: ChatMessage[] }
>();
const inMemoryMessages = new Map<string, ChatMessage>();

/**
 * Dev mode fallback repository that stores data in memory
 * Messages won't persist across restarts but chat will work
 */
const devModeChatRepository: ChatRepository = {
  async insertThread(
    thread: Omit<ChatThread, "createdAt">,
  ): Promise<ChatThread> {
    const newThread: ChatThread = {
      ...thread,
      createdAt: new Date(),
    };
    inMemoryThreads.set(thread.id, newThread);
    console.log("[DevMode] Created thread in memory:", thread.id);
    return newThread;
  },

  async deleteChatMessage(id: string): Promise<void> {
    inMemoryMessages.delete(id);
  },

  async selectThread(id: string): Promise<ChatThread | null> {
    return inMemoryThreads.get(id) || null;
  },

  async selectThreadDetails(id: string) {
    const thread = inMemoryThreads.get(id);
    if (!thread) return null;
    const messages = Array.from(inMemoryMessages.values())
      .filter((m) => m.threadId === id)
      .sort(
        (a, b) => (a.createdAt?.getTime() || 0) - (b.createdAt?.getTime() || 0),
      );
    return {
      ...thread,
      messages,
      userPreferences: undefined,
    };
  },

  async selectMessagesByThreadId(threadId: string): Promise<ChatMessage[]> {
    return Array.from(inMemoryMessages.values())
      .filter((m) => m.threadId === threadId)
      .sort(
        (a, b) => (a.createdAt?.getTime() || 0) - (b.createdAt?.getTime() || 0),
      );
  },

  async selectThreadsByUserId(
    userId: string,
  ): Promise<(ChatThread & { lastMessageAt: number })[]> {
    return Array.from(inMemoryThreads.values())
      .filter((t) => t.userId === userId)
      .map((t) => ({ ...t, lastMessageAt: Date.now() }));
  },

  async updateThread(
    id: string,
    thread: Partial<Omit<ChatThread, "id" | "createdAt">>,
  ): Promise<ChatThread> {
    const existing = inMemoryThreads.get(id);
    if (!existing) throw new Error("Thread not found");
    const updated = { ...existing, ...thread };
    inMemoryThreads.set(id, updated);
    return updated;
  },

  async upsertThread(
    thread: Omit<ChatThread, "createdAt">,
  ): Promise<ChatThread> {
    const existing = inMemoryThreads.get(thread.id);
    if (existing) {
      return this.updateThread(thread.id, thread);
    }
    return this.insertThread(thread);
  },

  async deleteThread(id: string): Promise<void> {
    inMemoryThreads.delete(id);
    // Delete associated messages
    for (const [msgId, msg] of inMemoryMessages) {
      if (msg.threadId === id) {
        inMemoryMessages.delete(msgId);
      }
    }
  },

  async insertMessage(
    message: Omit<ChatMessage, "createdAt">,
  ): Promise<ChatMessage> {
    const newMessage: ChatMessage = {
      ...message,
      createdAt: new Date(),
    } as ChatMessage;
    inMemoryMessages.set(message.id, newMessage);
    return newMessage;
  },

  async upsertMessage(
    message: Omit<ChatMessage, "createdAt">,
  ): Promise<ChatMessage> {
    const newMessage: ChatMessage = {
      ...message,
      createdAt: inMemoryMessages.get(message.id)?.createdAt || new Date(),
    } as ChatMessage;
    inMemoryMessages.set(message.id, newMessage);
    return newMessage;
  },

  async deleteMessagesByChatIdAfterTimestamp(messageId: string): Promise<void> {
    const message = inMemoryMessages.get(messageId);
    if (!message || !message.createdAt) return;
    for (const [id, msg] of inMemoryMessages) {
      if (
        msg.threadId === message.threadId &&
        msg.createdAt &&
        msg.createdAt >= message.createdAt
      ) {
        inMemoryMessages.delete(id);
      }
    }
  },

  async deleteAllThreads(userId: string): Promise<void> {
    for (const [id, thread] of inMemoryThreads) {
      if (thread.userId === userId) {
        await this.deleteThread(id);
      }
    }
  },

  async deleteUnarchivedThreads(userId: string): Promise<void> {
    // In dev mode, delete all threads (no archive support)
    await this.deleteAllThreads(userId);
  },

  async insertMessages(
    messages: Omit<ChatMessage, "createdAt">[],
  ): Promise<ChatMessage[]> {
    return Promise.all(messages.map((m) => this.insertMessage(m)));
  },

  async checkAccess(id: string, userId: string): Promise<boolean> {
    const thread = inMemoryThreads.get(id);
    // In dev mode, allow all access or check userId
    return thread?.userId === userId || true;
  },
};

// Lazy-loaded chat repository
let _chatRepository: ChatRepository | null = null;

function getChatRepository(): ChatRepository {
  if (_chatRepository) return _chatRepository;

  // Check if SQLite is available directly
  if (isSqliteAvailable()) {
    // SQLite is available, use the real repository
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const {
        sqliteChatRepository,
      } = require("./sqlite/repositories/chat-repository.sqlite");
      _chatRepository = sqliteChatRepository as ChatRepository;
      console.log("[Repository] Using SQLite chat repository directly");
      return _chatRepository!;
    } catch (error: any) {
      console.warn(
        "[Repository] Failed to load SQLite chat repository:",
        error.message,
      );
    }
  }

  // SQLite not available - use in-memory fallback
  // In Electron, all DB operations should go through IPC to the main process
  // The renderer should use IPC calls, not direct SQLite access
  console.warn(
    "[Repository] SQLite unavailable in renderer, using in-memory fallback",
  );
  console.warn(
    "[Repository] Note: DB operations should use IPC calls to main process",
  );
  _chatRepository = devModeChatRepository;
  return _chatRepository!;
}

// Export a proxy that lazily loads the real repository
export const chatRepository: ChatRepository = new Proxy({} as ChatRepository, {
  get(_target, prop) {
    const repo = getChatRepository();
    return (repo as any)[prop];
  },
});

export { sqliteAgentRepository as agentRepository } from "./sqlite/repositories/agent-repository.sqlite";
export { sqliteAgentStateRepository as agentStateRepository } from "./sqlite/repositories/agent-state-repository.sqlite";
export { sqliteMcpRepository as mcpRepository } from "./sqlite/repositories/mcp-repository.sqlite";
export { sqliteWorkflowRepository as workflowRepository } from "./sqlite/repositories/workflow-repository.sqlite";
export { sqliteArchiveRepository as archiveRepository } from "./sqlite/repositories/archive-repository.sqlite";
export { sqliteBrowserSessionRepository as browserSessionRepository } from "./sqlite/repositories/browser-session-repository.sqlite";

// Newly migrated SQLite repositories
export { sqliteChatExportRepository as chatExportRepository } from "./sqlite/repositories/chat-export-repository.sqlite";
export { sqliteConversationSummaryRepository as conversationSummaryRepository } from "./sqlite/repositories/conversation-summary-repository.sqlite";
export { sqliteMcpOAuthRepository as mcpOAuthRepository } from "./sqlite/repositories/mcp-oauth-repository.sqlite";
export { sqliteMcpServerCustomizationRepository as mcpServerCustomizationRepository } from "./sqlite/repositories/mcp-server-customization-repository.sqlite";
export { sqliteMcpToolCustomizationRepository as mcpMcpToolCustomizationRepository } from "./sqlite/repositories/mcp-tool-customization-repository.sqlite";
export { sqliteThreadFileContextRepository as threadFileContextRepository } from "./sqlite/repositories/thread-file-context-repository.sqlite";
export type { ThreadFileContextRepository } from "./sqlite/repositories/thread-file-context-repository.sqlite";

// Alias for backwards compatibility (deprecated - use threadFileContextRepository)
export { sqliteThreadFileContextRepository as threadWorkspaceContextRepository } from "./sqlite/repositories/thread-file-context-repository.sqlite";
export type { ThreadFileContextRepository as ThreadWorkspaceContextRepository } from "./sqlite/repositories/thread-file-context-repository.sqlite";

// Stub exports for repositories not needed in local-first single-user mode

// Promo Code - stub (not needed for local)
export const promoCodeRepository = {
  async getByCode(_code: string) {
    return null;
  },
  async createCode(_data: any) {
    return null;
  },
  async redeemCode(_code: string, _userId: string) {
    return null;
  },
  async getAll() {
    return [];
  },
  async update(_id: string, _data: any) {
    return null;
  },
  async delete(_id: string) {},
  async validateCode(
    _code: string,
    _userId: string,
    _purchaseType: string,
    _amount?: number,
    _tier?: string,
    _tokenPackAmount?: string,
  ): Promise<{
    valid: boolean;
    error?: string;
    promoCode?: any;
    discount?: { discountAmount: number; couponId?: string };
  }> {
    return { valid: false, error: "Promo codes not available in local mode" };
  },
  async atomicReserveRedemption(
    _promoCodeId: string,
    _userId: string,
    _maxRedemptions: number | null,
    _maxPerUser: number,
  ): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: "Promo codes not available in local mode" };
  },
  async updateStripeCouponId(
    _promoCodeId: string,
    _stripeCouponId: string,
  ): Promise<void> {},
  async releaseReservation(
    _promoCodeId: string,
    _userId?: string,
  ): Promise<boolean> {
    return true;
  },
  async finalizeRedemption(
    _promoCodeId: string,
    _userId: string,
  ): Promise<void> {},
  async recordRedemption(_data: {
    promoCodeId: string;
    userId: string;
    purchaseType: string;
    originalAmount?: number;
    discountAmount: number;
    finalAmount?: number;
    subscriptionId?: string;
    tokenPackId?: string;
    stripeCheckoutSessionId?: string;
  }): Promise<void> {},
};

// Usage Alert - stub (not needed for local)
export const usageAlertRepository = {
  async createAlert() {
    return null;
  },
  async getAlertsByUserId() {
    return [];
  },
  async updateAlert() {
    return null;
  },
  async cleanupOldAlerts(_retentionDays: number): Promise<number> {
    return 0;
  },
  async existsForPeriod(
    _userId: string,
    _alertType: string,
    _limitType: string,
    _periodStart: Date,
  ): Promise<boolean> {
    return false;
  },
  async createIfNotExists(_data: {
    userId: string;
    alertType: string;
    limitType: string;
    threshold: number;
    currentUsage: number;
    usageLimit: number;
    periodStart: Date;
    periodEnd: Date;
  }): Promise<{ id: string } | null> {
    return null;
  },
  async getUnacknowledgedByUser(_userId: string): Promise<any[]> {
    return [];
  },
  async getActiveCount(_userId: string): Promise<number> {
    return 0;
  },
  async acknowledge(_alertId: string, _userId: string): Promise<boolean> {
    return false;
  },
  async acknowledgeAll(_userId: string): Promise<number> {
    return 0;
  },
  async getUnemailedAlerts(_limit: number): Promise<any[]> {
    return [];
  },
  async markEmailSent(_alertId: string): Promise<void> {},
};

// Webhook Event - stub (not needed for local)
export const webhookEventRepository = {
  async createEvent() {
    return null;
  },
  async getUnprocessedEvents() {
    return [];
  },
  async markAsProcessed() {},
  async cleanupOldEvents(_retentionDays: number): Promise<number> {
    return 0;
  },
  async markEventProcessed(
    _eventId: string,
    _eventType: string,
    _metadata?: Record<string, unknown>,
  ): Promise<boolean> {
    return true;
  },
};

// Webhook Retry - stub (not needed for local)
export const webhookRetryRepository = {
  async createRetry() {
    return null;
  },
  async getPendingRetries() {
    return [];
  },
  async updateRetry() {
    return null;
  },
  async addToQueue(_data: {
    eventId: string;
    eventType: string;
    payload: Record<string, unknown>;
    maxRetries?: number;
    error?: string;
  }): Promise<void> {},
  async getStats(): Promise<{ pending: number; deadLetter: number }> {
    return { pending: 0, deadLetter: 0 };
  },
  async getPendingForRetry(_limit: number): Promise<
    Array<{
      id: string;
      eventId: string;
      eventType: string;
      payload: Record<string, unknown>;
    }>
  > {
    return [];
  },
  async markAsProcessing(_id: string): Promise<boolean> {
    return false;
  },
  async markAsSucceeded(_id: string): Promise<void> {},
  async recordFailedRetry(_id: string, _error: string): Promise<boolean> {
    return false;
  },
};

// Vector Index - stub (using local Qdrant instead for vector operations)
export const vectorIndexRepository = {
  async createIndex() {
    return null;
  },
  async getIndex() {
    return null;
  },
  async deleteIndex() {},
  async search() {
    return [];
  },
  // Additional methods needed by vector-search-service
  async create(_data: {
    id?: string;
    qdrantPointId: string;
    collectionName?: string;
    entityType: string;
    entityId: string;
    userId: string;
    metadata?: Record<string, unknown>;
    createdAt?: Date;
  }) {
    return { id: "stub-id" };
  },
  async deleteByEntity(_entityType: string, _entityId: string) {
    return;
  },
  async deleteByQdrantPointId(_qdrantPointId: string) {
    return;
  },
  async deleteByUserId(_userId: string) {
    return;
  },
  async getByEntity(_entityType: string, _entityId: string) {
    return [];
  },
};
export type VectorIndexRepository = typeof vectorIndexRepository;
