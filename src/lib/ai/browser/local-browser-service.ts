/**
 * Local Browser Service
 *
 * Provides a BrowserbaseService-compatible API that wraps the
 * Chrome DevTools Protocol service for local browser automation.
 *
 * This is the local-first replacement for the cloud-based Browserbase service.
 */

import logger from "logger";
import { ZodType } from "zod";

// Result type for operations
type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

interface BrowserSession {
  sessionId: string;
  userId: string;
  threadId?: string;
  provider: "chrome-devtools";
  currentUrl?: string;
  createdAt: Date;
}

interface NavigationResult {
  title?: string;
  url?: string;
}

interface ScreenshotResult {
  base64: string;
}

/**
 * Local Browser Service - Chrome DevTools-based browser automation
 */
export class LocalBrowserService {
  private static instance: LocalBrowserService;
  private activeSessions: Map<string, BrowserSession> = new Map();
  private chromeService: any = null;
  private port: number = 9222;

  private constructor() {}

  static getInstance(): LocalBrowserService {
    if (!LocalBrowserService.instance) {
      LocalBrowserService.instance = new LocalBrowserService();
    }
    return LocalBrowserService.instance;
  }

  /**
   * Get or initialize the Chrome DevTools service
   */
  private async getChromeService(): Promise<any> {
    if (this.chromeService) {
      return this.chromeService;
    }

    // Dynamic import for Electron environment
    // Skip in Next.js build - this will only work at runtime in Electron
    if (typeof window === "undefined" || !(window as any).electronAPI) {
      throw new Error("Not in Electron environment");
    }

    try {
      // Use eval to prevent Next.js from trying to resolve this at build time
      // This path only exists in the Electron runtime, not in Next.js build
      const electronServicesPath =
        "../../../../electron/services/chrome-devtools";
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const importFunc = new Function("path", "return import(path)");
      const chromeDevToolsModule = await importFunc(electronServicesPath);
      const { ChromeDevToolsService } = chromeDevToolsModule;
      this.chromeService = ChromeDevToolsService.getInstance();
      return this.chromeService;
    } catch (_error) {
      logger.warn(
        "[LocalBrowserService] Chrome DevTools service not available in this environment",
      );
      throw new Error(
        "Chrome DevTools service not available. Make sure you're running in Electron.",
      );
    }
  }

  /**
   * Create a browser session
   */
  async createSession(options: {
    userId: string;
    threadId?: string;
    port?: number;
  }): Promise<Result<BrowserSession, { message: string }>> {
    try {
      const chrome = await this.getChromeService();
      this.port = options.port || 9222;

      // Connect to Chrome
      const connectResult = await chrome.connect(this.port);
      if (!connectResult.success) {
        return {
          ok: false,
          error: {
            message:
              connectResult.error ||
              `Failed to connect to Chrome. Launch Chrome with: --remote-debugging-port=${this.port}`,
          },
        };
      }

      // Attach to first available tab or create new one
      const tabs = connectResult.tabs || [];
      if (tabs.length === 0) {
        const newTabResult = await chrome.newTab();
        if (!newTabResult.success) {
          return {
            ok: false,
            error: {
              message: "No Chrome tabs available and failed to create new tab",
            },
          };
        }
        await chrome.attachToTarget(newTabResult.tabId);
      } else {
        await chrome.attachToTarget(tabs[0].id);
      }

      const sessionId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const session: BrowserSession = {
        sessionId,
        userId: options.userId,
        threadId: options.threadId,
        provider: "chrome-devtools",
        createdAt: new Date(),
      };

      this.activeSessions.set(sessionId, session);
      logger.info(`[LocalBrowserService] Created session ${sessionId}`);

      return { ok: true, value: session };
    } catch (error: any) {
      logger.error("[LocalBrowserService] Failed to create session:", error);
      return {
        ok: false,
        error: { message: error.message || "Failed to create browser session" },
      };
    }
  }

  /**
   * Create a "stealth" session (same as regular for local Chrome)
   */
  async createStealthSession(
    userId: string,
    threadId?: string,
  ): Promise<Result<BrowserSession, { message: string }>> {
    // Local Chrome sessions are inherently "stealth" as they use the user's own browser
    return this.createSession({ userId, threadId });
  }

  /**
   * Navigate to a URL
   */
  async navigate(
    sessionId: string,
    url: string,
  ): Promise<Result<NavigationResult, { message: string }>> {
    try {
      const session = this.activeSessions.get(sessionId);
      if (!session) {
        return {
          ok: false,
          error: { message: `Session ${sessionId} not found` },
        };
      }

      const chrome = await this.getChromeService();
      const result = await chrome.navigate(url);

      if (!result.success) {
        return {
          ok: false,
          error: { message: result.error || "Navigation failed" },
        };
      }

      // Update session with current URL
      session.currentUrl = result.url;

      return {
        ok: true,
        value: { title: result.title, url: result.url },
      };
    } catch (error: any) {
      return {
        ok: false,
        error: { message: error.message || "Navigation failed" },
      };
    }
  }

  /**
   * Take a screenshot
   */
  async screenshot(
    sessionId: string,
    options?: { fullPage?: boolean },
  ): Promise<Result<ScreenshotResult, { message: string }>> {
    try {
      const session = this.activeSessions.get(sessionId);
      if (!session) {
        return {
          ok: false,
          error: { message: `Session ${sessionId} not found` },
        };
      }

      const chrome = await this.getChromeService();
      const result = await chrome.screenshot(options);

      if (!result.success) {
        return {
          ok: false,
          error: { message: result.error || "Screenshot failed" },
        };
      }

      return {
        ok: true,
        value: { base64: result.screenshot || "" },
      };
    } catch (error: any) {
      return {
        ok: false,
        error: { message: error.message || "Screenshot failed" },
      };
    }
  }

  /**
   * Extract data from the page using a schema
   */
  async extract<T>(
    sessionId: string,
    _instruction: string,
    schema: ZodType<T>,
  ): Promise<Result<T, { message: string }>> {
    try {
      const session = this.activeSessions.get(sessionId);
      if (!session) {
        return {
          ok: false,
          error: { message: `Session ${sessionId} not found` },
        };
      }

      const chrome = await this.getChromeService();

      // For local extraction, we'll use JavaScript evaluation
      // This is a simplified extraction - for complex schemas, consider using LLM
      const { success, result, error } = await chrome.evaluate(`
        (function() {
          // Basic extraction logic - get page content
          const title = document.title;
          const url = location.href;
          const text = document.body?.innerText || '';

          // Try to extract links if looking for search results
          const links = Array.from(document.querySelectorAll('a[href]'))
            .filter(a => a.href.startsWith('http'))
            .slice(0, 20)
            .map(a => ({
              url: a.href,
              title: a.textContent?.trim() || a.title || '',
              snippet: a.closest('div')?.textContent?.slice(0, 200) || ''
            }));

          return JSON.stringify({
            title,
            url,
            content: text.slice(0, 5000),
            results: links.filter(l => l.title && l.url.includes('http'))
          });
        })()
      `);

      if (!success) {
        return {
          ok: false,
          error: { message: error || "Extraction failed" },
        };
      }

      // Parse the extracted data
      const extracted = JSON.parse(result);

      // Try to validate against schema or return raw data
      try {
        const validated = schema.parse(extracted);
        return { ok: true, value: validated };
      } catch {
        // If schema validation fails, try to return what we have
        // The caller may need to handle partial data
        return { ok: true, value: extracted as T };
      }
    } catch (error: any) {
      return {
        ok: false,
        error: { message: error.message || "Extraction failed" },
      };
    }
  }

  /**
   * Click an element
   */
  async click(
    sessionId: string,
    selector: string,
  ): Promise<Result<void, { message: string }>> {
    try {
      const session = this.activeSessions.get(sessionId);
      if (!session) {
        return {
          ok: false,
          error: { message: `Session ${sessionId} not found` },
        };
      }

      const chrome = await this.getChromeService();
      const result = await chrome.click(selector);

      if (!result.success) {
        return {
          ok: false,
          error: { message: result.error || "Click failed" },
        };
      }

      return { ok: true, value: undefined };
    } catch (error: any) {
      return {
        ok: false,
        error: { message: error.message || "Click failed" },
      };
    }
  }

  /**
   * Type text into an element
   */
  async type(
    sessionId: string,
    selector: string,
    text: string,
    clear?: boolean,
  ): Promise<Result<void, { message: string }>> {
    try {
      const session = this.activeSessions.get(sessionId);
      if (!session) {
        return {
          ok: false,
          error: { message: `Session ${sessionId} not found` },
        };
      }

      const chrome = await this.getChromeService();
      const result = await chrome.type(selector, text, clear);

      if (!result.success) {
        return {
          ok: false,
          error: { message: result.error || "Type failed" },
        };
      }

      return { ok: true, value: undefined };
    } catch (error: any) {
      return {
        ok: false,
        error: { message: error.message || "Type failed" },
      };
    }
  }

  /**
   * Wait for an element
   */
  async wait(
    sessionId: string,
    selector: string,
    timeout?: number,
  ): Promise<Result<void, { message: string }>> {
    try {
      const session = this.activeSessions.get(sessionId);
      if (!session) {
        return {
          ok: false,
          error: { message: `Session ${sessionId} not found` },
        };
      }

      const chrome = await this.getChromeService();
      const result = await chrome.wait(selector, timeout);

      if (!result.success) {
        return {
          ok: false,
          error: { message: result.error || "Wait timed out" },
        };
      }

      return { ok: true, value: undefined };
    } catch (error: any) {
      return {
        ok: false,
        error: { message: error.message || "Wait failed" },
      };
    }
  }

  /**
   * Close a session
   */
  async closeSession(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return;
    }

    try {
      const chrome = await this.getChromeService();
      chrome.disconnect();
    } catch (error) {
      logger.warn(
        `[LocalBrowserService] Error disconnecting session ${sessionId}:`,
        error,
      );
    }

    this.activeSessions.delete(sessionId);
    logger.info(`[LocalBrowserService] Closed session ${sessionId}`);
  }

  /**
   * Get session info
   */
  getSession(sessionId: string): BrowserSession | undefined {
    return this.activeSessions.get(sessionId);
  }

  /**
   * Check if Chrome is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const chrome = await this.getChromeService();
      const result = await chrome.connect(this.port);
      return result.success;
    } catch {
      return false;
    }
  }
}

// Export singleton instance
export const localBrowserService = LocalBrowserService.getInstance();

// Backwards-compatible alias
export const BrowserbaseService = LocalBrowserService;
