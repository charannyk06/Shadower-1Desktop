import { type Tool, tool as createTool } from "ai";
import type { UIMessageStreamWriter } from "ai";
import { colorize } from "consola/utils";
import globalLogger from "logger";
import { z } from "zod";

const logger = globalLogger.withDefaults({
  message: colorize("magenta", "[Web Automation Agent] "),
});

/**
 * Web automation action
 */
export interface WebAction {
  type:
    | "navigate"
    | "click"
    | "type"
    | "fill"
    | "extract"
    | "screenshot"
    | "wait"
    | "scroll"
    | "evaluate"
    | "press"
    | "snapshot";
  instruction?: string;
  url?: string;
  selector?: string;
  text?: string;
  value?: string;
  script?: string;
  waitFor?: number | string;
  direction?: "up" | "down";
  key?: string;
}

/**
 * Action result
 */
export interface WebActionResult {
  success: boolean;
  action: WebAction;
  result?: unknown;
  screenshot?: string;
  error?: string;
}

/**
 * Automation flow result
 */
export interface AutomationResult {
  success: boolean;
  task: string;
  actions: WebActionResult[];
  extractedData?: unknown;
  finalScreenshot?: string;
}

// Check if running in Electron with browser API
const isElectron =
  typeof window !== "undefined" &&
  window.electronAPI &&
  window.electronAPI.browser;

/**
 * Helper to call Browser IPC (agent-browser powered)
 */
async function callBrowserAPI<T>(
  method: keyof typeof window.electronAPI.browser,
  ...args: unknown[]
): Promise<T> {
  if (!isElectron) {
    throw new Error("Web automation is only available in the desktop app");
  }
  const browserAPI = window.electronAPI.browser as unknown as Record<
    string,
    (...args: unknown[]) => Promise<T>
  >;
  if (!browserAPI[method]) {
    throw new Error(`Browser method ${method} not available`);
  }
  return browserAPI[method](...args);
}

/**
 * Web Automation Agent
 *
 * Sophisticated web automation using agent-browser's BrowserManager
 * with AI-optimized snapshots and ref-based element selection.
 */
export class WebAutomationAgent {
  private dataStream?: UIMessageStreamWriter;
  private activeSessionId?: string;

  constructor(dataStream?: UIMessageStreamWriter) {
    this.dataStream = dataStream;
  }

  /**
   * Emit progress to the UI
   */
  private emitProgress(
    stage: string,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    logger.info(`[${stage}] ${message}`);
    if (this.dataStream) {
      this.dataStream.write({
        type: "data-web-automation-progress",
        data: {
          stage,
          message,
          timestamp: new Date().toISOString(),
          sessionId: this.activeSessionId,
          ...data,
        },
      });
    }
  }

  /**
   * Create a browser session using agent-browser
   */
  async createSession(
    _userId: string,
    _threadId?: string,
    options?: {
      headless?: boolean;
      cdpPort?: number;
      cdpUrl?: string;
      viewport?: { width: number; height: number };
    },
  ): Promise<string> {
    this.emitProgress("setup", "Creating browser session...");

    const result = await callBrowserAPI<{
      sessionId?: string;
      url?: string;
      title?: string;
      error?: string;
    }>("createSession", options);

    if (result.error || !result.sessionId) {
      throw new Error(result.error || "Failed to create browser session");
    }

    this.activeSessionId = result.sessionId;

    this.emitProgress("setup", "Browser session created", {
      sessionId: this.activeSessionId,
      url: result.url,
      title: result.title,
    });

    return this.activeSessionId;
  }

  /**
   * Get AI-optimized snapshot of the page
   * Returns element tree with refs like @e1, @e2 for deterministic selection
   */
  async getSnapshot(options?: {
    interactive?: boolean;
    compact?: boolean;
    selector?: string;
  }): Promise<{
    tree: string;
    refs: Record<string, { selector: string; role: string; name?: string }>;
    stats: { lines: number; chars: number; refs: number; interactive: number };
  }> {
    this.emitProgress("snapshot", "Getting page snapshot...");

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
    }>("getSnapshot", { ...options, sessionId: this.activeSessionId });

    if (result.error || !result.tree) {
      throw new Error(result.error || "Failed to get snapshot");
    }

    this.emitProgress("snapshot", "Snapshot captured", {
      refs: result.stats?.refs,
      interactive: result.stats?.interactive,
    });

    return {
      tree: result.tree,
      refs: result.refs || {},
      stats: result.stats || { lines: 0, chars: 0, refs: 0, interactive: 0 },
    };
  }

  /**
   * Execute a single web action
   */
  async executeAction(
    _sessionId: string,
    action: WebAction,
  ): Promise<WebActionResult> {
    this.emitProgress("executing", `Performing ${action.type} action...`, {
      action: { type: action.type, instruction: action.instruction },
    });

    try {
      let result: unknown;
      let screenshot: string | undefined;

      switch (action.type) {
        case "navigate":
          if (action.url) {
            const navResult = await callBrowserAPI<{
              url?: string;
              title?: string;
              error?: string;
            }>("navigate", action.url, {
              sessionId: this.activeSessionId,
            });
            if (navResult.error) {
              throw new Error(navResult.error);
            }
            result = { navigatedTo: navResult.url, title: navResult.title };
          }
          break;

        case "click":
          if (action.selector) {
            const clickResult = await callBrowserAPI<{
              success?: boolean;
              error?: string;
            }>("click", action.selector, {
              sessionId: this.activeSessionId,
            });
            if (clickResult.error) {
              throw new Error(clickResult.error);
            }
            result = { clicked: action.selector };
          }
          break;

        case "fill":
          if (action.selector && (action.value || action.text)) {
            const fillResult = await callBrowserAPI<{
              success?: boolean;
              error?: string;
            }>("fill", action.selector, action.value || action.text, {
              sessionId: this.activeSessionId,
            });
            if (fillResult.error) {
              throw new Error(fillResult.error);
            }
            result = {
              filled: action.value || action.text,
              into: action.selector,
            };
          }
          break;

        case "type":
          if (action.selector && action.text) {
            const typeResult = await callBrowserAPI<{
              success?: boolean;
              error?: string;
            }>("type", action.selector, action.text, {
              sessionId: this.activeSessionId,
            });
            if (typeResult.error) {
              throw new Error(typeResult.error);
            }
            result = { typed: action.text, into: action.selector };
          }
          break;

        case "press":
          if (action.key) {
            const pressResult = await callBrowserAPI<{
              success?: boolean;
              error?: string;
            }>("press", action.key, {
              selector: action.selector,
              sessionId: this.activeSessionId,
            });
            if (pressResult.error) {
              throw new Error(pressResult.error);
            }
            result = { pressed: action.key };
          }
          break;

        case "extract":
          if (action.selector) {
            const contentResult = await callBrowserAPI<{
              html?: string;
              error?: string;
            }>("getContent", {
              selector: action.selector,
              sessionId: this.activeSessionId,
            });
            if (contentResult.error) {
              throw new Error(contentResult.error);
            }
            result = contentResult.html;
          }
          break;

        case "snapshot":
          const snapshotResult = await this.getSnapshot({
            interactive: action.instruction === "interactive",
            compact: true,
          });
          result = {
            tree: snapshotResult.tree,
            stats: snapshotResult.stats,
          };
          break;

        case "screenshot":
          const screenshotResult = await callBrowserAPI<{
            success?: boolean;
            data?: { base64?: string; path?: string };
            error?: string;
          }>("screenshot", {
            fullPage: action.instruction === "full",
            sessionId: this.activeSessionId,
          });
          if (screenshotResult.error) {
            result = { captured: false, error: screenshotResult.error };
          } else if (screenshotResult.data?.base64) {
            screenshot = screenshotResult.data.base64;
            result = { captured: true };
          }
          break;

        case "wait":
          if (typeof action.waitFor === "number") {
            await new Promise((resolve) =>
              setTimeout(resolve, action.waitFor as number),
            );
            result = { waited: action.waitFor };
          } else if (typeof action.waitFor === "string") {
            const waitResult = await callBrowserAPI<{
              success?: boolean;
              error?: string;
            }>("wait", {
              selector: action.waitFor,
              timeout: 30000,
              sessionId: this.activeSessionId,
            });
            if (waitResult.error) {
              throw new Error(waitResult.error);
            }
            result = { waitedFor: action.waitFor };
          }
          break;

        case "scroll":
          const scrollResult = await callBrowserAPI<{
            success?: boolean;
            error?: string;
          }>("scroll", {
            direction: action.direction || "down",
            amount: 500,
            selector: action.selector,
            sessionId: this.activeSessionId,
          });
          if (scrollResult.error) {
            throw new Error(scrollResult.error);
          }
          result = { scrolled: action.direction || "down" };
          break;

        case "evaluate":
          if (action.script) {
            const evalResult = await callBrowserAPI<{
              result?: unknown;
              error?: string;
            }>("evaluate", action.script, {
              sessionId: this.activeSessionId,
            });
            if (evalResult.error) {
              throw new Error(evalResult.error);
            }
            result = evalResult.result;
          }
          break;
      }

      // Take screenshot after action if not already taken
      if (!screenshot && action.type !== "screenshot") {
        try {
          const afterScreenshot = await callBrowserAPI<{
            success?: boolean;
            data?: { base64?: string };
          }>("screenshot", { sessionId: this.activeSessionId });
          if (afterScreenshot.data?.base64) {
            screenshot = afterScreenshot.data.base64;
          }
        } catch {
          // Screenshot optional, don't fail action
        }
      }

      return {
        success: true,
        action,
        result,
        screenshot,
      };
    } catch (err) {
      logger.error(`Action ${action.type} failed:`, err);
      return {
        success: false,
        action,
        error: String(err),
      };
    }
  }

  /**
   * Execute an automation flow
   */
  async executeFlow(
    sessionId: string,
    task: string,
    actions: WebAction[],
  ): Promise<AutomationResult> {
    const startTime = Date.now();
    const results: WebActionResult[] = [];
    let extractedData: unknown;

    this.emitProgress("starting", `Starting automation: ${task}`, {
      actionCount: actions.length,
    });

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      this.emitProgress(
        "action",
        `Action ${i + 1}/${actions.length}: ${action.type}`,
        {
          progress: ((i + 1) / actions.length) * 100,
        },
      );

      const result = await this.executeAction(sessionId, action);
      results.push(result);

      // Capture extracted data
      if (
        (action.type === "extract" || action.type === "snapshot") &&
        result.success &&
        result.result
      ) {
        extractedData = result.result;
      }

      // Stop if action failed
      if (!result.success) {
        this.emitProgress("error", `Action failed: ${result.error}`);
        break;
      }

      // Small delay between actions
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    // Get final screenshot
    let finalScreenshot: string | undefined;
    try {
      const finalScreenshotResult = await callBrowserAPI<{
        success?: boolean;
        data?: { base64?: string };
      }>("screenshot", { sessionId: this.activeSessionId });
      if (finalScreenshotResult.data?.base64) {
        finalScreenshot = finalScreenshotResult.data.base64;
      }
    } catch {
      // Optional, don't fail
    }

    const successCount = results.filter((r) => r.success).length;
    const duration = (Date.now() - startTime) / 1000;

    this.emitProgress(
      "complete",
      `Automation complete: ${successCount}/${actions.length} actions`,
      {
        successCount,
        totalActions: actions.length,
        duration,
      },
    );

    return {
      success: successCount === actions.length,
      task,
      actions: results,
      extractedData,
      finalScreenshot,
    };
  }

  /**
   * Execute a simple automation task using natural language
   */
  async executeTask(
    sessionId: string,
    task: string,
    url: string,
  ): Promise<AutomationResult> {
    this.emitProgress("starting", `Executing task: ${task}`);

    const actions: WebAction[] = [
      { type: "navigate", url },
      { type: "snapshot", instruction: "interactive" },
    ];

    // Parse task into actions (simplified - in production would use LLM)
    const taskLower = task.toLowerCase();

    if (taskLower.includes("click")) {
      // Extract selector from task if present
      const selectorMatch = task.match(/["']([^"']+)["']/);
      if (selectorMatch) {
        actions.push({
          type: "click",
          selector: selectorMatch[1],
        });
      }
    }

    if (
      taskLower.includes("type") ||
      taskLower.includes("enter") ||
      taskLower.includes("fill")
    ) {
      // Extract text and selector from the task
      const matches = task.match(/["']([^"']+)["']/g);
      if (matches && matches.length >= 2) {
        actions.push({
          type: "fill",
          selector: matches[0].replace(/["']/g, ""),
          value: matches[1].replace(/["']/g, ""),
        });
      }
    }

    if (
      taskLower.includes("extract") ||
      taskLower.includes("get") ||
      taskLower.includes("scrape")
    ) {
      const selectorMatch = task.match(/["']([^"']+)["']/);
      if (selectorMatch) {
        actions.push({
          type: "extract",
          selector: selectorMatch[1],
        });
      }
    }

    if (taskLower.includes("scroll")) {
      actions.push({
        type: "scroll",
        direction: taskLower.includes("up") ? "up" : "down",
      });
    }

    // Final screenshot
    actions.push({ type: "screenshot" });

    return this.executeFlow(sessionId, task, actions);
  }

  /**
   * Clean up the browser session
   */
  async cleanup(_sessionId: string): Promise<void> {
    this.emitProgress("cleanup", "Closing browser session...");
    try {
      await callBrowserAPI("closeSession", this.activeSessionId);
    } catch (err) {
      logger.warn("Error closing session:", err);
    }
    this.activeSessionId = undefined;
  }
}

/**
 * Create the browser session tool
 */
export function createBrowserSessionTool(
  dataStream?: UIMessageStreamWriter,
): Tool {
  return createTool({
    description:
      "Create a new browser session for web automation using agent-browser",
    inputSchema: z.object({
      headless: z
        .boolean()
        .optional()
        .describe("Run browser in headless mode (default: false)"),
      cdpPort: z
        .number()
        .optional()
        .describe("Connect to existing Chrome via CDP port"),
      cdpUrl: z
        .string()
        .optional()
        .describe("Connect to existing Chrome via CDP WebSocket URL"),
    }),
    execute: async ({ headless, cdpPort, cdpUrl }) => {
      const agent = new WebAutomationAgent(dataStream);

      try {
        const sessionId = await agent.createSession("user", undefined, {
          headless,
          cdpPort,
          cdpUrl,
        });

        return {
          success: true,
          sessionId,
          message:
            "Browser session created. Use getSnapshot to see page elements with refs.",
        };
      } catch (err) {
        logger.error("Failed to create session:", err);
        return {
          success: false,
          error: String(err),
        };
      }
    },
  }) as Tool;
}

/**
 * Create the snapshot tool for AI-optimized element selection
 */
export function createSnapshotTool(dataStream?: UIMessageStreamWriter): Tool {
  return createTool({
    description:
      "Get an AI-optimized snapshot of the current page with element refs. " +
      "Returns a tree of elements with refs like @e1, @e2 that can be used in click/fill/type actions.",
    inputSchema: z.object({
      interactive: z
        .boolean()
        .optional()
        .describe("Only include interactive elements (buttons, links, inputs)"),
      compact: z
        .boolean()
        .optional()
        .describe("Remove structural elements without content"),
      selector: z
        .string()
        .optional()
        .describe("CSS selector to scope the snapshot"),
    }),
    execute: async ({ interactive, compact, selector }) => {
      const agent = new WebAutomationAgent(dataStream);

      try {
        const snapshot = await agent.getSnapshot({ interactive, compact, selector });

        return {
          success: true,
          tree: snapshot.tree,
          stats: snapshot.stats,
          hint: "Use refs like @e1, @e2 in click, fill, type actions for deterministic selection",
        };
      } catch (err) {
        logger.error("Snapshot failed:", err);
        return {
          success: false,
          error: String(err),
        };
      }
    },
  }) as Tool;
}

/**
 * Create the web automation flow tool
 */
export function createWebAutomationFlowTool(
  dataStream?: UIMessageStreamWriter,
): Tool {
  return createTool({
    description:
      "Execute a sequence of web automation actions using agent-browser. " +
      "Supports refs (@e1, @e2) from snapshot or CSS selectors for element targeting.",
    inputSchema: z.object({
      sessionId: z.string().describe("The browser session ID"),
      task: z.string().describe("Description of the automation task"),
      actions: z
        .array(
          z.object({
            type: z.enum([
              "navigate",
              "click",
              "type",
              "fill",
              "extract",
              "screenshot",
              "wait",
              "scroll",
              "evaluate",
              "press",
              "snapshot",
            ]),
            instruction: z
              .string()
              .optional()
              .describe("Additional instruction for the action"),
            url: z.string().optional().describe("URL to navigate to"),
            selector: z
              .string()
              .optional()
              .describe("CSS selector or ref (@e1) for element"),
            text: z.string().optional().describe("Text to type"),
            value: z.string().optional().describe("Value to fill"),
            key: z.string().optional().describe("Key to press (e.g., Enter, Tab)"),
            script: z.string().optional().describe("JavaScript to evaluate"),
            waitFor: z
              .union([z.number(), z.string()])
              .optional()
              .describe("Time in ms or selector to wait for"),
            direction: z.enum(["up", "down"]).optional(),
          }),
        )
        .describe("Sequence of actions to perform"),
    }),
    execute: async ({ sessionId, task, actions }) => {
      const agent = new WebAutomationAgent(dataStream);

      try {
        const result = await agent.executeFlow(sessionId, task, actions);

        return {
          success: result.success,
          task: result.task,
          actionsCompleted: result.actions.filter((a) => a.success).length,
          totalActions: result.actions.length,
          extractedData: result.extractedData,
          finalScreenshot: result.finalScreenshot,
        };
      } catch (err) {
        logger.error("Web automation failed:", err);
        return {
          success: false,
          error: String(err),
          task,
        };
      }
    },
  }) as Tool;
}

/**
 * Create the simple task execution tool
 */
export function createWebTaskTool(dataStream?: UIMessageStreamWriter): Tool {
  return createTool({
    description: "Execute a web automation task described in natural language",
    inputSchema: z.object({
      sessionId: z.string().describe("The browser session ID"),
      task: z.string().describe("Natural language description of the task"),
      url: z.string().describe("Starting URL for the automation"),
    }),
    execute: async ({ sessionId, task, url }) => {
      const agent = new WebAutomationAgent(dataStream);

      try {
        const result = await agent.executeTask(sessionId, task, url);

        return {
          success: result.success,
          task: result.task,
          actionsCompleted: result.actions.filter((a) => a.success).length,
          extractedData: result.extractedData,
          finalScreenshot: result.finalScreenshot,
        };
      } catch (err) {
        logger.error("Web task failed:", err);
        return {
          success: false,
          error: String(err),
          task,
        };
      }
    },
  }) as Tool;
}

/**
 * Create all web automation tools
 */
export function createWebAutomationTools(
  dataStream?: UIMessageStreamWriter,
): Record<string, Tool> {
  return {
    createBrowserSession: createBrowserSessionTool(dataStream),
    getPageSnapshot: createSnapshotTool(dataStream),
    executeWebFlow: createWebAutomationFlowTool(dataStream),
    executeWebTask: createWebTaskTool(dataStream),
  };
}
