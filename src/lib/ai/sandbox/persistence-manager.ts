import { Sandbox } from "@e2b/code-interpreter";
import { browserSessionRepository } from "lib/db/repository";
import logger from "logger";
import type { FragmentTemplateId } from "@/types/fragment";

/**
 * Persistence Manager - Smart sandbox persistence for multi-turn conversations
 * Enables iterative development by reconnecting to existing sandboxes
 */
export class PersistenceManager {
  private enabled: boolean;

  constructor() {
    this.enabled = process.env.E2B_SANDBOX_ENABLE_PERSISTENCE === "true";
    logger.info(
      `[PERSIST] Sandbox persistence ${this.enabled ? "ENABLED" : "DISABLED"}`,
    );
  }

  /**
   * Determine if sandbox should be persistent
   * SMART: Enable for fragments only (iterative development)
   */
  shouldPersist(context: {
    threadId: string;
    template: FragmentTemplateId;
    operation: "create" | "edit";
  }): boolean {
    if (!this.enabled) return false;

    // ALWAYS persist for edits (need context)
    if (context.operation === "edit") return true;

    // Persist for fragment creation (multi-turn conversations)
    return true;
  }

  /**
   * Get existing persistent sandbox or create new one
   */
  async getOrCreatePersistent(
    threadId: string,
    template: FragmentTemplateId,
    userId: string,
  ): Promise<Sandbox> {
    if (!this.enabled) {
      // Persistence disabled - create new sandbox
      logger.debug(
        `[PERSIST] Creating ephemeral sandbox (persistence disabled)`,
      );
      return await this.createSandbox(template);
    }

    // Try to reconnect to existing sandbox
    const session = await browserSessionRepository.getSessionForThread(
      threadId,
      "e2b",
    );

    if (session?.sessionId) {
      try {
        const sandbox = await Sandbox.connect(session.sessionId);
        logger.info(
          `[PERSIST] ✅ Reconnected to sandbox ${session.sessionId} for thread ${threadId}`,
        );

        // Update last accessed
        await browserSessionRepository.updateSession(session.sessionId, {
          lastAccessedAt: new Date(),
        });

        return sandbox;
      } catch (error) {
        logger.warn(
          `[PERSIST] Failed to reconnect to sandbox ${session.sessionId}, creating new:`,
          error,
        );
        // Cleanup dead session
        await browserSessionRepository.deleteSession(session.sessionId);
      }
    }

    // Create new persistent sandbox
    const sandbox = await this.createSandbox(template);

    // Store in database for future reconnection
    await browserSessionRepository.createSession({
      threadId,
      userId,
      provider: "e2b",
      sessionId: sandbox.sandboxId,
      persistenceEnabled: true,
    });

    logger.info(
      `[PERSIST] ✅ Created persistent sandbox ${sandbox.sandboxId} for thread ${threadId}`,
    );

    return sandbox;
  }

  /**
   * Reconnect to existing sandbox by ID
   */
  async reconnect(sandboxId: string): Promise<Sandbox | null> {
    try {
      const sandbox = await Sandbox.connect(sandboxId);
      logger.info(`[PERSIST] Reconnected to sandbox ${sandboxId}`);
      return sandbox;
    } catch (error) {
      logger.warn(
        `[PERSIST] Failed to reconnect to sandbox ${sandboxId}:`,
        error,
      );
      return null;
    }
  }

  /**
   * Create a new sandbox
   */
  private async createSandbox(template: FragmentTemplateId): Promise<Sandbox> {
    const customTemplateId = process.env.E2B_TEMPLATE_ID;
    const apiKey = process.env.E2B_API_KEY;

    if (!apiKey) {
      throw new Error("E2B_API_KEY not configured");
    }

    // Use custom template if available for code-interpreter
    const templateToUse =
      template === "code-interpreter-v1" && customTemplateId
        ? customTemplateId
        : template;

    const sandbox = await Sandbox.create(templateToUse, {
      apiKey,
      timeoutMs: this.enabled ? 600000 : 300000, // 10 min for persistent, 5 min for ephemeral
    });

    logger.debug(
      `[PERSIST] Created sandbox ${sandbox.sandboxId} with template ${templateToUse}`,
    );

    return sandbox;
  }

  /**
   * Cleanup expired persistent sandboxes
   * Call this from a cron job
   */
  async cleanupExpired(maxAgeDays: number = 7): Promise<number> {
    logger.info(
      `[PERSIST] Cleaning up sandboxes older than ${maxAgeDays} days`,
    );

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);

    const expiredSessions =
      await browserSessionRepository.getExpiredSessions(cutoffDate);

    let cleanedCount = 0;

    for (const session of expiredSessions) {
      try {
        const sandbox = await Sandbox.connect(session.sessionId);
        await sandbox.kill();
        await browserSessionRepository.deleteSession(session.sessionId);
        cleanedCount++;
        logger.debug(`[PERSIST] Cleaned up sandbox ${session.sessionId}`);
      } catch (_error) {
        // Sandbox already dead, just remove from DB
        await browserSessionRepository.deleteSession(session.sessionId);
        cleanedCount++;
      }
    }

    logger.info(`[PERSIST] ✅ Cleaned up ${cleanedCount} expired sandboxes`);

    return cleanedCount;
  }

  /**
   * Manually kill a persistent sandbox
   */
  async kill(sandboxId: string): Promise<void> {
    try {
      const sandbox = await Sandbox.connect(sandboxId);
      await sandbox.kill();
      await browserSessionRepository.deleteSession(sandboxId);
      logger.info(`[PERSIST] Killed sandbox ${sandboxId}`);
    } catch (error) {
      logger.warn(`[PERSIST] Failed to kill sandbox ${sandboxId}:`, error);
      // Try to cleanup from DB anyway
      await browserSessionRepository.deleteSession(sandboxId);
    }
  }
}

// Singleton instance
export const persistenceManager = new PersistenceManager();
