/**
 * Local Sandbox Cost Tracker
 *
 * For the local-first desktop app, sandbox execution is free (runs locally).
 * This module provides a compatible API with the cloud E2B cost tracker
 * but doesn't actually track or enforce costs.
 */

import logger from "logger";

/**
 * Error thrown when quota is exceeded
 * (Not applicable for local execution, but kept for API compatibility)
 */
export class QuotaExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuotaExceededError";
  }
}

/**
 * Session tracking data (for local analytics only)
 */
interface SessionData {
  userId: string;
  sessionId: string;
  template?: string;
  durationMs: number;
  operationType: "create" | "edit" | "execute";
}

/**
 * Local sandbox cost tracker
 * Provides API compatibility but doesn't enforce quotas for local execution
 */
class LocalSandboxCostTracker {
  private sessionLog: SessionData[] = [];

  /**
   * Enforce quota (always passes for local execution)
   */
  async enforceQuota(_userId: string): Promise<void> {
    // Local execution is free - no quota enforcement
    logger.debug(
      "[LocalSandboxCostTracker] Local execution - no quota check needed",
    );
  }

  /**
   * Track a session for analytics (local only, no cloud reporting)
   */
  async trackSession(data: SessionData): Promise<void> {
    this.sessionLog.push({
      ...data,
      // @ts-ignore
      timestamp: Date.now(),
    });

    logger.debug(
      `[LocalSandboxCostTracker] Tracked session: ${data.sessionId} (${data.operationType}) - ${data.durationMs}ms`,
    );

    // Keep only last 100 sessions in memory
    if (this.sessionLog.length > 100) {
      this.sessionLog = this.sessionLog.slice(-100);
    }
  }

  /**
   * Get session statistics (for local analytics)
   */
  getStats(): {
    totalSessions: number;
    totalDurationMs: number;
    averageDurationMs: number;
    byTemplate: Record<string, number>;
    byOperation: Record<string, number>;
  } {
    const totalSessions = this.sessionLog.length;
    const totalDurationMs = this.sessionLog.reduce(
      (sum, s) => sum + s.durationMs,
      0,
    );
    const averageDurationMs =
      totalSessions > 0 ? totalDurationMs / totalSessions : 0;

    const byTemplate: Record<string, number> = {};
    const byOperation: Record<string, number> = {};

    for (const session of this.sessionLog) {
      const template = session.template || "unknown";
      byTemplate[template] = (byTemplate[template] || 0) + 1;
      byOperation[session.operationType] =
        (byOperation[session.operationType] || 0) + 1;
    }

    return {
      totalSessions,
      totalDurationMs,
      averageDurationMs,
      byTemplate,
      byOperation,
    };
  }

  /**
   * Clear session log
   */
  clearLog(): void {
    this.sessionLog = [];
  }
}

// Export singleton instance
export const sandboxCostTracker = new LocalSandboxCostTracker();

// Alias for backwards compatibility with code expecting e2bCostTracker
export const e2bCostTracker = sandboxCostTracker;
