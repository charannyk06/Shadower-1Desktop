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
 * Local Browser Automation Tools using Chrome DevTools Protocol (CDP)
 *
 * These tools connect to the user's EXISTING Chrome browser via CDP,
 * allowing access to all logged-in accounts and sessions.
 *
 * User must launch Chrome with: --remote-debugging-port=9222
 * Or the app will prompt them to do so.
 *
 * KEY TOOLS FOR AUTOMATION:
 * - browser_get_context: Get structured page context (NO screenshots, token-efficient)
 * - browser_fill_form: Fill multiple form fields at once
 * - browser_analyze_forms: Detect and analyze forms on the page
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

// ============================================================================
// CONTEXT-BASED TOOLS (No screenshots - token efficient)
// ============================================================================

/**
 * Get structured page context - THE PRIMARY TOOL FOR UNDERSTANDING PAGES
 *
 * This replaces screenshots with structured data:
 * - Interactive elements (buttons, links, inputs) with selectors
 * - Forms with field analysis
 * - Page structure (headings, landmarks)
 * - Visible text content
 *
 * Much more token-efficient than base64 images!
 */
export const browserGetContextTool = createTool({
  description: `Get structured page context instead of a screenshot. Returns:
- All interactive elements (buttons, links, inputs) with CSS selectors
- Forms with field types, labels, and current values
- Page structure (headings, navigation)
- Visible text content

This is the PRIMARY tool for understanding what's on a page. Use this BEFORE taking any action.
Each element has a 'ref' ID (like "btn-1", "field-3") and a 'selector' you can use with browser_click or browser_type.`,
  inputSchema: z.object({
    format: z
      .enum(["json", "text", "simplified"])
      .optional()
      .default("text")
      .describe(
        "Output format: 'text' for human-readable, 'json' for full structured data, 'simplified' for minimal context",
      ),
  }),
  execute: async ({ format }) => {
    try {
      // Execute the context extraction script
      const result = await callChromeIPC<{
        success: boolean;
        result?: PageContext;
        error?: string;
      }>("evaluate", { script: PAGE_CONTEXT_EXTRACTION_SCRIPT });

      if (!result.success || !result.result) {
        return {
          success: false,
          error: result.error || "Failed to extract page context",
        };
      }

      const context = result.result as PageContext;

      // Return in requested format
      if (format === "json") {
        return {
          success: true,
          context,
        };
      } else if (format === "simplified") {
        return {
          success: true,
          context: simplifyContext(context),
        };
      } else {
        // Text format - most token efficient for the model
        return {
          success: true,
          context: formatContextAsText(context),
        };
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
 * Analyze forms on the page - detailed form detection
 */
export const browserAnalyzeFormsTool = createTool({
  description: `Analyze all forms on the current page. Returns detailed information about:
- Form type (login, signup, search, or general)
- All fields with their types, labels, and current values
- Required fields
- Submit button location

Use this before filling forms to understand what fields need to be filled.`,
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const result = await callChromeIPC<{
        success: boolean;
        result?: PageContext;
        error?: string;
      }>("evaluate", { script: PAGE_CONTEXT_EXTRACTION_SCRIPT });

      if (!result.success || !result.result) {
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

      // Format forms in a readable way
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
- selector: CSS selector for the field (get this from browser_get_context or browser_analyze_forms)
- value: The value to fill

For checkboxes/radios, use "true" or "false" as values.
For select dropdowns, use the option value.

After filling, you may want to use browser_click on the submit button.`,
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
      const result = await callChromeIPC<{
        success: boolean;
        result?: { success: boolean; results: any[] };
        error?: string;
      }>("evaluate", { script });

      if (!result.success) {
        return {
          success: false,
          error: result.error || "Failed to fill form",
        };
      }

      const fillResult = result.result;
      const failedFields = fillResult?.results.filter((r) => !r.success) || [];

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

/**
 * Click an element by its reference ID (from browser_get_context)
 */
export const browserClickByRefTool = createTool({
  description: `Click an element using its reference ID from browser_get_context.
For example, if browser_get_context shows "[btn-1] button: Submit", you can click it with ref "btn-1".

This is a convenience wrapper - it finds the selector for the ref and clicks it.`,
  inputSchema: z.object({
    ref: z
      .string()
      .describe(
        "Reference ID from browser_get_context (e.g., 'btn-1', 'field-3')",
      ),
  }),
  execute: async ({ ref }) => {
    try {
      // First get current context to find the selector for this ref
      const contextResult = await callChromeIPC<{
        success: boolean;
        result?: PageContext;
        error?: string;
      }>("evaluate", { script: PAGE_CONTEXT_EXTRACTION_SCRIPT });

      if (!contextResult.success || !contextResult.result) {
        return {
          success: false,
          error: "Failed to get page context to find element",
        };
      }

      const context = contextResult.result as PageContext;

      // Find element by ref
      let selector: string | null = null;

      // Check interactive elements
      const element = context.elements.find((el) => el.ref === ref);
      if (element) {
        selector = element.selector;
      }

      // Check form fields
      if (!selector) {
        for (const form of context.forms) {
          const field = form.fields.find((f) => f.ref === ref);
          if (field) {
            selector = field.selector;
            break;
          }
          if (form.submitButton?.ref === ref) {
            selector = form.submitButton.selector;
            break;
          }
        }
      }

      if (!selector) {
        return {
          success: false,
          error: `Element with ref "${ref}" not found. Run browser_get_context to see available elements.`,
        };
      }

      // Click the element
      const clickResult = await callChromeIPC<{
        success: boolean;
        error?: string;
      }>("click", { selector });

      return {
        success: clickResult.success,
        message: clickResult.success
          ? `Clicked element [${ref}]`
          : clickResult.error,
        selector,
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
 * Type into an element by its reference ID (from browser_get_context)
 */
export const browserTypeByRefTool = createTool({
  description: `Type into an input field using its reference ID from browser_get_context.
For example, if browser_get_context shows "[field-1] text: Email", you can type into it with ref "field-1".

This is a convenience wrapper - it finds the selector for the ref and types into it.`,
  inputSchema: z.object({
    ref: z
      .string()
      .describe(
        "Reference ID from browser_get_context (e.g., 'field-1', 'inp-2')",
      ),
    text: z.string().describe("Text to type"),
    clear: z
      .boolean()
      .optional()
      .default(true)
      .describe("Clear the field before typing (default: true)"),
  }),
  execute: async ({ ref, text, clear }) => {
    try {
      // First get current context to find the selector for this ref
      const contextResult = await callChromeIPC<{
        success: boolean;
        result?: PageContext;
        error?: string;
      }>("evaluate", { script: PAGE_CONTEXT_EXTRACTION_SCRIPT });

      if (!contextResult.success || !contextResult.result) {
        return {
          success: false,
          error: "Failed to get page context to find element",
        };
      }

      const context = contextResult.result as PageContext;

      // Find element by ref
      let selector: string | null = null;

      // Check interactive elements
      const element = context.elements.find((el) => el.ref === ref);
      if (element) {
        selector = element.selector;
      }

      // Check form fields
      if (!selector) {
        for (const form of context.forms) {
          const field = form.fields.find((f) => f.ref === ref);
          if (field) {
            selector = field.selector;
            break;
          }
        }
      }

      if (!selector) {
        return {
          success: false,
          error: `Element with ref "${ref}" not found. Run browser_get_context to see available elements.`,
        };
      }

      // Type into the element
      const typeResult = await callChromeIPC<{
        success: boolean;
        error?: string;
      }>("type", { selector, text, clear });

      return {
        success: typeResult.success,
        message: typeResult.success
          ? `Typed into element [${ref}]`
          : typeResult.error,
        selector,
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
 * Submit a form
 */
export const browserSubmitFormTool = createTool({
  description: `Submit a form by clicking its submit button or pressing Enter.
Optionally waits for navigation or a specific element after submission.`,
  inputSchema: z.object({
    formRef: z
      .string()
      .optional()
      .describe(
        "Form reference ID from browser_analyze_forms. If not provided, submits the first form.",
      ),
    waitForNavigation: z
      .boolean()
      .optional()
      .default(true)
      .describe("Wait for page navigation after submit"),
    waitForSelector: z
      .string()
      .optional()
      .describe("CSS selector to wait for after submission"),
  }),
  execute: async ({ formRef, waitForNavigation, waitForSelector }) => {
    try {
      // Get page context to find the form
      const contextResult = await callChromeIPC<{
        success: boolean;
        result?: PageContext;
        error?: string;
      }>("evaluate", { script: PAGE_CONTEXT_EXTRACTION_SCRIPT });

      if (!contextResult.success || !contextResult.result) {
        return {
          success: false,
          error: "Failed to get page context",
        };
      }

      const context = contextResult.result as PageContext;

      if (context.forms.length === 0) {
        return {
          success: false,
          error: "No forms found on this page",
        };
      }

      // Find the target form
      const form = formRef
        ? context.forms.find((f) => f.ref === formRef)
        : context.forms[0];

      if (!form) {
        return {
          success: false,
          error: `Form with ref "${formRef}" not found`,
        };
      }

      // Try to click submit button, or press Enter on last field
      let submitResult: { success: boolean; error?: string };

      if (form.submitButton) {
        submitResult = await callChromeIPC<{
          success: boolean;
          error?: string;
        }>("click", { selector: form.submitButton.selector });
      } else {
        // Press Enter on the form or last field
        const lastField = form.fields[form.fields.length - 1];
        if (lastField) {
          await callChromeIPC("click", { selector: lastField.selector });
        }
        submitResult = await callChromeIPC<{
          success: boolean;
          error?: string;
        }>("pressKey", { key: "Enter" });
      }

      if (!submitResult.success) {
        return {
          success: false,
          error: submitResult.error || "Failed to submit form",
        };
      }

      // Wait for result
      if (waitForSelector) {
        const waitResult = await callChromeIPC<{
          success: boolean;
          error?: string;
        }>("wait", { selector: waitForSelector, timeout: 10000 });

        return {
          success: waitResult.success,
          message: waitResult.success
            ? "Form submitted and element found"
            : `Form submitted but element not found: ${waitResult.error}`,
        };
      } else if (waitForNavigation) {
        // Give some time for navigation
        await new Promise((resolve) => setTimeout(resolve, 2000));
        return {
          success: true,
          message: "Form submitted",
        };
      }

      return {
        success: true,
        message: "Form submitted",
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Submit failed",
      };
    }
  },
});

// Export all browser tools as a collection
// LEAN - only context-based tools, no legacy screenshot bloat
export const localBrowserTools = {
  // Connection & Tab Management
  browser_connect: browserConnectTool,
  browser_list_tabs: browserListTabsTool,
  browser_attach_tab: browserAttachTabTool,
  browser_new_tab: browserNewTabTool,
  browser_close_tab: browserCloseTabTool,

  // Navigation
  browser_navigate: browserNavigateTool,

  // === CONTEXT-BASED TOOLS (PRIMARY) ===
  browser_get_context: browserGetContextTool, // PRIMARY - no screenshots!
  browser_analyze_forms: browserAnalyzeFormsTool, // Form detection
  browser_fill_form: browserFillFormTool, // Fill multiple fields at once
  browser_click_ref: browserClickByRefTool, // Click by ref ID
  browser_type_ref: browserTypeByRefTool, // Type by ref ID
  browser_submit_form: browserSubmitFormTool, // Submit forms

  // Low-level interaction (when selectors are known)
  browser_click: browserClickTool,
  browser_type: browserTypeTool,
  browser_wait: browserWaitTool,
  browser_scroll: browserScrollTool,
  browser_press_key: browserPressKeyTool,
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
