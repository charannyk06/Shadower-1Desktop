import { Sandbox } from "@e2b/desktop";
import {
  createBrowserSession,
  getSessionForThread,
  updateSessionStatus,
} from "../../middleware/session-quota";

/**
 * E2B Desktop Sandbox Service
 *
 * Provides computer use capabilities via E2B Desktop sandboxes.
 * Supports screenshots, mouse/keyboard control, and VNC streaming.
 *
 * IMPORTANT: Sessions are persisted to the database for multi-user/serverless support.
 * The in-memory cache is only used for holding the active Sandbox reference.
 */

export interface DesktopSession {
  sandboxId: string;
  sandbox: Sandbox;
  status: "active" | "closed" | "error";
  streamUrl?: string;
  authKey?: string;
  createdAt: Date;
  userId?: string;
  threadId?: string;
}

export interface DesktopOptions {
  /** Timeout in milliseconds for the sandbox (default: 5 minutes) */
  timeout?: number;
  /** User ID who owns this session (required for database persistence) */
  userId?: string;
  /** Thread ID to associate with this session (required for database lookup) */
  threadId?: string;
}

export interface ScreenshotResult {
  base64: string;
  width: number;
  height: number;
  format: "png";
}

export interface ActionResult {
  success: boolean;
  message?: string;
  error?: string;
}

export interface StreamInfo {
  url: string;
  authKey: string;
}

class E2BDesktopService {
  private static instance: E2BDesktopService;
  /**
   * In-memory cache for Sandbox references.
   * Note: This is only a cache - sessions are persisted to database.
   * In serverless environments, this cache may be empty on cold starts.
   */
  private sandboxCache: Map<string, Sandbox> = new Map();

  private constructor() {}

  public static getInstance(): E2BDesktopService {
    if (!E2BDesktopService.instance) {
      E2BDesktopService.instance = new E2BDesktopService();
    }
    return E2BDesktopService.instance;
  }

  /**
   * Check if E2B is configured with API key.
   */
  public isConfigured(): boolean {
    return !!process.env.E2B_API_KEY;
  }

  /**
   * Get a cached sandbox reference or reconnect if needed.
   */
  private async getSandbox(sandboxId: string): Promise<Sandbox | null> {
    // Check cache first
    const cached = this.sandboxCache.get(sandboxId);
    if (cached) {
      return cached;
    }

    // Try to reconnect to existing sandbox
    try {
      const sandbox = await Sandbox.connect(sandboxId);
      this.sandboxCache.set(sandboxId, sandbox);
      return sandbox;
    } catch (error) {
      console.warn(
        `[E2B Desktop] Could not reconnect to sandbox ${sandboxId}:`,
        error,
      );
      return null;
    }
  }

  /**
   * Create a new desktop sandbox.
   */
  public async createDesktop(
    options: DesktopOptions = {},
  ): Promise<DesktopSession> {
    if (!this.isConfigured()) {
      throw new Error("E2B_API_KEY is not configured");
    }

    const { timeout, userId, threadId } = options;

    if (!userId || !threadId) {
      throw new Error("userId and threadId are required for session tracking");
    }

    try {
      const timeoutMs = timeout || 5 * 60 * 1000; // 5 minutes default

      console.log("[E2B Desktop] Creating new desktop sandbox...");

      const sandbox = await Sandbox.create({
        timeoutMs,
      });

      // Cache the sandbox reference
      this.sandboxCache.set(sandbox.sandboxId, sandbox);

      // Persist to database
      await createBrowserSession({
        threadId,
        userId,
        provider: "e2b-desktop",
        sessionId: sandbox.sandboxId,
      });

      const session: DesktopSession = {
        sandboxId: sandbox.sandboxId,
        sandbox,
        status: "active",
        createdAt: new Date(),
        userId,
        threadId,
      };

      console.log(`[E2B Desktop] Sandbox created: ${sandbox.sandboxId}`);

      return session;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("[E2B Desktop] Failed to create sandbox:", error);
      throw new Error(`Failed to create desktop sandbox: ${message}`);
    }
  }

  /**
   * Get session for a thread from the database.
   */
  public async getSessionForThread(
    threadId: string,
  ): Promise<{ sandboxId: string } | null> {
    const dbSession = await getSessionForThread(threadId, "e2b-desktop");
    if (!dbSession) return null;
    return { sandboxId: dbSession.sessionId };
  }

  /**
   * Close a desktop sandbox.
   */
  public async closeDesktop(sandboxId: string): Promise<void> {
    try {
      // Try to get sandbox from cache or reconnect
      const sandbox = await this.getSandbox(sandboxId);

      if (sandbox) {
        // Stop stream if active
        try {
          await sandbox.stream.stop();
        } catch {
          // Ignore stream stop errors
        }

        // Kill the sandbox
        await sandbox.kill();
      }

      // Remove from cache
      this.sandboxCache.delete(sandboxId);

      // Update database status
      await updateSessionStatus(sandboxId, "closed");

      console.log(`[E2B Desktop] Sandbox closed: ${sandboxId}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(`[E2B Desktop] Error closing sandbox:`, error);
      // Update database status to error
      await updateSessionStatus(sandboxId, "error");
      throw new Error(`Failed to close sandbox: ${message}`);
    }
  }

  /**
   * Take a screenshot of the desktop.
   */
  public async screenshot(sandboxId: string): Promise<ScreenshotResult> {
    const sandbox = await this.getSandbox(sandboxId);
    if (!sandbox) {
      throw new Error("Session not found or could not reconnect");
    }

    try {
      const imageBuffer = await sandbox.screenshot();

      // Convert buffer to base64
      const base64 = Buffer.from(imageBuffer).toString("base64");

      return {
        base64,
        width: 1920, // Default desktop resolution
        height: 1080,
        format: "png",
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new Error(`Screenshot failed: ${message}`);
    }
  }

  /**
   * Get screen dimensions.
   */
  public async getScreenSize(
    sandboxId: string,
  ): Promise<{ width: number; height: number }> {
    const sandbox = await this.getSandbox(sandboxId);
    if (!sandbox) {
      throw new Error("Session not found or could not reconnect");
    }

    // E2B desktop defaults to 1920x1080
    return { width: 1920, height: 1080 };
  }

  /**
   * Left click at current position or specified coordinates.
   */
  public async leftClick(
    sandboxId: string,
    x?: number,
    y?: number,
  ): Promise<ActionResult> {
    const sandbox = await this.getSandbox(sandboxId);
    if (!sandbox) {
      return {
        success: false,
        error: "Session not found or could not reconnect",
      };
    }

    try {
      if (x !== undefined && y !== undefined) {
        await sandbox.moveMouse(x, y);
      }
      await sandbox.leftClick();
      return { success: true, message: "Left click performed" };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return { success: false, error: message };
    }
  }

  /**
   * Right click at current position or specified coordinates.
   */
  public async rightClick(
    sandboxId: string,
    x?: number,
    y?: number,
  ): Promise<ActionResult> {
    const sandbox = await this.getSandbox(sandboxId);
    if (!sandbox) {
      return {
        success: false,
        error: "Session not found or could not reconnect",
      };
    }

    try {
      if (x !== undefined && y !== undefined) {
        await sandbox.moveMouse(x, y);
      }
      await sandbox.rightClick();
      return { success: true, message: "Right click performed" };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return { success: false, error: message };
    }
  }

  /**
   * Double click at current position or specified coordinates.
   */
  public async doubleClick(
    sandboxId: string,
    x?: number,
    y?: number,
  ): Promise<ActionResult> {
    const sandbox = await this.getSandbox(sandboxId);
    if (!sandbox) {
      return {
        success: false,
        error: "Session not found or could not reconnect",
      };
    }

    try {
      if (x !== undefined && y !== undefined) {
        await sandbox.moveMouse(x, y);
      }
      await sandbox.doubleClick();
      return { success: true, message: "Double click performed" };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return { success: false, error: message };
    }
  }

  /**
   * Move mouse to specified coordinates.
   */
  public async moveMouse(
    sandboxId: string,
    x: number,
    y: number,
  ): Promise<ActionResult> {
    const sandbox = await this.getSandbox(sandboxId);
    if (!sandbox) {
      return {
        success: false,
        error: "Session not found or could not reconnect",
      };
    }

    try {
      await sandbox.moveMouse(x, y);
      return { success: true, message: `Mouse moved to (${x}, ${y})` };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return { success: false, error: message };
    }
  }

  /**
   * Drag from one position to another.
   */
  public async drag(
    sandboxId: string,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
  ): Promise<ActionResult> {
    const sandbox = await this.getSandbox(sandboxId);
    if (!sandbox) {
      return {
        success: false,
        error: "Session not found or could not reconnect",
      };
    }

    try {
      // Move to start, press, move to end, release
      await sandbox.moveMouse(startX, startY);
      // Note: E2B desktop may not have drag directly, simulate with mouse events
      await sandbox.leftClick();
      await sandbox.moveMouse(endX, endY);
      await sandbox.leftClick();
      return {
        success: true,
        message: `Dragged from (${startX}, ${startY}) to (${endX}, ${endY})`,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return { success: false, error: message };
    }
  }

  /**
   * Scroll the mouse wheel.
   */
  public async scroll(
    sandboxId: string,
    direction: "up" | "down",
    amount: number = 3,
  ): Promise<ActionResult> {
    const sandbox = await this.getSandbox(sandboxId);
    if (!sandbox) {
      return {
        success: false,
        error: "Session not found or could not reconnect",
      };
    }

    try {
      await sandbox.scroll(direction, amount);
      return { success: true, message: `Scrolled ${direction} by ${amount}` };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return { success: false, error: message };
    }
  }

  /**
   * Type text at current cursor position.
   */
  public async type(sandboxId: string, text: string): Promise<ActionResult> {
    const sandbox = await this.getSandbox(sandboxId);
    if (!sandbox) {
      return {
        success: false,
        error: "Session not found or could not reconnect",
      };
    }

    try {
      await sandbox.write(text);
      return { success: true, message: `Typed: "${text}"` };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return { success: false, error: message };
    }
  }

  /**
   * Press a keyboard key or key combination.
   */
  public async press(
    sandboxId: string,
    key: string | string[],
  ): Promise<ActionResult> {
    const sandbox = await this.getSandbox(sandboxId);
    if (!sandbox) {
      return {
        success: false,
        error: "Session not found or could not reconnect",
      };
    }

    try {
      if (Array.isArray(key)) {
        // Press key combination (e.g., ["ctrl", "c"])
        const combo = key.join("+");
        await sandbox.press(combo);
        return { success: true, message: `Pressed: ${combo}` };
      } else {
        await sandbox.press(key);
        return { success: true, message: `Pressed: ${key}` };
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return { success: false, error: message };
    }
  }

  /**
   * Launch an application in the desktop.
   */
  public async launchApp(
    sandboxId: string,
    appName: string,
  ): Promise<ActionResult> {
    const sandbox = await this.getSandbox(sandboxId);
    if (!sandbox) {
      return {
        success: false,
        error: "Session not found or could not reconnect",
      };
    }

    try {
      await sandbox.launch(appName);
      // Wait for app to open
      await sandbox.wait(3000);
      return { success: true, message: `Launched: ${appName}` };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return { success: false, error: message };
    }
  }

  /**
   * Start streaming the desktop.
   */
  public async startStream(
    sandboxId: string,
    options: { windowId?: string; requireAuth?: boolean } = {},
  ): Promise<StreamInfo> {
    const sandbox = await this.getSandbox(sandboxId);
    if (!sandbox) {
      throw new Error("Session not found or could not reconnect");
    }

    try {
      // Get current window ID if not provided
      let windowId = options.windowId;
      if (!windowId) {
        windowId = await sandbox.getCurrentWindowId();
      }

      await sandbox.stream.start({
        windowId,
        requireAuth: options.requireAuth ?? true,
      });

      const authKey = sandbox.stream.getAuthKey();
      const url = sandbox.stream.getUrl({ authKey });

      return { url, authKey };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new Error(`Failed to start stream: ${message}`);
    }
  }

  /**
   * Stop streaming.
   */
  public async stopStream(sandboxId: string): Promise<void> {
    const sandbox = await this.getSandbox(sandboxId);
    if (!sandbox) {
      throw new Error("Session not found or could not reconnect");
    }

    try {
      await sandbox.stream.stop();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new Error(`Failed to stop stream: ${message}`);
    }
  }

  /**
   * Wait for a specified duration.
   */
  public async wait(sandboxId: string, ms: number): Promise<void> {
    const sandbox = await this.getSandbox(sandboxId);
    if (!sandbox) {
      throw new Error("Session not found or could not reconnect");
    }
    await sandbox.wait(ms);
  }

  /**
   * Execute a shell command in the sandbox.
   */
  public async runCommand(
    sandboxId: string,
    command: string,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const sandbox = await this.getSandbox(sandboxId);
    if (!sandbox) {
      throw new Error("Session not found or could not reconnect");
    }

    try {
      const result = await sandbox.commands.run(command);
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new Error(`Command execution failed: ${message}`);
    }
  }

  /**
   * Clean up cached sandbox references.
   * Note: This only clears the local cache, not database sessions.
   */
  public async cleanup(): Promise<void> {
    const sandboxIds = Array.from(this.sandboxCache.keys());
    for (const sandboxId of sandboxIds) {
      try {
        await this.closeDesktop(sandboxId);
      } catch (error) {
        console.error(
          `[E2B Desktop] Error cleaning up session ${sandboxId}:`,
          error,
        );
      }
    }
  }
}

// Export singleton instance getter
export function getE2BDesktopService(): E2BDesktopService {
  return E2BDesktopService.getInstance();
}

export { E2BDesktopService };
