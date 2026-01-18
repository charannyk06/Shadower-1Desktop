import { Tool, tool as createTool } from "ai";
import logger from "logger";
import { z } from "zod";
import { AppDefaultToolkit, DefaultToolName } from ".";
import { httpFetchTool } from "./http/fetch";
import {
  SandboxExecutionContext,
  createUnifiedSandboxTool,
  unifiedSandboxTool,
} from "./sandbox/unified-sandbox-tool";
import { createBarChartTool } from "./visualization/create-bar-chart";
import { createLineChartTool } from "./visualization/create-line-chart";
import { createPieChartTool } from "./visualization/create-pie-chart";
import { createTableTool } from "./visualization/create-table";
import { exaContentsTool, exaSearchTool } from "./web/web-search";

// Browser automation tools (Browserbase + Stagehand)
import {
  browserbaseTools,
  createBrowserToolsWithContext,
} from "./browser/browserbase-tools";

// Desktop/Computer Use tools (E2B Desktop)
import { desktopTools } from "./sandbox/desktop-tools";

// Data analysis tools
import { createDataAnalysisTools } from "../agents/data-analysis-agent";

// Document generation tools
import { createDocumentTools } from "../agents/document-agent";

// Deep research tools
import { createDeepResearchTool } from "../agents/deep-research-agent";

// Memory tools
import { rememberContextTool } from "./memory/remember-context";

// Fragment tools (autonomous app generation)
import { createFragmentTools } from "./fragment/fragment-tool";

// Re-export for backwards compatibility
export type { SandboxExecutionContext } from "./sandbox/unified-sandbox-tool";
// Alias for backwards compatibility
export type CodeExecutionContext = SandboxExecutionContext;

/**
 * Static tool kit - used when thread context is not available
 */
export const APP_DEFAULT_TOOL_KIT: Record<
  AppDefaultToolkit,
  Record<string, Tool>
> = {
  [AppDefaultToolkit.Visualization]: {
    [DefaultToolName.CreatePieChart]: createPieChartTool,
    [DefaultToolName.CreateBarChart]: createBarChartTool,
    [DefaultToolName.CreateLineChart]: createLineChartTool,
    [DefaultToolName.CreateTable]: createTableTool,
  },
  [AppDefaultToolkit.WebSearch]: {
    [DefaultToolName.WebSearch]: exaSearchTool,
    [DefaultToolName.WebContent]: exaContentsTool,
  },
  [AppDefaultToolkit.Http]: {
    [DefaultToolName.Http]: httpFetchTool,
  },
  [AppDefaultToolkit.Sandbox]: {
    [DefaultToolName.Sandbox]: unifiedSandboxTool,
  },
  // Browser automation tools (Browserbase + Stagehand)
  [AppDefaultToolkit.Browser]: {
    [DefaultToolName.BrowserNavigate]: browserbaseTools.browser_navigate,
    [DefaultToolName.BrowserAct]: browserbaseTools.browser_act,
    [DefaultToolName.BrowserObserve]: browserbaseTools.browser_observe,
    [DefaultToolName.BrowserExtract]: browserbaseTools.browser_extract,
    [DefaultToolName.BrowserScreenshot]: browserbaseTools.browser_screenshot,
    [DefaultToolName.BrowserWait]: browserbaseTools.browser_wait,
    [DefaultToolName.BrowserStealth]: browserbaseTools.browser_stealth,
    [DefaultToolName.BrowserClose]: browserbaseTools.browser_close,
  },
  // Desktop/Computer Use tools (E2B Desktop)
  [AppDefaultToolkit.Desktop]: {
    [DefaultToolName.DesktopCreate]: desktopTools.desktop_create,
    [DefaultToolName.DesktopScreenshot]: desktopTools.desktop_screenshot,
    [DefaultToolName.DesktopClick]: desktopTools.desktop_click,
    [DefaultToolName.DesktopType]: desktopTools.desktop_type,
    [DefaultToolName.DesktopPress]: desktopTools.desktop_press,
    [DefaultToolName.DesktopScroll]: desktopTools.desktop_scroll,
    [DefaultToolName.DesktopDrag]: desktopTools.desktop_drag,
    [DefaultToolName.DesktopLaunchApp]: desktopTools.desktop_launch,
  },
  // Data analysis tools (static versions without dataStream)
  [AppDefaultToolkit.DataAnalysis]: {
    [DefaultToolName.ProfileData]: createDataAnalysisTools().profileDataset,
    [DefaultToolName.AnalyzeData]: createDataAnalysisTools().analyzeStats,
    [DefaultToolName.CreateVisualization]:
      createDataAnalysisTools().createVisualization,
  },
  // Document generation tools (static versions without dataStream)
  [AppDefaultToolkit.Documents]: {
    [DefaultToolName.CreatePresentation]:
      createDocumentTools().create_presentation,
    [DefaultToolName.CreateDocument]: createDocumentTools().create_document,
    [DefaultToolName.CreateSpreadsheet]:
      createDocumentTools().create_spreadsheet,
    [DefaultToolName.CreateMultiSheetWorkbook]:
      createDocumentTools().create_multi_sheet_workbook,
    [DefaultToolName.CreatePDF]: createDocumentTools().create_pdf,
  },
  // Research tools (static version without dataStream)
  [AppDefaultToolkit.Research]: {
    [DefaultToolName.DeepResearch]: createDeepResearchTool(),
  },
  // Memory tools
  [AppDefaultToolkit.Memory]: {
    [DefaultToolName.RememberContext]: rememberContextTool,
  },
  // Fragment tools (autonomous app generation) - require context
  [AppDefaultToolkit.Fragments]: {},
};

/**
 * Creates a disabled sandbox tool that returns an error
 * Used when thread context is missing to prevent silent failures
 */
function createDisabledSandboxTool(): Tool {
  return createTool({
    description:
      "Code execution sandbox (UNAVAILABLE - session context missing). Cannot execute code without a valid thread context.",
    inputSchema: z.object({
      action: z.string().describe("The action to perform"),
      code: z.string().optional().describe("Code to execute"),
      language: z.string().optional().describe("Programming language"),
      command: z.string().optional().describe("Shell command"),
      path: z.string().optional().describe("File path"),
      content: z.string().optional().describe("File content"),
    }),
    execute: async () => {
      logger.error(
        "[Sandbox] CRITICAL: Attempted to use sandbox without thread context",
      );
      return {
        success: false,
        STOP: true,
        error:
          "Sandbox unavailable: Thread context not initialized. This is a system error - the chat session may not be properly initialized. Please refresh the page and try again.",
        instruction:
          "Do NOT retry this tool call. Inform the user about the error and ask them to refresh the page.",
      };
    },
  });
}

/**
 * Creates a tool kit with context-aware sandbox tools
 * When threadId and userId are provided, sandbox tools will persist
 * files across executions in the same thread
 */
export function createAppDefaultToolKit(
  context?: SandboxExecutionContext,
): Record<AppDefaultToolkit, Record<string, Tool>> {
  // Debug logging for context flow tracing
  logger.debug(
    `[Tool Kit] Creating toolkit with context: threadId=${context?.threadId}, userId=${context?.userId}`,
  );

  // If no context, return tools with DISABLED sandbox that returns clear error
  if (!context?.threadId || !context?.userId) {
    logger.error(
      "[Tool Kit] CRITICAL: Missing thread context - sandbox will be DISABLED to prevent loops!",
    );
    return {
      [AppDefaultToolkit.Visualization]: {
        [DefaultToolName.CreatePieChart]: createPieChartTool,
        [DefaultToolName.CreateBarChart]: createBarChartTool,
        [DefaultToolName.CreateLineChart]: createLineChartTool,
        [DefaultToolName.CreateTable]: createTableTool,
      },
      [AppDefaultToolkit.WebSearch]: {
        [DefaultToolName.WebSearch]: exaSearchTool,
        [DefaultToolName.WebContent]: exaContentsTool,
      },
      [AppDefaultToolkit.Http]: {
        [DefaultToolName.Http]: httpFetchTool,
      },
      [AppDefaultToolkit.Sandbox]: {
        [DefaultToolName.Sandbox]: createDisabledSandboxTool(),
      },
      // Browser tools work without thread context
      [AppDefaultToolkit.Browser]: {
        [DefaultToolName.BrowserNavigate]: browserbaseTools.browser_navigate,
        [DefaultToolName.BrowserAct]: browserbaseTools.browser_act,
        [DefaultToolName.BrowserObserve]: browserbaseTools.browser_observe,
        [DefaultToolName.BrowserExtract]: browserbaseTools.browser_extract,
        [DefaultToolName.BrowserScreenshot]:
          browserbaseTools.browser_screenshot,
        [DefaultToolName.BrowserWait]: browserbaseTools.browser_wait,
        [DefaultToolName.BrowserStealth]: browserbaseTools.browser_stealth,
        [DefaultToolName.BrowserClose]: browserbaseTools.browser_close,
      },
      // Desktop tools work without thread context
      [AppDefaultToolkit.Desktop]: {
        [DefaultToolName.DesktopScreenshot]: desktopTools.desktop_screenshot,
        [DefaultToolName.DesktopClick]: desktopTools.desktop_click,
        [DefaultToolName.DesktopType]: desktopTools.desktop_type,
        [DefaultToolName.DesktopPress]: desktopTools.desktop_press,
        [DefaultToolName.DesktopScroll]: desktopTools.desktop_scroll,
        [DefaultToolName.DesktopDrag]: desktopTools.desktop_drag,
        [DefaultToolName.DesktopLaunchApp]: desktopTools.desktop_launch,
      },
      // Data analysis (static - no dataStream)
      [AppDefaultToolkit.DataAnalysis]: {
        [DefaultToolName.ProfileData]: createDataAnalysisTools().profileDataset,
        [DefaultToolName.AnalyzeData]: createDataAnalysisTools().analyzeStats,
        [DefaultToolName.CreateVisualization]:
          createDataAnalysisTools().createVisualization,
      },
      // Documents (static - no dataStream)
      [AppDefaultToolkit.Documents]: {
        [DefaultToolName.CreatePresentation]:
          createDocumentTools().create_presentation,
        [DefaultToolName.CreateDocument]: createDocumentTools().create_document,
        [DefaultToolName.CreateSpreadsheet]:
          createDocumentTools().create_spreadsheet,
        [DefaultToolName.CreateMultiSheetWorkbook]:
          createDocumentTools().create_multi_sheet_workbook,
        [DefaultToolName.CreatePDF]: createDocumentTools().create_pdf,
      },
      // Research (static - no dataStream)
      [AppDefaultToolkit.Research]: {
        [DefaultToolName.DeepResearch]: createDeepResearchTool(),
      },
      // Memory tools
      [AppDefaultToolkit.Memory]: {
        [DefaultToolName.RememberContext]: rememberContextTool,
      },
      // Fragment tools unavailable without context
      [AppDefaultToolkit.Fragments]: {},
    };
  }

  logger.info(
    "[Tool Kit] Creating context-aware tools for thread:",
    context.threadId,
  );

  // Create context-aware tools with dataStream support
  // Note: dataStream would be passed through context if available
  const dataStream = context.dataStream;

  // Create context-aware browser tools with pre-injected userId and threadId
  // This prevents the AI from inventing fake UUIDs like "user_1234" or "charannyan"
  const contextAwareBrowserTools = createBrowserToolsWithContext(
    context.userId,
    context.threadId || null,
  );

  return {
    [AppDefaultToolkit.Visualization]: {
      [DefaultToolName.CreatePieChart]: createPieChartTool,
      [DefaultToolName.CreateBarChart]: createBarChartTool,
      [DefaultToolName.CreateLineChart]: createLineChartTool,
      [DefaultToolName.CreateTable]: createTableTool,
    },
    [AppDefaultToolkit.WebSearch]: {
      [DefaultToolName.WebSearch]: exaSearchTool,
      [DefaultToolName.WebContent]: exaContentsTool,
    },
    [AppDefaultToolkit.Http]: {
      [DefaultToolName.Http]: httpFetchTool,
    },
    [AppDefaultToolkit.Sandbox]: {
      [DefaultToolName.Sandbox]: createUnifiedSandboxTool(context),
      // DEPRECATED: Use createFragment for web apps, dashboards, games, and documents
      // Sandbox tool will be removed in Phase 2 - kept for backward compatibility only
    },
    // Browser automation tools (Browserbase + Stagehand) - context-aware versions
    // These tools have userId and threadId pre-injected so AI doesn't need to provide them
    [AppDefaultToolkit.Browser]: {
      [DefaultToolName.BrowserNavigate]:
        contextAwareBrowserTools.browser_navigate,
      [DefaultToolName.BrowserAct]: contextAwareBrowserTools.browser_act,
      [DefaultToolName.BrowserObserve]:
        contextAwareBrowserTools.browser_observe,
      [DefaultToolName.BrowserExtract]:
        contextAwareBrowserTools.browser_extract,
      [DefaultToolName.BrowserScreenshot]:
        contextAwareBrowserTools.browser_screenshot,
      [DefaultToolName.BrowserWait]: contextAwareBrowserTools.browser_wait,
      [DefaultToolName.BrowserStealth]:
        contextAwareBrowserTools.browser_stealth,
      [DefaultToolName.BrowserClose]: contextAwareBrowserTools.browser_close,
    },
    // Desktop/Computer Use tools (E2B Desktop)
    [AppDefaultToolkit.Desktop]: {
      [DefaultToolName.DesktopCreate]: desktopTools.desktop_create,
      [DefaultToolName.DesktopScreenshot]: desktopTools.desktop_screenshot,
      [DefaultToolName.DesktopClick]: desktopTools.desktop_click,
      [DefaultToolName.DesktopType]: desktopTools.desktop_type,
      [DefaultToolName.DesktopPress]: desktopTools.desktop_press,
      [DefaultToolName.DesktopScroll]: desktopTools.desktop_scroll,
      [DefaultToolName.DesktopDrag]: desktopTools.desktop_drag,
      [DefaultToolName.DesktopLaunchApp]: desktopTools.desktop_launch,
    },
    // Data analysis tools (with dataStream for progress updates)
    [AppDefaultToolkit.DataAnalysis]: {
      [DefaultToolName.ProfileData]:
        createDataAnalysisTools(dataStream).profileDataset,
      [DefaultToolName.AnalyzeData]:
        createDataAnalysisTools(dataStream).analyzeStats,
      [DefaultToolName.CreateVisualization]:
        createDataAnalysisTools(dataStream).createVisualization,
    },
    // Document generation tools (with dataStream and context for progress updates)
    [AppDefaultToolkit.Documents]: {
      [DefaultToolName.CreatePresentation]: createDocumentTools(
        dataStream,
        context.threadId,
        context.userId,
      ).create_presentation,
      [DefaultToolName.CreateDocument]: createDocumentTools(
        dataStream,
        context.threadId,
        context.userId,
      ).create_document,
      [DefaultToolName.CreateSpreadsheet]: createDocumentTools(
        dataStream,
        context.threadId,
        context.userId,
      ).create_spreadsheet,
      [DefaultToolName.CreateMultiSheetWorkbook]: createDocumentTools(
        dataStream,
        context.threadId,
        context.userId,
      ).create_multi_sheet_workbook,
      [DefaultToolName.CreatePDF]: createDocumentTools(
        dataStream,
        context.threadId,
        context.userId,
      ).create_pdf,
    },
    // Deep research tool (with dataStream for progress updates)
    [AppDefaultToolkit.Research]: {
      [DefaultToolName.DeepResearch]: createDeepResearchTool(dataStream),
    },
    // Memory tools
    [AppDefaultToolkit.Memory]: {
      [DefaultToolName.RememberContext]: rememberContextTool,
    },
    // Fragment tools (autonomous app generation)
    [AppDefaultToolkit.Fragments]: createFragmentTools({
      userId: context.userId,
      threadId: context.threadId,
      dataStream,
      chatModel: context.chatModel,
    }),
  };
}
