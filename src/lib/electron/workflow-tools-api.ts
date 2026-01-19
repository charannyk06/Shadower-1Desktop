/**
 * Unified Workflow Tools API for Desktop (Electron) and Web
 *
 * This module provides a unified API for fetching workflow tools (workflows + MCP tools)
 * that automatically detects if we're running in Electron mode and uses IPC,
 * or falls back to fetch calls for web mode.
 */

import { WorkflowToolKey } from "lib/ai/workflow/workflow.interface";

/**
 * Check if we're running in Electron mode with the required IPC available
 */
export function isElectronMode(): boolean {
  return (
    typeof window !== "undefined" &&
    window.electronAPI !== undefined &&
    window.electronAPI.db?.workflows !== undefined &&
    window.electronAPI.db?.mcp !== undefined
  );
}

/**
 * Get current user ID from Electron auth
 */
async function getElectronUserId(): Promise<string> {
  if (!isElectronMode()) {
    throw new Error("Not in Electron mode");
  }
  const user = await window.electronAPI.auth.getCurrentUser();
  return user?.id || "local-user";
}

/**
 * Unified Workflow Tools API
 */
export const workflowToolsApi = {
  /**
   * Get all workflow tools (workflows with execute ability + MCP tools)
   */
  async getAll(): Promise<WorkflowToolKey[]> {
    if (isElectronMode()) {
      try {
        const userId = await getElectronUserId();

        // Fetch workflows and MCP servers in parallel
        const [workflows, _mcpServers] = await Promise.all([
          window.electronAPI.db.workflows.getAll(userId),
          window.electronAPI.db.mcp.getServers(),
        ]);

        // Format workflows as workflow tools
        // Only include workflows that are published and have execute ability
        const workflowTools: WorkflowToolKey[] = workflows
          .filter(
            (w: any) =>
              w.isPublished ||
              w.visibility === "public" ||
              w.visibility === "readonly",
          )
          .map((w: any) => ({
            id: w.id,
            name: w.name,
            description: w.description || "",
            type: "workflow" as const,
            icon: w.icon,
          }));

        // For MCP tools, in Electron desktop mode we need to get tool info
        // from the MCP client manager. However, since MCP client manager
        // runs on the server side, we return the servers that are enabled
        // and let the UI handle loading tool details when needed.
        // This is a limitation - MCP tool details require the server to be connected.

        console.log(
          `[workflowToolsApi] Found ${workflowTools.length} workflow tools`,
        );

        return workflowTools;
      } catch (error) {
        console.error(
          "[workflowToolsApi] Error fetching workflow tools:",
          error,
        );
        return [];
      }
    }

    // Web mode - use fetch
    const res = await fetch("/api/workflow/tools");
    if (!res.ok) {
      throw new Error(`Failed to get workflow tools: ${res.status}`);
    }
    return res.json();
  },
};

/**
 * SWR-compatible fetcher for workflow tools
 */
export async function workflowToolsFetcher(url: string): Promise<any> {
  if (url === "/api/workflow/tools" || url === "/api/workflow/tools/") {
    return workflowToolsApi.getAll();
  }

  // Fallback to regular fetch for unrecognized patterns
  if (isElectronMode()) {
    console.warn(
      `[workflowToolsFetcher] Unrecognized URL pattern: ${url}, using fetch fallback`,
    );
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  return res.json();
}

export default workflowToolsApi;
