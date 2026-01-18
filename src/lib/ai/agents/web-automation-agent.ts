import "server-only";
import { type Tool, tool as createTool } from "ai";
import type { UIMessageStreamWriter } from "ai";
import { colorize } from "consola/utils";
import globalLogger from "logger";
import { z } from "zod";
import { BrowserbaseService } from "../browser/browserbase-service";

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
    | "scroll";
  instruction?: string;
  url?: string;
  selector?: string;
  text?: string;
  schema?: z.ZodSchema;
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
  sessionReplayUrl?: string;
}

/**
 * Web Automation Agent
 *
 * Sophisticated web automation using Browserbase + Stagehand
 * with AI-powered natural language browser control.
 */
export class WebAutomationAgent {
  private browserService: BrowserbaseService;
  private dataStream?: UIMessageStreamWriter;
  private activeSessionId?: string;

  constructor(dataStream?: UIMessageStreamWriter) {
    this.browserService = BrowserbaseService.getInstance();
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
   * Create a browser session for automation
   */
  async createSession(
    userId: string,
    threadId?: string,
    useStealth: boolean = false,
  ): Promise<string> {
    this.emitProgress(
      "setup",
      `Creating ${useStealth ? "stealth " : ""}browser session...`,
    );

    const sessionResult = useStealth
      ? await this.browserService.createStealthSession(userId, threadId)
      : await this.browserService.createSession({ userId, threadId });

    if (!sessionResult.ok) {
      throw new Error(
        `Failed to create browser session: ${sessionResult.error.message}`,
      );
    }

    const session = sessionResult.value;
    this.activeSessionId = session.sessionId;

    this.emitProgress("setup", "Browser session ready", {
      sessionId: session.sessionId,
      stealth: useStealth,
    });

    return session.sessionId;
  }

  /**
   * Execute a single web action
   */
  async executeAction(
    sessionId: string,
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
            await this.browserService.navigate(sessionId, action.url);
            result = { navigatedTo: action.url };
          }
          break;

        case "click":
          if (action.instruction) {
            // Use Stagehand natural language action
            const actResult = await this.browserService.act(
              sessionId,
              action.instruction,
            );
            result = actResult;
          }
          break;

        case "type":
          if (action.instruction && action.text) {
            // First focus the element, then type
            await this.browserService.act(sessionId, action.instruction);
            // Then type the text
            await this.browserService.act(sessionId, `type "${action.text}"`);
            result = { typed: action.text };
          }
          break;

        case "extract":
          if (action.instruction && action.schema) {
            result = await this.browserService.extract(
              sessionId,
              action.instruction,
              action.schema,
            );
          }
          break;

        case "screenshot":
          const screenshotResult =
            await this.browserService.screenshot(sessionId);
          if (screenshotResult.ok) {
            screenshot = screenshotResult.value.base64;
            result = { captured: true };
          } else {
            result = { captured: false, error: screenshotResult.error.message };
          }
          break;

        case "wait":
          if (typeof action.waitFor === "number") {
            await new Promise((resolve) =>
              setTimeout(resolve, action.waitFor as number),
            );
            result = { waited: action.waitFor };
          } else if (typeof action.waitFor === "string") {
            // Wait for element/condition using observe
            const observed = await this.browserService.observe(
              sessionId,
              `Wait until: ${action.waitFor}`,
            );
            result = observed;
          }
          break;

        case "scroll":
          await this.browserService.act(
            sessionId,
            `scroll ${action.direction || "down"}`,
          );
          result = { scrolled: action.direction || "down" };
          break;
      }

      // Take screenshot after action if not already taken
      if (!screenshot && action.type !== "screenshot") {
        try {
          const afterScreenshot =
            await this.browserService.screenshot(sessionId);
          if (afterScreenshot.ok) {
            screenshot = afterScreenshot.value.base64;
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

    // Get final screenshot and replay URL
    let finalScreenshot: string | undefined;
    let sessionReplayUrl: string | undefined;

    try {
      const finalScreenshotResult =
        await this.browserService.screenshot(sessionId);
      if (finalScreenshotResult.ok) {
        finalScreenshot = finalScreenshotResult.value.base64;
      }
      const replayUrlResult = await this.browserService.getReplayUrl(sessionId);
      if (replayUrlResult.ok && replayUrlResult.value) {
        sessionReplayUrl = replayUrlResult.value;
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
      sessionReplayUrl,
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
      actions.push({
        type: "click",
        instruction: task,
      });
    }

    if (
      taskLower.includes("type") ||
      taskLower.includes("enter") ||
      taskLower.includes("fill")
    ) {
      // Extract text to type from the task
      const match = task.match(/["']([^"']+)["']/);
      if (match) {
        actions.push({
          type: "type",
          instruction: task.replace(match[0], "").trim(),
          text: match[1],
        });
      }
    }

    if (
      taskLower.includes("extract") ||
      taskLower.includes("get") ||
      taskLower.includes("scrape")
    ) {
      actions.push({
        type: "extract",
        instruction: task,
        schema: z.object({
          data: z.unknown(),
        }),
      });
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
  async cleanup(sessionId: string): Promise<void> {
    this.emitProgress("cleanup", "Closing browser session...");
    await this.browserService.closeSession(sessionId);
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
      "Execute a sequence of web automation actions using Stagehand AI",
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
            ]),
            instruction: z
              .string()
              .optional()
              .describe("Natural language instruction for the action"),
            url: z.string().optional().describe("URL to navigate to"),
            text: z.string().optional().describe("Text to type"),
            waitFor: z
              .union([z.number(), z.string()])
              .optional()
              .describe("Time in ms or condition to wait for"),
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
          replayUrl: result.sessionReplayUrl,
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
          replayUrl: result.sessionReplayUrl,
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
