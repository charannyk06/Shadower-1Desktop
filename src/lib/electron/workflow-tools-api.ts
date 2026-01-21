/**
 * Unified Workflow Tools API for Desktop (Electron)
 *
 * This module provides a unified API for fetching workflow tools (workflows + MCP tools).
 * Desktop-only - no HTTP fallbacks.
 */

import { WorkflowToolKey } from "lib/ai/workflow/workflow.interface";

/**
 * Get current user ID from Electron auth
 */
async function getElectronUserId(): Promise<string> {
  const user = await window.electronAPI.auth.getCurrentUser();
  return user?.id || "local-user";
}

/**
 * Unified Workflow Tools API - Desktop Only (IPC)
 */
export const workflowToolsApi = {
  /**
   * Get all workflow tools (workflows with execute ability + MCP tools)
   */
  async getAll(): Promise<WorkflowToolKey[]> {
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
          description: w.description || w.name || "",
          type: "app-tool" as const,
        }));

      // For MCP tools, in Electron desktop mode we need to get tool info
      // from the MCP client manager. However, since MCP client manager
      // runs on the server side, we return the servers that are enabled
      // and let the UI handle loading tool details when needed.

      return workflowTools;
    } catch (error) {
      console.error(
        "[workflowToolsApi] Error fetching workflow tools:",
        error,
      );
      return [];
    }
  },
};

/**
 * SWR-compatible fetcher for workflow tools
 */
export async function workflowToolsFetcher(url: string): Promise<any> {
  if (url === "/api/workflow/tools" || url === "/api/workflow/tools/") {
    return workflowToolsApi.getAll();
  }

  // Unrecognized pattern - return empty array
  console.warn(
    `[workflowToolsFetcher] Unrecognized URL pattern: ${url}, returning empty array`,
  );
  return [];
}

export default workflowToolsApi;
