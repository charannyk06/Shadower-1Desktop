/**
 * Unified Workflow API for Desktop (Electron) and Web
 *
 * This module provides a unified API for workflow operations that automatically
 * detects if we're running in Electron mode and uses IPC, or falls back to
 * fetch calls for web mode.
 *
 * In Electron desktop mode, all operations go through window.electronAPI.db.workflows
 * In web mode, operations use the standard fetch API
 */

import {
  DBWorkflow,
  DBNode,
  DBEdge,
  WorkflowSummary,
} from "app-types/workflow";

/**
 * Check if we're running in Electron mode with workflow IPC available
 */
export function isElectronMode(): boolean {
  return (
    typeof window !== "undefined" &&
    window.electronAPI !== undefined &&
    window.electronAPI.db?.workflows !== undefined
  );
}

/**
 * Get current user ID from Electron auth
 * This returns the actual database user ID (UUID), not the hardcoded "local-user" string
 */
async function getElectronUserId(): Promise<string> {
  if (!isElectronMode()) {
    throw new Error("Not in Electron mode");
  }
  const user = await window.electronAPI.auth.getCurrentUser();
  return user?.id || "local-user";
}

/**
 * Get current user ID - exposed for components that need the correct user ID
 * In Electron mode, this returns the actual database UUID
 * In web mode, this returns undefined (use session instead)
 */
export async function getCurrentUserId(): Promise<string | undefined> {
  if (!isElectronMode()) {
    return undefined;
  }
  return getElectronUserId();
}

/**
 * Unified Workflow API
 */
export const workflowApi = {
  /**
   * Get all workflows for the current user
   */
  async getAll(): Promise<WorkflowSummary[]> {
    if (isElectronMode()) {
      const userId = await getElectronUserId();
      return window.electronAPI.db.workflows.getAll(userId);
    }
    const res = await fetch("/api/workflow");
    if (!res.ok) throw new Error(`Failed to get workflows: ${res.status}`);
    return res.json();
  },

  /**
   * Get a single workflow by ID with nodes and edges
   */
  async getById(
    id: string,
  ): Promise<(DBWorkflow & { nodes: DBNode[]; edges: DBEdge[] }) | null> {
    if (isElectronMode()) {
      return window.electronAPI.db.workflows.getById(id);
    }
    const res = await fetch(`/api/workflow/${id}`);
    if (!res.ok) throw new Error(`Failed to get workflow: ${res.status}`);
    return res.json();
  },

  /**
   * Create a new workflow
   */
  async create(data: {
    name: string;
    description?: string;
    icon?: any;
    visibility?: "private" | "public" | "readonly";
    isPublished?: boolean;
  }): Promise<DBWorkflow> {
    if (isElectronMode()) {
      const userId = await getElectronUserId();
      return window.electronAPI.db.workflows.create({
        ...data,
        userId,
      });
    }
    const res = await fetch("/api/workflow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Failed to create workflow: ${res.status}`);
    return res.json();
  },

  /**
   * Update an existing workflow
   */
  async update(
    id: string,
    data: Partial<{
      name: string;
      description: string;
      icon: any;
      visibility: "private" | "public" | "readonly";
      isPublished: boolean;
    }>,
  ): Promise<DBWorkflow> {
    if (isElectronMode()) {
      return window.electronAPI.db.workflows.update(id, data);
    }
    const res = await fetch(`/api/workflow/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Failed to update workflow: ${res.status}`);
    return res.json();
  },

  /**
   * Delete a workflow
   */
  async delete(id: string): Promise<void> {
    if (isElectronMode()) {
      await window.electronAPI.db.workflows.delete(id);
      return;
    }
    const res = await fetch(`/api/workflow/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error(`Failed to delete workflow: ${res.status}`);
  },

  /**
   * Save workflow structure (nodes and edges)
   * Accepts partial node/edge types (without createdAt/updatedAt)
   * Uses proper diff-based saving - only updates changed nodes, deletes specified ones
   */
  async saveStructure(
    workflowId: string,
    data: {
      nodes?: Omit<DBNode, "createdAt" | "updatedAt">[];
      edges?: Omit<DBEdge, "createdAt" | "updatedAt">[];
      deleteNodes?: string[];
      deleteEdges?: string[];
    },
  ): Promise<void> {
    if (isElectronMode()) {
      // Use the new saveStructure IPC handler that properly handles diffs
      await window.electronAPI.db.workflows.saveStructure(workflowId, data);
      return;
    }
    const res = await fetch(`/api/workflow/${workflowId}/structure`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok)
      throw new Error(`Failed to save workflow structure: ${res.status}`);
  },

  /**
   * Execute a workflow
   * Returns a ReadableStream for streaming execution events
   */
  async execute(
    workflowId: string,
    query: Record<string, any>,
  ): Promise<ReadableStreamDefaultReader<Uint8Array>> {
    if (isElectronMode()) {
      // For Electron, we need to create a mock stream from IPC events
      // This will be handled by a custom IPC handler that streams events
      throw new Error(
        "Workflow execution in Electron mode requires streaming IPC - use executeWithCallback instead",
      );
    }
    const res = await fetch(`/api/workflow/${workflowId}/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) throw new Error(`Failed to execute workflow: ${res.status}`);
    const reader = res.body?.getReader();
    if (!reader) throw new Error("No readable stream available");
    return reader;
  },

  /**
   * Execute a workflow with callbacks (for both Electron and Web)
   * This provides a unified interface for handling streaming events
   */
  async executeWithStream(
    workflowId: string,
    query: Record<string, any>,
    signal?: AbortSignal,
  ): Promise<Response> {
    // Both Electron and Web use the same fetch-based approach
    // The API route will handle the execution appropriately
    const res = await fetch(`/api/workflow/${workflowId}/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
      signal,
    });
    if (!res.ok) {
      throw new Error(`Failed to execute workflow: ${res.status}`);
    }
    return res;
  },
};

/**
 * SWR-compatible fetcher that uses the workflow API
 */
export async function workflowFetcher(url: string): Promise<any> {
  // Handle different endpoint patterns
  if (url === "/api/workflow") {
    return workflowApi.getAll();
  }

  const workflowMatch = url.match(/^\/api\/workflow\/([^\/]+)$/);
  if (workflowMatch) {
    return workflowApi.getById(workflowMatch[1]);
  }

  // Fallback to regular fetch for unrecognized patterns
  if (isElectronMode()) {
    console.warn(
      `[workflowFetcher] Unrecognized URL pattern: ${url}, using fetch fallback`,
    );
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  return res.json();
}

export default workflowApi;
