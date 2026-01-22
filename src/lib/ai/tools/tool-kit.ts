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
import { desktopTools } from "./desktop/desktop-tools";

// Data analysis tools
import { createDataAnalysisTools } from "../agents/data-analysis-agent";

// Document generation tools
import { createDocumentTools } from "../agents/document-agent";

// Deep research tools
import { createDeepResearchTool } from "../agents/deep-research-agent";

// Memory tools
import { rememberContextTool } from "./memory/remember-context";

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
  // Browser automation tools (Local Chrome DevTools Protocol via agent-browser)
  [AppDefaultToolkit.Browser]: {
    // Session Management
    [DefaultToolName.BrowserCreateSession]: localBrowserTools.browser_create_session,
    [DefaultToolName.BrowserCloseSession]: localBrowserTools.browser_close_session,
    [DefaultToolName.BrowserListSessions]: localBrowserTools.browser_list_sessions,
    [DefaultToolName.BrowserSwitchSession]: localBrowserTools.browser_switch_session,
    // Navigation
    [DefaultToolName.BrowserNavigate]: localBrowserTools.browser_navigate,
    [DefaultToolName.BrowserGoBack]: localBrowserTools.browser_go_back,
    [DefaultToolName.BrowserGoForward]: localBrowserTools.browser_go_forward,
    [DefaultToolName.BrowserReload]: localBrowserTools.browser_reload,
    // AI-Optimized Page Understanding
    [DefaultToolName.BrowserGetSnapshot]: localBrowserTools.browser_get_snapshot,
    [DefaultToolName.BrowserGetContext]: localBrowserTools.browser_get_context,
    [DefaultToolName.BrowserAnalyzeForms]: localBrowserTools.browser_analyze_forms,
    [DefaultToolName.BrowserFillForm]: localBrowserTools.browser_fill_form,
    // Element Interaction
    [DefaultToolName.BrowserClick]: localBrowserTools.browser_click,
    [DefaultToolName.BrowserFill]: localBrowserTools.browser_fill,
    [DefaultToolName.BrowserType]: localBrowserTools.browser_type,
    [DefaultToolName.BrowserPressKey]: localBrowserTools.browser_press_key,
    [DefaultToolName.BrowserScroll]: localBrowserTools.browser_scroll,
    [DefaultToolName.BrowserWait]: localBrowserTools.browser_wait,
    // Page Information
    [DefaultToolName.BrowserScreenshot]: localBrowserTools.browser_screenshot,
    [DefaultToolName.BrowserGetContent]: localBrowserTools.browser_get_content,
    [DefaultToolName.BrowserGetUrl]: localBrowserTools.browser_get_url,
    [DefaultToolName.BrowserGetTitle]: localBrowserTools.browser_get_title,
    [DefaultToolName.BrowserEvaluate]: localBrowserTools.browser_evaluate,
  },
  // Desktop/Computer Use tools (Local Terminal)
  // IMPORTANT: desktop_command is the shell/terminal execution tool - essential for all agents
  [AppDefaultToolkit.Desktop]: {
    [DefaultToolName.DesktopCreate]: desktopTools.desktop_create,
    [DefaultToolName.DesktopCommand]: desktopTools.desktop_command, // Shell execution - CRITICAL
    [DefaultToolName.DesktopScreenshot]: desktopTools.desktop_screenshot,
    [DefaultToolName.DesktopClick]: desktopTools.desktop_click,
    [DefaultToolName.DesktopType]: desktopTools.desktop_type,
    [DefaultToolName.DesktopPress]: desktopTools.desktop_press,
    [DefaultToolName.DesktopScroll]: desktopTools.desktop_scroll,
    [DefaultToolName.DesktopDrag]: desktopTools.desktop_drag,
    [DefaultToolName.DesktopLaunchApp]: desktopTools.desktop_launch,
    [DefaultToolName.DesktopDisplayInfo]: desktopTools.desktop_display_info,
    [DefaultToolName.DesktopCursorPosition]: desktopTools.desktop_cursor_position,
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
        // Session Management
        [DefaultToolName.BrowserCreateSession]: localBrowserTools.browser_create_session,
        [DefaultToolName.BrowserCloseSession]: localBrowserTools.browser_close_session,
        [DefaultToolName.BrowserListSessions]: localBrowserTools.browser_list_sessions,
        [DefaultToolName.BrowserSwitchSession]: localBrowserTools.browser_switch_session,
        // Navigation
        [DefaultToolName.BrowserNavigate]: localBrowserTools.browser_navigate,
        [DefaultToolName.BrowserGoBack]: localBrowserTools.browser_go_back,
        [DefaultToolName.BrowserGoForward]: localBrowserTools.browser_go_forward,
        [DefaultToolName.BrowserReload]: localBrowserTools.browser_reload,
        // AI-Optimized Page Understanding
        [DefaultToolName.BrowserGetSnapshot]: localBrowserTools.browser_get_snapshot,
        [DefaultToolName.BrowserGetContext]: localBrowserTools.browser_get_context,
        [DefaultToolName.BrowserAnalyzeForms]: localBrowserTools.browser_analyze_forms,
        [DefaultToolName.BrowserFillForm]: localBrowserTools.browser_fill_form,
        // Element Interaction
        [DefaultToolName.BrowserClick]: localBrowserTools.browser_click,
        [DefaultToolName.BrowserFill]: localBrowserTools.browser_fill,
        [DefaultToolName.BrowserType]: localBrowserTools.browser_type,
        [DefaultToolName.BrowserPressKey]: localBrowserTools.browser_press_key,
        [DefaultToolName.BrowserScroll]: localBrowserTools.browser_scroll,
        [DefaultToolName.BrowserWait]: localBrowserTools.browser_wait,
        // Page Information
        [DefaultToolName.BrowserScreenshot]: localBrowserTools.browser_screenshot,
        [DefaultToolName.BrowserGetContent]: localBrowserTools.browser_get_content,
        [DefaultToolName.BrowserGetUrl]: localBrowserTools.browser_get_url,
        [DefaultToolName.BrowserGetTitle]: localBrowserTools.browser_get_title,
        [DefaultToolName.BrowserEvaluate]: localBrowserTools.browser_evaluate,
      },
      // Desktop tools work without thread context
      // IMPORTANT: desktop_command (shell execution) is essential for all agents
      [AppDefaultToolkit.Desktop]: {
        [DefaultToolName.DesktopCreate]: desktopTools.desktop_create,
        [DefaultToolName.DesktopCommand]: desktopTools.desktop_command, // Shell execution - CRITICAL
        [DefaultToolName.DesktopScreenshot]: desktopTools.desktop_screenshot,
        [DefaultToolName.DesktopClick]: desktopTools.desktop_click,
        [DefaultToolName.DesktopType]: desktopTools.desktop_type,
        [DefaultToolName.DesktopPress]: desktopTools.desktop_press,
        [DefaultToolName.DesktopScroll]: desktopTools.desktop_scroll,
        [DefaultToolName.DesktopDrag]: desktopTools.desktop_drag,
        [DefaultToolName.DesktopLaunchApp]: desktopTools.desktop_launch,
        [DefaultToolName.DesktopDisplayInfo]: desktopTools.desktop_display_info,
        [DefaultToolName.DesktopCursorPosition]: desktopTools.desktop_cursor_position,
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
      // Session Management
      [DefaultToolName.BrowserCreateSession]: contextAwareBrowserTools.browser_create_session,
      [DefaultToolName.BrowserCloseSession]: contextAwareBrowserTools.browser_close_session,
      [DefaultToolName.BrowserListSessions]: contextAwareBrowserTools.browser_list_sessions,
      [DefaultToolName.BrowserSwitchSession]: contextAwareBrowserTools.browser_switch_session,
      // Navigation
      [DefaultToolName.BrowserNavigate]: contextAwareBrowserTools.browser_navigate,
      [DefaultToolName.BrowserGoBack]: contextAwareBrowserTools.browser_go_back,
      [DefaultToolName.BrowserGoForward]: contextAwareBrowserTools.browser_go_forward,
      [DefaultToolName.BrowserReload]: contextAwareBrowserTools.browser_reload,
      // AI-Optimized Page Understanding
      [DefaultToolName.BrowserGetSnapshot]: contextAwareBrowserTools.browser_get_snapshot,
      [DefaultToolName.BrowserGetContext]: contextAwareBrowserTools.browser_get_context,
      [DefaultToolName.BrowserAnalyzeForms]: contextAwareBrowserTools.browser_analyze_forms,
      [DefaultToolName.BrowserFillForm]: contextAwareBrowserTools.browser_fill_form,
      // Element Interaction
      [DefaultToolName.BrowserClick]: contextAwareBrowserTools.browser_click,
      [DefaultToolName.BrowserFill]: contextAwareBrowserTools.browser_fill,
      [DefaultToolName.BrowserType]: contextAwareBrowserTools.browser_type,
      [DefaultToolName.BrowserPressKey]: contextAwareBrowserTools.browser_press_key,
      [DefaultToolName.BrowserScroll]: contextAwareBrowserTools.browser_scroll,
      [DefaultToolName.BrowserWait]: contextAwareBrowserTools.browser_wait,
      // Page Information
      [DefaultToolName.BrowserScreenshot]: contextAwareBrowserTools.browser_screenshot,
      [DefaultToolName.BrowserGetContent]: contextAwareBrowserTools.browser_get_content,
      [DefaultToolName.BrowserGetUrl]: contextAwareBrowserTools.browser_get_url,
      [DefaultToolName.BrowserGetTitle]: contextAwareBrowserTools.browser_get_title,
      [DefaultToolName.BrowserEvaluate]: contextAwareBrowserTools.browser_evaluate,
    },
    // Desktop/Computer Use tools (Local Terminal)
    // IMPORTANT: desktop_command (shell execution) is essential for all agents
    [AppDefaultToolkit.Desktop]: {
      [DefaultToolName.DesktopCreate]: desktopTools.desktop_create,
      [DefaultToolName.DesktopCommand]: desktopTools.desktop_command, // Shell execution - CRITICAL
      [DefaultToolName.DesktopScreenshot]: desktopTools.desktop_screenshot,
      [DefaultToolName.DesktopClick]: desktopTools.desktop_click,
      [DefaultToolName.DesktopType]: desktopTools.desktop_type,
      [DefaultToolName.DesktopPress]: desktopTools.desktop_press,
      [DefaultToolName.DesktopScroll]: desktopTools.desktop_scroll,
      [DefaultToolName.DesktopDrag]: desktopTools.desktop_drag,
      [DefaultToolName.DesktopLaunchApp]: desktopTools.desktop_launch,
      [DefaultToolName.DesktopDisplayInfo]: desktopTools.desktop_display_info,
      [DefaultToolName.DesktopCursorPosition]: desktopTools.desktop_cursor_position,
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
  };
}
