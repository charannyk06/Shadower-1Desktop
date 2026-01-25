import { extractMCPToolId } from "@/lib/ai/mcp/mcp-tool-id";
import { DefaultToolName } from "@/lib/ai/tools";

export interface FriendlyToolName {
  displayName: string;
  serverName?: string;
  toolName?: string;
}

/**
 * Maps default tool names to friendly display names
 */
const DEFAULT_TOOL_NAME_MAP: Record<string, string> = {
  // Visualization tools
  [DefaultToolName.CreatePieChart]: "Create Pie Chart",
  [DefaultToolName.CreateBarChart]: "Create Bar Chart",
  [DefaultToolName.CreateLineChart]: "Create Line Chart",
  [DefaultToolName.CreateTable]: "Create Table",

  // Web tools
  [DefaultToolName.WebSearch]: "Web Search",
  [DefaultToolName.WebContent]: "Get Web Content",

  // Browser automation tools
  [DefaultToolName.BrowserCreateSession]: "Create Browser Session",
  [DefaultToolName.BrowserCloseSession]: "Close Browser Session",
  [DefaultToolName.BrowserNavigate]: "Navigate Browser",
  [DefaultToolName.BrowserClick]: "Click Element",
  [DefaultToolName.BrowserFill]: "Fill Input",
  [DefaultToolName.BrowserType]: "Type Text",
  [DefaultToolName.BrowserGetSnapshot]: "Get Page Snapshot",
  [DefaultToolName.BrowserGetContent]: "Get Page Content",
  [DefaultToolName.BrowserScreenshot]: "Take Screenshot",
  [DefaultToolName.BrowserWait]: "Wait for Condition",
  [DefaultToolName.BrowserEvaluate]: "Evaluate JavaScript",

  // Desktop/Computer Use tools
  [DefaultToolName.DesktopCreate]: "Create Desktop Session",
  [DefaultToolName.DesktopScreenshot]: "Take Screenshot",
  [DefaultToolName.DesktopClick]: "Click",
  [DefaultToolName.DesktopType]: "Type Text",
  [DefaultToolName.DesktopPress]: "Press Key",
  [DefaultToolName.DesktopScroll]: "Scroll",
  [DefaultToolName.DesktopDrag]: "Drag and Drop",
  [DefaultToolName.DesktopLaunchApp]: "Launch Application",

  // Data analysis tools
  [DefaultToolName.UploadDataset]: "Upload Dataset",
  [DefaultToolName.ProfileData]: "Profile Data",
  [DefaultToolName.AnalyzeData]: "Analyze Data",
  [DefaultToolName.CreateVisualization]: "Create Visualization",

  // Document generation tools
  [DefaultToolName.CreatePresentation]: "Create Presentation",
  [DefaultToolName.CreateDocument]: "Create Document",
  [DefaultToolName.CreateSpreadsheet]: "Create Spreadsheet",
  [DefaultToolName.CreateMultiSheetWorkbook]: "Create Workbook",
  [DefaultToolName.CreatePDF]: "Create PDF",

  // Document editing tools
  [DefaultToolName.EditSpreadsheet]: "Edit Spreadsheet",
  [DefaultToolName.EditPresentation]: "Edit Presentation",
  [DefaultToolName.EditDocument]: "Edit Document",

  // Research tools
  [DefaultToolName.DeepResearch]: "Deep Research",

  // Other tools
  sequential_thinking: "Sequential Thinking",
  image_manager: "Image Manager",

  // Agent planning tools
  createPlan: "Create Plan",
  updateTaskStatus: "Update Task Status",
  getNextTask: "Get Next Task",
  getPlanStatus: "Get Plan Status",
};

/**
 * Maps browser tool patterns (snake_case) to friendly names
 */
const BROWSER_TOOL_NAME_MAP: Record<string, string> = {
  browser_navigate: "Navigate to URL",
  browser_act: "Perform Action",
  browser_observe: "Observe Page",
  browser_extract: "Extract Data",
  browser_screenshot: "Take Screenshot",
  browser_wait: "Wait",
  browser_close: "Close Browser",
  browser_stealth: "Enable Stealth Mode",
  browser_get_content: "Get Content",
  browser_replay: "Replay Session",
};

/**
 * Maps desktop tool patterns (snake_case) to friendly names
 */
const DESKTOP_TOOL_NAME_MAP: Record<string, string> = {
  desktop_create: "Create Desktop Session",
  desktop_screenshot: "Take Screenshot",
  desktop_click: "Click",
  desktop_type: "Type Text",
  desktop_press: "Press Key",
  desktop_scroll: "Scroll",
  desktop_launch: "Launch Application",
  desktop_move: "Move Mouse",
  desktop_drag: "Drag and Drop",
  desktop_command: "Run Command",
  desktop_stream: "Start Stream",
  desktop_close: "Close Desktop",
};

/**
 * Maps Electron desktop tools (created in electron/ipc/ai.ts) to friendly names
 * These tools are local to the desktop app and provide direct system access
 */
const ELECTRON_TOOL_NAME_MAP: Record<string, string> = {
  // Terminal
  terminal_execute: "Run Terminal Command",
  // File operations (with and without local_ prefix for MCP compatibility)
  file_read: "Read File",
  file_write: "Write File",
  file_list: "List Directory",
  file_search: "Search Files",
  local_file_read: "Read File (Local)",
  local_file_write: "Write File (Local)",
  local_file_list: "List Directory (Local)",
  local_file_search: "Search Files (Local)",
  // Web search (with and without local_ prefix)
  web_search: "Web Search",
  web_fetch: "Fetch Web Content",
  local_web_search: "Web Search (Local)",
  local_web_fetch: "Fetch Web Content (Local)",
  // Browser
  browser_open: "Open in Browser",
  local_browser_open: "Open in Browser (Local)",
  // Clipboard
  clipboard_read: "Read Clipboard",
  clipboard_write: "Write to Clipboard",
  // System
  system_info: "Get System Info",
  // Memory
  memory_search: "Search Memory",
};

/**
 * Maps common MCP server names to friendly display names
 */
const MCP_SERVER_NAME_MAP: Record<string, string> = {
  "cursor-ide-browser": "Browser",
  filesystem: "File System",
  github: "GitHub",
  slack: "Slack",
  linear: "Linear",
  notion: "Notion",
  postgres: "PostgreSQL",
  mysql: "MySQL",
  mongodb: "MongoDB",
};

/**
 * Maps common MCP tool name patterns to friendly names
 */
const MCP_TOOL_NAME_MAP: Record<string, string> = {
  browser_navigate: "Navigate to URL",
  browser_snapshot: "Take Snapshot",
  browser_click: "Click Element",
  browser_type: "Type Text",
  browser_hover: "Hover Element",
  read_file: "Read File",
  write_file: "Write File",
  list_directory: "List Directory",
  create_file: "Create File",
  delete_file: "Delete File",
  search_code: "Search Code",
  get_issue: "Get Issue",
  create_issue: "Create Issue",
  update_issue: "Update Issue",
};

/**
 * Formats a string from various cases to Title Case
 */
function toTitleCase(str: string): string {
  // Handle camelCase
  // Using replace() instead of replaceAll() because regex with capture groups requires replace()
  // NOSONAR: replaceAll() does not support regex patterns with capture groups
  str = str.replace(/([a-z])([A-Z])/g, "$1 $2"); // NOSONAR

  // Handle snake_case and kebab-case
  // Replace all underscores and hyphens with spaces
  str = str.replaceAll("_", " ").replaceAll("-", " ");

  // Split and capitalize each word
  return str
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ")
    .trim();
}

/**
 * Formats an MCP server name to a friendly display name
 */
function formatMCPServerName(serverName: string): string {
  // Check if we have a direct mapping
  if (MCP_SERVER_NAME_MAP[serverName]) {
    return MCP_SERVER_NAME_MAP[serverName];
  }

  // Remove common prefixes
  const formatted = serverName
    .replace(/^mcp-/, "")
    .replace(/^cursor-ide-/, "")
    .replace(/-server$/, "")
    .replace(/-mcp$/, "");

  // Convert to title case
  return toTitleCase(formatted);
}

/**
 * Formats an MCP tool name to a friendly display name
 */
function formatMCPToolName(toolName: string): string {
  // Check if we have a direct mapping
  if (MCP_TOOL_NAME_MAP[toolName]) {
    return MCP_TOOL_NAME_MAP[toolName];
  }

  // Convert to title case
  return toTitleCase(toolName);
}

/**
 * Gets the original tool name for a renamed local_ prefixed tool
 * This is used for display purposes when tools are renamed to avoid MCP conflicts
 */
export function getOriginalToolName(toolName: string): string {
  if (toolName.startsWith("local_")) {
    return toolName.slice(6); // Remove 'local_' prefix
  }
  return toolName;
}

/**
 * Gets the display name for a tool, stripping local_ prefix for cleaner UI
 * Use this when you want to show the user-friendly name without "(Local)" suffix
 */
export function getCleanDisplayName(toolName: string): string {
  // Get the original name if it's a local_ prefixed tool
  const originalName = getOriginalToolName(toolName);

  // Look up in Electron tools map (prefer the non-local version)
  if (ELECTRON_TOOL_NAME_MAP[originalName]) {
    return ELECTRON_TOOL_NAME_MAP[originalName];
  }

  // Fall back to the full getFriendlyToolName logic
  return getFriendlyToolName(toolName).displayName;
}

/**
 * Gets a friendly display name for a tool
 */
export function getFriendlyToolName(toolName: string): FriendlyToolName {
  // Handle empty or invalid tool names
  if (!toolName || typeof toolName !== "string") {
    return {
      displayName: "Unknown Tool",
    };
  }

  // Check if it's an Electron desktop tool (takes priority)
  if (ELECTRON_TOOL_NAME_MAP[toolName]) {
    return {
      displayName: ELECTRON_TOOL_NAME_MAP[toolName],
    };
  }

  // Check if it's a default tool
  if (DEFAULT_TOOL_NAME_MAP[toolName]) {
    return {
      displayName: DEFAULT_TOOL_NAME_MAP[toolName],
    };
  }

  // Check if it's a browser tool (snake_case pattern)
  if (toolName.startsWith("browser_")) {
    const friendlyName =
      BROWSER_TOOL_NAME_MAP[toolName] ||
      toTitleCase(toolName.replaceAll("browser_", ""));
    return {
      displayName: friendlyName,
    };
  }

  // Check if it's a desktop tool (snake_case pattern)
  if (toolName.startsWith("desktop_")) {
    const friendlyName =
      DESKTOP_TOOL_NAME_MAP[toolName] ||
      toTitleCase(toolName.replaceAll("desktop_", ""));
    return {
      displayName: friendlyName,
    };
  }

  // Check if it's a browser tool (camelCase pattern)
  if (toolName.startsWith("browser") && toolName !== "browser") {
    // Replace prefix only - using replace() with regex anchor for precise matching
    // SonarQube: regex pattern requires replace() instead of replaceAll()
    const camelCaseName = toolName.replace(/^browser/, "browser_");
    // Insert underscore before uppercase letters
    // SonarQube: regex pattern with capture group requires replace() instead of replaceAll()
    // NOSONAR: replaceAll() does not support regex patterns with capture groups
    const snakeCaseName = camelCaseName
      .replace(/([A-Z])/g, "_$1") // NOSONAR
      .toLowerCase();
    const friendlyName =
      BROWSER_TOOL_NAME_MAP[snakeCaseName] ||
      // Remove prefix - using replace() with regex anchor for precise matching
      // SonarQube: regex pattern requires replace() instead of replaceAll()
      // NOSONAR: replaceAll() does not support regex patterns with anchors
      toTitleCase(toolName.replace(/^browser/, "")); // NOSONAR
    return {
      displayName: friendlyName,
    };
  }

  // Check if it's a desktop tool (camelCase pattern)
  if (toolName.startsWith("desktop") && toolName !== "desktop") {
    // Replace prefix only - using replace() with regex anchor for precise matching
    // SonarQube: regex pattern requires replace() instead of replaceAll()
    // NOSONAR: replaceAll() does not support regex patterns with anchors
    const camelCaseName = toolName.replace(/^desktop/, "desktop_"); // NOSONAR
    // Insert underscore before uppercase letters
    // SonarQube: regex pattern with capture group requires replace() instead of replaceAll()
    // NOSONAR: replaceAll() does not support regex patterns with capture groups
    const snakeCaseName = camelCaseName
      .replace(/([A-Z])/g, "_$1") // NOSONAR
      .toLowerCase();
    const friendlyName =
      DESKTOP_TOOL_NAME_MAP[snakeCaseName] ||
      // Remove prefix - using replace() with regex anchor for precise matching
      // SonarQube: regex pattern requires replace() instead of replaceAll()
      toTitleCase(toolName.replace(/^desktop/, ""));
    return {
      displayName: friendlyName,
    };
  }

  // Check if it's an MCP tool (contains underscore separator)
  const { serverName: mcpServerName, toolName: mcpToolName } =
    extractMCPToolId(toolName);

  if (mcpServerName && mcpToolName) {
    const friendlyServerName = formatMCPServerName(mcpServerName);
    const friendlyToolName = formatMCPToolName(mcpToolName);

    return {
      displayName: friendlyToolName,
      serverName: friendlyServerName,
      toolName: friendlyToolName,
    };
  }

  // Fallback: smart formatting
  return {
    displayName: toTitleCase(toolName),
  };
}
