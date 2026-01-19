import { Tool } from "ai";
import logger from "logger";
import { AppDefaultToolkit, DefaultToolName } from ".";
import { httpFetchTool } from "./http/fetch";
import { createBarChartTool } from "./visualization/create-bar-chart";
import { createLineChartTool } from "./visualization/create-line-chart";
import { createPieChartTool } from "./visualization/create-pie-chart";
import { createTableTool } from "./visualization/create-table";
import { exaContentsTool, exaSearchTool } from "./web/web-search";

// Browser automation tools (Local Chrome DevTools Protocol)
import {
  localBrowserTools,
  createBrowserToolsWithContext,
} from "./browser/local-browser-tools";

// Desktop/Computer Use tools (Local Terminal)
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

import type { UIMessageStreamWriter } from "ai";
import type { ChatModel } from "app-types/chat";

/**
 * Context for tool creation
 * Used to pass thread and user context to tools that need it
 */
export interface ToolCreationContext {
  threadId?: string;
  userId: string;
  dataStream?: UIMessageStreamWriter;
  chatModel?: ChatModel;
}

/**
 * Static tool kit - used when thread context is not available
 * All execution is local via Desktop tools and Browser tools
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
  // Browser automation tools (Local Chrome DevTools Protocol)
  [AppDefaultToolkit.Browser]: {
    [DefaultToolName.BrowserNavigate]: localBrowserTools.browser_navigate,
    [DefaultToolName.BrowserAct]: localBrowserTools.browser_act,
    [DefaultToolName.BrowserObserve]: localBrowserTools.browser_observe,
    [DefaultToolName.BrowserExtract]: localBrowserTools.browser_extract,
    [DefaultToolName.BrowserScreenshot]: localBrowserTools.browser_screenshot,
    [DefaultToolName.BrowserWait]: localBrowserTools.browser_wait,
    [DefaultToolName.BrowserStealth]: localBrowserTools.browser_stealth,
    [DefaultToolName.BrowserClose]: localBrowserTools.browser_close,
  },
  // Desktop/Computer Use tools (Local Terminal)
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
 * Creates a tool kit with context-aware tools
 * When threadId and userId are provided, tools will have proper context
 */
export function createAppDefaultToolKit(
  context?: ToolCreationContext,
): Record<AppDefaultToolkit, Record<string, Tool>> {
  // Debug logging for context flow tracing
  logger.debug(
    `[Tool Kit] Creating toolkit with context: threadId=${context?.threadId}, userId=${context?.userId}`,
  );

  // If no context, return tools without context-specific features
  if (!context?.threadId || !context?.userId) {
    logger.warn(
      "[Tool Kit] Missing thread context - some tools may have limited functionality",
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
      // Browser tools work without thread context
      [AppDefaultToolkit.Browser]: {
        [DefaultToolName.BrowserNavigate]: localBrowserTools.browser_navigate,
        [DefaultToolName.BrowserAct]: localBrowserTools.browser_act,
        [DefaultToolName.BrowserObserve]: localBrowserTools.browser_observe,
        [DefaultToolName.BrowserExtract]: localBrowserTools.browser_extract,
        [DefaultToolName.BrowserScreenshot]:
          localBrowserTools.browser_screenshot,
        [DefaultToolName.BrowserWait]: localBrowserTools.browser_wait,
        [DefaultToolName.BrowserStealth]: localBrowserTools.browser_stealth,
        [DefaultToolName.BrowserClose]: localBrowserTools.browser_close,
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
  const dataStream = context.dataStream;

  // Create context-aware browser tools with pre-injected userId and threadId
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
    // Browser automation tools (Local Chrome DevTools) - context-aware versions
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
    // Desktop/Computer Use tools (Local Terminal)
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
