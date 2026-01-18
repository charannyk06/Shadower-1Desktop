import "server-only";
import { type Tool, tool as createTool } from "ai";
import type { UIMessageStreamWriter } from "ai";
import { colorize } from "consola/utils";
import globalLogger from "logger";
import { z } from "zod";
import { E2BDesktopService } from "../sandbox/e2b-desktop-service";

const logger = globalLogger.withDefaults({
  message: colorize("yellow", "[Computer Use Agent] "),
});

/**
 * Screen element detected in screenshot
 */
export interface ScreenElement {
  type: "button" | "input" | "text" | "image" | "link" | "menu" | "window";
  label?: string;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  clickable: boolean;
}

/**
 * Action to perform on the desktop
 */
export interface DesktopAction {
  type:
    | "click"
    | "doubleClick"
    | "rightClick"
    | "type"
    | "press"
    | "scroll"
    | "drag"
    | "launch";
  target?: { x: number; y: number };
  text?: string;
  keys?: string[];
  app?: string;
  direction?: "up" | "down";
  amount?: number;
  from?: { x: number; y: number };
  to?: { x: number; y: number };
}

/**
 * Action result
 */
export interface ActionResult {
  success: boolean;
  action: DesktopAction;
  screenshot?: string;
  error?: string;
}

/**
 * Task execution result
 */
export interface TaskResult {
  success: boolean;
  task: string;
  actions: ActionResult[];
  finalScreenshot?: string;
  summary: string;
}

/**
 * Computer Use Agent
 *
 * Automates desktop tasks using visual understanding
 * and E2B Desktop sandbox.
 */
export class ComputerUseAgent {
  private desktopService: E2BDesktopService;
  private dataStream?: UIMessageStreamWriter;
  private activeSandboxId?: string;

  constructor(dataStream?: UIMessageStreamWriter) {
    this.desktopService = E2BDesktopService.getInstance();
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
        type: "data-computer-use-progress",
        data: {
          stage,
          message,
          timestamp: new Date().toISOString(),
          sandboxId: this.activeSandboxId,
          ...data,
        },
      });
    }
  }

  /**
   * Create a new desktop sandbox
   */
  async createDesktop(): Promise<string> {
    this.emitProgress("setup", "Creating desktop sandbox...");
    const desktop = await this.desktopService.createDesktop();
    this.activeSandboxId = desktop.sandboxId;

    this.emitProgress("setup", "Desktop sandbox ready", {
      sandboxId: desktop.sandboxId,
    });

    return desktop.sandboxId;
  }

  /**
   * Take a screenshot and return base64
   */
  async captureScreen(sandboxId: string): Promise<string> {
    const result = await this.desktopService.screenshot(sandboxId);
    return result.base64;
  }

  /**
   * Execute a single action on the desktop
   */
  async executeAction(
    sandboxId: string,
    action: DesktopAction,
  ): Promise<ActionResult> {
    this.emitProgress("executing", `Performing ${action.type} action...`, {
      action,
    });

    try {
      switch (action.type) {
        case "click":
          if (action.target) {
            await this.desktopService.leftClick(
              sandboxId,
              action.target.x,
              action.target.y,
            );
          } else {
            await this.desktopService.leftClick(sandboxId);
          }
          break;

        case "doubleClick":
          if (action.target) {
            await this.desktopService.doubleClick(
              sandboxId,
              action.target.x,
              action.target.y,
            );
          } else {
            await this.desktopService.doubleClick(sandboxId);
          }
          break;

        case "rightClick":
          if (action.target) {
            await this.desktopService.rightClick(
              sandboxId,
              action.target.x,
              action.target.y,
            );
          } else {
            await this.desktopService.rightClick(sandboxId);
          }
          break;

        case "type":
          if (action.text) {
            await this.desktopService.type(sandboxId, action.text);
          }
          break;

        case "press":
          if (action.keys && action.keys.length > 0) {
            await this.desktopService.press(sandboxId, action.keys);
          }
          break;

        case "scroll":
          await this.desktopService.scroll(
            sandboxId,
            action.direction || "down",
            action.amount,
          );
          break;

        case "drag":
          if (action.from && action.to) {
            await this.desktopService.drag(
              sandboxId,
              action.from.x,
              action.from.y,
              action.to.x,
              action.to.y,
            );
          }
          break;

        case "launch":
          if (action.app) {
            await this.desktopService.launchApp(sandboxId, action.app);
          }
          break;
      }

      // Wait a bit for the UI to update
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Take a screenshot after the action
      const screenshot = await this.captureScreen(sandboxId);

      return {
        success: true,
        action,
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
   * Execute a sequence of actions
   */
  async executeTask(
    sandboxId: string,
    task: string,
    actions: DesktopAction[],
  ): Promise<TaskResult> {
    const startTime = Date.now();
    const results: ActionResult[] = [];

    this.emitProgress("starting", `Starting task: ${task}`, {
      actionCount: actions.length,
    });

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      this.emitProgress("action", `Action ${i + 1}/${actions.length}`, {
        actionType: action.type,
        progress: ((i + 1) / actions.length) * 100,
      });

      const result = await this.executeAction(sandboxId, action);
      results.push(result);

      // Stop if action failed
      if (!result.success) {
        this.emitProgress("error", `Action failed: ${result.error}`);
        break;
      }
    }

    // Take final screenshot
    const finalScreenshot = await this.captureScreen(sandboxId);

    const successCount = results.filter((r) => r.success).length;
    const duration = (Date.now() - startTime) / 1000;

    const summary = `Completed ${successCount}/${actions.length} actions in ${duration.toFixed(1)}s`;

    this.emitProgress("complete", summary, {
      successCount,
      totalActions: actions.length,
      duration,
    });

    return {
      success: successCount === actions.length,
      task,
      actions: results,
      finalScreenshot,
      summary,
    };
  }

  /**
   * Clean up the desktop sandbox
   */
  async cleanup(sandboxId: string): Promise<void> {
    this.emitProgress("cleanup", "Closing desktop sandbox...");
    await this.desktopService.closeDesktop(sandboxId);
    this.activeSandboxId = undefined;
  }
}

/**
 * Create the computer use task execution tool
 */
export function createComputerUseTaskTool(
  dataStream?: UIMessageStreamWriter,
): Tool {
  return createTool({
    description: "Execute a sequence of desktop actions to complete a task",
    inputSchema: z.object({
      sandboxId: z.string().describe("The desktop sandbox ID"),
      task: z.string().describe("Description of the task to complete"),
      actions: z
        .array(
          z.object({
            type: z.enum([
              "click",
              "doubleClick",
              "rightClick",
              "type",
              "press",
              "scroll",
              "drag",
              "launch",
            ]),
            target: z
              .object({
                x: z.number(),
                y: z.number(),
              })
              .optional(),
            text: z.string().optional(),
            keys: z.array(z.string()).optional(),
            app: z.string().optional(),
            direction: z.enum(["up", "down"]).optional(),
            amount: z.number().optional(),
            from: z.object({ x: z.number(), y: z.number() }).optional(),
            to: z.object({ x: z.number(), y: z.number() }).optional(),
          }),
        )
        .describe("Sequence of actions to perform"),
    }),
    execute: async ({ sandboxId, task, actions }) => {
      const agent = new ComputerUseAgent(dataStream);

      try {
        const result = await agent.executeTask(sandboxId, task, actions);

        return {
          success: result.success,
          task: result.task,
          summary: result.summary,
          actionsCompleted: result.actions.filter((a) => a.success).length,
          totalActions: result.actions.length,
          finalScreenshot: result.finalScreenshot,
        };
      } catch (err) {
        logger.error("Computer use task failed:", err);
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
 * Create the analyze screen tool
 */
export function createAnalyzeScreenTool(
  dataStream?: UIMessageStreamWriter,
): Tool {
  return createTool({
    description: "Take a screenshot and analyze the current screen state",
    inputSchema: z.object({
      sandboxId: z.string().describe("The desktop sandbox ID"),
    }),
    execute: async ({ sandboxId }) => {
      const agent = new ComputerUseAgent(dataStream);

      try {
        const screenshot = await agent.captureScreen(sandboxId);
        const desktopService = E2BDesktopService.getInstance();
        const screenSize = await desktopService.getScreenSize(sandboxId);

        return {
          success: true,
          screenshot,
          screenSize,
          instruction:
            "Analyze this screenshot to identify UI elements and their coordinates for interaction",
        };
      } catch (err) {
        logger.error("Screen analysis failed:", err);
        return {
          success: false,
          error: String(err),
        };
      }
    },
  }) as Tool;
}

/**
 * Create all computer use tools
 */
export function createComputerUseTools(
  dataStream?: UIMessageStreamWriter,
): Record<string, Tool> {
  return {
    executeComputerTask: createComputerUseTaskTool(dataStream),
    analyzeScreen: createAnalyzeScreenTool(dataStream),
  };
}
