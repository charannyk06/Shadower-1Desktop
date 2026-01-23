/**
 * Enhanced Browser IPC Handlers
 *
 * Exposes the EnhancedBrowserService to the renderer process via IPC.
 * Uses agent-browser's BrowserManager for AI-optimized browser automation.
 *
 * Features:
 * - Stealth mode for bot detection bypass
 * - Navigation retry with exponential backoff
 * - CAPTCHA detection
 * - Execution context error handling
 */

import { ipcMain } from "electron";
import log from "electron-log/main";
import {
  EnhancedBrowserService,
  type LaunchOptions,
  type NavigateOptions,
  type SnapshotOptions,
  type BrowserAction,
} from "../services/browser-service";

/**
 * Register all browser IPC handlers
 */
export function registerBrowserHandlers(): void {
  log.info("[Browser] Registering enhanced browser handlers...");

  const service = EnhancedBrowserService.getInstance();

  // Session management
  ipcMain.handle(
    "browser:createSession",
    async (_event, options?: LaunchOptions) => {
      try {
        return await service.createSession(options);
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  ipcMain.handle(
    "browser:closeSession",
    async (_event, sessionId?: string) => {
      try {
        await service.closeSession(sessionId);
        return { success: true };
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  ipcMain.handle("browser:listSessions", async () => {
    return service.listSessions();
  });

  ipcMain.handle(
    "browser:switchSession",
    async (_event, sessionId: string) => {
      try {
        service.switchSession(sessionId);
        return { success: true };
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  // Navigation with retry and CAPTCHA detection
  ipcMain.handle(
    "browser:navigate",
    async (
      _event,
      url: string,
      options?: NavigateOptions
    ) => {
      try {
        return await service.navigate(url, options);
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  ipcMain.handle("browser:goBack", async (_event, sessionId?: string) => {
    try {
      return await service.goBack(sessionId);
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("browser:goForward", async (_event, sessionId?: string) => {
    try {
      return await service.goForward(sessionId);
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("browser:reload", async (_event, sessionId?: string) => {
    try {
      return await service.reload(sessionId);
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  // Snapshot (AI-optimized element tree)
  ipcMain.handle(
    "browser:getSnapshot",
    async (_event, options?: SnapshotOptions & { sessionId?: string }) => {
      try {
        return await service.getSnapshot(options);
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  // Actions
  ipcMain.handle(
    "browser:executeAction",
    async (
      _event,
      action: BrowserAction,
      options?: { sessionId?: string }
    ) => {
      try {
        return await service.executeAction(action, options);
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  // Convenience methods (wrap executeAction)
  ipcMain.handle(
    "browser:click",
    async (
      _event,
      selector: string,
      options?: { sessionId?: string }
    ) => {
      try {
        return await service.executeAction({ type: "click", selector }, options);
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  ipcMain.handle(
    "browser:fill",
    async (
      _event,
      selector: string,
      value: string,
      options?: { sessionId?: string }
    ) => {
      try {
        return await service.executeAction(
          { type: "fill", selector, value },
          options
        );
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  ipcMain.handle(
    "browser:type",
    async (
      _event,
      selector: string,
      text: string,
      options?: { delay?: number; sessionId?: string }
    ) => {
      try {
        return await service.executeAction(
          { type: "type", selector, text, delay: options?.delay },
          { sessionId: options?.sessionId }
        );
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  ipcMain.handle(
    "browser:press",
    async (
      _event,
      key: string,
      options?: { selector?: string; sessionId?: string }
    ) => {
      try {
        return await service.executeAction(
          { type: "press", key, selector: options?.selector },
          { sessionId: options?.sessionId }
        );
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  ipcMain.handle(
    "browser:screenshot",
    async (
      _event,
      options?: { fullPage?: boolean; path?: string; sessionId?: string }
    ) => {
      try {
        return await service.executeAction(
          {
            type: "screenshot",
            fullPage: options?.fullPage,
            path: options?.path,
          },
          { sessionId: options?.sessionId }
        );
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  ipcMain.handle(
    "browser:scroll",
    async (
      _event,
      options?: {
        direction?: "up" | "down";
        amount?: number;
        selector?: string;
        sessionId?: string;
      }
    ) => {
      try {
        return await service.executeAction(
          {
            type: "scroll",
            direction: options?.direction,
            amount: options?.amount,
            selector: options?.selector,
          },
          { sessionId: options?.sessionId }
        );
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  // Utilities
  ipcMain.handle(
    "browser:evaluate",
    async (
      _event,
      script: string,
      options?: { sessionId?: string }
    ) => {
      try {
        const result = await service.evaluate(script, options);
        return { result };
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  ipcMain.handle(
    "browser:wait",
    async (
      _event,
      options: {
        selector?: string;
        state?: "visible" | "hidden" | "attached" | "detached";
        timeout?: number;
        loadState?: "load" | "domcontentloaded" | "networkidle";
        sessionId?: string;
      }
    ) => {
      try {
        return await service.wait(options);
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  ipcMain.handle(
    "browser:getContent",
    async (
      _event,
      options?: { selector?: string; sessionId?: string }
    ) => {
      try {
        const html = await service.getContent(options);
        return { html };
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  ipcMain.handle("browser:getUrl", async (_event, sessionId?: string) => {
    try {
      const url = await service.getUrl(sessionId);
      return { url };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("browser:getTitle", async (_event, sessionId?: string) => {
    try {
      const title = await service.getTitle(sessionId);
      return { title };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  // ============================================================================
  // MULTI-TAB SUPPORT
  // ============================================================================

  ipcMain.handle(
    "browser:newTab",
    async (_event, options?: { url?: string; sessionId?: string }) => {
      try {
        return await service.newTab(options?.sessionId, options?.url);
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  ipcMain.handle(
    "browser:newWindow",
    async (
      _event,
      options?: { viewport?: { width: number; height: number }; sessionId?: string }
    ) => {
      try {
        return await service.newWindow(options?.sessionId, { viewport: options?.viewport });
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  ipcMain.handle(
    "browser:switchTab",
    async (_event, index: number, sessionId?: string) => {
      try {
        return await service.switchTab(index, sessionId);
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  ipcMain.handle(
    "browser:closeTab",
    async (_event, options?: { index?: number; sessionId?: string }) => {
      try {
        return await service.closeTab(options?.index, options?.sessionId);
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  ipcMain.handle("browser:listTabs", async (_event, sessionId?: string) => {
    try {
      return await service.listTabs(sessionId);
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("browser:getActiveTabIndex", async (_event, sessionId?: string) => {
    try {
      return { index: service.getActiveTabIndex(sessionId) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  // ============================================================================
  // ADDITIONAL ACTIONS (hover, select, check, uncheck)
  // ============================================================================

  ipcMain.handle(
    "browser:hover",
    async (_event, selector: string, options?: { sessionId?: string }) => {
      try {
        return await service.executeAction({ type: "hover", selector }, options);
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  ipcMain.handle(
    "browser:select",
    async (
      _event,
      selector: string,
      values: string | string[],
      options?: { sessionId?: string }
    ) => {
      try {
        return await service.executeAction({ type: "select", selector, values }, options);
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  ipcMain.handle(
    "browser:check",
    async (_event, selector: string, options?: { sessionId?: string }) => {
      try {
        return await service.executeAction({ type: "check", selector }, options);
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  ipcMain.handle(
    "browser:uncheck",
    async (_event, selector: string, options?: { sessionId?: string }) => {
      try {
        return await service.executeAction({ type: "uncheck", selector }, options);
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  log.info("[Browser] Enhanced browser handlers registered (with multi-tab support)");
}
