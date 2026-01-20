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
    | "extract"
    | "screenshot"
    | "wait"
    | "scroll"
    | "evaluate";
  instruction?: string;
  url?: string;
  selector?: string;
  text?: string;
  script?: string;
  waitFor?: number | string;
  direction?: "up" | "down";
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

// Check if running in Electron
const isElectron =
  typeof window !== "undefined" &&
  window.electronAPI &&
  window.electronAPI.chrome;

/**
 * Helper to call Chrome IPC
 */
async function callChromeIPC<T>(method: string, data?: unknown): Promise<T> {
  if (!isElectron) {
    throw new Error("Web automation is only available in the desktop app");
  }
  const chromeAPI = window.electronAPI.chrome as unknown as Record<
    string,
    (data?: unknown) => Promise<T>
  >;
  if (!chromeAPI[method]) {
    throw new Error(`Chrome method ${method} not available`);
  }
  return chromeAPI[method](data);
}

/**
 * Web Automation Agent
 *
 * Sophisticated web automation using Chrome DevTools Protocol
 * to control the user's local Chrome browser.
 */
export class WebAutomationAgent {
  private dataStream?: UIMessageStreamWriter;
  private activeSessionId?: string;
  // @ts-expect-error - Reserved for future implementation
  private isConnected: boolean = false;

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
   * Connect to Chrome browser
   */
  async createSession(
    _userId: string,
    _threadId?: string,
    port: number = 9222,
  ): Promise<string> {
    this.emitProgress("setup", "Connecting to Chrome browser...");

    const result = await callChromeIPC<{
      success: boolean;
      tabs?: Array<{ id: string; title: string; url: string }>;
      error?: string;
    }>("connect", { port });

    if (!result.success) {
      throw new Error(
        result.error ||
          "Failed to connect to Chrome. Make sure Chrome is running with --remote-debugging-port=9222",
      );
    }

    this.isConnected = true;
    this.activeSessionId = `chrome-${port}-${Date.now()}`;

    this.emitProgress("setup", "Connected to Chrome", {
      sessionId: this.activeSessionId,
      tabs: result.tabs?.length || 0,
    });

    return this.activeSessionId;
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
            const navResult = await callChromeIPC<{
              success: boolean;
              title?: string;
              url?: string;
              error?: string;
            }>("navigate", { url: action.url });
            if (!navResult.success) {
              throw new Error(navResult.error || "Navigation failed");
            }
            result = { navigatedTo: action.url, title: navResult.title };
          }
          break;

        case "click":
          if (action.selector) {
            const clickResult = await callChromeIPC<{
              success: boolean;
              error?: string;
            }>("click", { selector: action.selector });
            if (!clickResult.success) {
              throw new Error(clickResult.error || "Click failed");
            }
            result = { clicked: action.selector };
          }
          break;

        case "type":
          if (action.selector && action.text) {
            const typeResult = await callChromeIPC<{
              success: boolean;
              error?: string;
            }>("type", {
              selector: action.selector,
              text: action.text,
              clear: true,
            });
            if (!typeResult.success) {
              throw new Error(typeResult.error || "Type failed");
            }
            result = { typed: action.text, into: action.selector };
          }
          break;

        case "extract":
          if (action.selector) {
            const extractResult = await callChromeIPC<{
              success: boolean;
              data?: string | string[];
              error?: string;
            }>("extract", {
              selector: action.selector,
              attribute: action.instruction,
              all: true,
            });
            if (!extractResult.success) {
              throw new Error(extractResult.error || "Extract failed");
            }
            result = extractResult.data;
          }
          break;

        case "screenshot":
          const screenshotResult = await callChromeIPC<{
            success: boolean;
            screenshot?: string;
            error?: string;
          }>("screenshot", {
            fullPage: action.instruction === "full",
          });
          if (screenshotResult.success && screenshotResult.screenshot) {
            screenshot = screenshotResult.screenshot;
            result = { captured: true };
          } else {
            result = {
              captured: false,
              error: screenshotResult.error,
            };
          }
          break;

        case "wait":
          if (typeof action.waitFor === "number") {
            await new Promise((resolve) =>
              setTimeout(resolve, action.waitFor as number),
            );
            result = { waited: action.waitFor };
          } else if (typeof action.waitFor === "string") {
            // Wait for selector
            const waitResult = await callChromeIPC<{
              success: boolean;
              error?: string;
            }>("wait", {
              selector: action.waitFor,
              timeout: 30000,
            });
            if (!waitResult.success) {
              throw new Error(waitResult.error || "Wait failed");
            }
            result = { waitedFor: action.waitFor };
          }
          break;

        case "scroll":
          const scrollResult = await callChromeIPC<{
            success: boolean;
            error?: string;
          }>("scroll", {
            direction: action.direction || "down",
            amount: 500,
          });
          if (!scrollResult.success) {
            throw new Error(scrollResult.error || "Scroll failed");
          }
          result = { scrolled: action.direction || "down" };
          break;

        case "evaluate":
          if (action.script) {
            const evalResult = await callChromeIPC<{
              success: boolean;
              result?: unknown;
              error?: string;
            }>("evaluate", { script: action.script });
            if (!evalResult.success) {
              throw new Error(evalResult.error || "Evaluate failed");
            }
            result = evalResult.result;
          }
          break;
      }

      // Take screenshot after action if not already taken
      if (!screenshot && action.type !== "screenshot") {
        try {
          const afterScreenshot = await callChromeIPC<{
            success: boolean;
            screenshot?: string;
          }>("screenshot", {});
          if (afterScreenshot.success && afterScreenshot.screenshot) {
            screenshot = afterScreenshot.screenshot;
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
      if (action.type === "extract" && result.success && result.result) {
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
      const finalScreenshotResult = await callChromeIPC<{
        success: boolean;
        screenshot?: string;
      }>("screenshot", {});
      if (finalScreenshotResult.success && finalScreenshotResult.screenshot) {
        finalScreenshot = finalScreenshotResult.screenshot;
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
      { type: "screenshot" },
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
          type: "type",
          selector: matches[0].replace(/["']/g, ""),
          text: matches[1].replace(/["']/g, ""),
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
    // Note: We don't actually close Chrome, just disconnect
    this.isConnected = false;
    this.activeSessionId = undefined;
  }
}

/**
 * Create the web automation flow tool
 */
export function createWebAutomationFlowTool(
  dataStream?: UIMessageStreamWriter,
): Tool {
  return createTool({
    description:
      "Execute a sequence of web automation actions using Chrome DevTools Protocol",
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
              "extract",
              "screenshot",
              "wait",
              "scroll",
              "evaluate",
            ]),
            instruction: z
              .string()
              .optional()
              .describe("Additional instruction for the action"),
            url: z.string().optional().describe("URL to navigate to"),
            selector: z
              .string()
              .optional()
              .describe("CSS selector for element"),
            text: z.string().optional().describe("Text to type"),
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
    executeWebFlow: createWebAutomationFlowTool(dataStream),
    executeWebTask: createWebTaskTool(dataStream),
  };
}
