/**
 * BrowserbaseService - Enterprise-grade Browser Automation
 *
 * Key improvements:
 * - Database-backed session state (no module-level variables)
 * - Proper screenshot capture using Browserbase API
 * - Rate limiting and quota enforcement
 * - Structured logging and observability
 * - URL validation for security
 * - Graceful error handling with Result pattern
 */

import { BrowserConfig } from "@/lib/config/browser-config";
import { BrowserSessionTable } from "@/lib/db/pg/schema.pg";
import { updateSessionActivity } from "@/lib/jobs/session-cleanup";
import { createSessionWithQuotaCheck } from "@/lib/middleware/session-quota";
import {
  logBrowserAction,
  logBrowserError,
  logBrowserNavigation,
  logBrowserScreenshot,
  logSessionClosed,
  logSessionCreated,
  timeOperation,
} from "@/lib/observability/automation-metrics";
import { uploadScreenshot } from "@/lib/storage/screenshot-storage";
import { AutomationErrorCode, Result, err, ok } from "@/lib/utils/result";
import { sanitizeUrlForLogging, validateUrl } from "@/lib/utils/url-validator";
import Browserbase from "@browserbasehq/sdk";
import {
  type ActResult,
  type Action,
  Stagehand,
} from "@browserbasehq/stagehand";
import { and, eq } from "drizzle-orm";
import logger from "logger";
import { z } from "zod";
import type {
  ActionResult,
  BrowserEvent,
  BrowserSession,
  BrowserSessionOptions,
  ObservationResult,
  ScreenshotOptions,
  ScreenshotResult,
} from "./types";

// Lazy database import to avoid initialization during tests
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _db: any = null;
async function getDb() {
  if (!_db) {
    const { pgDb } = await import("@/lib/db/pg/db.pg");
    _db = pgDb;
  }
  return _db;
}

/**
 * In-memory cache for active Stagehand instances
 * This is OK because Stagehand instances are just client connections,
 * not session state. The actual session state is in the database.
 */
interface StagehandCache {
  stagehand: Stagehand;
  createdAt: Date;
  lastUsedAt: Date;
}

/**
 * Enterprise Browser Automation Service
 *
 * Uses database for session state persistence and Stagehand for browser control.
 */
export class BrowserbaseService {
  private static instance: BrowserbaseService;
  private client: Browserbase;
  private readonly apiKey: string;
  private readonly projectId: string;

  // In-memory cache for Stagehand instances (not session state)
  private stagehandCache: Map<string, StagehandCache> = new Map();

  private constructor() {
    this.apiKey = BrowserConfig.provider.apiKey;
    this.projectId = BrowserConfig.provider.projectId;

    if (!this.apiKey || !this.projectId) {
      console.warn(
        "[BrowserbaseService] BROWSERBASE_API_KEY or BROWSERBASE_PROJECT_ID not set. Browser automation will fail.",
      );
    }

    this.client = new Browserbase({
      apiKey: this.apiKey,
    });

    // Note: Cleanup is now handled by cron job at /api/cron/cleanup
    // Avoiding module-level setInterval which doesn't work reliably in serverless
  }

  public static getInstance(): BrowserbaseService {
    if (!BrowserbaseService.instance) {
      BrowserbaseService.instance = new BrowserbaseService();
    }
    return BrowserbaseService.instance;
  }

  /**
   * Clean up stale Stagehand instances from cache
   * Called by cron job at /api/cron/cleanup
   */
  public async cleanupStaleSessions(): Promise<number> {
    const now = Date.now();
    const maxAge = BrowserConfig.session.idleTimeout;
    let cleaned = 0;

    for (const [sessionId, cache] of this.stagehandCache.entries()) {
      if (now - cache.lastUsedAt.getTime() > maxAge) {
        await this.cleanupStagehand(sessionId);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * Clean up a Stagehand instance from cache
   */
  private async cleanupStagehand(sessionId: string): Promise<void> {
    const cache = this.stagehandCache.get(sessionId);
    if (cache) {
      try {
        await cache.stagehand.close();
      } catch (_error) {
        // Ignore errors during cleanup
      }
      this.stagehandCache.delete(sessionId);
    }
  }

  /**
   * Get or create a Stagehand instance for a session
   */
  private async getStagehand(sessionId: string): Promise<Result<Stagehand>> {
    // Check cache first
    const cached = this.stagehandCache.get(sessionId);
    if (cached) {
      cached.lastUsedAt = new Date();
      return ok(cached.stagehand);
    }

    // Create new Stagehand instance
    try {
      const stagehand = new Stagehand({
        env: "BROWSERBASE",
        apiKey: this.apiKey,
        projectId: this.projectId,
        browserbaseSessionID: sessionId,
        verbose: 0, // Disabled to avoid pino-pretty issues in serverless
        logger: () => {}, // Disable logging completely to avoid pino transport issues
        // Configure model for AI operations (act, observe, extract)
        // Priority: OpenAI GPT-5.2 > Google Gemini > None
        model: (() => {
          if (BrowserConfig.provider.openaiApiKey) {
            return {
              modelName: BrowserConfig.provider.stagehandModel, // Default: openai/gpt-5.2
              apiKey: BrowserConfig.provider.openaiApiKey,
            };
          }
          if (BrowserConfig.provider.googleApiKey) {
            const modelName = BrowserConfig.provider.stagehandModel.startsWith(
              "openai/",
            )
              ? "gemini-2.0-flash" // Fallback to Gemini if OpenAI model but no OpenAI key
              : BrowserConfig.provider.stagehandModel;
            return {
              modelName,
              apiKey: BrowserConfig.provider.googleApiKey,
            };
          }
          return undefined;
        })(),
      });

      await stagehand.init();

      // Cache the instance
      this.stagehandCache.set(sessionId, {
        stagehand,
        createdAt: new Date(),
        lastUsedAt: new Date(),
      });

      return ok(stagehand);
    } catch (error) {
      return err(
        AutomationErrorCode.SESSION_NOT_FOUND,
        `Failed to connect to session: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Wait for page to stabilize before taking screenshot.
   * Many modern sites load content dynamically after initial DOM load.
   */
  private async waitForPageStability(stagehand: Stagehand): Promise<void> {
    const page = stagehand.context.activePage();
    if (!page) return;

    try {
      // Wait for network to be idle (no requests for 500ms)
      // Stagehand's Page uses timeout as a number directly
      await Promise.race([
        page.waitForLoadState("networkidle"),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), 5000),
        ),
      ]);
    } catch {
      // If networkidle times out, that's okay - continue
    }

    // Additional small delay for any final rendering
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // Helper functions to reduce cognitive complexity
  private validateCredentials(): Result<void> {
    if (!this.apiKey || !this.projectId) {
      console.error(
        `[BrowserbaseService] Missing credentials: apiKey=${!!this.apiKey}, projectId=${!!this.projectId}`,
      );
      return err(
        AutomationErrorCode.SESSION_CREATION_FAILED,
        "Browser automation is not configured. Missing BROWSERBASE_API_KEY or BROWSERBASE_PROJECT_ID.",
      );
    }
    return ok(undefined);
  }

  private async createBrowserbaseSession(
    options: BrowserSessionOptions,
  ): Promise<Result<{ id: string }>> {
    try {
      const timeoutMs = options.timeout || BrowserConfig.session.maxDuration;
      const timeoutSeconds = Math.min(Math.floor(timeoutMs / 1000), 21600);

      console.log(
        `[BrowserbaseService] Creating session with projectId=${this.projectId.substring(0, 8)}..., apiKey=${this.apiKey ? "set" : "missing"}`,
      );

      const bbSession = await this.client.sessions.create({
        projectId: this.projectId,
        browserSettings: {
          viewport: options.viewport || {
            width: BrowserConfig.provider.viewportWidth,
            height: BrowserConfig.provider.viewportHeight,
          },
          ...(options.stealth && {
            fingerprint: {
              browsers: ["chrome"],
              devices: ["desktop"],
              operatingSystems: ["macos"],
            },
          }),
        },
        ...(options.proxy && {
          proxies: [
            {
              type: "external",
              server: options.proxy.server,
              ...(options.proxy.username && {
                username: options.proxy.username,
                password: options.proxy.password,
              }),
            },
          ],
        }),
        timeout: timeoutSeconds,
        keepAlive: true,
      });

      return ok(bbSession);
    } catch (error) {
      return err(
        AutomationErrorCode.SESSION_CREATION_FAILED,
        `Failed to create Browserbase session: ${error}`,
      );
    }
  }

  private async saveSessionToDatabase(
    userId: string,
    threadId: string | null,
    sessionId: string,
  ): Promise<Result<{ id: string; sessionId: string }>> {
    logger.info(
      `[BrowserbaseService] Creating session record: userId=${userId}, threadId=${threadId}, sessionId=${sessionId}`,
    );

    const dbResult = await createSessionWithQuotaCheck({
      userId,
      threadId,
      provider: "browserbase",
      sessionId,
      replayUrl: undefined,
    });

    return dbResult;
  }

  private async cleanupSessionOnError(sessionId: string): Promise<void> {
    try {
      await this.client.sessions.update(sessionId, {
        projectId: this.projectId,
        status: "REQUEST_RELEASE",
      });
    } catch (cleanupError) {
      console.error(
        `[BrowserbaseService] Failed to cleanup session ${sessionId} after quota error:`,
        cleanupError,
      );
    }
  }

  private createStagehandConfig(
    sessionId: string,
  ): ConstructorParameters<typeof Stagehand>[0] {
    return {
      env: "BROWSERBASE",
      apiKey: this.apiKey,
      projectId: this.projectId,
      browserbaseSessionID: sessionId,
      verbose: 0,
      logger: () => {},
      model: this.getStagehandModelConfig(),
    };
  }

  private getStagehandModelConfig():
    | { modelName: string; apiKey: string }
    | undefined {
    if (BrowserConfig.provider.openaiApiKey) {
      return {
        modelName: BrowserConfig.provider.stagehandModel,
        apiKey: BrowserConfig.provider.openaiApiKey,
      };
    }
    if (BrowserConfig.provider.googleApiKey) {
      const modelName = BrowserConfig.provider.stagehandModel.startsWith(
        "openai/",
      )
        ? "gemini-2.0-flash"
        : BrowserConfig.provider.stagehandModel;
      return {
        modelName,
        apiKey: BrowserConfig.provider.googleApiKey,
      };
    }
    return undefined;
  }

  private async updateSessionMetadata(
    sessionId: string,
    debugUrl: string,
    options: BrowserSessionOptions & { userId: string; threadId?: string },
    startTime: number,
  ): Promise<void> {
    await (await getDb())
      .update(BrowserSessionTable)
      .set({
        replayUrl: debugUrl,
        lastActivityAt: new Date(),
        expiresAt: new Date(
          Date.now() + (options.timeout || BrowserConfig.session.maxDuration),
        ),
        metadata: {
          browserType: "chrome",
          viewport: options.viewport || {
            width: BrowserConfig.provider.viewportWidth,
            height: BrowserConfig.provider.viewportHeight,
          },
          stealth: options.stealth || false,
          proxy: !!options.proxy,
        },
      })
      .where(eq(BrowserSessionTable.sessionId, sessionId));

    logSessionCreated(sessionId, "browserbase", {
      userId: options.userId,
      threadId: options.threadId,
      options: {
        stealth: options.stealth,
        durationMs: Date.now() - startTime,
      },
    });
  }

  /**
   * Gets user-friendly error message based on error content.
   */
  private getUserFriendlyErrorMessage(errorMessage: string): string {
    if (errorMessage.includes("401") || errorMessage.includes("Unauthorized")) {
      return "Browser automation failed: Invalid API credentials. Please check BROWSERBASE_API_KEY.";
    }
    if (errorMessage.includes("403") || errorMessage.includes("Forbidden")) {
      return "Browser automation failed: Access denied. Please check your Browserbase account permissions.";
    }
    if (errorMessage.includes("429") || errorMessage.includes("rate limit")) {
      return "Browser automation failed: Rate limit exceeded. Please try again later.";
    }
    if (
      errorMessage.includes("Connection") ||
      errorMessage.includes("ECONNREFUSED") ||
      errorMessage.includes("network")
    ) {
      return "Browser automation failed: Connection error. Browserbase service may be temporarily unavailable.";
    }
    return `Failed to create browser session: ${errorMessage}`;
  }

  /**
   * Create a new browser session with optional stealth configuration.
   * Uses transactional quota checking to prevent race conditions.
   */
  public async createSession(
    options: BrowserSessionOptions & { userId: string; threadId?: string },
  ): Promise<Result<BrowserSession>> {
    const startTime = Date.now();
    let bbSessionId: string | null = null;

    try {
      const validationResult = this.validateCredentials();
      if (!validationResult.ok) {
        return validationResult;
      }

      const bbSessionResult = await this.createBrowserbaseSession(options);
      if (!bbSessionResult.ok) {
        return bbSessionResult;
      }
      const bbSession = bbSessionResult.value;
      bbSessionId = bbSession.id;

      const threadId =
        options.threadId && options.threadId.trim() !== ""
          ? options.threadId
          : null;

      const dbResult = await this.saveSessionToDatabase(
        options.userId,
        threadId,
        bbSession.id,
      );

      if (!dbResult.ok) {
        await this.cleanupSessionOnError(bbSession.id);
        return dbResult;
      }

      const stagehandConfig = this.createStagehandConfig(bbSession.id);
      const stagehand = new Stagehand(stagehandConfig);
      await stagehand.init();

      const debugUrl = stagehand.browserbaseDebugURL;

      this.stagehandCache.set(bbSession.id, {
        stagehand,
        createdAt: new Date(),
        lastUsedAt: new Date(),
      });

      await this.updateSessionMetadata(
        bbSession.id,
        debugUrl || "",
        options,
        startTime,
      );

      const session: BrowserSession = {
        id: dbResult.value.id,
        sessionId: bbSession.id,
        status: "active",
        replayUrl: debugUrl,
        createdAt: new Date(),
        provider: "browserbase",
      };

      return ok(session);
    } catch (error) {
      // Clean up Browserbase session if it was created
      if (bbSessionId) {
        try {
          await this.client.sessions.update(bbSessionId, {
            projectId: this.projectId,
            status: "REQUEST_RELEASE",
          });
        } catch (cleanupError) {
          console.error(
            `[BrowserbaseService] Failed to cleanup session ${bbSessionId} after error:`,
            cleanupError,
          );
        }
      }

      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      console.error(`[BrowserbaseService] Session creation failed:`, error);

      logBrowserError("unknown", "session_create", errorMessage, {
        userId: options.userId,
      });

      const userMessage = this.getUserFriendlyErrorMessage(errorMessage);
      return err(AutomationErrorCode.SESSION_CREATION_FAILED, userMessage);
    }
  }

  /**
   * Create a stealth session with advanced bot detection avoidance.
   */
  public async createStealthSession(
    userId: string,
    threadId?: string,
    geoLocation?: string,
  ): Promise<Result<BrowserSession>> {
    return this.createSession({
      userId,
      threadId,
      stealth: true,
      geoLocation,
      viewport: {
        width: BrowserConfig.provider.viewportWidth,
        height: BrowserConfig.provider.viewportHeight,
      },
      recording: true,
    });
  }

  /**
   * Get an existing session by ID.
   */
  public async getSession(
    sessionId: string,
  ): Promise<Result<BrowserSession | null>> {
    try {
      const [dbSession] = await (await getDb())
        .select()
        .from(BrowserSessionTable)
        .where(eq(BrowserSessionTable.sessionId, sessionId))
        .limit(1);

      if (!dbSession) {
        return ok(null);
      }

      // Check if session is expired
      if (
        dbSession.expiresAt &&
        dbSession.expiresAt < new Date() &&
        dbSession.status === "active"
      ) {
        // Mark as expired in database
        await (await getDb())
          .update(BrowserSessionTable)
          .set({ status: "expired" })
          .where(eq(BrowserSessionTable.id, dbSession.id));

        return ok(null);
      }

      return ok({
        id: dbSession.id,
        sessionId: dbSession.sessionId,
        status: dbSession.status as "active" | "closed" | "error",
        currentUrl: dbSession.currentUrl || undefined,
        replayUrl: dbSession.replayUrl || undefined,
        createdAt: dbSession.createdAt,
        provider: "browserbase",
      });
    } catch (error) {
      return err(
        AutomationErrorCode.UNKNOWN_ERROR,
        `Failed to get session: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Close a browser session and cleanup resources.
   */
  public async closeSession(sessionId: string): Promise<Result<void>> {
    try {
      // Cleanup Stagehand from cache
      await this.cleanupStagehand(sessionId);

      // Request session release from Browserbase
      try {
        await this.client.sessions.update(sessionId, {
          projectId: this.projectId,
          status: "REQUEST_RELEASE",
        });
      } catch {
        // Session might already be closed
      }

      // Update database
      await (await getDb())
        .update(BrowserSessionTable)
        .set({
          status: "closed",
          closedAt: new Date(),
        })
        .where(eq(BrowserSessionTable.sessionId, sessionId));

      logSessionClosed(sessionId, "browserbase", { reason: "user_requested" });

      return ok(undefined);
    } catch (error) {
      return err(
        AutomationErrorCode.UNKNOWN_ERROR,
        `Failed to close session: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Navigate to a URL in the browser session.
   * Uses Playwright's page.goto() directly for reliability (no AI/OpenAI needed).
   */
  public async navigate(
    sessionId: string,
    url: string,
    waitFor: "load" | "domcontentloaded" | "networkidle" = "domcontentloaded",
  ): Promise<Result<ActionResult>> {
    // Validate URL
    const urlResult = validateUrl(url);
    if (!urlResult.ok) {
      return err(urlResult.error.code, urlResult.error.message);
    }

    const stagehandResult = await this.getStagehand(sessionId);
    if (!stagehandResult.ok) {
      return err(stagehandResult.error.code, stagehandResult.error.message);
    }

    const stagehand = stagehandResult.value;

    try {
      const result = await timeOperation(
        "browser_navigate",
        async () => {
          // Use Playwright's page.goto() directly - no AI/OpenAI needed
          const page = stagehand.context.activePage();
          if (!page) {
            throw new Error("No active page available for navigation");
          }

          await page.goto(url, {
            waitUntil: waitFor,
            timeoutMs: BrowserConfig.provider.navigationTimeout,
          });

          // Wait for page to stabilize before taking screenshot
          await this.waitForPageStability(stagehand);

          // Update session state
          await (await getDb())
            .update(BrowserSessionTable)
            .set({
              currentUrl: url,
              lastActivityAt: new Date(),
            })
            .where(eq(BrowserSessionTable.sessionId, sessionId));

          // Take screenshot after navigation
          const screenshotResult = await this.screenshot(sessionId);
          const screenshot = screenshotResult.ok
            ? screenshotResult.value.base64
            : undefined;

          return {
            success: true,
            message: `Navigated to ${sanitizeUrlForLogging(url)}`,
            screenshot,
          } as ActionResult;
        },
        { sessionId, url: sanitizeUrlForLogging(url) },
      );

      logBrowserNavigation(sessionId, url, { success: true });

      return ok(result);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      logBrowserError(sessionId, "navigate", errorMessage, { url });

      return err(
        AutomationErrorCode.ACTION_FAILED,
        `Navigation failed: ${errorMessage}`,
      );
    }
  }

  /**
   * Perform a natural language action using Stagehand.
   */
  public async act(
    sessionId: string,
    action: string,
    timeout?: number,
  ): Promise<Result<ActionResult>> {
    const stagehandResult = await this.getStagehand(sessionId);
    if (!stagehandResult.ok) {
      return err(stagehandResult.error.code, stagehandResult.error.message);
    }

    const stagehand = stagehandResult.value;

    try {
      const result = await timeOperation(
        "browser_act",
        async () => {
          const actResult: ActResult = await stagehand.act(action, {
            ...(timeout && { timeout }),
          });

          // Update activity timestamp
          await updateSessionActivity(sessionId);

          // Wait for page to stabilize after action
          await this.waitForPageStability(stagehand);

          // Take screenshot after action
          const screenshotResult = await this.screenshot(sessionId);
          const screenshot = screenshotResult.ok
            ? screenshotResult.value.base64
            : undefined;

          return {
            success: actResult.success,
            message: actResult.message || `Action completed: ${action}`,
            screenshot,
          } as ActionResult;
        },
        { sessionId, action },
      );

      logBrowserAction(sessionId, action, { success: result.success });

      return ok(result);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      logBrowserError(sessionId, "act", errorMessage, { action });

      return err(
        AutomationErrorCode.ACTION_FAILED,
        `Action failed: ${errorMessage}`,
      );
    }
  }

  /**
   * Observe elements on the page using Stagehand.
   */
  public async observe(
    sessionId: string,
    instruction: string,
  ): Promise<Result<ObservationResult>> {
    const stagehandResult = await this.getStagehand(sessionId);
    if (!stagehandResult.ok) {
      return err(stagehandResult.error.code, stagehandResult.error.message);
    }

    const stagehand = stagehandResult.value;

    try {
      const observations: Action[] = await stagehand.observe(instruction);

      // Update activity timestamp
      await updateSessionActivity(sessionId);

      // Wait for page to stabilize
      await this.waitForPageStability(stagehand);

      // Take screenshot for context
      const screenshotResult = await this.screenshot(sessionId);
      const screenshot = screenshotResult.ok
        ? screenshotResult.value.base64
        : undefined;

      return ok({
        success: true,
        elements: observations.map((obs) => ({
          selector: obs.selector,
          text: obs.description,
        })),
        screenshot,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      logBrowserError(sessionId, "observe", errorMessage, { instruction });

      return err(
        AutomationErrorCode.ACTION_FAILED,
        `Observation failed: ${errorMessage}`,
      );
    }
  }

  /**
   * Extract structured data from the page using Stagehand.
   */
  public async extract<T extends z.ZodTypeAny>(
    sessionId: string,
    instruction: string,
    schema: T,
  ): Promise<Result<z.infer<T>>> {
    const stagehandResult = await this.getStagehand(sessionId);
    if (!stagehandResult.ok) {
      return err(stagehandResult.error.code, stagehandResult.error.message);
    }

    const stagehand = stagehandResult.value;

    try {
      const result = await stagehand.extract(instruction, schema);

      // Update activity timestamp
      await updateSessionActivity(sessionId);

      return ok(result as z.infer<T>);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      logBrowserError(sessionId, "extract", errorMessage, { instruction });

      return err(
        AutomationErrorCode.ACTION_FAILED,
        `Extraction failed: ${errorMessage}`,
      );
    }
  }

  /**
   * Take a screenshot of the current page using Browserbase API.
   */
  public async screenshot(
    sessionId: string,
    options: ScreenshotOptions = {},
  ): Promise<Result<ScreenshotResult>> {
    try {
      // Get or create Stagehand instance to take screenshot via Playwright
      const stagehandResult = await this.getStagehand(sessionId);
      if (!stagehandResult.ok) {
        return err(
          AutomationErrorCode.SCREENSHOT_FAILED,
          `Cannot take screenshot: ${stagehandResult.error.message}`,
        );
      }

      const stagehand = stagehandResult.value;
      const page = stagehand.context.activePage();

      if (!page) {
        return err(
          AutomationErrorCode.SCREENSHOT_FAILED,
          "No active page available for screenshot",
        );
      }

      // Take screenshot using the Page's screenshot method
      const buffer = await page.screenshot({
        fullPage: options.fullPage || false,
      });

      const base64 = buffer.toString("base64");

      // Log the screenshot
      logBrowserScreenshot(sessionId, {
        sizeBytes: buffer.length,
        fullPage: options.fullPage,
      });

      // Optionally upload to storage
      if (options.saveToStorage) {
        const uploadResult = await uploadScreenshot(
          buffer,
          sessionId,
          "browser",
          { format: options.format || "png" },
        );

        if (uploadResult.ok) {
          // Update session with screenshot reference
          const [session] = await (await getDb())
            .select({ screenshots: BrowserSessionTable.screenshots })
            .from(BrowserSessionTable)
            .where(eq(BrowserSessionTable.sessionId, sessionId))
            .limit(1);

          if (session) {
            const screenshots = session.screenshots || [];

            screenshots.push({
              id: uploadResult.value.pathname, // Use pathname as unique id
              timestamp: new Date().toISOString(),
              url: uploadResult.value.url,
              storageKey: uploadResult.value.pathname,
            });

            // Keep only last N screenshots
            const maxScreenshots = BrowserConfig.screenshot.maxPerSession;
            const trimmedScreenshots = screenshots.slice(-maxScreenshots);

            await (await getDb())
              .update(BrowserSessionTable)
              .set({ screenshots: trimmedScreenshots })
              .where(eq(BrowserSessionTable.sessionId, sessionId));
          }
        }
      }

      return ok({
        base64,
        width: options.viewport?.width || BrowserConfig.provider.viewportWidth,
        height:
          options.viewport?.height || BrowserConfig.provider.viewportHeight,
        format: "png",
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      logBrowserError(sessionId, "screenshot", errorMessage);

      // Return empty screenshot on error (non-critical)
      return ok({
        base64: "",
        width: BrowserConfig.provider.viewportWidth,
        height: BrowserConfig.provider.viewportHeight,
        format: "png",
      });
    }
  }

  /**
   * Get the replay URL for a session.
   */
  public async getReplayUrl(sessionId: string): Promise<Result<string | null>> {
    const sessionResult = await this.getSession(sessionId);
    if (!sessionResult.ok) {
      return err(sessionResult.error.code, sessionResult.error.message);
    }

    return ok(sessionResult.value?.replayUrl || null);
  }

  /**
   * Wait for a specific condition on the page.
   */
  public async waitFor(
    sessionId: string,
    options: {
      selector?: string;
      text?: string;
      timeout?: number;
    },
  ): Promise<Result<ActionResult>> {
    const stagehandResult = await this.getStagehand(sessionId);
    if (!stagehandResult.ok) {
      return err(stagehandResult.error.code, stagehandResult.error.message);
    }

    const stagehand = stagehandResult.value;
    const timeout = options.timeout || 30000;

    try {
      if (options.selector) {
        await stagehand.act(`wait for element ${options.selector} to appear`, {
          timeout,
        });
      } else if (options.text) {
        await stagehand.act(
          `wait for text "${options.text}" to appear on the page`,
          { timeout },
        );
      }

      await updateSessionActivity(sessionId);

      const screenshotResult = await this.screenshot(sessionId);
      const screenshot = screenshotResult.ok
        ? screenshotResult.value.base64
        : undefined;

      return ok({
        success: true,
        message: "Wait condition satisfied",
        screenshot,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      return err(
        AutomationErrorCode.ACTION_FAILED,
        `Wait failed: ${errorMessage}`,
      );
    }
  }

  /**
   * Get the current page content as text.
   */
  public async getPageContent(
    sessionId: string,
    _format: "text" | "html" = "text",
  ): Promise<Result<string>> {
    const stagehandResult = await this.getStagehand(sessionId);
    if (!stagehandResult.ok) {
      return err(stagehandResult.error.code, stagehandResult.error.message);
    }

    const stagehand = stagehandResult.value;

    try {
      const result = await stagehand.extract();
      await updateSessionActivity(sessionId);

      return ok((result as any).pageText || "");
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      return err(
        AutomationErrorCode.ACTION_FAILED,
        `Failed to get page content: ${errorMessage}`,
      );
    }
  }

  /**
   * Stream screenshots from a session (for live preview).
   */
  public async *streamSession(
    sessionId: string,
    intervalMs: number = BrowserConfig.streaming.pollingInterval,
  ): AsyncGenerator<BrowserEvent> {
    const sessionResult = await this.getSession(sessionId);
    if (!sessionResult.ok || !sessionResult.value) {
      yield {
        type: "error",
        timestamp: new Date(),
        data: { message: "Session not found" },
      };
      return;
    }

    let consecutiveErrors = 0;
    const maxErrors = 5; // Max consecutive errors before stopping stream

    while (sessionResult.value.status === "active") {
      try {
        const screenshotResult = await this.screenshot(sessionId);

        if (screenshotResult.ok && screenshotResult.value.base64) {
          consecutiveErrors = 0;

          // Get current URL from database
          const [session] = await (await getDb())
            .select({ currentUrl: BrowserSessionTable.currentUrl })
            .from(BrowserSessionTable)
            .where(eq(BrowserSessionTable.sessionId, sessionId))
            .limit(1);

          yield {
            type: "screenshot",
            timestamp: new Date(),
            data: {
              base64: screenshotResult.value.base64,
              url: session?.currentUrl || undefined,
            },
          };
        } else {
          consecutiveErrors++;
        }
      } catch (error) {
        consecutiveErrors++;
        yield {
          type: "error",
          timestamp: new Date(),
          data: {
            message:
              error instanceof Error ? error.message : "Screenshot failed",
          },
        };
      }

      // Check for too many errors
      if (consecutiveErrors >= maxErrors) {
        yield {
          type: "error",
          timestamp: new Date(),
          data: {
            message: `Too many consecutive errors (${consecutiveErrors})`,
          },
        };
        break;
      }

      // Check session status
      const currentSession = await this.getSession(sessionId);
      if (
        !currentSession.ok ||
        !currentSession.value ||
        currentSession.value.status !== "active"
      ) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    yield {
      type: "closed",
      timestamp: new Date(),
      data: { sessionId },
    };
  }

  /**
   * Check if the service is properly configured.
   */
  public isConfigured(): boolean {
    return !!(this.apiKey && this.projectId);
  }

  /**
   * Get active sessions for a user from database.
   */
  public async getActiveSessionsForUser(userId: string): Promise<
    Result<
      Array<{
        id: string;
        sessionId: string;
        currentUrl: string | null;
        createdAt: Date;
      }>
    >
  > {
    try {
      const sessions = await (await getDb())
        .select({
          id: BrowserSessionTable.id,
          sessionId: BrowserSessionTable.sessionId,
          currentUrl: BrowserSessionTable.currentUrl,
          createdAt: BrowserSessionTable.createdAt,
        })
        .from(BrowserSessionTable)
        .where(
          and(
            eq(BrowserSessionTable.userId, userId),
            eq(BrowserSessionTable.provider, "browserbase"),
            eq(BrowserSessionTable.status, "active"),
          ),
        );

      return ok(sessions);
    } catch (error) {
      return err(
        AutomationErrorCode.UNKNOWN_ERROR,
        `Failed to get active sessions: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
}

// Export singleton instance getter
export const getBrowserbaseService = () => BrowserbaseService.getInstance();
