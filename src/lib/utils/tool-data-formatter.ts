import { extractMCPToolId } from "@/lib/ai/mcp/mcp-tool-id";
import { getFriendlyToolName } from "@/lib/utils/tool-name-formatter";

export interface FormattedToolData {
  type: "formatted" | "json";
  title?: string;
  summary?: string;
  fields?: Array<{ label: string; value: string }>;
  raw?: unknown;
}

// Helper functions to reduce cognitive complexity
function formatStringData(
  data: string,
  toolName?: string,
  isInput?: boolean,
): FormattedToolData {
  try {
    const parsed = JSON.parse(data);
    return formatToolData(parsed, toolName, isInput);
  } catch {
    return {
      type: "formatted",
      summary: data.length > 100 ? `${data.slice(0, 100)}...` : data,
      raw: data,
    };
  }
}

function formatArrayData(data: unknown[]): FormattedToolData {
  if (data.length === 0) {
    return { type: "formatted", summary: "Empty array" };
  }
  return {
    type: "formatted",
    summary: `Array with ${data.length} item${data.length === 1 ? "" : "s"}`,
    fields: [
      {
        label: "Items",
        value: `${data.length} item${data.length === 1 ? "" : "s"}`,
      },
    ],
    raw: data,
  };
}

function formatObjectData(
  obj: Record<string, unknown>,
  toolName?: string,
  isInput?: boolean,
): FormattedToolData {
  if (toolName) {
    const formatted = formatByToolType(obj, toolName, isInput ?? false);
    if (formatted) return formatted;
  }

  const entries = Object.entries(obj);
  if (entries.length === 0) {
    return { type: "formatted", summary: "Empty object" };
  }

  const fields = entries.slice(0, 5).map(([key, value]) => ({
    label: formatKey(key),
    value: formatValue(value),
  }));

  return {
    type: "formatted",
    summary: `${entries.length} field${entries.length === 1 ? "" : "s"}`,
    fields,
    raw: obj,
  };
}

/**
 * Formats tool input/output data into human-readable format
 */
export function formatToolData(
  data: unknown,
  toolName?: string,
  isInput = true,
): FormattedToolData {
  if (data === null || data === undefined) {
    return { type: "formatted", summary: "No data" };
  }

  if (typeof data === "string") {
    return formatStringData(data, toolName, isInput);
  }

  if (Array.isArray(data)) {
    return formatArrayData(data);
  }

  if (typeof data === "object") {
    return formatObjectData(data as Record<string, unknown>, toolName, isInput);
  }

  return {
    type: "formatted",
    summary: String(data),
    raw: data,
  };
}

// Helper functions to reduce cognitive complexity
function formatWebSearchTool(
  data: Record<string, unknown>,
): FormattedToolData | null {
  const query = data.query || data.q || data.search;
  if (!query) return null;
  return {
    type: "formatted",
    title: "Search Query",
    summary: String(query),
    fields: [
      { label: "Query", value: String(query) },
      ...(data.maxResults
        ? [{ label: "Max Results", value: String(data.maxResults) }]
        : []),
    ],
    raw: data,
  };
}

function formatApiRequestTool(
  data: Record<string, unknown>,
): FormattedToolData | null {
  if (!data.url && !data.endpoint) return null;
  const url = String(data.url || data.endpoint);
  const method = data.method || "GET";
  return {
    type: "formatted",
    title: "API Request",
    summary: `${method} ${url}`,
    fields: [
      { label: "Method", value: String(method).toUpperCase() },
      { label: "URL", value: url },
      ...(data.headers
        ? [{ label: "Headers", value: formatObject(data.headers) }]
        : []),
      ...(data.body ? [{ label: "Body", value: formatValue(data.body) }] : []),
    ],
    raw: data,
  };
}

function formatFileOperationTool(
  data: Record<string, unknown>,
): FormattedToolData | null {
  if (!data.path && !data.filePath && !data.filename) return null;
  const path = String(data.path || data.filePath || data.filename);
  return {
    type: "formatted",
    title: "File Operation",
    summary: path,
    fields: [
      { label: "Path", value: path },
      ...(data.content
        ? [{ label: "Content", value: formatValue(data.content) }]
        : []),
      ...(data.size ? [{ label: "Size", value: formatBytes(data.size) }] : []),
    ],
    raw: data,
  };
}

function formatDatabaseQueryTool(
  data: Record<string, unknown>,
): FormattedToolData | null {
  if (!data.query && !data.sql) return null;
  const query = String(data.query || data.sql);
  return {
    type: "formatted",
    title: "Database Query",
    summary: query.length > 60 ? `${query.slice(0, 60)}...` : query,
    fields: [{ label: "Query", value: query }],
    raw: data,
  };
}

function formatMCPTool(
  data: Record<string, unknown>,
  toolName: string,
  serverName: string,
  mcpToolName: string,
): FormattedToolData {
  let friendlyName;
  try {
    friendlyName = getFriendlyToolName(toolName || "");
  } catch (error) {
    console.error("Error getting friendly tool name:", error);
    friendlyName = {
      displayName: mcpToolName || "Unknown Tool",
      serverName: serverName,
      toolName: mcpToolName,
    };
  }
  const fields: Array<{ label: string; value: string }> = [
    { label: "Server", value: friendlyName.serverName || serverName },
    {
      label: "Tool",
      value: friendlyName.toolName || friendlyName.displayName || mcpToolName,
    },
  ];

  Object.entries(data).forEach(([key, value]) => {
    if (key !== "serverName" && key !== "toolName") {
      fields.push({ label: formatKey(key), value: formatValue(value) });
    }
  });

  const displayTitle =
    friendlyName.serverName && friendlyName.toolName
      ? `${friendlyName.serverName} → ${friendlyName.toolName}`
      : friendlyName.displayName;

  return {
    type: "formatted",
    title: displayTitle,
    summary: displayTitle,
    fields: fields.slice(0, 5),
    raw: data,
  };
}

function formatByToolType(
  data: Record<string, unknown>,
  toolName: string,
  _isInput: boolean,
): FormattedToolData | null {
  const { serverName, toolName: mcpToolName } = extractMCPToolId(toolName);

  if (toolName.includes("search") || toolName.includes("web")) {
    const result = formatWebSearchTool(data);
    if (result) return result;
  }

  if (data.url || data.endpoint) {
    return formatApiRequestTool(data);
  }

  if (data.path || data.filePath || data.filename) {
    return formatFileOperationTool(data);
  }

  if (data.query || data.sql) {
    return formatDatabaseQueryTool(data);
  }

  if (serverName && mcpToolName) {
    return formatMCPTool(data, toolName, serverName, mcpToolName);
  }

  return null;
}

function formatKey(key: string): string {
  // Convert camelCase to Title Case
  return (
    key
      // Insert space before uppercase letters (camelCase to Title Case)
      // SonarQube: regex pattern with capture group requires replace() instead of replaceAll()
      // NOSONAR: replaceAll() does not support regex patterns with capture groups
      .replace(/([A-Z])/g, " $1") // NOSONAR
      .replace(/^./, (str) => str.toUpperCase())
      .trim()
  );
}

function formatValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") {
    return value.length > 100 ? `${value.slice(0, 100)}...` : value;
  }
  if (typeof value === "object") {
    return formatObject(value);
  }
  return String(value);
}

function formatObject(obj: unknown): string {
  if (typeof obj !== "object" || obj === null) return String(obj);
  try {
    const str = JSON.stringify(obj, null, 2);
    return str.length > 200 ? `${str.slice(0, 200)}...` : str;
  } catch {
    return String(obj);
  }
}

function formatBytes(bytes: unknown): string {
  if (typeof bytes !== "number") return String(bytes);
  const sizes = ["B", "KB", "MB", "GB"];
  if (bytes === 0) return "0 B";
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${Math.round((bytes / Math.pow(1024, i)) * 100) / 100} ${sizes[i]}`;
}
