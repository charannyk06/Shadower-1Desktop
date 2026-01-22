import { type Tool, tool as createTool } from "ai";
import type { UIMessageStreamWriter } from "ai";
import { colorize } from "consola/utils";
import globalLogger from "logger";
import { z } from "zod";

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
    | "launch"
    | "command";
  target?: { x: number; y: number };
  text?: string;
  keys?: string[];
  app?: string;
  command?: string;
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
  output?: string;
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

// Check if running in Electron
const isElectron =
  typeof window !== "undefined" &&
  window.electronAPI &&
  window.electronAPI.terminal;

/**
 * Helper to check if we're in Electron and throw if not
 */
function assertElectron(): void {
  if (!isElectron) {
    throw new Error("Computer use is only available in the desktop app");
  }
}

/**
 * Terminal result type for action methods
 */
type TerminalResult = {
  success: boolean;
  message?: string;
  error?: string;
};

/**
 * Terminal API helpers - each method matches the preload.ts signatures
 */
const terminalAPI = {
  async screenshot(options?: { fullScreen?: boolean; displayId?: string }): Promise<{
    success: boolean;
    screenshot?: string;
    error?: string;
  }> {
    assertElectron();
    return window.electronAPI.terminal.screenshot(options);
  },

  async click(x: number, y: number, button?: "left" | "right" | "double"): Promise<TerminalResult> {
    assertElectron();
    return window.electronAPI.terminal.click(x, y, button);
  },

  async type(text: string): Promise<TerminalResult> {
    assertElectron();
    return window.electronAPI.terminal.type(text);
  },

  async keyPress(key: string): Promise<TerminalResult> {
    assertElectron();
    return window.electronAPI.terminal.keyPress(key);
  },

  async scroll(direction: "up" | "down", amount?: number): Promise<TerminalResult> {
    assertElectron();
    return window.electronAPI.terminal.scroll(direction, amount);
  },

  async drag(startX: number, startY: number, endX: number, endY: number): Promise<TerminalResult> {
    assertElectron();
    return window.electronAPI.terminal.drag(startX, startY, endX, endY);
  },

  async launch(app: string, args?: string[]): Promise<TerminalResult & { pid?: number }> {
    assertElectron();
    return window.electronAPI.terminal.launch(app, args);
  },

  async execute(options: {
    command: string;
    cwd?: string;
    timeout?: number;
  }): Promise<{ success: boolean; stdout: string; stderr: string }> {
    assertElectron();
    return window.electronAPI.terminal.execute(options);
  },
};

/**
 * Computer Use Agent
 *
 * Automates desktop tasks using visual understanding
 * and local terminal execution.
 */
export class ComputerUseAgent {
  private dataStream?: UIMessageStreamWriter;
  private sessionId?: string;

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
        type: "data-computer-use-progress",
        data: {
          stage,
          message,
          timestamp: new Date().toISOString(),
          sessionId: this.sessionId,
          ...data,
        },
      });
    }
  }

  /**
   * Initialize a local desktop session
   */
  async createDesktop(): Promise<string> {
    this.emitProgress("setup", "Initializing local desktop session...");

    // Generate a session ID for tracking
    this.sessionId = `local-${Date.now()}`;

    this.emitProgress("setup", "Local desktop session ready", {
      sessionId: this.sessionId,
    });

    return this.sessionId;
  }

  /**
   * Take a screenshot and return base64
   */
  async captureScreen(_sessionId: string): Promise<string> {
    const result = await terminalAPI.screenshot({ fullScreen: true });

    if (!result.success || !result.screenshot) {
      throw new Error(result.error || "Failed to capture screenshot");
    }

    return result.screenshot;
  }

  /**
   * Execute a single action on the desktop
   */
  async executeAction(
    sessionId: string,
    action: DesktopAction,
  ): Promise<ActionResult> {
    this.emitProgress("executing", `Performing ${action.type} action...`, {
      action,
    });

    try {
      let output: string | undefined;

      switch (action.type) {
        case "click":
          if (action.target) {
            await terminalAPI.click(action.target.x, action.target.y, "left");
          }
          break;

        case "doubleClick":
          if (action.target) {
            await terminalAPI.click(action.target.x, action.target.y, "double");
          }
          break;

        case "rightClick":
          if (action.target) {
            await terminalAPI.click(action.target.x, action.target.y, "right");
          }
          break;

        case "type":
          if (action.text) {
            await terminalAPI.type(action.text);
          }
          break;

        case "press":
          if (action.keys && action.keys.length > 0) {
            await terminalAPI.keyPress(action.keys.join("+"));
          }
          break;

        case "scroll":
          await terminalAPI.scroll(action.direction || "down", action.amount || 3);
          break;

        case "drag":
          if (action.from && action.to) {
            await terminalAPI.drag(
              action.from.x,
              action.from.y,
              action.to.x,
              action.to.y
            );
          }
          break;

        case "launch":
          if (action.app) {
            await terminalAPI.launch(action.app);
          }
          break;

        case "command":
          if (action.command) {
            const result = await terminalAPI.execute({ command: action.command });
            output = result.stdout || result.stderr;
          }
          break;
      }

      // Wait a bit for the UI to update
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Try to take a screenshot after the action
      let screenshot: string | undefined;
      try {
        screenshot = await this.captureScreen(sessionId);
      } catch {
        // Screenshot might fail, that's okay
      }

      return {
        success: true,
        action,
        screenshot,
        output,
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
    sessionId: string,
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

      const result = await this.executeAction(sessionId, action);
      results.push(result);

      // Stop if action failed
      if (!result.success) {
        this.emitProgress("error", `Action failed: ${result.error}`);
        break;
      }
    }

    // Take final screenshot
    let finalScreenshot: string | undefined;
    try {
      finalScreenshot = await this.captureScreen(sessionId);
    } catch {
      // Screenshot might fail
    }

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
   * Clean up the desktop session
   */
  async cleanup(_sessionId: string): Promise<void> {
    this.emitProgress("cleanup", "Closing desktop session...");
    this.sessionId = undefined;
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
      sessionId: z.string().describe("The desktop session ID"),
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
              "command",
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
            command: z.string().optional(),
            direction: z.enum(["up", "down"]).optional(),
            amount: z.number().optional(),
            from: z.object({ x: z.number(), y: z.number() }).optional(),
            to: z.object({ x: z.number(), y: z.number() }).optional(),
          }),
        )
        .describe("Sequence of actions to perform"),
    }),
    execute: async ({ sessionId, task, actions }) => {
      const agent = new ComputerUseAgent(dataStream);

      try {
        const result = await agent.executeTask(sessionId, task, actions);

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
      sessionId: z.string().describe("The desktop session ID"),
    }),
    execute: async ({ sessionId }) => {
      const agent = new ComputerUseAgent(dataStream);

      try {
        const screenshot = await agent.captureScreen(sessionId);

        return {
          success: true,
          screenshot,
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
