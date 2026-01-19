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

// Stub exports for repositories not yet migrated to SQLite
// These are either not used in Electron or have minimal usage

// Chat export - stub implementation
export const chatExportRepository = {
  async createExport(_data: any) {
    return null;
  },
  async getExportById(_id: string) {
    return null;
  },
  async getExportsByUserId(_userId: string) {
    return [];
  },
  async deleteExport(_id: string) {},
  async isExpired(_id: string) {
    return true; // Always expired in local-first mode
  },
  async getContent(_id: string) {
    return null;
  },
  async selectByIdWithUser(_id: string) {
    return null;
  },
  async selectCommentsByExportId(_id: string, _userId?: string) {
    return [];
  },
  async exportChat(_data: {
    threadId: string;
    exporterId: string;
    expiresAt?: Date;
  }) {
    return null;
  },
  async insertComment(_data: {
    exportId: string;
    content: unknown;
    authorId: string;
    parentId?: string;
  }) {
    return null;
  },
  async checkCommentAccess(
    _commentId: string,
    _userId: string,
  ): Promise<boolean> {
    return false;
  },
  async deleteComment(_commentId: string, _userId: string): Promise<void> {},
  async checkAccess(_id: string, _userId: string): Promise<boolean> {
    return false;
  },
  async deleteById(_id: string): Promise<void> {},
  async selectSummaryByExporterId(_userId: string): Promise<Array<any>> {
    return [];
  },
};

// Invitation - stub (not needed for local-first single-user)
// Returns null since invitations are not supported in local-first mode
type InvitationWithInviter = {
  id: string;
  email: string;
  token: string;
  role: string;
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

// MCP OAuth - stub
export const mcpOAuthRepository = {
  async createSession() {
    return null;
  },
  async getSessionByState(
    _state: string,
  ): Promise<{ mcpServerId: string } | null> {
    return null;
  },
  async deleteSession() {},
  async getAuthenticatedSession(
    _id: string,
  ): Promise<{ tokens?: unknown } | null> {
    return null;
  },
};

// MCP Server Customization - stub
export const mcpServerCustomizationRepository = {
  async getCustomization() {
    return null;
  },
  async saveCustomization() {
    return null;
  },
  async deleteCustomization() {},
  async selectByUserId(_userId: string): Promise<
    Array<{
      mcpServerId: string;
      serverName?: string;
      displayName?: string;
      description?: string;
      prompt?: string;
    }>
  > {
    return [];
  },
  async selectByUserIdAndMcpServerId(_params: {
    mcpServerId: string;
    userId: string;
  }) {
    return null;
  },
  async upsertMcpServerCustomization(_params: {
    userId: string;
    mcpServerId: string;
    prompt?: string | null;
  }) {
    return null;
  },
  async deleteMcpServerCustomizationByMcpServerIdAndUserId(_params: {
    mcpServerId: string;
    userId: string;
  }) {},
};

// MCP Tool Customization - stub
export const mcpMcpToolCustomizationRepository = {
  async getCustomization() {
    return null;
  },
  async saveCustomization() {
    return null;
  },
  async deleteCustomization() {},
  async getCustomizationsByServer() {
    return [];
  },
  async selectByUserId(_userId: string): Promise<
    Array<{
      mcpServerId: string;
      serverName?: string;
      toolName: string;
      displayName?: string;
      enabled?: boolean;
      prompt?: string;
    }>
  > {
    return [];
  },
  async select(_params: {
    mcpServerId: string;
    userId: string;
    toolName: string;
  }) {
    return null;
  },
  async selectByUserIdAndMcpServerId(_params: {
    mcpServerId: string;
    userId: string;
  }): Promise<Array<any>> {
    return [];
  },
  async upsertToolCustomization(_params: {
    userId: string;
    mcpServerId: string;
    toolName: string;
    prompt?: string | null;
    enabled?: boolean;
  }) {
    return null;
  },
  async deleteToolCustomization(_params: {
    mcpServerId: string;
    userId: string;
    toolName: string;
  }) {},
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

// Referral - stub (not needed for local)
export const referralRepository = {
  async createReferral() {
    return null;
  },
  async getReferralByCode() {
    return null;
  },
  async updateReferralStatus() {
    return null;
  },
  async hasBeenReferred(_refereeId: string): Promise<boolean> {
    return false;
  },
  async create(_data: {
    referrerId: string;
    refereeId: string;
    referralCode?: string;
    status?: string;
    expiresAt?: Date;
  }): Promise<any> {
    // Returns undefined in stub mode - no referrals
    return undefined;
  },
  async getPendingByReferee(_refereeId: string): Promise<any | null> {
    return null;
  },
  async complete(
    _referralId: string,
    _referrerBonus: number,
    _refereeBonus?: number,
  ): Promise<any | null> {
    return null;
  },
  async getStats(_userId: string): Promise<{
    totalReferrals: number;
    completedReferrals: number;
    pendingReferrals: number;
    totalBonus: number;
  }> {
    return {
      totalReferrals: 0,
      completedReferrals: 0,
      pendingReferrals: 0,
      totalBonus: 0,
    };
  },
  async getByReferrerId(_referrerId: string): Promise<any[]> {
    return [];
  },
  async getExpiredReferrals(_expirationDays: number): Promise<any[]> {
    return [];
  },
  async expire(_referralId: string): Promise<any | null> {
    return null;
  },
};

// Usage Alert - stub
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

// Webhook Event - stub
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
    // In local-first mode, always return true to indicate the event is "new"
    return true;
  },
};

// Webhook Retry - stub
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

// Thread File Context - stub (for tracking files in local execution)
export const threadFileContextRepository = {
  async getByThreadId(_threadId: string): Promise<{
    threadId: string;
    sessionId?: string;
    fileMetadata?: Array<{
      name: string;
      storageKey?: string;
      path?: string;
      localPath?: string;
      size?: number;
      type?: string;
      url?: string;
      uploadedAt?: string;
      source?: string;
    }>;
    totalFilesCount?: number;
    contextSizeBytes?: string;
    lastExecutionAt?: Date;
    contextStorageKey?: string;
  } | null> {
    return null;
  },
  async upsert(_data: {
    threadId: string;
    sessionId?: string;
    context?: unknown;
  }) {
    return null;
  },
  async delete(_threadId: string) {},
  async getOrCreate(
    _threadId: string,
    _userId: string,
  ): Promise<{
    threadId: string;
    sessionId?: string;
    fileMetadata?: Array<any>;
    totalFilesCount?: number;
    contextSizeBytes?: string;
    lastExecutionAt?: Date;
    contextStorageKey?: string;
  }> {
    return {
      threadId: _threadId,
      fileMetadata: [],
      totalFilesCount: 0,
      contextSizeBytes: "0",
    };
  },
  async addFile(_threadId: string, _fileMetadata: any): Promise<void> {},
  async updateArchive(
    _threadId: string,
    _archiveUrl: string,
    _size: number,
  ): Promise<void> {},
  async removeFile(_threadId: string, _filename: string): Promise<void> {},
  async updateFileMetadata(_threadId: string, _files: any[]): Promise<void> {},
};
export type ThreadFileContextRepository = typeof threadFileContextRepository;

// Alias for backwards compatibility with existing API routes
// TODO: Migrate usages to threadFileContextRepository
export const threadSandboxContextRepository = threadFileContextRepository;
export type ThreadSandboxContextRepository = ThreadFileContextRepository;

// Vector Index - stub (using DuckDB instead)
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
};
export type VectorIndexRepository = typeof vectorIndexRepository;

// Conversation Summary - stub
export const conversationSummaryRepository = {
  async getSummary() {
    return null;
  },
  async saveSummary() {
    return null;
  },
  async deleteSummary() {},
  async create(_data: {
    threadId: string;
    userId: string;
    summary: string;
    messagesCompacted: number;
    tokensSaved: number;
    summaryTokens: number;
    modelProvider: string;
    modelName: string;
  }): Promise<void> {},
};

// Fragment Repository - stub
export const fragmentRepository = {
  async createFragment() {
    return null;
  },
  async getFragmentById() {
    return null;
  },
  async getFragmentsByUserId() {
    return [];
  },
  async updateFragment() {
    return null;
  },
  async deleteFragment() {},
  async create(_data: {
    threadId?: string;
    userId: string;
    template: string;
    title: string;
    description?: string;
    code: string;
    filePath: string;
    port?: number;
    sessionId?: string;
    previewUrl?: string;
  }): Promise<{ id: string }> {
    return { id: `local-fragment-${Date.now()}` };
  },
  async update(
    _id: string,
    _data: {
      status?: string;
      previewUrl?: string;
      deploymentUrl?: string;
      code?: string;
      sessionId?: string;
    },
  ): Promise<void> {},
  async getById(_id: string): Promise<{
    id: string;
    user_id: string;
    thread_id?: string;
    title: string;
    description?: string;
    template?: string;
    code?: string;
    file_path?: string;
    port?: number;
    session_id?: string;
    preview_url?: string;
    deployment_url?: string;
    status?: string;
    error_message?: string;
    created_at: Date;
    updated_at: Date;
  } | null> {
    return null;
  },
  async delete(_id: string): Promise<void> {},
  async getByThread(_threadId: string): Promise<
    Array<{
      id: string;
      title: string;
      description?: string;
      template?: string;
      status?: string;
      preview_url?: string;
      deployment_url?: string;
      created_at: Date;
      updated_at: Date;
    }>
  > {
    return [];
  },
  async getByUser(
    _userId: string,
    _limit?: number,
  ): Promise<
    Array<{
      id: string;
      title: string;
      description?: string;
      template?: string;
      status?: string;
      preview_url?: string;
      deployment_url?: string;
      created_at: Date;
      updated_at: Date;
    }>
  > {
    return [];
  },
};
export type FragmentRepository = typeof fragmentRepository;

// Local Execution Usage Repository - stub (local execution is free, just for tracking)
export const localExecutionRepository = {
  async recordExecution(_data: {
    userId: string;
    threadId?: string;
    executionMs: number;
    language?: string;
  }) {
    return null;
  },
  async getExecutionsByUserId(_userId: string, _from?: Date, _to?: Date) {
    return [];
  },
};
export type LocalExecutionRepository = typeof localExecutionRepository;

// Fragment Shares - stub
export const fragmentSharesRepository = {
  async createShare() {
    return null;
  },
  async getShareById() {
    return null;
  },
  async deleteShare() {},
  async create(_data: {
    fragmentId: string;
    userId: string;
    shareId: string;
    expiresAt?: Date;
  }): Promise<void> {},
  async getByFragment(_fragmentId: string): Promise<
    Array<{
      shareId: string;
      expiresAt: Date | null;
      isActive: boolean;
      viewCount: number;
    }>
  > {
    return [];
  },
  async getByShareId(_shareId: string): Promise<{
    fragmentId: string;
    userId: string;
    shareId: string;
    isActive: boolean;
    expiresAt?: Date | null;
    viewCount: number;
  } | null> {
    return null;
  },
  async deactivate(_shareId: string): Promise<void> {},
  async incrementViewCount(_shareId: string): Promise<void> {},
};
export type FragmentSharesRepository = typeof fragmentSharesRepository;
