import { tool as createTool } from "ai";
import { z } from "zod";

/**
 * Local Browser Automation Tools using Chrome DevTools Protocol (CDP)
 *
 * These tools connect to the user's EXISTING Chrome browser via CDP,
 * allowing access to all logged-in accounts and sessions.
 *
 * User must launch Chrome with: --remote-debugging-port=9222
 * Or the app will prompt them to do so.
 */

// Check if running in Electron renderer
const isElectron = typeof window !== "undefined" && window.electronAPI;

/**
 * Helper to call Electron IPC for Chrome DevTools operations
 */
async function callChromeIPC<T>(method: string, ...args: any[]): Promise<T> {
  if (!isElectron) {
    throw new Error("Chrome tools are only available in the desktop app");
  }

  // @ts-ignore - electronAPI is injected by preload
  return window.electronAPI.chrome[method](...args);
}

/**
 * Connect to Chrome via DevTools Protocol
 */
export const browserConnectTool = createTool({
  description:
    "Connect to your existing Chrome browser via DevTools Protocol. Chrome must be running with --remote-debugging-port=9222. This gives access to all your logged-in sessions.",
  inputSchema: z.object({
    port: z
      .number()
      .optional()
      .default(9222)
      .describe("Chrome debugging port (default: 9222)"),
  }),
  execute: async ({ port }) => {
    try {
      const result = await callChromeIPC<{
        success: boolean;
        tabs?: any[];
        error?: string;
      }>("connect", { port });

      if (!result.success) {
        return {
          success: false,
          error: result.error,
          hint: "Launch Chrome with: /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222",
        };
      }

      return {
        success: true,
        tabs: result.tabs,
        message: `Connected to Chrome on port ${port}. Found ${result.tabs?.length || 0} tabs.`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Connection failed",
        hint: "Make sure Chrome is running with --remote-debugging-port=9222",
      };
    }
  },
});

/**
 * List all open Chrome tabs
 */
export const browserListTabsTool = createTool({
  description:
    "List all open tabs in your Chrome browser. Use this to find the tab you want to interact with.",
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const result = await callChromeIPC<{
        success: boolean;
        tabs?: any[];
        error?: string;
      }>("listTabs", {});

      return {
        success: result.success,
        tabs: result.tabs?.map((tab: any) => ({
          id: tab.id,
          title: tab.title,
          url: tab.url,
          type: tab.type,
        })),
        error: result.error,
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
 * Attach to a specific Chrome tab
 */
export const browserAttachTabTool = createTool({
  description:
    "Attach to a specific Chrome tab by its ID. Get tab IDs from browser_list_tabs.",
  inputSchema: z.object({
    tabId: z.string().describe("The tab ID to attach to"),
  }),
  execute: async ({ tabId }) => {
    try {
      const result = await callChromeIPC<{
        success: boolean;
        title?: string;
        url?: string;
        error?: string;
      }>("attachTab", { tabId });

      return {
        success: result.success,
        title: result.title,
        url: result.url,
        message: result.success
          ? `Attached to tab: ${result.title}`
          : result.error,
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to attach to tab",
      };
    }
  },
});

/**
 * Navigate to a URL in the current tab
 */
export const browserNavigateTool = createTool({
  description: "Navigate to a URL in the currently attached Chrome tab.",
  inputSchema: z.object({
    url: z.string().url().describe("The URL to navigate to"),
    waitUntil: z
      .enum(["load", "domcontentloaded", "networkIdle"])
      .optional()
      .default("domcontentloaded")
      .describe("When to consider navigation complete"),
  }),
  execute: async ({ url, waitUntil }) => {
    try {
      const result = await callChromeIPC<{
        success: boolean;
        title?: string;
        url?: string;
        error?: string;
      }>("navigate", { url, waitUntil });

      return {
        success: result.success,
        title: result.title,
        currentUrl: result.url,
        message: result.success ? `Navigated to ${url}` : result.error,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Navigation failed",
      };
    }
  },
});

/**
 * Take a screenshot of the current tab
 */
export const browserScreenshotTool = createTool({
  description:
    "Take a screenshot of the currently attached Chrome tab. Returns a base64-encoded image.",
  inputSchema: z.object({
    fullPage: z
      .boolean()
      .optional()
      .default(false)
      .describe("Whether to capture the full scrollable page"),
    format: z
      .enum(["png", "jpeg", "webp"])
      .optional()
      .default("png")
      .describe("Image format"),
    quality: z
      .number()
      .optional()
      .describe("Image quality (1-100, only for jpeg/webp)"),
  }),
  execute: async ({ fullPage, format, quality }) => {
    try {
      const result = await callChromeIPC<{
        success: boolean;
        screenshot?: string;
        error?: string;
      }>("screenshot", { fullPage, format, quality });

      if (!result.success) {
        return { success: false, error: result.error };
      }

      return {
        success: true,
        screenshot: `data:image/${format};base64,${result.screenshot}`,
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
  description: "Click on an element in the Chrome tab using a CSS selector.",
  inputSchema: z.object({
    selector: z.string().describe("CSS selector for the element to click"),
  }),
  execute: async ({ selector }) => {
    try {
      const result = await callChromeIPC<{ success: boolean; error?: string }>(
        "click",
        { selector },
      );

      return {
        success: result.success,
        message: result.success ? `Clicked on ${selector}` : result.error,
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
 * Type text into an element
 */
export const browserTypeTool = createTool({
  description:
    "Type text into an input field in Chrome. Can optionally clear the field first.",
  inputSchema: z.object({
    selector: z.string().describe("CSS selector for the input element"),
    text: z.string().describe("Text to type"),
    clear: z
      .boolean()
      .optional()
      .default(false)
      .describe("Clear the field before typing"),
  }),
  execute: async ({ selector, text, clear }) => {
    try {
      const result = await callChromeIPC<{ success: boolean; error?: string }>(
        "type",
        { selector, text, clear },
      );

      return {
        success: result.success,
        message: result.success ? `Typed into ${selector}` : result.error,
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
 * Extract text or attributes from elements
 */
export const browserExtractTool = createTool({
  description: "Extract text content or attributes from elements on the page.",
  inputSchema: z.object({
    selector: z.string().describe("CSS selector for elements to extract from"),
    attribute: z
      .string()
      .optional()
      .describe(
        "Attribute to extract (e.g., 'href'). If not provided, extracts text content.",
      ),
    all: z
      .boolean()
      .optional()
      .default(false)
      .describe("Extract from all matching elements"),
  }),
  execute: async ({ selector, attribute, all }) => {
    try {
      const result = await callChromeIPC<{
        success: boolean;
        data?: string | string[];
        error?: string;
      }>("extract", { selector, attribute, all });

      return {
        success: result.success,
        data: result.data,
        error: result.error,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Extract failed",
      };
    }
  },
});

/**
 * Wait for an element
 */
export const browserWaitTool = createTool({
  description: "Wait for an element to appear on the page.",
  inputSchema: z.object({
    selector: z.string().describe("CSS selector to wait for"),
    timeout: z
      .number()
      .optional()
      .default(30000)
      .describe("Maximum time to wait in ms"),
  }),
  execute: async ({ selector, timeout }) => {
    try {
      const result = await callChromeIPC<{ success: boolean; error?: string }>(
        "wait",
        { selector, timeout },
      );

      return {
        success: result.success,
        message: result.success ? `Element ${selector} found` : result.error,
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
    "Execute JavaScript code in the Chrome tab. Use for complex interactions not covered by other tools.",
  inputSchema: z.object({
    script: z.string().describe("JavaScript code to execute"),
  }),
  execute: async ({ script }) => {
    try {
      const result = await callChromeIPC<{
        success: boolean;
        result?: any;
        error?: string;
      }>("evaluate", { script });

      return {
        success: result.success,
        result: result.result,
        error: result.error,
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
      .describe("CSS selector to scroll element into view"),
  }),
  execute: async ({ direction, amount, selector }) => {
    try {
      const result = await callChromeIPC<{ success: boolean; error?: string }>(
        "scroll",
        { direction, amount, selector },
      );

      return {
        success: result.success,
        message: result.success ? "Scrolled successfully" : result.error,
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
export const browserGetHtmlTool = createTool({
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
      const result = await callChromeIPC<{
        success: boolean;
        html?: string;
        error?: string;
      }>("getHtml", { selector });

      return {
        success: result.success,
        html: result.html,
        error: result.error,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Get HTML failed",
      };
    }
  },
});

/**
 * Press keyboard keys
 */
export const browserPressKeyTool = createTool({
  description:
    "Press a keyboard key or key combination (e.g., 'Enter', 'Tab', 'Control+A').",
  inputSchema: z.object({
    key: z.string().describe("Key or key combination to press"),
  }),
  execute: async ({ key }) => {
    try {
      const result = await callChromeIPC<{ success: boolean; error?: string }>(
        "pressKey",
        { key },
      );

      return {
        success: result.success,
        message: result.success ? `Pressed ${key}` : result.error,
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
 * Open a new tab
 */
export const browserNewTabTool = createTool({
  description: "Open a new Chrome tab with an optional URL.",
  inputSchema: z.object({
    url: z.string().url().optional().describe("URL to open in the new tab"),
  }),
  execute: async ({ url }) => {
    try {
      const result = await callChromeIPC<{
        success: boolean;
        tabId?: string;
        error?: string;
      }>("newTab", { url });

      return {
        success: result.success,
        tabId: result.tabId,
        message: result.success ? "New tab opened" : result.error,
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to open new tab",
      };
    }
  },
});

/**
 * Close the current tab
 */
export const browserCloseTabTool = createTool({
  description: "Close the currently attached Chrome tab.",
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const result = await callChromeIPC<{ success: boolean; error?: string }>(
        "closeTab",
        {},
      );

      return {
        success: result.success,
        message: result.success ? "Tab closed" : result.error,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to close tab",
      };
    }
  },
});

// Export all browser tools as a collection
export const localBrowserTools = {
  browser_connect: browserConnectTool,
  browser_list_tabs: browserListTabsTool,
  browser_attach_tab: browserAttachTabTool,
  browser_navigate: browserNavigateTool,
  browser_screenshot: browserScreenshotTool,
  browser_click: browserClickTool,
  browser_type: browserTypeTool,
  browser_extract: browserExtractTool,
  browser_wait: browserWaitTool,
  browser_evaluate: browserEvaluateTool,
  browser_scroll: browserScrollTool,
  browser_get_html: browserGetHtmlTool,
  browser_press_key: browserPressKeyTool,
  browser_new_tab: browserNewTabTool,
  browser_close_tab: browserCloseTabTool,
  // Backwards compatibility aliases for tool-kit
  browser_act: browserClickTool,
  browser_observe: browserGetHtmlTool,
  browser_stealth: browserConnectTool,
  browser_close: browserCloseTabTool,
};

// Backwards compatibility aliases
export const browserbaseTools = {
  browser_navigate: browserNavigateTool,
  browser_act: browserClickTool,
  browser_observe: browserGetHtmlTool,
  browser_extract: browserExtractTool,
  browser_screenshot: browserScreenshotTool,
  browser_wait: browserWaitTool,
  browser_stealth: browserConnectTool, // Connect is similar to stealth mode
  browser_close: browserCloseTabTool,
};

// Create context-aware browser tools (simplified for local - no cloud session needed)
export function createBrowserToolsWithContext(
  _userId: string,
  _threadId: string | null,
) {
  // For local Chrome DevTools, we don't need userId/threadId injection
  // The browser is the user's own Chrome instance
  return localBrowserTools;
}
