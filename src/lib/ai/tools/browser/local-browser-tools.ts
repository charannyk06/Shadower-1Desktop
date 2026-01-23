import { tool as createTool } from "ai";
import { z } from "zod";
import {
  PAGE_CONTEXT_EXTRACTION_SCRIPT,
  createFormFillScript,
  formatContextAsText,
  simplifyContext,
  type PageContext,
} from "../../browser/page-context";

/**
 * Extract alternative URLs from a suggestion string
 */
function extractAlternativeUrls(suggestion: string): string[] {
  const urlRegex = /https?:\/\/[^\s\n)]+/g;
  const matches = suggestion.match(urlRegex);
  return matches ? [...new Set(matches)] : [];
}

/**
 * Local Browser Automation Tools using agent-browser
 *
 * These tools use agent-browser's BrowserManager for AI-optimized browser automation.
 * Key features:
 * - AI-optimized snapshots with element refs (@e1, @e2, etc.)
 * - Session management for multiple browser instances
 * - Works with both CSS selectors and refs
 *
 * KEY TOOLS FOR AUTOMATION:
 * - browser_get_snapshot: Get AI-optimized element tree with refs
 * - browser_get_context: Get structured page context (NO screenshots, token-efficient)
 * - browser_fill_form: Fill multiple form fields at once
 * - browser_analyze_forms: Detect and analyze forms on the page
 */

/**
 * Interface for browser service - used for type safety when interacting with
 * the EnhancedBrowserService from the main process
 *
 * CDP-ONLY MODE: Always connects to user's real Chrome browser via CDP.
 * This preserves cookies, sessions, and avoids bot detection entirely.
 */
export interface BrowserServiceInterface {
  createSession(options: {
    cdpPort?: number;
    executablePath?: string;
    viewport?: { width: number; height: number };
  }): Promise<{
    sessionId: string;
    url?: string;
    title?: string;
    stealth?: boolean; // Always false - not needed with real browser
    userBrowser: true; // Always true - CDP only
    cdpUrl?: string;
  }>;
  closeSession(sessionId?: string): Promise<void>;
  listSessions(): { id: string; createdAt: Date; isActive: boolean }[];
  switchSession(sessionId: string): void;
  navigate(
    url: string,
    options?: {
      waitUntil?: string;
      timeout?: number;
      retries?: number;
      sessionId?: string;
    }
  ): Promise<{
    url: string;
    title: string;
    captchaDetected?: boolean;
    captchaType?: string;
    blocked?: boolean;
    suggestion?: string;
  }>;
  goBack(sessionId?: string): Promise<{ url: string }>;
  goForward(sessionId?: string): Promise<{ url: string }>;
  reload(sessionId?: string): Promise<{ url: string }>;
  getSnapshot(options?: {
    interactive?: boolean;
    compact?: boolean;
    selector?: string;
    sessionId?: string;
  }): Promise<{ tree: string; stats?: Record<string, number> }>;
  executeAction(
    action: {
      type: string;
      selector?: string;
      value?: string;
      values?: string | string[]; // For select action
      text?: string;
      key?: string;
      delay?: number;
      direction?: string;
      amount?: number;
      fullPage?: boolean;
      path?: string;
    },
    options?: { sessionId?: string }
  ): Promise<{ data?: unknown }>;
  evaluate(script: string, options?: { sessionId?: string }): Promise<unknown>;
  wait(options: {
    selector?: string;
    state?: string;
    loadState?: string;
    timeout?: number;
    sessionId?: string;
  }): Promise<{ success: boolean }>;
  getContent(options?: { selector?: string; sessionId?: string }): Promise<string>;
  getUrl(sessionId?: string): Promise<string>;
  getTitle(sessionId?: string): Promise<string>;
  // Multi-tab support
  newTab(sessionId?: string, url?: string): Promise<{ index: number; total: number; url?: string }>;
  newWindow(sessionId?: string, options?: { viewport?: { width: number; height: number } }): Promise<{ index: number; total: number }>;
  switchTab(index: number, sessionId?: string): Promise<{ index: number; url: string; title: string }>;
  closeTab(index?: number, sessionId?: string): Promise<{ closed: number; remaining: number }>;
  listTabs(sessionId?: string): Promise<Array<{ index: number; url: string; title: string; active: boolean }>>;
  getActiveTabIndex(sessionId?: string): number;
}

/**
 * Browser Service reference for main process execution
 * This is set by calling setBrowserServiceInstance() from the main process
 */
let browserServiceInstance: BrowserServiceInterface | null = null;

/**
 * Set the browser service instance (called from main process)
 * This allows the browser tools to work in both main and renderer process contexts
 */
export function setBrowserServiceInstance(service: BrowserServiceInterface): void {
  browserServiceInstance = service;
}

/**
 * Check if running in Electron renderer at runtime
 */
function isRendererProcess(): boolean {
  return typeof window !== "undefined" && !!window.electronAPI?.browser;
}

/**
 * Check if running in Node.js/main process at runtime
 */
function isMainProcess(): boolean {
  return typeof process !== "undefined" && process.versions?.electron !== undefined && typeof window === "undefined";
}

/**
 * Get the browser service for main process execution
 */
function getBrowserServiceForMainProcess(): BrowserServiceInterface {
  if (browserServiceInstance) {
    return browserServiceInstance;
  }
  throw new Error(
    "Browser service not initialized. Call setBrowserServiceInstance() first from the main process."
  );
}

/**
 * Helper to call browser operations - works in both main process and renderer
 */
async function callBrowserAPI<T>(
  method: string,
  ...args: unknown[]
): Promise<T> {
  // Check if in renderer process (has window.electronAPI)
  if (isRendererProcess()) {
    // @ts-ignore - electronAPI is injected by preload
    const browserAPI = window.electronAPI.browser;
    if (!browserAPI || !browserAPI[method]) {
      throw new Error(
        `Browser method '${method}' not available in renderer. ` +
          "This may indicate a version mismatch between the renderer and main process."
      );
    }

    try {
      return await browserAPI[method](...args);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes("No browser session")) {
        throw new Error(
          "No browser session active. Call browser_create_session first to launch a browser."
        );
      }
      throw error;
    }
  }

  // Check if in main process (Node.js with Electron)
  if (isMainProcess()) {
    try {
      const service = await getBrowserServiceForMainProcess();

      // Map method names to service methods
      switch (method) {
        case "createSession":
          return await service.createSession(args[0] as Parameters<BrowserServiceInterface["createSession"]>[0]) as T;
        case "closeSession": {
          await service.closeSession(args[0] as string | undefined);
          return { success: true } as T;
        }
        case "listSessions":
          return service.listSessions() as T;
        case "switchSession":
          service.switchSession(args[0] as string);
          return { success: true } as T;
        case "navigate":
          return await service.navigate(args[0] as string, args[1] as Parameters<BrowserServiceInterface["navigate"]>[1]) as T;
        case "goBack":
          return await service.goBack(args[0] as string | undefined) as T;
        case "goForward":
          return await service.goForward(args[0] as string | undefined) as T;
        case "reload":
          return await service.reload(args[0] as string | undefined) as T;
        case "getSnapshot":
          return await service.getSnapshot(args[0] as Parameters<BrowserServiceInterface["getSnapshot"]>[0]) as T;
        case "click":
          return await service.executeAction({ type: "click", selector: args[0] as string }, args[1] as { sessionId?: string }) as T;
        case "fill":
          return await service.executeAction({ type: "fill", selector: args[0] as string, value: args[1] as string }, args[2] as { sessionId?: string }) as T;
        case "type":
          return await service.executeAction({ type: "type", selector: args[0] as string, text: args[1] as string, delay: (args[2] as { delay?: number })?.delay }, { sessionId: (args[2] as { sessionId?: string })?.sessionId }) as T;
        case "press":
          return await service.executeAction({ type: "press", key: args[0] as string, selector: (args[1] as { selector?: string })?.selector }, { sessionId: (args[1] as { sessionId?: string })?.sessionId }) as T;
        case "screenshot":
          return await service.executeAction({ type: "screenshot", fullPage: (args[0] as { fullPage?: boolean })?.fullPage, path: (args[0] as { path?: string })?.path }, { sessionId: (args[0] as { sessionId?: string })?.sessionId }) as T;
        case "scroll":
          return await service.executeAction({ type: "scroll", direction: (args[0] as { direction?: string })?.direction, amount: (args[0] as { amount?: number })?.amount, selector: (args[0] as { selector?: string })?.selector }, { sessionId: (args[0] as { sessionId?: string })?.sessionId }) as T;
        case "evaluate":
          return { result: await service.evaluate(args[0] as string, args[1] as { sessionId?: string }) } as T;
        case "wait":
          return await service.wait(args[0] as Parameters<BrowserServiceInterface["wait"]>[0]) as T;
        case "getContent":
          return { html: await service.getContent(args[0] as { selector?: string; sessionId?: string }) } as T;
        case "getUrl":
          return { url: await service.getUrl((args[0] as { sessionId?: string })?.sessionId) } as T;
        case "getTitle":
          return { title: await service.getTitle((args[0] as { sessionId?: string })?.sessionId) } as T;
        // Multi-tab support
        case "newTab": {
          const opts = args[0] as { url?: string; sessionId?: string } | undefined;
          return await service.newTab(opts?.sessionId, opts?.url) as T;
        }
        case "newWindow": {
          const opts = args[0] as { viewport?: { width: number; height: number }; sessionId?: string } | undefined;
          return await service.newWindow(opts?.sessionId, { viewport: opts?.viewport }) as T;
        }
        case "switchTab":
          return await service.switchTab(args[0] as number, args[1] as string | undefined) as T;
        case "closeTab": {
          const opts = args[0] as { index?: number; sessionId?: string } | undefined;
          return await service.closeTab(opts?.index, opts?.sessionId) as T;
        }
        case "listTabs":
          return await service.listTabs(args[0] as string | undefined) as T;
        case "getActiveTabIndex":
          return { index: service.getActiveTabIndex(args[0] as string | undefined) } as T;
        // Additional actions
        case "hover":
          return await service.executeAction({ type: "hover", selector: args[0] as string }, args[1] as { sessionId?: string }) as T;
        case "select":
          return await service.executeAction({ type: "select", selector: args[0] as string, values: args[1] as string | string[] }, args[2] as { sessionId?: string }) as T;
        case "check":
          return await service.executeAction({ type: "check", selector: args[0] as string }, args[1] as { sessionId?: string }) as T;
        case "uncheck":
          return await service.executeAction({ type: "uncheck", selector: args[0] as string }, args[1] as { sessionId?: string }) as T;
        default:
          throw new Error(`Unknown browser method: ${method}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes("No browser session") || errorMessage.includes("No active session")) {
        throw new Error(
          "No browser session active. Call browser_create_session first to launch a browser."
        );
      }
      throw error;
    }
  }

  // Not in a supported context
  throw new Error(
    "Browser tools require either the Electron renderer process (with electronAPI) " +
      "or the Electron main process. Current environment is not supported."
  );
}

/**
 * Create a browser session (CDP-ONLY MODE)
 *
 * Connects to the user's REAL Chrome browser via CDP (Chrome DevTools Protocol).
 * This preserves cookies, sessions, and completely avoids bot detection.
 *
 * If Chrome is not running, it will be launched with remote debugging enabled.
 * If Chrome is running without CDP, the user will be asked to close it first.
 */
export const browserCreateSessionTool = createTool({
  description:
    "Create a new browser session by connecting to the USER'S REAL CHROME BROWSER via CDP. " +
    "This preserves cookies, sessions, and history - completely avoiding bot detection! " +
    "No CAPTCHAs, no blocks from Google/LinkedIn/etc. " +
    "Chrome will be launched automatically if not running. " +
    "If Chrome is already running without debugging, close ALL Chrome windows first.",
  inputSchema: z.object({
    cdpPort: z
      .number()
      .optional()
      .default(9222)
      .describe("CDP port for Chrome remote debugging (default: 9222)"),
    viewport: z
      .object({
        width: z.number().default(1280),
        height: z.number().default(720),
      })
      .optional()
      .describe("Browser viewport dimensions"),
  }),
  execute: async ({ cdpPort, viewport }) => {
    try {
      const result = await callBrowserAPI<{
        sessionId?: string;
        url?: string;
        title?: string;
        stealth?: boolean;
        userBrowser: true;
        cdpUrl?: string;
        error?: string;
      }>("createSession", {
        cdpPort,
        viewport,
      });

      if (result.error || !result.sessionId) {
        return {
          success: false,
          error: result.error || "Failed to create browser session",
          hint:
            "Common fixes:\n" +
            "1. Close ALL Chrome windows and try again\n" +
            "2. Check if Chrome is installed\n" +
            `3. Manually start Chrome with: chrome --remote-debugging-port=${cdpPort || 9222}`,
        };
      }

      return {
        success: true,
        sessionId: result.sessionId,
        url: result.url,
        title: result.title,
        userBrowserMode: true,
        cdpUrl: result.cdpUrl,
        message:
          "Connected to USER'S REAL CHROME BROWSER via CDP. " +
          "All cookies, sessions, and history are preserved. " +
          "Bot detection is impossible since this is your actual browser! " +
          "Use browser_get_snapshot to see page elements with refs.",
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Session creation failed";

      return {
        success: false,
        error: errorMsg,
        hint:
          "To fix this:\n" +
          "1. Close ALL Chrome windows (check Task Manager/Activity Monitor)\n" +
          "2. Wait a few seconds\n" +
          "3. Try again - Chrome will launch automatically with debugging enabled",
      };
    }
  },
});

/**
 * Close a browser session
 */
export const browserCloseSessionTool = createTool({
  description: "Close a browser session and release its resources.",
  inputSchema: z.object({
    sessionId: z
      .string()
      .optional()
      .describe(
        "Session ID to close. If not provided, closes the active session.",
      ),
  }),
  execute: async ({ sessionId }) => {
    try {
      const result = await callBrowserAPI<{
        success?: boolean;
        error?: string;
      }>("closeSession", sessionId);

      return {
        success: result.success !== false,
        message: result.error || "Session closed",
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to close session",
      };
    }
  },
});

/**
 * List all active browser sessions
 */
export const browserListSessionsTool = createTool({
  description: "List all active browser sessions.",
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const sessions = await callBrowserAPI<
        Array<{ id: string; createdAt: Date; isActive: boolean }>
      >("listSessions");

      return {
        success: true,
        sessions,
        count: sessions.length,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to list sessions",
      };
    }
  },
});

/**
 * Switch to a different browser session
 */
export const browserSwitchSessionTool = createTool({
  description: "Switch to a different browser session. Use browser_list_sessions to see available sessions.",
  inputSchema: z.object({
    sessionId: z.string().describe("The session ID to switch to"),
  }),
  execute: async ({ sessionId }) => {
    try {
      const result = await callBrowserAPI<{
        success?: boolean;
        error?: string;
      }>("switchSession", sessionId);

      if (result.error) {
        return { success: false, error: result.error };
      }

      return {
        success: true,
        message: `Switched to session ${sessionId}`,
        activeSessionId: sessionId,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to switch session",
      };
    }
  },
});

/**
 * Navigate to a URL in the current tab
 */
export const browserNavigateTool = createTool({
  description: "Navigate to a URL in the browser with automatic retry on failure and CAPTCHA detection.",
  inputSchema: z.object({
    url: z.string().url().describe("The URL to navigate to"),
    waitUntil: z
      .enum(["load", "domcontentloaded", "networkidle"])
      .optional()
      .default("domcontentloaded")
      .describe("When to consider navigation complete. 'domcontentloaded' is recommended for reliability."),
    timeout: z
      .number()
      .optional()
      .default(30000)
      .describe("Navigation timeout in milliseconds (default: 30000)"),
    retries: z
      .number()
      .optional()
      .default(2)
      .describe("Number of retry attempts on navigation failure (default: 2)"),
  }),
  execute: async ({ url, waitUntil, timeout, retries }) => {
    try {
      const result = await callBrowserAPI<{
        url?: string;
        title?: string;
        captchaDetected?: boolean;
        captchaType?: string;
        blocked?: boolean;
        suggestion?: string;
        error?: string;
      }>("navigate", url, { waitUntil, timeout, retries });

      if (result.error) {
        return { success: false, error: result.error };
      }

      const response: Record<string, unknown> = {
        success: !result.blocked, // Mark as failed if blocked
        title: result.title,
        currentUrl: result.url,
        message: result.blocked ? `Navigation blocked by ${result.captchaType || "bot detection"}` : `Navigated to ${url}`,
      };

      // Report CAPTCHA/block detection with suggestions
      if (result.captchaDetected || result.blocked) {
        response.captchaDetected = result.captchaDetected;
        response.captchaType = result.captchaType;
        response.blocked = result.blocked;
        response.warning = `BLOCKED by ${result.captchaType || "bot detection"}. Page cannot be scraped.`;

        // Include suggestion for alternatives
        if (result.suggestion) {
          response.suggestion = result.suggestion;
          response.alternativeUrls = extractAlternativeUrls(result.suggestion);
        }
      }

      return response;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Navigation failed",
      };
    }
  },
});

/**
 * Get AI-optimized snapshot with element refs
 * This is THE KEY TOOL for understanding page structure
 */
export const browserGetSnapshotTool = createTool({
  description: `Get an AI-optimized snapshot of the page with element refs.

Returns a text tree of elements like:
- heading "Example Domain" [ref=e1] [level=1]
- paragraph: Some text content
- button "Submit" [ref=e2]
- textbox "Email" [ref=e3]

Use refs (@e1, @e2) or CSS selectors in subsequent actions.
This is the PRIMARY tool for understanding what's on a page.`,
  inputSchema: z.object({
    interactive: z
      .boolean()
      .optional()
      .default(false)
      .describe("Only include interactive elements (buttons, links, inputs)"),
    compact: z
      .boolean()
      .optional()
      .default(true)
      .describe("Remove structural elements without meaningful content"),
    selector: z
      .string()
      .optional()
      .describe("CSS selector to scope the snapshot to"),
  }),
  execute: async ({ interactive, compact, selector }) => {
    try {
      const result = await callBrowserAPI<{
        tree?: string;
        refs?: Record<string, { selector: string; role: string; name?: string }>;
        stats?: {
          lines: number;
          chars: number;
          refs: number;
          interactive: number;
        };
        error?: string;
      }>("getSnapshot", { interactive, compact, selector });

      if (result.error || !result.tree) {
        return {
          success: false,
          error: result.error || "Failed to get snapshot",
        };
      }

      return {
        success: true,
        tree: result.tree,
        stats: result.stats,
        hint: "Use refs like @e1, @e2 in click, fill, type actions for deterministic selection",
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Snapshot failed",
      };
    }
  },
});

/**
 * Take a screenshot of the current tab
 */
export const browserScreenshotTool = createTool({
  description:
    "Take a screenshot of the browser. Returns a base64-encoded image.",
  inputSchema: z.object({
    fullPage: z
      .boolean()
      .optional()
      .default(false)
      .describe("Whether to capture the full scrollable page"),
  }),
  execute: async ({ fullPage }) => {
    try {
      const result = await callBrowserAPI<{
        success?: boolean;
        data?: { base64?: string; path?: string };
        error?: string;
      }>("screenshot", { fullPage });

      if (result.error || !result.data?.base64) {
        return { success: false, error: result.error || "Screenshot failed" };
      }

      return {
        success: true,
        screenshot: `data:image/png;base64,${result.data.base64}`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Screenshot failed",
      };
    }
  },
});

/**
 * Click on an element
 */
export const browserClickTool = createTool({
  description:
    "Click on an element using a CSS selector or ref from snapshot (e.g., @e1).",
  inputSchema: z.object({
    selector: z
      .string()
      .describe("CSS selector or ref (e.g., @e1) for the element to click"),
  }),
  execute: async ({ selector }) => {
    try {
      const result = await callBrowserAPI<{
        success?: boolean;
        error?: string;
      }>("click", selector);

      if (result.error) {
        return { success: false, error: result.error };
      }

      return {
        success: true,
        message: `Clicked on ${selector}`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Click failed",
      };
    }
  },
});

/**
 * Fill an input field (clears and sets value)
 */
export const browserFillTool = createTool({
  description:
    "Fill an input field with a value (clears existing content first). Use ref (@e1) or CSS selector.",
  inputSchema: z.object({
    selector: z.string().describe("CSS selector or ref for the input element"),
    value: z.string().describe("Value to fill"),
  }),
  execute: async ({ selector, value }) => {
    try {
      const result = await callBrowserAPI<{
        success?: boolean;
        error?: string;
      }>("fill", selector, value);

      if (result.error) {
        return { success: false, error: result.error };
      }

      return {
        success: true,
        message: `Filled ${selector} with value`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Fill failed",
      };
    }
  },
});

/**
 * Type text into an element
 */
export const browserTypeTool = createTool({
  description:
    "Type text into an input field character by character (doesn't clear first). Use for natural typing.",
  inputSchema: z.object({
    selector: z.string().describe("CSS selector or ref for the input element"),
    text: z.string().describe("Text to type"),
    delay: z
      .number()
      .optional()
      .describe("Delay between key presses in milliseconds"),
  }),
  execute: async ({ selector, text, delay }) => {
    try {
      const result = await callBrowserAPI<{
        success?: boolean;
        error?: string;
      }>("type", selector, text, { delay });

      if (result.error) {
        return { success: false, error: result.error };
      }

      return {
        success: true,
        message: `Typed into ${selector}`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Type failed",
      };
    }
  },
});

/**
 * Press keyboard keys
 */
export const browserPressKeyTool = createTool({
  description:
    "Press a keyboard key (e.g., 'Enter', 'Tab', 'Escape', 'Control+A').",
  inputSchema: z.object({
    key: z.string().describe("Key to press (e.g., 'Enter', 'Tab')"),
    selector: z
      .string()
      .optional()
      .describe("Optional element to focus before pressing key"),
  }),
  execute: async ({ key, selector }) => {
    try {
      const result = await callBrowserAPI<{
        success?: boolean;
        error?: string;
      }>("press", key, { selector });

      if (result.error) {
        return { success: false, error: result.error };
      }

      return {
        success: true,
        message: `Pressed ${key}`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Key press failed",
      };
    }
  },
});

/**
 * Wait for an element or load state
 */
export const browserWaitTool = createTool({
  description: "Wait for an element to appear or for a load state.",
  inputSchema: z.object({
    selector: z.string().optional().describe("CSS selector to wait for"),
    state: z
      .enum(["visible", "hidden", "attached", "detached"])
      .optional()
      .default("visible")
      .describe("Element state to wait for"),
    loadState: z
      .enum(["load", "domcontentloaded", "networkidle"])
      .optional()
      .describe("Page load state to wait for (use instead of selector)"),
    timeout: z
      .number()
      .optional()
      .default(30000)
      .describe("Maximum time to wait in ms"),
  }),
  execute: async ({ selector, state, loadState, timeout }) => {
    try {
      const result = await callBrowserAPI<{
        success?: boolean;
        error?: string;
      }>("wait", { selector, state, loadState, timeout });

      if (result.error) {
        return { success: false, error: result.error };
      }

      return {
        success: true,
        message: selector ? `Element ${selector} is ${state}` : "Load complete",
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Wait failed",
      };
    }
  },
});

/**
 * Execute JavaScript in the page
 */
export const browserEvaluateTool = createTool({
  description:
    "Execute JavaScript code in the browser tab. Use for complex interactions not covered by other tools.",
  inputSchema: z.object({
    script: z.string().describe("JavaScript code to execute"),
  }),
  execute: async ({ script }) => {
    try {
      const result = await callBrowserAPI<{
        result?: unknown;
        error?: string;
      }>("evaluate", script);

      if (result.error) {
        return { success: false, error: result.error };
      }

      return {
        success: true,
        result: result.result,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Evaluate failed",
      };
    }
  },
});

/**
 * Scroll the page
 */
export const browserScrollTool = createTool({
  description: "Scroll the page up, down, or to a specific element.",
  inputSchema: z.object({
    direction: z
      .enum(["up", "down"])
      .optional()
      .describe("Direction to scroll"),
    amount: z
      .number()
      .optional()
      .default(500)
      .describe("Amount to scroll in pixels"),
    selector: z
      .string()
      .optional()
      .describe("CSS selector or ref to scroll element into view"),
  }),
  execute: async ({ direction, amount, selector }) => {
    try {
      const result = await callBrowserAPI<{
        success?: boolean;
        error?: string;
      }>("scroll", { direction, amount, selector });

      if (result.error) {
        return { success: false, error: result.error };
      }

      return {
        success: true,
        message: selector
          ? `Scrolled ${selector} into view`
          : `Scrolled ${direction || "down"}`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Scroll failed",
      };
    }
  },
});

/**
 * Get page HTML
 */
export const browserGetContentTool = createTool({
  description: "Get the HTML content of the page or a specific element.",
  inputSchema: z.object({
    selector: z
      .string()
      .optional()
      .describe(
        "CSS selector for specific element. If not provided, gets full page.",
      ),
  }),
  execute: async ({ selector }) => {
    try {
      const result = await callBrowserAPI<{
        html?: string;
        error?: string;
      }>("getContent", { selector });

      if (result.error) {
        return { success: false, error: result.error };
      }

      return {
        success: true,
        html: result.html,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Get content failed",
      };
    }
  },
});

/**
 * Get current URL
 */
export const browserGetUrlTool = createTool({
  description: "Get the current URL of the browser tab.",
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const result = await callBrowserAPI<{
        url?: string;
        error?: string;
      }>("getUrl");

      if (result.error) {
        return { success: false, error: result.error };
      }

      return {
        success: true,
        url: result.url,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Get URL failed",
      };
    }
  },
});

/**
 * Get page title
 */
export const browserGetTitleTool = createTool({
  description: "Get the title of the current page.",
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const result = await callBrowserAPI<{
        title?: string;
        error?: string;
      }>("getTitle");

      if (result.error) {
        return { success: false, error: result.error };
      }

      return {
        success: true,
        title: result.title,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Get title failed",
      };
    }
  },
});

/**
 * Navigate back
 */
export const browserGoBackTool = createTool({
  description: "Navigate back in browser history.",
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const result = await callBrowserAPI<{
        url?: string;
        error?: string;
      }>("goBack");

      if (result.error) {
        return { success: false, error: result.error };
      }

      return {
        success: true,
        url: result.url,
        message: "Navigated back",
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Go back failed",
      };
    }
  },
});

/**
 * Navigate forward
 */
export const browserGoForwardTool = createTool({
  description: "Navigate forward in browser history.",
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const result = await callBrowserAPI<{
        url?: string;
        error?: string;
      }>("goForward");

      if (result.error) {
        return { success: false, error: result.error };
      }

      return {
        success: true,
        url: result.url,
        message: "Navigated forward",
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Go forward failed",
      };
    }
  },
});

/**
 * Reload page
 */
export const browserReloadTool = createTool({
  description: "Reload the current page.",
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const result = await callBrowserAPI<{
        url?: string;
        error?: string;
      }>("reload");

      if (result.error) {
        return { success: false, error: result.error };
      }

      return {
        success: true,
        url: result.url,
        message: "Page reloaded",
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Reload failed",
      };
    }
  },
});

// ============================================================================
// MULTI-TAB TOOLS
// ============================================================================

/**
 * Open a new browser tab
 */
export const browserNewTabTool = createTool({
  description: "Open a new browser tab, optionally navigating to a URL. Returns the tab index.",
  inputSchema: z.object({
    url: z.string().url().optional().describe("Optional URL to navigate to in the new tab"),
  }),
  execute: async ({ url }) => {
    try {
      const result = await callBrowserAPI<{
        index?: number;
        total?: number;
        url?: string;
        error?: string;
      }>("newTab", { url });

      if (result.error) {
        return { success: false, error: result.error };
      }

      return {
        success: true,
        tabIndex: result.index,
        totalTabs: result.total,
        url: result.url || "about:blank",
        message: `Opened new tab ${(result.index || 0) + 1}/${result.total}${url ? ` at ${url}` : ""}`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to open new tab",
      };
    }
  },
});

/**
 * Open a new browser window
 */
export const browserNewWindowTool = createTool({
  description: "Open a new browser window. Useful for multi-window workflows.",
  inputSchema: z.object({
    viewport: z
      .object({
        width: z.number().default(1280),
        height: z.number().default(720),
      })
      .optional()
      .describe("Optional viewport size for the new window"),
  }),
  execute: async ({ viewport }) => {
    try {
      const result = await callBrowserAPI<{
        index?: number;
        total?: number;
        error?: string;
      }>("newWindow", { viewport });

      if (result.error) {
        return { success: false, error: result.error };
      }

      return {
        success: true,
        tabIndex: result.index,
        totalTabs: result.total,
        message: `Opened new window (tab ${(result.index || 0) + 1}/${result.total})`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to open new window",
      };
    }
  },
});

/**
 * Switch to a different browser tab
 */
export const browserSwitchTabTool = createTool({
  description: "Switch to a different browser tab by index. Use browser_list_tabs to see available tabs.",
  inputSchema: z.object({
    index: z.number().describe("Tab index to switch to (0-based)"),
  }),
  execute: async ({ index }) => {
    try {
      const result = await callBrowserAPI<{
        index?: number;
        url?: string;
        title?: string;
        error?: string;
      }>("switchTab", index);

      if (result.error) {
        return { success: false, error: result.error };
      }

      return {
        success: true,
        activeTabIndex: result.index,
        url: result.url,
        title: result.title,
        message: `Switched to tab ${(result.index || 0) + 1}: ${result.title}`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to switch tab",
      };
    }
  },
});

/**
 * Close a browser tab
 */
export const browserCloseTabTool = createTool({
  description: "Close a browser tab. If no index provided, closes the current tab.",
  inputSchema: z.object({
    index: z.number().optional().describe("Tab index to close. If not provided, closes active tab."),
  }),
  execute: async ({ index }) => {
    try {
      const result = await callBrowserAPI<{
        closed?: number;
        remaining?: number;
        error?: string;
      }>("closeTab", { index });

      if (result.error) {
        return { success: false, error: result.error };
      }

      return {
        success: true,
        closedTabIndex: result.closed,
        remainingTabs: result.remaining,
        message: `Closed tab, ${result.remaining} tab${result.remaining === 1 ? "" : "s"} remaining`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to close tab",
      };
    }
  },
});

/**
 * List all browser tabs
 */
export const browserListTabsTool = createTool({
  description: "List all open browser tabs with their URLs and titles.",
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const tabs = await callBrowserAPI<
        Array<{ index: number; url: string; title: string; active: boolean }>
      >("listTabs");

      if (!Array.isArray(tabs)) {
        return {
          success: false,
          error: "Failed to list tabs",
        };
      }

      return {
        success: true,
        tabs: tabs.map((tab) => ({
          index: tab.index,
          url: tab.url,
          title: tab.title || "(untitled)",
          active: tab.active,
        })),
        totalTabs: tabs.length,
        activeTabIndex: tabs.find((t) => t.active)?.index,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to list tabs",
      };
    }
  },
});

/**
 * Get active tab index
 */
export const browserGetActiveTabIndexTool = createTool({
  description: "Get the index of the currently active browser tab.",
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const result = await callBrowserAPI<{
        index?: number;
        error?: string;
      }>("getActiveTabIndex");

      if (result.error) {
        return { success: false, error: result.error };
      }

      return {
        success: true,
        activeTabIndex: result.index,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get active tab index",
      };
    }
  },
});

// ============================================================================
// ADDITIONAL ACTION TOOLS
// ============================================================================

/**
 * Hover over an element
 */
export const browserHoverTool = createTool({
  description: "Hover over an element to trigger hover states, tooltips, or dropdown menus.",
  inputSchema: z.object({
    selector: z.string().describe("CSS selector or ref (e.g., @e1) for the element to hover over"),
  }),
  execute: async ({ selector }) => {
    try {
      const result = await callBrowserAPI<{
        success?: boolean;
        error?: string;
      }>("hover", selector);

      if (result.error) {
        return { success: false, error: result.error };
      }

      return {
        success: true,
        message: `Hovered over ${selector}`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Hover failed",
      };
    }
  },
});

/**
 * Select options from a dropdown
 */
export const browserSelectTool = createTool({
  description: "Select one or more options from a dropdown/select element.",
  inputSchema: z.object({
    selector: z.string().describe("CSS selector or ref for the select element"),
    values: z
      .union([z.string(), z.array(z.string())])
      .describe("Value(s) to select. For multi-select, provide an array."),
  }),
  execute: async ({ selector, values }) => {
    try {
      const result = await callBrowserAPI<{
        success?: boolean;
        error?: string;
      }>("select", selector, values);

      if (result.error) {
        return { success: false, error: result.error };
      }

      const selectedValues = Array.isArray(values) ? values.join(", ") : values;
      return {
        success: true,
        message: `Selected "${selectedValues}" in ${selector}`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Select failed",
      };
    }
  },
});

/**
 * Check a checkbox or radio button
 */
export const browserCheckTool = createTool({
  description: "Check a checkbox or radio button.",
  inputSchema: z.object({
    selector: z.string().describe("CSS selector or ref for the checkbox/radio element"),
  }),
  execute: async ({ selector }) => {
    try {
      const result = await callBrowserAPI<{
        success?: boolean;
        error?: string;
      }>("check", selector);

      if (result.error) {
        return { success: false, error: result.error };
      }

      return {
        success: true,
        message: `Checked ${selector}`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Check failed",
      };
    }
  },
});

/**
 * Uncheck a checkbox
 */
export const browserUncheckTool = createTool({
  description: "Uncheck a checkbox.",
  inputSchema: z.object({
    selector: z.string().describe("CSS selector or ref for the checkbox element"),
  }),
  execute: async ({ selector }) => {
    try {
      const result = await callBrowserAPI<{
        success?: boolean;
        error?: string;
      }>("uncheck", selector);

      if (result.error) {
        return { success: false, error: result.error };
      }

      return {
        success: true,
        message: `Unchecked ${selector}`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Uncheck failed",
      };
    }
  },
});

// ============================================================================
// CONTEXT-BASED TOOLS (Legacy compat - uses evaluate for page context)
// ============================================================================

/**
 * Get structured page context (uses JS evaluation for compatibility)
 */
export const browserGetContextTool = createTool({
  description: `Get structured page context. Returns:
- All interactive elements (buttons, links, inputs) with CSS selectors
- Forms with field types, labels, and current values
- Page structure (headings, navigation)

This is an alternative to browser_get_snapshot that returns structured JSON.
Each element has a 'ref' ID (like "btn-1", "field-3") and a 'selector'.`,
  inputSchema: z.object({
    format: z
      .enum(["json", "text", "simplified"])
      .optional()
      .default("text")
      .describe(
        "Output format: 'text' for human-readable, 'json' for full data",
      ),
  }),
  execute: async ({ format }) => {
    try {
      const result = await callBrowserAPI<{
        result?: unknown;
        error?: string;
      }>("evaluate", PAGE_CONTEXT_EXTRACTION_SCRIPT);

      if (result.error || !result.result) {
        return {
          success: false,
          error: result.error || "Failed to extract page context",
        };
      }

      const context = result.result as PageContext;

      if (format === "json") {
        return { success: true, context };
      } else if (format === "simplified") {
        return { success: true, context: simplifyContext(context) };
      } else {
        return { success: true, context: formatContextAsText(context) };
      }
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to get page context",
      };
    }
  },
});

/**
 * Analyze forms on the page
 */
export const browserAnalyzeFormsTool = createTool({
  description: `Analyze all forms on the current page. Returns detailed information about:
- Form type (login, signup, search, or general)
- All fields with their types, labels, and current values
- Required fields
- Submit button location`,
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const result = await callBrowserAPI<{
        result?: unknown;
        error?: string;
      }>("evaluate", PAGE_CONTEXT_EXTRACTION_SCRIPT);

      if (result.error || !result.result) {
        return {
          success: false,
          error: result.error || "Failed to analyze forms",
        };
      }

      const context = result.result as PageContext;

      if (context.forms.length === 0) {
        return {
          success: true,
          message: "No forms found on this page",
          forms: [],
        };
      }

      const formSummaries = context.forms.map((form) => {
        const formType = form.isLoginForm
          ? "LOGIN"
          : form.isSignupForm
            ? "SIGNUP"
            : form.isSearchForm
              ? "SEARCH"
              : "GENERAL";

        return {
          ref: form.ref,
          type: formType,
          selector: form.selector,
          fieldCount: form.fields.length,
          fields: form.fields.map((f) => ({
            ref: f.ref,
            selector: f.selector,
            type: f.type,
            label: f.label || f.placeholder || f.name || "unlabeled",
            required: f.required,
            hasValue: !!f.value,
            options: f.options?.map((o) => o.text),
          })),
          submitButton: form.submitButton,
        };
      });

      return {
        success: true,
        formCount: context.forms.length,
        forms: formSummaries,
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to analyze forms",
      };
    }
  },
});

/**
 * Fill multiple form fields at once
 */
export const browserFillFormTool = createTool({
  description: `Fill multiple form fields at once. Much more efficient than typing into each field separately.

Provide an array of field-value pairs. Each field needs:
- selector: CSS selector for the field
- value: The value to fill

For checkboxes/radios, use "true" or "false" as values.
For select dropdowns, use the option value.`,
  inputSchema: z.object({
    fields: z
      .array(
        z.object({
          selector: z.string().describe("CSS selector for the field"),
          value: z.string().describe("Value to fill in the field"),
        }),
      )
      .describe("Array of field-value pairs to fill"),
  }),
  execute: async ({ fields }) => {
    try {
      const script = createFormFillScript(fields);
      const result = await callBrowserAPI<{
        result?: { success: boolean; results: Array<{ success: boolean; selector: string; error?: string }> };
        error?: string;
      }>("evaluate", script);

      if (result.error) {
        return { success: false, error: result.error };
      }

      const fillResult = result.result;
      const failedFields =
        fillResult?.results.filter((r) => !r.success) || [];

      if (failedFields.length > 0) {
        return {
          success: false,
          message: `Failed to fill ${failedFields.length} of ${fields.length} fields`,
          failedFields: failedFields.map((f) => ({
            selector: f.selector,
            error: f.error,
          })),
          successfulFields: fields.length - failedFields.length,
        };
      }

      return {
        success: true,
        message: `Successfully filled ${fields.length} fields`,
        filledFields: fields.length,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to fill form",
      };
    }
  },
});

// Export all browser tools as a collection
export const localBrowserTools = {
  // Session Management
  browser_create_session: browserCreateSessionTool,
  browser_close_session: browserCloseSessionTool,
  browser_list_sessions: browserListSessionsTool,
  browser_switch_session: browserSwitchSessionTool,

  // Navigation
  browser_navigate: browserNavigateTool,
  browser_go_back: browserGoBackTool,
  browser_go_forward: browserGoForwardTool,
  browser_reload: browserReloadTool,

  // === MULTI-TAB MANAGEMENT ===
  browser_new_tab: browserNewTabTool,
  browser_new_window: browserNewWindowTool,
  browser_switch_tab: browserSwitchTabTool,
  browser_close_tab: browserCloseTabTool,
  browser_list_tabs: browserListTabsTool,
  browser_get_active_tab_index: browserGetActiveTabIndexTool,

  // === AI-OPTIMIZED TOOLS (PRIMARY) ===
  browser_get_snapshot: browserGetSnapshotTool, // PRIMARY - ref-based element tree
  browser_get_context: browserGetContextTool, // Structured context extraction
  browser_analyze_forms: browserAnalyzeFormsTool,
  browser_fill_form: browserFillFormTool,

  // Element Interaction
  browser_click: browserClickTool,
  browser_fill: browserFillTool,
  browser_type: browserTypeTool,
  browser_press_key: browserPressKeyTool,
  browser_scroll: browserScrollTool,
  browser_wait: browserWaitTool,
  browser_hover: browserHoverTool,
  browser_select: browserSelectTool,
  browser_check: browserCheckTool,
  browser_uncheck: browserUncheckTool,

  // Page Info
  browser_screenshot: browserScreenshotTool,
  browser_get_content: browserGetContentTool,
  browser_get_url: browserGetUrlTool,
  browser_get_title: browserGetTitleTool,
  browser_evaluate: browserEvaluateTool,
};

// Create context-aware browser tools
export function createBrowserToolsWithContext(
  _userId: string,
  _threadId: string | null,
) {
  // For agent-browser, we don't need userId/threadId injection
  // The browser is managed via sessions
  return localBrowserTools;
}
