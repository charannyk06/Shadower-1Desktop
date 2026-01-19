// Repository exports for local-first Electron app
// Using SQLite repositories for all database operations

export { sqliteUserRepository as userRepository } from "./sqlite/repositories/user-repository.sqlite";
export { sqliteChatRepository as chatRepository } from "./sqlite/repositories/chat-repository.sqlite";
export { sqliteAgentRepository as agentRepository } from "./sqlite/repositories/agent-repository.sqlite";
export { sqliteAgentStateRepository as agentStateRepository } from "./sqlite/repositories/agent-state-repository.sqlite";
export { sqliteMcpRepository as mcpRepository } from "./sqlite/repositories/mcp-repository.sqlite";
export { sqliteSubscriptionRepository as subscriptionRepository } from "./sqlite/repositories/subscription-repository.sqlite";
export { sqliteBookmarkRepository as bookmarkRepository } from "./sqlite/repositories/bookmark-repository.sqlite";
export { sqliteWorkflowRepository as workflowRepository } from "./sqlite/repositories/workflow-repository.sqlite";
export { sqliteArchiveRepository as archiveRepository } from "./sqlite/repositories/archive-repository.sqlite";
export { sqliteBrowserSessionRepository as browserSessionRepository } from "./sqlite/repositories/browser-session-repository.sqlite";

// Newly migrated SQLite repositories
export { sqliteChatExportRepository as chatExportRepository } from "./sqlite/repositories/chat-export-repository.sqlite";
export { sqliteConversationSummaryRepository as conversationSummaryRepository } from "./sqlite/repositories/conversation-summary-repository.sqlite";
export { sqliteFragmentRepository as fragmentRepository } from "./sqlite/repositories/fragment-repository.sqlite";
export { sqliteLocalExecutionRepository as localExecutionRepository } from "./sqlite/repositories/fragment-repository.sqlite";
export { sqliteFragmentSharesRepository as fragmentSharesRepository } from "./sqlite/repositories/fragment-repository.sqlite";
export { sqliteMcpOAuthRepository as mcpOAuthRepository } from "./sqlite/repositories/mcp-oauth-repository.sqlite";
export { sqliteMcpServerCustomizationRepository as mcpServerCustomizationRepository } from "./sqlite/repositories/mcp-server-customization-repository.sqlite";
export { sqliteMcpToolCustomizationRepository as mcpMcpToolCustomizationRepository } from "./sqlite/repositories/mcp-tool-customization-repository.sqlite";
export { sqliteThreadFileContextRepository as threadFileContextRepository } from "./sqlite/repositories/thread-file-context-repository.sqlite";
export type { ThreadFileContextRepository } from "./sqlite/repositories/thread-file-context-repository.sqlite";

// Alias for backwards compatibility with existing API routes
export { sqliteThreadFileContextRepository as threadSandboxContextRepository } from "./sqlite/repositories/thread-file-context-repository.sqlite";
export type { ThreadFileContextRepository as ThreadSandboxContextRepository } from "./sqlite/repositories/thread-file-context-repository.sqlite";

// Type exports for fragments
export type { SqliteFragmentRepository as FragmentRepository } from "./sqlite/repositories/fragment-repository.sqlite";
export type { SqliteLocalExecutionRepository as LocalExecutionRepository } from "./sqlite/repositories/fragment-repository.sqlite";
export type { SqliteFragmentSharesRepository as FragmentSharesRepository } from "./sqlite/repositories/fragment-repository.sqlite";

// Stub exports for repositories not needed in local-first single-user mode

// Invitation - stub (not needed for local-first single-user)
type InvitationWithInviter = {
  id: string;
  email: string;
  token: string;
  invitedBy: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  inviterName: string;
  inviterEmail: string;
};

export const invitationRepository = {
  async create(_data: any): Promise<InvitationWithInviter | null> {
    return null;
  },
  async getByToken(_token: string): Promise<InvitationWithInviter | null> {
    return null;
  },
  async updateStatus(
    _token: string,
    _status: string,
  ): Promise<InvitationWithInviter | null> {
    return null;
  },
  async getByEmail(_email: string): Promise<InvitationWithInviter[]> {
    return [];
  },
  async delete(_token: string): Promise<void> {},
  async markAsAccepted(_token: string): Promise<void> {},
  async getPendingInvitations(_options?: {
    limit?: number;
    offset?: number;
  }): Promise<{ invitations: any[]; total: number }> {
    return { invitations: [], total: 0 };
  },
};

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
  async cleanupOldAlerts(): Promise<number> {
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
