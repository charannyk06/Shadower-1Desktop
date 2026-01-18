import { tool as createTool } from "ai";
import { z } from "zod";
import { getSessionForThread } from "../../../middleware/session-quota";
import { getE2BDesktopService } from "../../sandbox/e2b-desktop-service";

/**
 * Desktop automation tools using E2B Desktop Sandbox.
 * These tools enable computer use capabilities with GUI automation.
 *
 * IMPORTANT: These tools are stateless and look up sessions from the database.
 * Each tool requires userId and threadId to find the active session.
 */

// Common params for all tools that need session context
const SessionContextParams = z.object({
  userId: z.string().describe("User ID who owns this desktop session"),
  threadId: z.string().describe("Thread ID to find the active session"),
});

/**
 * Helper to get active desktop session for a thread from database
 */
async function getActiveDesktopForThread(
  threadId: string,
): Promise<string | null> {
  const session = await getSessionForThread(threadId, "e2b-desktop");
  return session?.sessionId || null;
}

/**
 * Helper function to get or create a desktop sandbox
 */
async function getOrCreateDesktopSandbox(
  userId: string,
  threadId: string,
): Promise<
  { success: true; sandboxId: string } | { success: false; error: string }
> {
  const service = getE2BDesktopService();

  if (!service.isConfigured()) {
    return {
      success: false,
      error: "E2B is not configured. Please set E2B_API_KEY.",
    };
  }

  // Check for existing session
  let sandboxId = await getActiveDesktopForThread(threadId);

  // Auto-create if it doesn't exist
  if (!sandboxId) {
    try {
      const session = await service.createDesktop({
        userId,
        threadId,
      });
      sandboxId = session.sandboxId;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        error: `Failed to create desktop sandbox: ${message}`,
      };
    }
  }

  return { success: true, sandboxId };
}

/**
 * Create or get the active desktop sandbox.
 */
export const desktopCreateTool = createTool({
  description:
    "Create a new desktop sandbox environment for computer use tasks. This provides a full Linux desktop that can run applications, browse the web, and perform GUI automation.",
  inputSchema: z
    .object({
      timeout: z
        .number()
        .optional()
        .describe("Session timeout in milliseconds (default: 5 minutes)"),
    })
    .extend(SessionContextParams.shape),
  execute: async ({ timeout, userId, threadId }) => {
    const service = getE2BDesktopService();

    if (!service.isConfigured()) {
      return {
        success: false,
        error: "E2B is not configured. Please set E2B_API_KEY.",
      };
    }

    try {
      // Check for existing session and close it
      const existingSandboxId = await getActiveDesktopForThread(threadId);
      if (existingSandboxId) {
        try {
          await service.closeDesktop(existingSandboxId);
        } catch {
          // Ignore errors when closing old session
        }
      }

      const session = await service.createDesktop({
        timeout,
        userId,
        threadId,
      });

      return {
        success: true,
        sandboxId: session.sandboxId,
        message:
          "Desktop sandbox created. You can now launch applications and interact with the GUI.",
        guide:
          "Use desktop_launch to open applications, desktop_screenshot to see the screen, and desktop_click/desktop_type to interact.",
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
 * Take a screenshot of the desktop.
 */
export const desktopScreenshotTool = createTool({
  description:
    "Take a screenshot of the current desktop state. Use this to see what's on screen before performing actions.",
  inputSchema: SessionContextParams,
  execute: async ({ userId, threadId }) => {
    const service = getE2BDesktopService();

    if (!service.isConfigured()) {
      return {
        success: false,
        error: "E2B is not configured. Please set E2B_API_KEY.",
      };
    }

    // Look up session from database
    let sandboxId = await getActiveDesktopForThread(threadId);

    // Auto-create sandbox if it doesn't exist
    if (!sandboxId) {
      try {
        const desktop = await service.createDesktop({
          userId,
          threadId,
        });
        sandboxId = desktop.sandboxId;
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          success: false,
          error: `Failed to create desktop sandbox: ${message}`,
        };
      }
    }

    try {
      const result = await service.screenshot(sandboxId);

      return {
        success: true,
        screenshot: `data:image/png;base64,${result.base64}`,
        width: result.width,
        height: result.height,
        sandboxId,
        guide:
          "Analyze the screenshot to identify UI elements and their positions for interaction.",
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
 * Click at coordinates on the desktop.
 */
export const desktopClickTool = createTool({
  description:
    "Click at specific coordinates on the desktop. Use left click for normal selection, right click for context menus, double click to open items.",
  inputSchema: z
    .object({
      x: z.number().describe("X coordinate to click"),
      y: z.number().describe("Y coordinate to click"),
      button: z
        .enum(["left", "right", "double"])
        .optional()
        .describe("Mouse button to click (default: left)"),
    })
    .extend(SessionContextParams.shape),
  execute: async ({ x, y, button = "left", userId, threadId }) => {
    const sandboxResult = await getOrCreateDesktopSandbox(userId, threadId);
    if (!sandboxResult.success) {
      return sandboxResult;
    }
    const sandboxId = sandboxResult.sandboxId;
    const service = getE2BDesktopService();

    try {
      let result;
      if (button === "right") {
        result = await service.rightClick(sandboxId, x, y);
      } else if (button === "double") {
        result = await service.doubleClick(sandboxId, x, y);
      } else {
        result = await service.leftClick(sandboxId, x, y);
      }

      // Take screenshot after click
      const screenshot = await service.screenshot(sandboxId);

      return {
        success: result.success,
        message: result.message,
        sandboxId,
        screenshot: `data:image/png;base64,${screenshot.base64}`,
        error: result.error,
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
 * Type text at current cursor position.
 */
export const desktopTypeTool = createTool({
  description:
    "Type text at the current cursor position. Click on an input field first, then use this to enter text.",
  inputSchema: z
    .object({
      text: z.string().describe("Text to type"),
    })
    .extend(SessionContextParams.shape),
  execute: async ({ text, userId, threadId }) => {
    const sandboxResult = await getOrCreateDesktopSandbox(userId, threadId);
    if (!sandboxResult.success) {
      return sandboxResult;
    }
    const sandboxId = sandboxResult.sandboxId;
    const service = getE2BDesktopService();

    try {
      const result = await service.type(sandboxId, text);

      // Take screenshot after typing
      const screenshot = await service.screenshot(sandboxId);

      return {
        success: result.success,
        message: result.message,
        sandboxId,
        screenshot: `data:image/png;base64,${screenshot.base64}`,
        error: result.error,
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
 * Press keyboard keys.
 */
export const desktopPressTool = createTool({
  description:
    'Press a keyboard key or key combination. Examples: "Enter", "Tab", "ctrl+c", "ctrl+v", "alt+Tab", "F5".',
  inputSchema: z
    .object({
      key: z
        .string()
        .describe(
          'Key or key combination to press (e.g., "Enter", "ctrl+c", "alt+Tab")',
        ),
    })
    .extend(SessionContextParams.shape),
  execute: async ({ key, userId, threadId }) => {
    const sandboxResult = await getOrCreateDesktopSandbox(userId, threadId);
    if (!sandboxResult.success) {
      return sandboxResult;
    }
    const sandboxId = sandboxResult.sandboxId;
    const service = getE2BDesktopService();

    try {
      const result = await service.press(sandboxId, key);

      // Wait a moment for the action to take effect
      await service.wait(sandboxId, 500);

      // Take screenshot after key press
      const screenshot = await service.screenshot(sandboxId);

      return {
        success: result.success,
        message: result.message,
        sandboxId,
        screenshot: `data:image/png;base64,${screenshot.base64}`,
        error: result.error,
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
 * Scroll the screen.
 */
export const desktopScrollTool = createTool({
  description:
    "Scroll the screen up or down. Use this to navigate long pages or documents.",
  inputSchema: z
    .object({
      direction: z.enum(["up", "down"]).describe("Direction to scroll"),
      amount: z.number().optional().describe("Amount to scroll (default: 3)"),
    })
    .extend(SessionContextParams.shape),
  execute: async ({ direction, amount = 3, userId, threadId }) => {
    const sandboxResult = await getOrCreateDesktopSandbox(userId, threadId);
    if (!sandboxResult.success) {
      return sandboxResult;
    }
    const sandboxId = sandboxResult.sandboxId;
    const service = getE2BDesktopService();

    try {
      const result = await service.scroll(sandboxId, direction, amount);

      // Take screenshot after scrolling
      const screenshot = await service.screenshot(sandboxId);

      return {
        success: result.success,
        message: result.message,
        sandboxId,
        screenshot: `data:image/png;base64,${screenshot.base64}`,
        error: result.error,
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
 * Launch an application.
 */
export const desktopLaunchTool = createTool({
  description:
    'Launch an application in the desktop. Common apps: "google-chrome", "firefox", "code" (VS Code), "libreoffice", "gimp", "terminal".',
  inputSchema: z
    .object({
      app: z.string().describe("Application name to launch"),
    })
    .extend(SessionContextParams.shape),
  execute: async ({ app, userId, threadId }) => {
    const sandboxResult = await getOrCreateDesktopSandbox(userId, threadId);
    if (!sandboxResult.success) {
      return sandboxResult;
    }
    const sandboxId = sandboxResult.sandboxId;
    const service = getE2BDesktopService();

    try {
      const result = await service.launchApp(sandboxId, app);

      // Wait for app to fully open
      await service.wait(sandboxId, 2000);

      // Take screenshot after launching
      const screenshot = await service.screenshot(sandboxId);

      return {
        success: result.success,
        message: result.message,
        sandboxId,
        screenshot: `data:image/png;base64,${screenshot.base64}`,
        error: result.error,
        guide: `${app} has been launched. Use desktop_screenshot to see the current state and desktop_click/desktop_type to interact.`,
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
 * Move mouse to coordinates.
 */
export const desktopMoveTool = createTool({
  description:
    "Move the mouse cursor to specific coordinates without clicking. Useful for hovering over elements.",
  inputSchema: z
    .object({
      x: z.number().describe("X coordinate to move to"),
      y: z.number().describe("Y coordinate to move to"),
    })
    .extend(SessionContextParams.shape),
  execute: async ({ x, y, userId, threadId }) => {
    const sandboxResult = await getOrCreateDesktopSandbox(userId, threadId);
    if (!sandboxResult.success) {
      return sandboxResult;
    }
    const sandboxId = sandboxResult.sandboxId;
    const service = getE2BDesktopService();

    try {
      const result = await service.moveMouse(sandboxId, x, y);

      return {
        success: result.success,
        message: result.message,
        sandboxId,
        error: result.error,
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
 * Drag from one point to another.
 */
export const desktopDragTool = createTool({
  description:
    "Drag from one point to another. Useful for moving windows, selecting text, or drag-and-drop operations.",
  inputSchema: z
    .object({
      startX: z.number().describe("Starting X coordinate"),
      startY: z.number().describe("Starting Y coordinate"),
      endX: z.number().describe("Ending X coordinate"),
      endY: z.number().describe("Ending Y coordinate"),
    })
    .extend(SessionContextParams.shape),
  execute: async ({ startX, startY, endX, endY, userId, threadId }) => {
    const sandboxResult = await getOrCreateDesktopSandbox(userId, threadId);
    if (!sandboxResult.success) {
      return sandboxResult;
    }
    const sandboxId = sandboxResult.sandboxId;
    const service = getE2BDesktopService();

    try {
      const result = await service.drag(sandboxId, startX, startY, endX, endY);

      // Take screenshot after drag
      const screenshot = await service.screenshot(sandboxId);

      return {
        success: result.success,
        message: result.message,
        sandboxId,
        screenshot: `data:image/png;base64,${screenshot.base64}`,
        error: result.error,
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
 * Run a shell command in the sandbox.
 */
export const desktopCommandTool = createTool({
  description:
    "Run a shell command in the desktop sandbox. Useful for installing software, running scripts, or system tasks.",
  inputSchema: z
    .object({
      command: z.string().describe("Shell command to execute"),
    })
    .extend(SessionContextParams.shape),
  execute: async ({ command, userId, threadId }) => {
    const sandboxResult = await getOrCreateDesktopSandbox(userId, threadId);
    if (!sandboxResult.success) {
      return sandboxResult;
    }
    const sandboxId = sandboxResult.sandboxId;
    const service = getE2BDesktopService();

    try {
      const result = await service.runCommand(sandboxId, command);

      return {
        success: result.exitCode === 0,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        sandboxId,
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
 * Start streaming the desktop.
 */
export const desktopStreamTool = createTool({
  description:
    "Start a live video stream of the desktop. Returns a URL that can be used to view the desktop in real-time.",
  inputSchema: SessionContextParams,
  execute: async ({ userId, threadId }) => {
    const sandboxResult = await getOrCreateDesktopSandbox(userId, threadId);
    if (!sandboxResult.success) {
      return sandboxResult;
    }
    const sandboxId = sandboxResult.sandboxId;
    const service = getE2BDesktopService();

    try {
      const streamInfo = await service.startStream(sandboxId, {
        requireAuth: true,
      });

      return {
        success: true,
        streamUrl: streamInfo.url,
        authKey: streamInfo.authKey,
        sandboxId,
        message: "Desktop stream started. Open the stream URL to view live.",
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
 * Close the desktop sandbox.
 */
export const desktopCloseTool = createTool({
  description:
    "Close the desktop sandbox and release resources. Use this when done with computer use tasks.",
  inputSchema: SessionContextParams,
  execute: async ({ userId: _userId, threadId }) => {
    const service = getE2BDesktopService();

    // Look up session from database
    const sandboxId = await getActiveDesktopForThread(threadId);

    if (!sandboxId) {
      return {
        success: true,
        message: "No active sandbox to close.",
      };
    }

    try {
      await service.closeDesktop(sandboxId);

      return {
        success: true,
        message: `Desktop sandbox ${sandboxId} closed successfully.`,
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

// Export all desktop tools as a collection
export const desktopTools = {
  desktop_create: desktopCreateTool,
  desktop_screenshot: desktopScreenshotTool,
  desktop_click: desktopClickTool,
  desktop_type: desktopTypeTool,
  desktop_press: desktopPressTool,
  desktop_scroll: desktopScrollTool,
  desktop_launch: desktopLaunchTool,
  desktop_move: desktopMoveTool,
  desktop_drag: desktopDragTool,
  desktop_command: desktopCommandTool,
  desktop_stream: desktopStreamTool,
  desktop_close: desktopCloseTool,
};
