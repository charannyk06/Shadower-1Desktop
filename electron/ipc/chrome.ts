/**
 * Chrome DevTools Protocol IPC Handlers
 *
 * Enables browser automation by connecting to Chrome via CDP.
 * User must launch Chrome with: --remote-debugging-port=9222
 *
 * This provides the backend for the browser automation tools.
 */

import { ipcMain } from "electron";
import CDP from "chrome-remote-interface";
import log from "electron-log/main";

// Track active CDP connection
let cdpClient: CDP.Client | null = null;
let attachedTarget: { id: string; title: string; url: string } | null = null;

/**
 * Connect to Chrome DevTools Protocol
 */
async function connectToChrome(port: number = 9222): Promise<{
  success: boolean;
  tabs?: any[];
  error?: string;
}> {
  try {
    log.info(`[Chrome] Connecting to Chrome on port ${port}...`);

    // List available targets (tabs)
    const targets = await CDP.List({ port });

    if (!targets || targets.length === 0) {
      return {
        success: false,
        error: "No Chrome tabs found. Make sure Chrome is running with --remote-debugging-port=9222",
      };
    }

    // Filter to only page targets
    const pageTabs = targets.filter((t: any) => t.type === "page");

    log.info(`[Chrome] Found ${pageTabs.length} tabs`);

    return {
      success: true,
      tabs: pageTabs.map((t: any) => ({
        id: t.id,
        title: t.title,
        url: t.url,
        type: t.type,
      })),
    };
  } catch (error) {
    log.error("[Chrome] Connection failed:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to connect to Chrome",
    };
  }
}

/**
 * List all open tabs
 */
async function listTabs(port: number = 9222): Promise<{
  success: boolean;
  tabs?: any[];
  error?: string;
}> {
  try {
    const targets = await CDP.List({ port });
    const pageTabs = targets.filter((t: any) => t.type === "page");

    return {
      success: true,
      tabs: pageTabs.map((t: any) => ({
        id: t.id,
        title: t.title,
        url: t.url,
        type: t.type,
      })),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to list tabs",
    };
  }
}

/**
 * Attach to a specific tab
 */
async function attachTab(
  tabId: string,
  port: number = 9222
): Promise<{
  success: boolean;
  title?: string;
  url?: string;
  error?: string;
}> {
  try {
    // Close existing connection if any
    if (cdpClient) {
      try {
        await cdpClient.close();
      } catch {
        // Ignore close errors
      }
      cdpClient = null;
      attachedTarget = null;
    }

    // Connect to the specific target
    cdpClient = await CDP({ target: tabId, port });

    // Enable required domains
    await Promise.all([
      cdpClient.Page.enable(),
      cdpClient.Runtime.enable(),
      cdpClient.DOM.enable(),
      cdpClient.Network.enable(),
    ]);

    // Get page info
    const { result } = await cdpClient.Runtime.evaluate({
      expression: "({ title: document.title, url: window.location.href })",
      returnByValue: true,
    });

    const pageInfo = result.value as { title: string; url: string };
    attachedTarget = { id: tabId, ...pageInfo };

    log.info(`[Chrome] Attached to tab: ${pageInfo.title}`);

    return {
      success: true,
      title: pageInfo.title,
      url: pageInfo.url,
    };
  } catch (error) {
    log.error("[Chrome] Attach failed:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to attach to tab",
    };
  }
}

/**
 * Navigate to a URL
 */
async function navigate(
  url: string,
  waitUntil: "load" | "domcontentloaded" | "networkIdle" = "domcontentloaded"
): Promise<{
  success: boolean;
  title?: string;
  url?: string;
  error?: string;
}> {
  if (!cdpClient) {
    return { success: false, error: "Not attached to any tab. Use browser_attach_tab first." };
  }

  try {
    // Navigate to the URL
    await cdpClient.Page.navigate({ url });

    // Wait for the appropriate event
    if (waitUntil === "load") {
      await cdpClient.Page.loadEventFired();
    } else if (waitUntil === "domcontentloaded") {
      await cdpClient.Page.domContentEventFired();
    } else {
      // networkIdle - wait for load + a short delay
      await cdpClient.Page.loadEventFired();
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // Get updated page info
    const { result } = await cdpClient.Runtime.evaluate({
      expression: "({ title: document.title, url: window.location.href })",
      returnByValue: true,
    });

    const pageInfo = result.value as { title: string; url: string };

    return {
      success: true,
      title: pageInfo.title,
      url: pageInfo.url,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Navigation failed",
    };
  }
}

/**
 * Take a screenshot
 */
async function screenshot(options: {
  fullPage?: boolean;
  format?: "png" | "jpeg" | "webp";
  quality?: number;
}): Promise<{
  success: boolean;
  screenshot?: string;
  error?: string;
}> {
  if (!cdpClient) {
    return { success: false, error: "Not attached to any tab" };
  }

  try {
    const { data } = await cdpClient.Page.captureScreenshot({
      format: options.format || "png",
      quality: options.format === "jpeg" || options.format === "webp" ? options.quality : undefined,
      captureBeyondViewport: options.fullPage,
    });

    return {
      success: true,
      screenshot: data,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Screenshot failed",
    };
  }
}

/**
 * Click on an element
 */
async function click(selector: string): Promise<{
  success: boolean;
  error?: string;
}> {
  if (!cdpClient) {
    return { success: false, error: "Not attached to any tab" };
  }

  try {
    // Find the element and click it
    const { result } = await cdpClient.Runtime.evaluate({
      expression: `
        (function() {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return { error: 'Element not found: ${selector}' };

          // Scroll into view
          el.scrollIntoView({ behavior: 'instant', block: 'center' });

          // Get element center coordinates
          const rect = el.getBoundingClientRect();
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;

          return { x, y };
        })()
      `,
      returnByValue: true,
    });

    if (result.value?.error) {
      return { success: false, error: result.value.error };
    }

    const { x, y } = result.value;

    // Simulate mouse click
    await cdpClient.Input.dispatchMouseEvent({
      type: "mousePressed",
      x,
      y,
      button: "left",
      clickCount: 1,
    });

    await cdpClient.Input.dispatchMouseEvent({
      type: "mouseReleased",
      x,
      y,
      button: "left",
      clickCount: 1,
    });

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Click failed",
    };
  }
}

/**
 * Type text into an element
 */
async function type(
  selector: string,
  text: string,
  clear: boolean = false
): Promise<{
  success: boolean;
  error?: string;
}> {
  if (!cdpClient) {
    return { success: false, error: "Not attached to any tab" };
  }

  try {
    // Focus the element and optionally clear it
    const { result } = await cdpClient.Runtime.evaluate({
      expression: `
        (function() {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return { error: 'Element not found: ${selector}' };

          el.focus();
          ${clear ? "el.value = '';" : ""}

          return { success: true };
        })()
      `,
      returnByValue: true,
    });

    if (result.value?.error) {
      return { success: false, error: result.value.error };
    }

    // Type each character
    for (const char of text) {
      await cdpClient.Input.dispatchKeyEvent({
        type: "keyDown",
        text: char,
      });
      await cdpClient.Input.dispatchKeyEvent({
        type: "keyUp",
        text: char,
      });
    }

    // Dispatch input and change events
    await cdpClient.Runtime.evaluate({
      expression: `
        (function() {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (el) {
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        })()
      `,
    });

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Type failed",
    };
  }
}

/**
 * Extract text or attributes from elements
 */
async function extract(
  selector: string,
  attribute?: string,
  all: boolean = false
): Promise<{
  success: boolean;
  data?: string | string[];
  error?: string;
}> {
  if (!cdpClient) {
    return { success: false, error: "Not attached to any tab" };
  }

  try {
    const { result } = await cdpClient.Runtime.evaluate({
      expression: `
        (function() {
          const elements = ${all}
            ? Array.from(document.querySelectorAll(${JSON.stringify(selector)}))
            : [document.querySelector(${JSON.stringify(selector)})].filter(Boolean);

          if (elements.length === 0) {
            return { error: 'No elements found: ${selector}' };
          }

          const data = elements.map(el => {
            return ${attribute ? `el.getAttribute(${JSON.stringify(attribute)})` : "el.innerText"};
          });

          return { data: ${all} ? data : data[0] };
        })()
      `,
      returnByValue: true,
    });

    if (result.value?.error) {
      return { success: false, error: result.value.error };
    }

    return {
      success: true,
      data: result.value.data,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Extract failed",
    };
  }
}

/**
 * Wait for an element to appear
 */
async function wait(
  selector: string,
  timeout: number = 30000
): Promise<{
  success: boolean;
  error?: string;
}> {
  if (!cdpClient) {
    return { success: false, error: "Not attached to any tab" };
  }

  try {
    const startTime = Date.now();
    const pollInterval = 100;

    while (Date.now() - startTime < timeout) {
      const { result } = await cdpClient.Runtime.evaluate({
        expression: `!!document.querySelector(${JSON.stringify(selector)})`,
        returnByValue: true,
      });

      if (result.value === true) {
        return { success: true };
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    return {
      success: false,
      error: `Timeout waiting for element: ${selector}`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Wait failed",
    };
  }
}

/**
 * Execute JavaScript in the page
 */
async function evaluate(script: string): Promise<{
  success: boolean;
  result?: any;
  error?: string;
}> {
  if (!cdpClient) {
    return { success: false, error: "Not attached to any tab" };
  }

  try {
    const { result, exceptionDetails } = await cdpClient.Runtime.evaluate({
      expression: script,
      returnByValue: true,
      awaitPromise: true,
    });

    if (exceptionDetails) {
      return {
        success: false,
        error: exceptionDetails.text || "Script execution failed",
      };
    }

    return {
      success: true,
      result: result.value,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Evaluate failed",
    };
  }
}

/**
 * Scroll the page
 */
async function scroll(
  direction?: "up" | "down",
  amount: number = 500,
  selector?: string
): Promise<{
  success: boolean;
  error?: string;
}> {
  if (!cdpClient) {
    return { success: false, error: "Not attached to any tab" };
  }

  try {
    if (selector) {
      // Scroll element into view
      await cdpClient.Runtime.evaluate({
        expression: `
          const el = document.querySelector(${JSON.stringify(selector)});
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        `,
      });
    } else if (direction) {
      // Scroll page
      const scrollAmount = direction === "up" ? -amount : amount;
      await cdpClient.Runtime.evaluate({
        expression: `window.scrollBy(0, ${scrollAmount})`,
      });
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Scroll failed",
    };
  }
}

/**
 * Get page HTML
 */
async function getHtml(selector?: string): Promise<{
  success: boolean;
  html?: string;
  error?: string;
}> {
  if (!cdpClient) {
    return { success: false, error: "Not attached to any tab" };
  }

  try {
    const { result } = await cdpClient.Runtime.evaluate({
      expression: selector
        ? `document.querySelector(${JSON.stringify(selector)})?.outerHTML || ''`
        : `document.documentElement.outerHTML`,
      returnByValue: true,
    });

    return {
      success: true,
      html: result.value,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Get HTML failed",
    };
  }
}

/**
 * Press a keyboard key
 */
async function pressKey(key: string): Promise<{
  success: boolean;
  error?: string;
}> {
  if (!cdpClient) {
    return { success: false, error: "Not attached to any tab" };
  }

  try {
    // Map common key names to CDP key codes
    const keyMap: Record<string, { key: string; code: string; keyCode: number }> = {
      Enter: { key: "Enter", code: "Enter", keyCode: 13 },
      Tab: { key: "Tab", code: "Tab", keyCode: 9 },
      Escape: { key: "Escape", code: "Escape", keyCode: 27 },
      Backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
      Delete: { key: "Delete", code: "Delete", keyCode: 46 },
      ArrowUp: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
      ArrowDown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
      ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
      ArrowRight: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
      Space: { key: " ", code: "Space", keyCode: 32 },
    };

    const keyInfo = keyMap[key] || { key, code: `Key${key.toUpperCase()}`, keyCode: key.charCodeAt(0) };

    await cdpClient.Input.dispatchKeyEvent({
      type: "keyDown",
      key: keyInfo.key,
      code: keyInfo.code,
      windowsVirtualKeyCode: keyInfo.keyCode,
      nativeVirtualKeyCode: keyInfo.keyCode,
    });

    await cdpClient.Input.dispatchKeyEvent({
      type: "keyUp",
      key: keyInfo.key,
      code: keyInfo.code,
      windowsVirtualKeyCode: keyInfo.keyCode,
      nativeVirtualKeyCode: keyInfo.keyCode,
    });

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Key press failed",
    };
  }
}

/**
 * Open a new tab
 */
async function newTab(url?: string, port: number = 9222): Promise<{
  success: boolean;
  tabId?: string;
  error?: string;
}> {
  try {
    const target = await CDP.New({ port, url });
    return {
      success: true,
      tabId: target.id,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to open new tab",
    };
  }
}

/**
 * Close the current tab
 */
async function closeTab(port: number = 9222): Promise<{
  success: boolean;
  error?: string;
}> {
  if (!attachedTarget) {
    return { success: false, error: "No tab attached" };
  }

  try {
    await CDP.Close({ port, id: attachedTarget.id });

    // Clean up
    if (cdpClient) {
      try {
        await cdpClient.close();
      } catch {
        // Ignore
      }
      cdpClient = null;
    }
    attachedTarget = null;

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to close tab",
    };
  }
}

/**
 * Register all Chrome IPC handlers
 */
export function registerChromeHandlers(): void {
  log.info("[Chrome] Registering Chrome DevTools Protocol handlers...");

  // Connection handlers
  ipcMain.handle("chrome:connect", async (_event, options: { port?: number }) => {
    return connectToChrome(options?.port || 9222);
  });

  ipcMain.handle("chrome:listTabs", async (_event, options: { port?: number }) => {
    return listTabs(options?.port || 9222);
  });

  ipcMain.handle("chrome:attachTab", async (_event, options: { tabId: string; port?: number }) => {
    return attachTab(options.tabId, options.port || 9222);
  });

  // Navigation
  ipcMain.handle("chrome:navigate", async (_event, options: { url: string; waitUntil?: "load" | "domcontentloaded" | "networkIdle" }) => {
    return navigate(options.url, options.waitUntil);
  });

  // Screenshot
  ipcMain.handle("chrome:screenshot", async (_event, options: { fullPage?: boolean; format?: "png" | "jpeg" | "webp"; quality?: number }) => {
    return screenshot(options);
  });

  // Interaction
  ipcMain.handle("chrome:click", async (_event, options: { selector: string }) => {
    return click(options.selector);
  });

  ipcMain.handle("chrome:type", async (_event, options: { selector: string; text: string; clear?: boolean }) => {
    return type(options.selector, options.text, options.clear);
  });

  ipcMain.handle("chrome:extract", async (_event, options: { selector: string; attribute?: string; all?: boolean }) => {
    return extract(options.selector, options.attribute, options.all);
  });

  ipcMain.handle("chrome:wait", async (_event, options: { selector: string; timeout?: number }) => {
    return wait(options.selector, options.timeout);
  });

  ipcMain.handle("chrome:evaluate", async (_event, options: { script: string }) => {
    return evaluate(options.script);
  });

  ipcMain.handle("chrome:scroll", async (_event, options: { direction?: "up" | "down"; amount?: number; selector?: string }) => {
    return scroll(options.direction, options.amount, options.selector);
  });

  ipcMain.handle("chrome:getHtml", async (_event, options: { selector?: string }) => {
    return getHtml(options.selector);
  });

  ipcMain.handle("chrome:pressKey", async (_event, options: { key: string }) => {
    return pressKey(options.key);
  });

  // Tab management
  ipcMain.handle("chrome:newTab", async (_event, options: { url?: string; port?: number }) => {
    return newTab(options.url, options.port || 9222);
  });

  ipcMain.handle("chrome:closeTab", async (_event, options: { port?: number }) => {
    return closeTab(options.port || 9222);
  });

  log.info("[Chrome] Chrome handlers registered successfully");
}
