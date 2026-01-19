import { tool as createTool } from "ai";
import { z } from "zod";

/**
 * Local Desktop/Terminal automation tools.
 * These tools enable command execution and terminal operations on the local machine.
 *
 * IMPORTANT: These tools execute commands locally via Electron IPC.
 */

// Check if running in Electron renderer
const isElectron =
  typeof window !== "undefined" &&
  window.electronAPI &&
  window.electronAPI.terminal;

/**
 * Helper to call terminal IPC methods
 */
async function callTerminalIPC<T>(
  method: string,
  ...args: unknown[]
): Promise<T> {
  if (!isElectron) {
    throw new Error("Terminal tools are only available in the desktop app");
  }
  const terminalAPI = window.electronAPI.terminal as unknown as Record<
    string,
    (...args: unknown[]) => Promise<T>
  >;
  if (!terminalAPI[method]) {
    throw new Error(`Terminal method ${method} not available`);
  }
  return terminalAPI[method](...args);
}

/**
 * Execute a shell command locally
 */
export const desktopCommandTool = createTool({
  description:
    "Execute a shell command on the local machine. Returns stdout, stderr, and exit code.",
  inputSchema: z.object({
    command: z.string().describe("Shell command to execute"),
    cwd: z
      .string()
      .optional()
      .describe("Working directory for the command (optional)"),
    timeout: z
      .number()
      .optional()
      .describe("Command timeout in milliseconds (default: 60000)"),
  }),
  execute: async ({ command, cwd, timeout }) => {
    try {
      const result = await callTerminalIPC<{
        success: boolean;
        stdout: string;
        stderr: string;
        exitCode: number;
        error?: string;
      }>("execute", { command, cwd, timeout });

      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        stdout: "",
        stderr: "",
        exitCode: 1,
        error: message,
      };
    }
  },
});

/**
 * Create a desktop sandbox (placeholder - runs in local terminal)
 */
export const desktopCreateTool = createTool({
  description:
    "Initialize a local terminal session for executing commands. This prepares the local environment for command execution.",
  inputSchema: z.object({
    workingDir: z
      .string()
      .optional()
      .describe("Working directory for the terminal session"),
  }),
  execute: async ({ workingDir }) => {
    try {
      // For local execution, we just verify the terminal IPC is available
      if (!isElectron) {
        return {
          success: false,
          error: "Terminal tools are only available in the desktop app",
        };
      }

      return {
        success: true,
        message: "Local terminal session ready",
        workingDir: workingDir || process.cwd?.() || "~",
        guide:
          "Use desktop_command to execute shell commands. Use desktop_screenshot to capture the screen.",
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        error: message,
      };
    }
  },
});

/**
 * Take a screenshot of the desktop
 */
export const desktopScreenshotTool = createTool({
  description:
    "Take a screenshot of the current desktop. Uses system screenshot capabilities.",
  inputSchema: z.object({
    fullScreen: z
      .boolean()
      .optional()
      .describe("Capture full screen (default: true)"),
  }),
  execute: async ({ fullScreen = true }) => {
    try {
      const result = await callTerminalIPC<{
        success: boolean;
        screenshot?: string;
        width?: number;
        height?: number;
        error?: string;
      }>("screenshot", { fullScreen });

      if (result.success && result.screenshot) {
        return {
          success: true,
          screenshot: result.screenshot,
          width: result.width,
          height: result.height,
          guide:
            "Analyze the screenshot to identify UI elements and their positions.",
        };
      }

      return {
        success: false,
        error: result.error || "Failed to capture screenshot",
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        error: message,
      };
    }
  },
});

/**
 * Click at coordinates (requires robotjs or similar)
 */
export const desktopClickTool = createTool({
  description:
    "Click at specific coordinates on the desktop. Requires system automation permissions.",
  inputSchema: z.object({
    x: z.number().describe("X coordinate to click"),
    y: z.number().describe("Y coordinate to click"),
    button: z
      .enum(["left", "right", "double"])
      .optional()
      .describe("Mouse button to click (default: left)"),
  }),
  execute: async ({ x, y, button = "left" }) => {
    try {
      const result = await callTerminalIPC<{
        success: boolean;
        message?: string;
        error?: string;
      }>("click", { x, y, button });

      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        error: message,
      };
    }
  },
});

/**
 * Type text at current cursor position
 */
export const desktopTypeTool = createTool({
  description:
    "Type text at the current cursor position. Click on an input field first.",
  inputSchema: z.object({
    text: z.string().describe("Text to type"),
  }),
  execute: async ({ text }) => {
    try {
      const result = await callTerminalIPC<{
        success: boolean;
        message?: string;
        error?: string;
      }>("type", { text });

      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        error: message,
      };
    }
  },
});

/**
 * Press keyboard key
 */
export const desktopPressTool = createTool({
  description:
    'Press a keyboard key or key combination. Examples: "Enter", "Tab", "ctrl+c", "cmd+v".',
  inputSchema: z.object({
    key: z
      .string()
      .describe('Key or key combination to press (e.g., "Enter", "ctrl+c")'),
  }),
  execute: async ({ key }) => {
    try {
      const result = await callTerminalIPC<{
        success: boolean;
        message?: string;
        error?: string;
      }>("press", { key });

      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        error: message,
      };
    }
  },
});

/**
 * Scroll the screen
 */
export const desktopScrollTool = createTool({
  description: "Scroll the screen up or down.",
  inputSchema: z.object({
    direction: z.enum(["up", "down"]).describe("Direction to scroll"),
    amount: z.number().optional().describe("Amount to scroll (default: 3)"),
  }),
  execute: async ({ direction, amount = 3 }) => {
    try {
      const result = await callTerminalIPC<{
        success: boolean;
        message?: string;
        error?: string;
      }>("scroll", { direction, amount });

      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        error: message,
      };
    }
  },
});

/**
 * Drag from one point to another
 */
export const desktopDragTool = createTool({
  description:
    "Drag from one point to another. Useful for moving windows or selecting text.",
  inputSchema: z.object({
    startX: z.number().describe("Starting X coordinate"),
    startY: z.number().describe("Starting Y coordinate"),
    endX: z.number().describe("Ending X coordinate"),
    endY: z.number().describe("Ending Y coordinate"),
  }),
  execute: async ({ startX, startY, endX, endY }) => {
    try {
      const result = await callTerminalIPC<{
        success: boolean;
        message?: string;
        error?: string;
      }>("drag", { startX, startY, endX, endY });

      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        error: message,
      };
    }
  },
});

/**
 * Launch an application
 */
export const desktopLaunchTool = createTool({
  description: "Launch an application on the local machine.",
  inputSchema: z.object({
    app: z.string().describe("Application name or path to launch"),
    args: z
      .array(z.string())
      .optional()
      .describe("Arguments to pass to the application"),
  }),
  execute: async ({ app, args }) => {
    try {
      const result = await callTerminalIPC<{
        success: boolean;
        message?: string;
        pid?: number;
        error?: string;
      }>("launch", { app, args });

      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        error: message,
      };
    }
  },
});

// Export all desktop tools as a collection
export const desktopTools = {
  desktop_create: desktopCreateTool,
  desktop_screenshot: desktopScreenshotTool,
  desktop_click: desktopClickTool,
  desktop_type: desktopTypeTool,
  desktop_press: desktopPressTool,
  desktop_scroll: desktopScrollTool,
  desktop_drag: desktopDragTool,
  desktop_launch: desktopLaunchTool,
  desktop_command: desktopCommandTool,
};
