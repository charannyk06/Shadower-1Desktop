/**
 * Local Sandbox Cost Tracker
 *
 * This is a no-op tracker since local execution runs on the user's machine
 * and doesn't incur any cloud costs. Kept for backwards compatibility.
 */

export interface SessionTrackingParams {
  userId: string;
  sessionId: string;
  template: string;
  durationMs: number;
  operationType: "execute" | "deploy";
}

/**
 * Local sandbox cost tracker - all operations are free
 * since they run on the user's machine
 */
export const localSandboxCostTracker = {
  /**
   * Track a session (no-op - local execution is free)
   */
  async trackSession(_params: SessionTrackingParams): Promise<void> {
    // Local execution runs on user's machine - no cost to track
  },

  /**
   * Get usage for a user (always returns 0 - local execution is free)
   */
  async getUserUsage(
    _userId: string,
  ): Promise<{ executionCount: number; totalDurationMs: number }> {
    return { executionCount: 0, totalDurationMs: 0 };
  },
};

// Legacy alias for backwards compatibility
export const sandboxCostTracker = localSandboxCostTracker;
