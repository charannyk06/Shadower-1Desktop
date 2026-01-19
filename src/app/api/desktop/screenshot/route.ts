/**
 * Local Desktop Screenshot API Route
 *
 * Takes screenshots locally in the Electron environment.
 * This replaces the cloud-based E2B Desktop with local screenshot capture.
 *
 * Supports:
 * - Chrome browser screenshots (via Chrome DevTools Protocol)
 * - Desktop screenshots (via native OS tools in Electron)
 *
 * Note: This API route is primarily for non-Electron contexts.
 * In the Electron app, prefer using IPC calls directly.
 */

import { validateSession } from "lib/api/auth-helpers";

interface ScreenshotResult {
  success: boolean;
  screenshot?: string;
  width?: number;
  height?: number;
  format?: string;
  error?: string;
}

/**
 * GET /api/desktop/screenshot - Get a screenshot of the local desktop or browser
 * Used by DesktopPreview component for live polling
 */
export async function GET(req: Request) {
  try {
    const auth = await validateSession();
    if (!auth.success) return auth.response;

    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get("sessionId");
    const threadId = searchParams.get("threadId");
    const source = searchParams.get("source") || "browser"; // "browser" or "desktop"

    // For Electron environment, return instructions to use IPC
    if (typeof window !== "undefined" && (window as any).electronAPI) {
      return Response.json(
        {
          success: false,
          error: "In Electron environment, use IPC calls instead of API routes",
          suggestion:
            source === "browser"
              ? "Use window.electronAPI.chrome.screenshot()"
              : "Use window.electronAPI.terminal.screenshot()",
        },
        { status: 400 },
      );
    }

    // For server-side (non-Electron), we can only take screenshots
    // if we have access to native screenshot tools
    const result = await takeLocalScreenshot(source, sessionId || threadId);

    if (!result.success) {
      return Response.json(
        {
          success: false,
          error: result.error || "Failed to take screenshot",
          code: "SCREENSHOT_FAILED",
        },
        { status: 500 },
      );
    }

    return Response.json({
      success: true,
      screenshot: result.screenshot,
      width: result.width,
      height: result.height,
      format: result.format || "png",
      sessionId: sessionId || threadId,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("[Desktop Screenshot] Unexpected error:", error);
    return Response.json(
      { success: false, error: error.message },
      { status: 500 },
    );
  }
}

/**
 * POST /api/desktop/screenshot - Take a screenshot with options
 */
export async function POST(req: Request) {
  try {
    const auth = await validateSession();
    if (!auth.success) return auth.response;

    const body = await req.json();
    const { sessionId, threadId, source = "browser", fullPage = false } = body;

    // For Electron environment, return instructions to use IPC
    if (typeof window !== "undefined" && (window as any).electronAPI) {
      return Response.json(
        {
          success: false,
          error: "In Electron environment, use IPC calls instead of API routes",
          suggestion:
            source === "browser"
              ? "Use window.electronAPI.chrome.screenshot()"
              : "Use window.electronAPI.terminal.screenshot()",
        },
        { status: 400 },
      );
    }

    const result = await takeLocalScreenshot(
      source,
      sessionId || threadId,
      fullPage,
    );

    if (!result.success) {
      return Response.json(
        {
          success: false,
          error: result.error || "Failed to take screenshot",
          code: "SCREENSHOT_FAILED",
        },
        { status: 500 },
      );
    }

    return Response.json({
      success: true,
      screenshot: result.screenshot,
      width: result.width,
      height: result.height,
      format: result.format || "png",
      sessionId: sessionId || threadId,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("[Desktop Screenshot POST] Error:", error);
    return Response.json(
      { success: false, error: error.message },
      { status: 500 },
    );
  }
}

/**
 * Take a local screenshot using available tools
 * This is a server-side fallback for non-Electron contexts
 */
async function takeLocalScreenshot(
  source: string,
  _identifier?: string | null,
  fullPage = false,
): Promise<ScreenshotResult> {
  try {
    if (source === "browser") {
      // Try to connect to Chrome DevTools Protocol
      return await takeChromeScreenshot(fullPage);
    } else {
      // Desktop screenshot using native tools
      return await takeDesktopScreenshot();
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.message || "Screenshot capture failed",
    };
  }
}

/**
 * Take a screenshot of Chrome browser via DevTools Protocol
 */
async function takeChromeScreenshot(
  fullPage = false,
): Promise<ScreenshotResult> {
  try {
    // Dynamic import to avoid bundling issues
    const CDP = await import("chrome-remote-interface").then((m) => m.default);

    const port = parseInt(process.env.CHROME_DEBUGGING_PORT || "9222", 10);

    let client;
    try {
      client = await CDP({ port });
    } catch {
      return {
        success: false,
        error: `Cannot connect to Chrome on port ${port}. Make sure Chrome is running with --remote-debugging-port=${port}`,
      };
    }

    const { Page } = client;

    // Enable Page domain
    await Page.enable();

    // Take screenshot
    const { data } = await Page.captureScreenshot({
      format: "png",
      captureBeyondViewport: fullPage,
    });

    await client.close();

    return {
      success: true,
      screenshot: `data:image/png;base64,${data}`,
      format: "png",
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || "Chrome screenshot failed",
    };
  }
}

/**
 * Take a screenshot of the desktop using native OS tools
 */
async function takeDesktopScreenshot(): Promise<ScreenshotResult> {
  try {
    const { execSync } = await import("child_process");
    const { readFileSync, unlinkSync } = await import("fs");
    const { join } = await import("path");
    const { tmpdir } = await import("os");

    const tempFile = join(tmpdir(), `screenshot_${Date.now()}.png`);
    const platform = process.platform;

    try {
      if (platform === "darwin") {
        // macOS: use screencapture
        execSync(`screencapture -x "${tempFile}"`, { timeout: 10000 });
      } else if (platform === "win32") {
        // Windows: use PowerShell snippet
        const psScript = `
          Add-Type -AssemblyName System.Windows.Forms
          [System.Windows.Forms.Screen]::PrimaryScreen | ForEach-Object {
            $bitmap = New-Object System.Drawing.Bitmap($_.Bounds.Width, $_.Bounds.Height)
            $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
            $graphics.CopyFromScreen($_.Bounds.Location, [System.Drawing.Point]::Empty, $_.Bounds.Size)
            $bitmap.Save('${tempFile.replace(/\\/g, "\\\\")}')
          }
        `;
        execSync(`powershell -Command "${psScript.replace(/"/g, '\\"')}"`, {
          timeout: 10000,
        });
      } else if (platform === "linux") {
        // Linux: try gnome-screenshot, scrot, or import
        try {
          execSync(`gnome-screenshot -f "${tempFile}"`, { timeout: 10000 });
        } catch {
          try {
            execSync(`scrot "${tempFile}"`, { timeout: 10000 });
          } catch {
            execSync(`import -window root "${tempFile}"`, { timeout: 10000 });
          }
        }
      } else {
        return {
          success: false,
          error: `Unsupported platform: ${platform}`,
        };
      }

      // Read the screenshot file
      const imageBuffer = readFileSync(tempFile);
      const base64 = imageBuffer.toString("base64");

      // Clean up temp file
      unlinkSync(tempFile);

      return {
        success: true,
        screenshot: `data:image/png;base64,${base64}`,
        format: "png",
      };
    } catch (error: any) {
      // Try to clean up temp file even on error
      try {
        unlinkSync(tempFile);
      } catch {
        // Ignore cleanup errors
      }

      return {
        success: false,
        error: `Desktop screenshot failed: ${error.message}`,
      };
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.message || "Desktop screenshot failed",
    };
  }
}
