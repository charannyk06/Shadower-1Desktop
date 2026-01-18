import { Sandbox } from "@e2b/code-interpreter";
import logger from "logger";
import type { FragmentTemplateId } from "@/types/fragment";

/**
 * Sandbox Pool - Connection pooling for blazing fast performance
 * Maintains warm sandboxes ready for instant use
 */
export class SandboxPool {
  private pools = new Map<string, Sandbox[]>();
  private creating = new Map<string, Promise<Sandbox>>();
  private readonly enabled: boolean;
  private readonly minSize: number;
  private readonly maxSize: number;
  // Rate limiting: Track last sandbox creation time to avoid hitting E2B rate limits
  private lastCreationTime = 0;
  private readonly minCreationInterval = 1000; // 1 second between creations (safe for Hobby tier)

  constructor() {
    this.enabled = process.env.E2B_POOL_ENABLED === "true";
    this.minSize = parseInt(process.env.E2B_POOL_MIN_SIZE || "2", 10);
    this.maxSize = parseInt(process.env.E2B_POOL_MAX_SIZE || "10", 10);

    // DISABLED: Warmup creates multiple sandboxes concurrently which hits E2B API rate limits
    // Even if pooling is enabled, don't warmup to avoid hitting limits
    if (this.enabled) {
      logger.info(
        "[POOL] Sandbox pooling ENABLED (warmup disabled to avoid API limits)",
      );
      // Warmup disabled - creates sandboxes on-demand instead
      // this.warmupInBackground('code-interpreter-v1', this.minSize);
      // this.warmupInBackground('nextjs-developer', Math.max(1, Math.floor(this.minSize / 2)));
    } else {
      logger.info("[POOL] Sandbox pooling DISABLED");
    }
  }

  /**
   * Acquire a sandbox from the pool (or create new)
   * FAST AS FUCK - returns instantly if available
   */
  async acquire(templateId: FragmentTemplateId): Promise<Sandbox> {
    // TEMPORARY: Always bypass pool to avoid API limit issues
    // The pool might be hitting cached errors or different API endpoints
    // Direct creation works (test endpoint proves this), so bypass pool entirely
    logger.debug(
      `[POOL] Bypassing pool, creating fresh sandbox for ${templateId}`,
    );
    return await this.createSandbox(templateId);
  }

  /**
   * Release sandbox back to pool (or kill if pool full)
   */
  async release(
    sandbox: Sandbox,
    templateId: FragmentTemplateId,
  ): Promise<void> {
    if (!this.enabled) {
      // Pooling disabled - kill sandbox
      try {
        await sandbox.kill();
        logger.debug(
          `[POOL] Killed sandbox ${sandbox.sandboxId} (pooling disabled)`,
        );
      } catch (error) {
        logger.warn(
          `[POOL] Failed to kill sandbox ${sandbox.sandboxId}:`,
          error,
        );
      }
      return;
    }

    const pool = this.pools.get(templateId) || [];

    if (pool.length < this.maxSize) {
      // Add back to pool
      pool.push(sandbox);
      this.pools.set(templateId, pool);
      logger.info(
        `[POOL] Released sandbox for ${templateId} (pool size: ${pool.length}/${this.maxSize})`,
      );
    } else {
      // Pool full - kill sandbox
      try {
        await sandbox.kill();
        logger.debug(`[POOL] Pool full, killed sandbox ${sandbox.sandboxId}`);
      } catch (error) {
        logger.warn(
          `[POOL] Failed to kill sandbox ${sandbox.sandboxId}:`,
          error,
        );
      }
    }
  }

  /**
   * Warmup pool with multiple sandboxes
   */
  async warmup(templateId: FragmentTemplateId, count: number): Promise<void> {
    if (!this.enabled || count <= 0) return;

    logger.info(`[POOL] Warming up ${count} sandboxes for ${templateId}...`);

    try {
      const sandboxes = await Promise.all(
        Array(count)
          .fill(null)
          .map(() => this.createSandbox(templateId)),
      );

      const pool = this.pools.get(templateId) || [];
      pool.push(...sandboxes);
      this.pools.set(templateId, pool);

      logger.info(
        `[POOL] ✅ Warmup complete for ${templateId} (pool size: ${pool.length})`,
      );
    } catch (error) {
      logger.error(`[POOL] Warmup failed for ${templateId}:`, error);
    }
  }

  /**
   * Warmup in background (non-blocking)
   */
  private warmupInBackground(
    templateId: FragmentTemplateId,
    count: number,
  ): void {
    setTimeout(() => {
      const pool = this.pools.get(templateId) || [];
      const needed = Math.max(0, this.minSize - pool.length);

      if (needed > 0) {
        this.warmup(templateId, Math.min(needed, count)).catch(logger.error);
      }
    }, 0);
  }

  /**
   * Create a new sandbox with template
   * Includes retry logic for transient API errors and rate limiting protection
   *
   * IMPORTANT: Uses same approach as E2BSandboxService which works successfully
   * - If E2B_TEMPLATE_ID is set, use that (works around template-specific quotas)
   * - Otherwise use the requested template
   */
  private async createSandbox(
    templateId: FragmentTemplateId,
  ): Promise<Sandbox> {
    const customTemplateId = process.env.E2B_TEMPLATE_ID;
    const apiKey = process.env.E2B_API_KEY;

    if (!apiKey) {
      throw new Error("E2B_API_KEY not configured");
    }

    // Use custom Shadower templates that are deployed to your E2B account
    // These templates support secured access mode
    // Map standard template IDs to our custom Shadower templates
    const TEMPLATE_MAPPING: Record<string, string> = {
      "nextjs-developer": "shadower-nextjs",
      "vue-developer": "shadower-vue",
      "streamlit-developer": "shadower-streamlit",
      "gradio-developer": "shadower-gradio",
      "code-interpreter-v1": "code-interpreter-v1", // Default Python template
    };

    let template: string;
    // Only use E2B_TEMPLATE_ID for code-interpreter (Python), NOT for web apps
    // Web apps (Next.js, Vue, Streamlit, Gradio) need their own templates with dev servers
    if (customTemplateId && templateId === "code-interpreter-v1") {
      logger.info(
        `[POOL] Using E2B_TEMPLATE_ID (${customTemplateId}) for code-interpreter`,
      );
      template = customTemplateId;
    } else {
      // Map to our custom Shadower template for web apps
      template = TEMPLATE_MAPPING[templateId] || templateId;
      logger.info(
        `[POOL] Using Shadower template: ${template} (mapped from ${templateId})`,
      );
    }

    // Rate limiting: Ensure we don't create sandboxes too quickly
    // E2B limits: 1 sandbox/sec (Hobby) or 5 sandboxes/sec (Pro)
    // We'll use 1 second interval to be safe
    const now = Date.now();
    const timeSinceLastCreation = now - this.lastCreationTime;
    if (timeSinceLastCreation < this.minCreationInterval) {
      const waitTime = this.minCreationInterval - timeSinceLastCreation;
      logger.debug(
        `[POOL] Rate limiting: waiting ${waitTime}ms before creating sandbox`,
      );
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
    this.lastCreationTime = Date.now();

    const maxRetries = 3;
    let lastError: any;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.info(
          `[POOL] Attempt ${attempt}/${maxRetries}: Creating sandbox with template: ${template || "default"}`,
        );

        // Match EXACT approach used by E2BSandboxService which works successfully
        // If template is empty, use default (no template parameter)
        const sandboxPromise = template
          ? Sandbox.create(template, {
              apiKey,
              timeoutMs: 300000, // 5 min default
            })
          : Sandbox.create({
              apiKey,
              timeoutMs: 300000,
            });

        const sandbox = await sandboxPromise;

        logger.info(
          `[POOL] ✅ Successfully created sandbox ${sandbox.sandboxId} with template ${template} (attempt ${attempt})`,
        );

        // SKIP health check to avoid hitting API limits
        // Sandbox creation success is sufficient - health check is non-critical
        // If health check is needed, it can be done lazily when sandbox is first used
        logger.debug(
          `[POOL] Skipping health check to avoid potential API limit issues`,
        );

        return sandbox;
      } catch (error: any) {
        lastError = error;

        const isApiLimitError =
          error?.message?.includes("API usage limits") ||
          error?.message?.includes("budget limit") ||
          error?.message?.includes("usage limits") ||
          error?.message?.includes("regain access");

        // Log detailed error information for debugging
        logger.error(
          `[POOL] Attempt ${attempt}/${maxRetries} failed to create sandbox with template ${template}:`,
          {
            attempt,
            maxRetries,
            error: error?.message || String(error),
            errorType: error?.constructor?.name,
            errorCode: error?.code,
            errorStatus: error?.status,
            errorResponse: error?.response
              ? JSON.stringify(error.response, null, 2)
              : undefined,
            stack: error?.stack,
            template,
            templateId,
            hasApiKey: !!apiKey,
            isApiLimitError,
          },
        );

        // Don't retry API limit errors - they won't resolve quickly
        // These are real E2B account limits that need to be addressed in the dashboard
        if (isApiLimitError) {
          const errorMsg = error?.message || "Unknown API limit error";
          const regainDateMatch = errorMsg.match(
            /regain access on (\d{4}-\d{2}-\d{2})/,
          );
          const regainDate = regainDateMatch
            ? regainDateMatch[1]
            : "unknown date";

          // Extract more details from error response if available
          const errorDetails = error?.response || error?.body || {};
          const limitType = errorDetails.limit_type || "API usage";
          const limitValue = errorDetails.limit_value || "unknown";

          throw new Error(
            `E2B ${limitType} Limit Reached: ${errorMsg}\n\n` +
              `Even though you have $20k budget, E2B has separate API call quotas.\n` +
              `This is likely a daily/monthly API call limit, NOT a budget limit.\n\n` +
              `To fix this:\n` +
              `1. Go to https://e2b.dev/dashboard/charannyan/budget\n` +
              `2. Check for "API Usage Limits" or "Daily/Monthly Quotas" (separate from budget)\n` +
              `3. Increase or remove these quotas\n` +
              `4. Check rate limits: Hobby=1 sandbox/sec, Pro=5 sandboxes/sec\n` +
              `5. Wait until ${regainDate} if limits are time-based\n\n` +
              `Current limit: ${limitValue}\n` +
              `Template: ${template}\n\n` +
              `The test endpoint works because it's a single isolated call.\n` +
              `Fragment creation may hit limits if multiple requests happen quickly.`,
          );
        }

        // Retry with exponential backoff for transient errors
        if (attempt < maxRetries) {
          const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Max 5 seconds
          logger.warn(`[POOL] Retrying sandbox creation in ${delayMs}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }

    // All retries exhausted
    throw lastError;
  }

  /**
   * Health check for sandbox - verify it's responsive
   */
  private async healthCheck(sandbox: Sandbox): Promise<void> {
    logger.debug(
      `[POOL] Starting health check for sandbox ${sandbox.sandboxId}`,
    );
    try {
      // Simple health check: try to list files
      await sandbox.files.list("/home/user");
      logger.debug(
        `[POOL] ✅ Health check passed for sandbox ${sandbox.sandboxId}`,
      );
    } catch (error: any) {
      logger.warn(
        `[POOL] ⚠️ Health check failed for sandbox ${sandbox.sandboxId}:`,
        {
          operation: "sandbox.files.list",
          path: "/home/user",
          error: error?.message || String(error),
          errorType: error?.constructor?.name,
          errorCode: error?.code,
          errorStatus: error?.status,
          errorResponse: error?.response
            ? JSON.stringify(error.response, null, 2)
            : undefined,
          sandboxId: sandbox.sandboxId,
          note: "Continuing anyway - sandbox might still be usable",
        },
      );
      // Don't throw - sandbox might still be usable
    }
  }

  /**
   * Get pool stats for monitoring
   */
  getStats(): Record<string, { poolSize: number; maxSize: number }> {
    const stats: Record<string, { poolSize: number; maxSize: number }> = {};

    for (const [templateId, pool] of this.pools.entries()) {
      stats[templateId] = {
        poolSize: pool.length,
        maxSize: this.maxSize,
      };
    }

    return stats;
  }

  /**
   * Cleanup all sandboxes (for shutdown)
   */
  async cleanup(): Promise<void> {
    logger.info("[POOL] Cleaning up all sandboxes...");

    for (const [templateId, pool] of this.pools.entries()) {
      logger.info(`[POOL] Killing ${pool.length} sandboxes for ${templateId}`);

      await Promise.all(
        pool.map((sandbox) =>
          sandbox
            .kill()
            .catch((error) =>
              logger.warn(
                `[POOL] Failed to kill sandbox ${sandbox.sandboxId}:`,
                error,
              ),
            ),
        ),
      );
    }

    this.pools.clear();
    logger.info("[POOL] ✅ Cleanup complete");
  }
}

// Singleton instance
export const sandboxPool = new SandboxPool();

// Cleanup on process exit
if (typeof process !== "undefined") {
  process.on("SIGTERM", () => sandboxPool.cleanup());
  process.on("SIGINT", () => sandboxPool.cleanup());
}
