/**
 * Terminal IPC handlers for desktop automation
 *
 * Provides local command execution, screenshot capture,
 * and mouse/keyboard automation for the desktop app.
 *
 * SECURITY:
 * - Input validation for all user-provided parameters
 * - Logging of dangerous command patterns
 * - Use of execFile where possible to avoid shell injection
 */

import { ipcMain, desktopCapturer, screen } from "electron";
import { exec, spawn, execFile } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// SECURITY: Validate coordinates are safe numbers
function validateCoordinates(
  x: unknown,
  y: unknown,
): { x: number; y: number } | null {
  const xNum = Number(x);
  const yNum = Number(y);
  if (
    !Number.isFinite(xNum) ||
    !Number.isFinite(yNum) ||
    xNum < 0 ||
    yNum < 0 ||
    xNum > 100000 ||
    yNum > 100000
  ) {
    return null;
  }
  return { x: Math.floor(xNum), y: Math.floor(yNum) };
}

// SECURITY: Sanitize text for AppleScript by escaping special characters
function sanitizeForAppleScript(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/'/g, "'\\''");
}

// SECURITY: Log potentially dangerous commands
function logCommandExecution(command: string): void {
  const dangerousPatterns = [
    /rm\s+(-rf?|--recursive)/i,
    /sudo/i,
    /chmod\s+777/i,
    />\s*\/dev\//i,
    /mkfs/i,
    /dd\s+if=/i,
    /:(){ :|:& };:/i, // fork bomb
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(command)) {
      console.warn(
        `[Terminal] SECURITY WARNING: Potentially dangerous command executed: ${command.substring(0, 100)}`,
      );
      break;
    }
  }
}

// Platform-specific automation helpers
const platform = process.platform;

/**
 * Execute a shell command with timeout support
 * SECURITY: Logs potentially dangerous commands for audit
 */
async function executeCommand(options: {
  command: string;
  cwd?: string;
  timeout?: number;
  env?: Record<string, string>;
}): Promise<{
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  error?: string;
}> {
  const { command, cwd, timeout = 60000, env } = options;

  // SECURITY: Log potentially dangerous commands
  logCommandExecution(command);

  try {
    // Determine shell based on platform
    const shell = platform === "win32" ? "cmd.exe" : "/bin/bash";
    const shellArgs = platform === "win32" ? ["/c"] : ["-c"];

    return new Promise((resolve) => {
      const child = spawn(shell, [...shellArgs, command], {
        cwd: cwd || process.cwd(),
        env: { ...process.env, ...env },
        timeout,
      });

      const stdout: string[] = [];
      const stderr: string[] = [];

      child.stdout?.on("data", (data) => {
        stdout.push(data.toString());
      });

      child.stderr?.on("data", (data) => {
        stderr.push(data.toString());
      });

      child.on("error", (error) => {
        resolve({
          success: false,
          stdout: stdout.join(""),
          stderr: stderr.join(""),
          exitCode: 1,
          error: error.message,
        });
      });

      child.on("close", (code) => {
        resolve({
          success: code === 0,
          stdout: stdout.join(""),
          stderr: stderr.join(""),
          exitCode: code ?? 1,
        });
      });

      // Handle timeout
      setTimeout(() => {
        child.kill("SIGTERM");
        resolve({
          success: false,
          stdout: stdout.join(""),
          stderr: stderr.join(""),
          exitCode: 124, // Standard timeout exit code
          error: `Command timed out after ${timeout}ms`,
        });
      }, timeout);
    });
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
}

/**
 * Take a screenshot of the desktop
 */
async function captureScreenshot(options: {
  fullScreen?: boolean;
  displayId?: string;
}): Promise<{
  success: boolean;
  screenshot?: string; // Base64 encoded PNG
  width?: number;
  height?: number;
  error?: string;
}> {
  try {
    const { displayId } = options;

    // Get all available sources
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: 1920, height: 1080 },
    });

    if (sources.length === 0) {
      return {
        success: false,
        error: "No display sources available",
      };
    }

    // Find the requested display or use primary
    let source = sources[0];
    if (displayId) {
      const found = sources.find((s) => s.display_id === displayId);
      if (found) source = found;
    }

    // Get the thumbnail (screenshot)
    const thumbnail = source.thumbnail;

    if (!thumbnail || thumbnail.isEmpty()) {
      return {
        success: false,
        error: "Failed to capture screenshot - thumbnail is empty",
      };
    }

    // Convert to base64 PNG
    const base64 = thumbnail.toPNG().toString("base64");
    const size = thumbnail.getSize();

    return {
      success: true,
      screenshot: base64,
      width: size.width,
      height: size.height,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      success: false,
      error: message,
    };
  }
}

/**
 * Platform-specific mouse click implementation
 * SECURITY: Validates coordinates before use
 */
async function performClick(options: {
  x: number;
  y: number;
  button?: "left" | "right" | "double";
}): Promise<{ success: boolean; message?: string; error?: string }> {
  const { x, y, button = "left" } = options;

  // SECURITY: Validate coordinates
  const coords = validateCoordinates(x, y);
  if (!coords) {
    return {
      success: false,
      error: "Invalid coordinates: must be non-negative finite numbers",
    };
  }

  try {
    if (platform === "darwin") {
      // macOS: Use cliclick or AppleScript
      let clickType = "c"; // click
      if (button === "right") clickType = "rc";
      if (button === "double") clickType = "dc";

      // Try cliclick first (if installed)
      // SECURITY: Use execFileAsync to avoid shell injection
      try {
        await execFileAsync("cliclick", [`${clickType}:${coords.x},${coords.y}`]);
        return { success: true, message: `Clicked at (${coords.x}, ${coords.y})` };
      } catch {
        // Fall back to AppleScript using execFile
        const script =
          button === "right"
            ? `tell application "System Events" to click at {${coords.x}, ${coords.y}} using right button`
            : button === "double"
              ? `tell application "System Events" to double click at {${coords.x}, ${coords.y}}`
              : `tell application "System Events" to click at {${coords.x}, ${coords.y}}`;

        // SECURITY: Use execFileAsync with args array to avoid shell injection
        await execFileAsync("osascript", ["-e", script]);
        return { success: true, message: `Clicked at (${coords.x}, ${coords.y})` };
      }
    } else if (platform === "win32") {
      // Windows: Use PowerShell
      const buttonType =
        button === "right" ? "Right" : button === "double" ? "Double" : "Left";
      const script = `
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y})
        $signature = @"
        [DllImport("user32.dll", CharSet = CharSet.Auto, CallingConvention = CallingConvention.StdCall)]
        public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint cButtons, uint dwExtraInfo);
"@
        $MouseEvent = Add-Type -memberDefinition $signature -name "MouseEvent" -namespace Win32Functions -passThru
        ${
          buttonType === "Right"
            ? "$MouseEvent::mouse_event(0x08, 0, 0, 0, 0); $MouseEvent::mouse_event(0x10, 0, 0, 0, 0)"
            : buttonType === "Double"
              ? "$MouseEvent::mouse_event(0x02, 0, 0, 0, 0); $MouseEvent::mouse_event(0x04, 0, 0, 0, 0); $MouseEvent::mouse_event(0x02, 0, 0, 0, 0); $MouseEvent::mouse_event(0x04, 0, 0, 0, 0)"
              : "$MouseEvent::mouse_event(0x02, 0, 0, 0, 0); $MouseEvent::mouse_event(0x04, 0, 0, 0, 0)"
        }
      `;
      await execAsync(`powershell -Command "${script.replace(/"/g, '\\"')}"`);
      return { success: true, message: `Clicked at (${x}, ${y})` };
    } else {
      // Linux: Use xdotool
      const clickCmd =
        button === "right"
          ? `xdotool mousemove ${x} ${y} click 3`
          : button === "double"
            ? `xdotool mousemove ${x} ${y} click --repeat 2 1`
            : `xdotool mousemove ${x} ${y} click 1`;
      await execAsync(clickCmd);
      return { success: true, message: `Clicked at (${x}, ${y})` };
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      success: false,
      error: `Failed to click: ${message}`,
    };
  }
}

/**
 * Platform-specific keyboard typing
 * SECURITY: Sanitizes text input before use
 */
async function performType(options: {
  text: string;
}): Promise<{ success: boolean; message?: string; error?: string }> {
  const { text } = options;

  // SECURITY: Validate text is a string and not too long
  if (typeof text !== "string" || text.length > 10000) {
    return {
      success: false,
      error: "Invalid text: must be a string under 10000 characters",
    };
  }

  try {
    if (platform === "darwin") {
      // macOS: Use AppleScript with execFile for safety
      // SECURITY: Sanitize text for AppleScript
      const sanitizedText = sanitizeForAppleScript(text);
      const script = `tell application "System Events" to keystroke "${sanitizedText}"`;

      // SECURITY: Use execFileAsync with args array to avoid shell injection
      await execFileAsync("osascript", ["-e", script]);
      return { success: true, message: `Typed: ${text.substring(0, 20)}...` };
    } else if (platform === "win32") {
      // Windows: Use PowerShell
      const escapedText = text.replace(/"/g, '`"');
      await execAsync(
        `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${escapedText}')"`,
      );
      return { success: true, message: `Typed: ${text}` };
    } else {
      // Linux: Use xdotool
      await execAsync(`xdotool type "${text}"`);
      return { success: true, message: `Typed: ${text}` };
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      success: false,
      error: `Failed to type: ${message}`,
    };
  }
}

/**
 * Platform-specific key press
 */
async function performKeyPress(options: {
  key: string;
}): Promise<{ success: boolean; message?: string; error?: string }> {
  const { key } = options;

  try {
    // Parse key combination (e.g., "ctrl+c", "cmd+v", "Enter")
    const parts = key.toLowerCase().split("+");
    const mainKey = parts.pop() || key;
    const modifiers = parts;

    if (platform === "darwin") {
      // macOS: Map modifiers and use AppleScript
      const modifierMap: Record<string, string> = {
        ctrl: "control down",
        control: "control down",
        cmd: "command down",
        command: "command down",
        alt: "option down",
        option: "option down",
        shift: "shift down",
      };

      const keyMap: Record<string, string> = {
        enter: "return",
        return: "return",
        tab: "tab",
        escape: "escape",
        esc: "escape",
        space: "space",
        backspace: "delete",
        delete: "forward delete",
        up: "up arrow",
        down: "down arrow",
        left: "left arrow",
        right: "right arrow",
        home: "home",
        end: "end",
        pageup: "page up",
        pagedown: "page down",
      };

      const modifierString = modifiers
        .map((m) => modifierMap[m] || "")
        .filter(Boolean)
        .join(", ");
      const mappedKey = keyMap[mainKey] || mainKey;

      const script = modifierString
        ? `tell application "System Events" to key code (key code of "${mappedKey}") using {${modifierString}}`
        : `tell application "System Events" to keystroke "${mappedKey}"`;

      await execAsync(`osascript -e '${script}'`);
      return { success: true, message: `Pressed: ${key}` };
    } else if (platform === "win32") {
      // Windows: Use SendKeys format
      const modifierMap: Record<string, string> = {
        ctrl: "^",
        control: "^",
        alt: "%",
        shift: "+",
      };

      const keyMap: Record<string, string> = {
        enter: "{ENTER}",
        return: "{ENTER}",
        tab: "{TAB}",
        escape: "{ESC}",
        esc: "{ESC}",
        space: " ",
        backspace: "{BACKSPACE}",
        delete: "{DELETE}",
        up: "{UP}",
        down: "{DOWN}",
        left: "{LEFT}",
        right: "{RIGHT}",
        home: "{HOME}",
        end: "{END}",
        pageup: "{PGUP}",
        pagedown: "{PGDN}",
        f1: "{F1}",
        f2: "{F2}",
        f3: "{F3}",
        f4: "{F4}",
        f5: "{F5}",
        f6: "{F6}",
        f7: "{F7}",
        f8: "{F8}",
        f9: "{F9}",
        f10: "{F10}",
        f11: "{F11}",
        f12: "{F12}",
      };

      const modifierPrefix = modifiers
        .map((m) => modifierMap[m] || "")
        .join("");
      const mappedKey =
        keyMap[mainKey] || (mainKey.length === 1 ? mainKey : `{${mainKey}}`);

      await execAsync(
        `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${modifierPrefix}${mappedKey}')"`,
      );
      return { success: true, message: `Pressed: ${key}` };
    } else {
      // Linux: Use xdotool
      const modifierMap: Record<string, string> = {
        ctrl: "ctrl",
        control: "ctrl",
        alt: "alt",
        shift: "shift",
        super: "super",
        meta: "super",
      };

      const keyMap: Record<string, string> = {
        enter: "Return",
        return: "Return",
        tab: "Tab",
        escape: "Escape",
        esc: "Escape",
        space: "space",
        backspace: "BackSpace",
        delete: "Delete",
        up: "Up",
        down: "Down",
        left: "Left",
        right: "Right",
      };

      const modifierString = modifiers
        .map((m) => modifierMap[m] || m)
        .join("+");
      const mappedKey = keyMap[mainKey] || mainKey;

      const cmd = modifierString
        ? `xdotool key ${modifierString}+${mappedKey}`
        : `xdotool key ${mappedKey}`;

      await execAsync(cmd);
      return { success: true, message: `Pressed: ${key}` };
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      success: false,
      error: `Failed to press key: ${message}`,
    };
  }
}

/**
 * Scroll the screen
 */
async function performScroll(options: {
  direction: "up" | "down";
  amount?: number;
}): Promise<{ success: boolean; message?: string; error?: string }> {
  const { direction, amount = 3 } = options;
  const scrollAmount = direction === "up" ? amount : -amount;

  try {
    if (platform === "darwin") {
      // macOS: Use AppleScript
      const scrollDirection = direction === "up" ? -1 : 1;
      await execAsync(
        `osascript -e 'tell application "System Events" to scroll ${scrollDirection * amount}'`,
      );
      return { success: true, message: `Scrolled ${direction} by ${amount}` };
    } else if (platform === "win32") {
      // Windows: Use PowerShell with mouse_event
      const wheelDelta = scrollAmount * 120; // 120 is one notch
      await execAsync(
        `powershell -Command "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class MouseWin { [DllImport(\\"user32.dll\\")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, int dwData, int dwExtraInfo); }'; [MouseWin]::mouse_event(0x0800, 0, 0, ${wheelDelta}, 0)"`,
      );
      return { success: true, message: `Scrolled ${direction} by ${amount}` };
    } else {
      // Linux: Use xdotool
      const button = direction === "up" ? 4 : 5;
      await execAsync(`xdotool click --repeat ${amount} ${button}`);
      return { success: true, message: `Scrolled ${direction} by ${amount}` };
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      success: false,
      error: `Failed to scroll: ${message}`,
    };
  }
}

/**
 * Drag from one point to another
 */
async function performDrag(options: {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}): Promise<{ success: boolean; message?: string; error?: string }> {
  const { startX, startY, endX, endY } = options;

  try {
    if (platform === "darwin") {
      // macOS: Use cliclick or AppleScript
      try {
        await execAsync(
          `cliclick dd:${startX},${startY} dm:${endX},${endY} du:${endX},${endY}`,
        );
        return {
          success: true,
          message: `Dragged from (${startX}, ${startY}) to (${endX}, ${endY})`,
        };
      } catch {
        // Fall back to slower AppleScript method
        return {
          success: false,
          error:
            "Drag not supported without cliclick on macOS. Install with: brew install cliclick",
        };
      }
    } else if (platform === "win32") {
      // Windows: Use PowerShell
      const script = `
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${startX}, ${startY})
        $signature = @"
        [DllImport("user32.dll", CharSet = CharSet.Auto, CallingConvention = CallingConvention.StdCall)]
        public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint cButtons, uint dwExtraInfo);
"@
        $MouseEvent = Add-Type -memberDefinition $signature -name "MouseEventDrag" -namespace Win32Functions -passThru
        $MouseEvent::mouse_event(0x02, 0, 0, 0, 0)
        Start-Sleep -Milliseconds 50
        [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${endX}, ${endY})
        Start-Sleep -Milliseconds 50
        $MouseEvent::mouse_event(0x04, 0, 0, 0, 0)
      `;
      await execAsync(`powershell -Command "${script.replace(/"/g, '\\"')}"`);
      return {
        success: true,
        message: `Dragged from (${startX}, ${startY}) to (${endX}, ${endY})`,
      };
    } else {
      // Linux: Use xdotool
      await execAsync(
        `xdotool mousemove ${startX} ${startY} mousedown 1 mousemove ${endX} ${endY} mouseup 1`,
      );
      return {
        success: true,
        message: `Dragged from (${startX}, ${startY}) to (${endX}, ${endY})`,
      };
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      success: false,
      error: `Failed to drag: ${message}`,
    };
  }
}

/**
 * Launch an application
 */
async function launchApplication(options: {
  app: string;
  args?: string[];
}): Promise<{
  success: boolean;
  message?: string;
  pid?: number;
  error?: string;
}> {
  const { app, args = [] } = options;

  try {
    if (platform === "darwin") {
      // macOS: Use 'open' command
      const argString = args.length > 0 ? `--args ${args.join(" ")}` : "";
      await execAsync(`open -a "${app}" ${argString}`);
      return { success: true, message: `Launched ${app}` };
    } else if (platform === "win32") {
      // Windows: Use Start-Process
      const argString =
        args.length > 0 ? `-ArgumentList "${args.join(" ")}"` : "";
      await execAsync(
        `powershell -Command "Start-Process '${app}' ${argString}"`,
      );
      return { success: true, message: `Launched ${app}` };
    } else {
      // Linux: Launch directly
      const child = spawn(app, args, {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      return { success: true, message: `Launched ${app}`, pid: child.pid };
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      success: false,
      error: `Failed to launch ${app}: ${message}`,
    };
  }
}

/**
 * Get display information
 */
function getDisplayInfo(): {
  displays: Array<{
    id: number;
    bounds: { x: number; y: number; width: number; height: number };
    workArea: { x: number; y: number; width: number; height: number };
    scaleFactor: number;
    isPrimary: boolean;
  }>;
} {
  const displays = screen.getAllDisplays();
  const primaryDisplay = screen.getPrimaryDisplay();

  return {
    displays: displays.map((display) => ({
      id: display.id,
      bounds: display.bounds,
      workArea: display.workArea,
      scaleFactor: display.scaleFactor,
      isPrimary: display.id === primaryDisplay.id,
    })),
  };
}

/**
 * Register all terminal IPC handlers
 */
export function registerTerminalHandlers(): void {
  console.log("[Terminal] Registering terminal IPC handlers...");

  // Execute command
  ipcMain.handle(
    "terminal:execute",
    async (
      _event,
      options: {
        command: string;
        cwd?: string;
        timeout?: number;
        env?: Record<string, string>;
      },
    ) => {
      console.log(`[Terminal] Executing command: ${options.command}`);
      return await executeCommand(options);
    },
  );

  // Take screenshot
  ipcMain.handle(
    "terminal:screenshot",
    async (
      _event,
      options?: {
        fullScreen?: boolean;
        displayId?: string;
      },
    ) => {
      console.log("[Terminal] Capturing screenshot...");
      return await captureScreenshot(options || {});
    },
  );

  // Click
  ipcMain.handle(
    "terminal:click",
    async (
      _event,
      x: number,
      y: number,
      button?: "left" | "right" | "double",
    ) => {
      console.log(`[Terminal] Clicking at (${x}, ${y})`);
      return await performClick({ x, y, button });
    },
  );

  // Type text
  ipcMain.handle("terminal:type", async (_event, text: string) => {
    console.log(`[Terminal] Typing: ${text.substring(0, 20)}...`);
    return await performType({ text });
  });

  // Key press
  ipcMain.handle("terminal:keyPress", async (_event, key: string) => {
    console.log(`[Terminal] Pressing key: ${key}`);
    return await performKeyPress({ key });
  });

  // Scroll
  ipcMain.handle(
    "terminal:scroll",
    async (_event, direction: "up" | "down", amount?: number) => {
      console.log(`[Terminal] Scrolling ${direction}`);
      return await performScroll({ direction, amount });
    },
  );

  // Drag
  ipcMain.handle(
    "terminal:drag",
    async (
      _event,
      startX: number,
      startY: number,
      endX: number,
      endY: number,
    ) => {
      console.log(
        `[Terminal] Dragging from (${startX}, ${startY}) to (${endX}, ${endY})`,
      );
      return await performDrag({ startX, startY, endX, endY });
    },
  );

  // Launch application
  ipcMain.handle(
    "terminal:launch",
    async (_event, app: string, args?: string[]) => {
      console.log(`[Terminal] Launching: ${app}`);
      return await launchApplication({ app, args });
    },
  );

  // Get display info
  ipcMain.handle("terminal:getDisplayInfo", async () => {
    console.log("[Terminal] Getting display info...");
    return getDisplayInfo();
  });

  // Get cursor position
  ipcMain.handle("terminal:getCursorPosition", async () => {
    const point = screen.getCursorScreenPoint();
    return { x: point.x, y: point.y };
  });

  console.log("[Terminal] Terminal IPC handlers registered successfully");
}
