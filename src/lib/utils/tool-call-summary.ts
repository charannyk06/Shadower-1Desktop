import { getFriendlyToolName } from "./tool-name-formatter";

export interface ToolCallSummary {
  action: string;
  detail?: string;
}

/**
 * Generates a human-readable summary for a tool call based on its name and input
 */
export function getToolCallSummary(
  toolName: string,
  input: unknown
): ToolCallSummary {
  const normalizedName = toolName.toLowerCase();
  const args = (input && typeof input === "object" ? input : {}) as Record<
    string,
    unknown
  >;

  // File read operations
  if (
    normalizedName.includes("read") ||
    normalizedName === "read_file" ||
    normalizedName === "readfile"
  ) {
    const path = getPathFromArgs(args);
    const lines = args.lines || args.limit || args.count;
    if (lines) {
      return {
        action: `Read ${lines} lines`,
        detail: path,
      };
    }
    return {
      action: "Read",
      detail: path,
    };
  }

  // File write operations
  if (
    normalizedName.includes("write") ||
    normalizedName === "write_file" ||
    normalizedName === "writefile"
  ) {
    const path = getPathFromArgs(args);
    return {
      action: "Write",
      detail: path,
    };
  }

  // Edit operations
  if (normalizedName.includes("edit") || normalizedName === "edit_file") {
    const path = getPathFromArgs(args);
    return {
      action: "Edit",
      detail: path,
    };
  }

  // Glob/Find file operations
  if (
    normalizedName.includes("glob") ||
    normalizedName.includes("find") ||
    normalizedName === "search_files" ||
    normalizedName === "list_directory"
  ) {
    const pattern = args.pattern || args.glob || args.query;
    const path = getPathFromArgs(args);
    if (pattern) {
      return {
        action: `Find ${truncate(String(pattern), 40)}`,
        detail: path,
      };
    }
    return {
      action: "Find files",
      detail: path,
    };
  }

  // Grep/Search operations
  if (
    normalizedName.includes("grep") ||
    normalizedName.includes("search") ||
    normalizedName === "ripgrep"
  ) {
    const query =
      args.pattern || args.query || args.search || args.q || args.regex;
    const path = getPathFromArgs(args);
    if (query) {
      return {
        action: `grep for '${truncate(String(query), 50)}'`,
        detail: path,
      };
    }
    return {
      action: "Search",
      detail: path,
    };
  }

  // Bash/Execute operations
  if (
    normalizedName.includes("bash") ||
    normalizedName.includes("shell") ||
    normalizedName.includes("exec") ||
    normalizedName.includes("run") ||
    normalizedName === "execute_command"
  ) {
    const command = args.command || args.cmd || args.script;
    if (command) {
      return {
        action: `$ ${truncate(String(command), 60)}`,
      };
    }
    return {
      action: "Execute command",
    };
  }

  // Web search
  if (normalizedName.includes("websearch") || normalizedName === "web_search") {
    const query = args.query || args.q || args.search;
    if (query) {
      return {
        action: `Search web for '${truncate(String(query), 40)}'`,
      };
    }
    return {
      action: "Web search",
    };
  }

  // Web content/fetch
  if (
    normalizedName.includes("webcontent") ||
    normalizedName.includes("fetch") ||
    normalizedName === "web_content"
  ) {
    const url = args.url || args.href;
    if (url) {
      return {
        action: "Fetch",
        detail: truncate(String(url), 60),
      };
    }
    return {
      action: "Fetch web content",
    };
  }

  // Browser operations
  if (normalizedName.startsWith("browser")) {
    const action = normalizedName.replace(/^browser_?/i, "").replace(/_/g, " ");
    const url = args.url;
    const selector = args.selector;
    if (url) {
      return {
        action: `Browser ${action || "action"}`,
        detail: truncate(String(url), 50),
      };
    }
    if (selector) {
      return {
        action: `Browser ${action}`,
        detail: truncate(String(selector), 40),
      };
    }
    return {
      action: `Browser ${action || "action"}`,
    };
  }

  // Desktop operations
  if (normalizedName.startsWith("desktop")) {
    const action = normalizedName.replace(/^desktop_?/i, "").replace(/_/g, " ");
    return {
      action: `Desktop ${action || "action"}`,
    };
  }

  // MCP tools - extract server and tool name
  const friendlyName = getFriendlyToolName(toolName);
  if (friendlyName.serverName && friendlyName.toolName) {
    // Check for common patterns in the tool name
    const mcpToolName = friendlyName.toolName.toLowerCase();

    if (mcpToolName.includes("read")) {
      const path = getPathFromArgs(args);
      return {
        action: `Read`,
        detail: path,
      };
    }

    if (mcpToolName.includes("write")) {
      const path = getPathFromArgs(args);
      return {
        action: `Write`,
        detail: path,
      };
    }

    if (mcpToolName.includes("list") || mcpToolName.includes("directory")) {
      const path = getPathFromArgs(args);
      return {
        action: `List`,
        detail: path,
      };
    }

    if (mcpToolName.includes("search") || mcpToolName.includes("find")) {
      const query = args.query || args.pattern || args.search;
      return {
        action: `Search ${query ? `'${truncate(String(query), 30)}'` : ""}`,
        detail: getPathFromArgs(args),
      };
    }

    return {
      action: friendlyName.toolName,
      detail: friendlyName.serverName,
    };
  }

  // Default: use friendly name
  return {
    action: friendlyName.displayName,
  };
}

/**
 * Gets a result summary for display
 */
export function getToolResultSummary(
  toolName: string,
  result: unknown
): string | undefined {
  if (!result) return undefined;

  const normalizedName = toolName.toLowerCase();

  // Handle string results
  if (typeof result === "string") {
    // Skip status-only strings - the dot color indicates success/failure
    const trimmed = result.trim().toLowerCase();
    if (
      trimmed === "success" ||
      trimmed === "failed" ||
      trimmed === "ok" ||
      trimmed === "done" ||
      trimmed === "error"
    ) {
      return undefined;
    }

    const lines = result.split("\n").length;
    if (lines > 1) {
      return `${lines} lines`;
    }
    // Skip short single-line responses - not useful as summaries
    return undefined;
  }

  // Handle object results
  if (typeof result === "object" && result !== null) {
    const obj = result as Record<string, unknown>;

    // Check for matches/results count
    if (obj.matches !== undefined) {
      return `${obj.matches} matches`;
    }
    if (obj.count !== undefined) {
      return `${obj.count} results`;
    }
    if (Array.isArray(obj.results)) {
      return `${obj.results.length} results`;
    }
    if (Array.isArray(obj.files)) {
      return `${obj.files.length} files`;
    }

    // Read operations
    if (
      normalizedName.includes("read") &&
      (obj.content || obj.text || obj.data)
    ) {
      const content = String(obj.content || obj.text || obj.data);
      const lines = content.split("\n").length;
      return `${lines} lines`;
    }

    // Don't show "Success" or "Failed" - the status dot color indicates this
    // Only return meaningful result summaries like counts, matches, etc.
  }

  return undefined;
}

function getPathFromArgs(args: Record<string, unknown>): string | undefined {
  const path =
    args.path ||
    args.file_path ||
    args.filePath ||
    args.filename ||
    args.file ||
    args.directory ||
    args.dir;
  if (path) {
    // Shorten the path to show just the filename or last parts
    const pathStr = String(path);
    const parts = pathStr.split("/");
    if (parts.length > 3) {
      return `.../${parts.slice(-2).join("/")}`;
    }
    return pathStr;
  }
  return undefined;
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return `${str.slice(0, maxLen)}...`;
}
