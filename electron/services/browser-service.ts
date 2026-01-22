/**
 * Enhanced Browser Service using agent-browser's BrowserManager
 *
 * Provides AI-optimized browser automation with:
 * - Snapshot/ref system for deterministic element selection
 * - CDP connection support (for existing Chrome instances)
 * - Session management
 * - Streaming capability
 */

import { BrowserManager } from "agent-browser/dist/browser.js";
import type { RefMap } from "agent-browser/dist/snapshot.js";
import log from "electron-log/main";

// Session tracking
interface BrowserSession {
  id: string;
  manager: BrowserManager;
  createdAt: Date;
}

// Launch options
export interface LaunchOptions {
  /** Run in headless mode (default: false for visibility) */
  headless?: boolean;
  /** Custom Chrome executable path */
  executablePath?: string;
  /** Connect to existing browser via CDP port */
  cdpPort?: number;
  /** Connect to existing browser via CDP WebSocket URL */
  cdpUrl?: string;
  /** Viewport dimensions */
  viewport?: { width: number; height: number };
  /** User agent override */
  userAgent?: string;
  /** Custom args to pass to browser */
  args?: string[];
}

// Snapshot options
export interface SnapshotOptions {
  /** Only include interactive elements (buttons, links, inputs) */
  interactive?: boolean;
  /** Maximum depth of tree to include */
  maxDepth?: number;
  /** Remove structural elements without meaningful content */
  compact?: boolean;
  /** CSS selector to scope the snapshot */
  selector?: string;
}

// Action types
export type BrowserAction =
  | {
      type: "click";
      selector: string;
      button?: "left" | "right";
      clickCount?: number;
    }
  | { type: "fill"; selector: string; value: string }
  | { type: "type"; selector: string; text: string; delay?: number }
  | { type: "press"; key: string; selector?: string }
  | { type: "hover"; selector: string }
  | { type: "select"; selector: string; values: string | string[] }
  | { type: "check"; selector: string }
  | { type: "uncheck"; selector: string }
  | { type: "screenshot"; fullPage?: boolean; path?: string }
  | {
      type: "scroll";
      direction?: "up" | "down";
      amount?: number;
      selector?: string;
    };

/**
 * Enhanced Browser Service Singleton
 */
export class EnhancedBrowserService {
  private static instance: EnhancedBrowserService;
  private sessions: Map<string, BrowserSession> = new Map();
  private activeSessionId: string | null = null;

  static getInstance(): EnhancedBrowserService {
    if (!EnhancedBrowserService.instance) {
      EnhancedBrowserService.instance = new EnhancedBrowserService();
    }
    return EnhancedBrowserService.instance;
  }

  /**
   * Create a new browser session
   */
  async createSession(options: LaunchOptions = {}): Promise<{
    sessionId: string;
    url?: string;
    title?: string;
  }> {
    const manager = new BrowserManager();

    try {
      // Launch or connect to browser
      // Note: cdpUrl is handled via cdpPort in agent-browser
      await manager.launch({
        headless: options.headless ?? false,
        executablePath: options.executablePath,
        cdpPort: options.cdpPort,
        viewport: options.viewport ?? { width: 1280, height: 720 },
        userAgent: options.userAgent,
        args: options.args,
      } as any);

      const sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const session: BrowserSession = {
        id: sessionId,
        manager,
        createdAt: new Date(),
      };

      this.sessions.set(sessionId, session);
      this.activeSessionId = sessionId;

      // Get current page info
      const page = manager.getPage();
      const url = page.url();
      const title = await page.title().catch(() => "");

      log.info(`[Browser] Session created: ${sessionId}`);

      return { sessionId, url, title };
    } catch (error) {
      await manager.close().catch(() => {});
      throw error;
    }
  }

  /**
   * Get a session by ID (or active session if not specified)
   */
  private getSession(sessionId?: string): BrowserSession {
    const id = sessionId ?? this.activeSessionId;
    if (!id) {
      throw new Error("No browser session active. Call createSession first.");
    }

    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(`Session not found: ${id}`);
    }

    return session;
  }

  /**
   * Navigate to a URL
   */
  async navigate(
    url: string,
    options?: {
      waitUntil?: "load" | "domcontentloaded" | "networkidle";
      sessionId?: string;
    }
  ): Promise<{ url: string; title: string }> {
    const session = this.getSession(options?.sessionId);
    const page = session.manager.getPage();

    await page.goto(url, {
      waitUntil: options?.waitUntil ?? "load",
    });

    return {
      url: page.url(),
      title: await page.title(),
    };
  }

  /**
   * Get AI-optimized snapshot with element refs
   *
   * Example output:
   * ```
   * - heading "Example Domain" [ref=e1] [level=1]
   * - paragraph: Some text content
   * - button "Submit" [ref=e2]
   * - textbox "Email" [ref=e3]
   * ```
   *
   * Use refs with click, fill, etc: `click('@e2')` or `fill('@e3', 'test@email.com')`
   */
  async getSnapshot(options?: SnapshotOptions & { sessionId?: string }): Promise<{
    tree: string;
    refs: RefMap;
    stats: { lines: number; chars: number; refs: number; interactive: number };
  }> {
    const session = this.getSession(options?.sessionId);
    const snapshot = await session.manager.getSnapshot({
      interactive: options?.interactive,
      maxDepth: options?.maxDepth,
      compact: options?.compact,
      selector: options?.selector,
    });

    // Calculate stats
    const lines = snapshot.tree.split("\n").length;
    const chars = snapshot.tree.length;
    const refCount = Object.keys(snapshot.refs).length;
    const interactive = Object.values(snapshot.refs).filter((r) =>
      ["button", "link", "textbox", "checkbox", "radio", "combobox"].includes(r.role)
    ).length;

    return {
      tree: snapshot.tree,
      refs: snapshot.refs,
      stats: { lines, chars, refs: refCount, interactive },
    };
  }

  /**
   * Execute a browser action
   * Supports both refs (@e1) and CSS selectors
   */
  async executeAction(
    action: BrowserAction,
    options?: { sessionId?: string }
  ): Promise<{ success: boolean; data?: unknown }> {
    const session = this.getSession(options?.sessionId);
    const manager = session.manager;

    try {
      switch (action.type) {
        case "click": {
          const locator = manager.getLocator(action.selector);
          await locator.click({
            button: action.button,
            clickCount: action.clickCount,
          });
          return { success: true };
        }

        case "fill": {
          const locator = manager.getLocator(action.selector);
          await locator.fill(action.value);
          return { success: true };
        }

        case "type": {
          const locator = manager.getLocator(action.selector);
          await locator.pressSequentially(action.text, { delay: action.delay });
          return { success: true };
        }

        case "press": {
          const page = manager.getPage();
          if (action.selector) {
            await page.press(action.selector, action.key);
          } else {
            await page.keyboard.press(action.key);
          }
          return { success: true };
        }

        case "hover": {
          const locator = manager.getLocator(action.selector);
          await locator.hover();
          return { success: true };
        }

        case "select": {
          const locator = manager.getLocator(action.selector);
          const values = Array.isArray(action.values)
            ? action.values
            : [action.values];
          await locator.selectOption(values);
          return { success: true, data: { selected: values } };
        }

        case "check": {
          const locator = manager.getLocator(action.selector);
          await locator.check();
          return { success: true };
        }

        case "uncheck": {
          const locator = manager.getLocator(action.selector);
          await locator.uncheck();
          return { success: true };
        }

        case "screenshot": {
          const page = manager.getPage();
          const buffer = await page.screenshot({
            fullPage: action.fullPage,
            path: action.path,
          });
          return {
            success: true,
            data: action.path
              ? { path: action.path }
              : { base64: buffer.toString("base64") },
          };
        }

        case "scroll": {
          const page = manager.getPage();
          if (action.selector) {
            await page.locator(action.selector).scrollIntoViewIfNeeded();
          } else {
            const amount = action.amount ?? 500;
            const delta = action.direction === "up" ? -amount : amount;
            await page.evaluate(`window.scrollBy(0, ${delta})`);
          }
          return { success: true };
        }

        default:
          throw new Error(`Unknown action type: ${(action as BrowserAction).type}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // Convert to AI-friendly error messages
      if (message.includes("strict mode violation")) {
        throw new Error(
          `Selector "${(action as { selector?: string }).selector}" matched multiple elements. ` +
            `Run 'getSnapshot()' to get updated refs.`
        );
      }
      if (message.includes("intercepts pointer events")) {
        throw new Error(
          `Element is blocked by another element (likely a modal or overlay). ` +
            `Try dismissing any modals/cookie banners first.`
        );
      }
      if (message.includes("waiting for") || message.includes("Timeout")) {
        throw new Error(
          `Element "${(action as { selector?: string }).selector}" not found. ` +
            `Run 'getSnapshot()' to see current page elements.`
        );
      }

      throw error;
    }
  }

  /**
   * Evaluate JavaScript in the page context
   */
  async evaluate(
    script: string,
    options?: { sessionId?: string }
  ): Promise<unknown> {
    const session = this.getSession(options?.sessionId);
    const page = session.manager.getPage();
    return page.evaluate(script);
  }

  /**
   * Wait for element or load state
   */
  async wait(options: {
    selector?: string;
    state?: "visible" | "hidden" | "attached" | "detached";
    timeout?: number;
    loadState?: "load" | "domcontentloaded" | "networkidle";
    sessionId?: string;
  }): Promise<{ success: boolean }> {
    const session = this.getSession(options.sessionId);
    const page = session.manager.getPage();

    if (options.selector) {
      await page.waitForSelector(options.selector, {
        state: options.state ?? "visible",
        timeout: options.timeout,
      });
    } else if (options.loadState) {
      await page.waitForLoadState(options.loadState);
    } else {
      await page.waitForLoadState("load");
    }

    return { success: true };
  }

  /**
   * Get page content (HTML)
   */
  async getContent(options?: {
    selector?: string;
    sessionId?: string;
  }): Promise<string> {
    const session = this.getSession(options?.sessionId);
    const page = session.manager.getPage();

    if (options?.selector) {
      return page.locator(options.selector).innerHTML();
    }
    return page.content();
  }

  /**
   * Get current URL
   */
  async getUrl(sessionId?: string): Promise<string> {
    const session = this.getSession(sessionId);
    return session.manager.getPage().url();
  }

  /**
   * Get page title
   */
  async getTitle(sessionId?: string): Promise<string> {
    const session = this.getSession(sessionId);
    return session.manager.getPage().title();
  }

  /**
   * Go back in history
   */
  async goBack(sessionId?: string): Promise<{ url: string }> {
    const session = this.getSession(sessionId);
    const page = session.manager.getPage();
    await page.goBack();
    return { url: page.url() };
  }

  /**
   * Go forward in history
   */
  async goForward(sessionId?: string): Promise<{ url: string }> {
    const session = this.getSession(sessionId);
    const page = session.manager.getPage();
    await page.goForward();
    return { url: page.url() };
  }

  /**
   * Reload page
   */
  async reload(sessionId?: string): Promise<{ url: string }> {
    const session = this.getSession(sessionId);
    const page = session.manager.getPage();
    await page.reload();
    return { url: page.url() };
  }

  /**
   * List all active sessions
   */
  listSessions(): Array<{ id: string; createdAt: Date; isActive: boolean }> {
    return Array.from(this.sessions.entries()).map(([id, session]) => ({
      id,
      createdAt: session.createdAt,
      isActive: id === this.activeSessionId,
    }));
  }

  /**
   * Switch to a different session
   */
  switchSession(sessionId: string): void {
    if (!this.sessions.has(sessionId)) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    this.activeSessionId = sessionId;
  }

  /**
   * Close a session
   */
  async closeSession(sessionId?: string): Promise<void> {
    const id = sessionId ?? this.activeSessionId;
    if (!id) return;

    const session = this.sessions.get(id);
    if (session) {
      await session.manager.close();
      this.sessions.delete(id);
      log.info(`[Browser] Session closed: ${id}`);

      if (this.activeSessionId === id) {
        // Switch to another session if available
        const remaining = Array.from(this.sessions.keys());
        this.activeSessionId = remaining.length > 0 ? remaining[0] : null;
      }
    }
  }

  /**
   * Close all sessions
   */
  async closeAllSessions(): Promise<void> {
    for (const [id, session] of this.sessions) {
      await session.manager.close().catch(() => {});
      log.info(`[Browser] Session closed: ${id}`);
    }
    this.sessions.clear();
    this.activeSessionId = null;
  }
}

// Export singleton instance getter
export const getBrowserService = () => EnhancedBrowserService.getInstance();
