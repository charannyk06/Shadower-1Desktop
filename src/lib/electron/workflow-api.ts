/**
 * Unified Workflow API for Desktop (Electron)
 *
 * This module provides a unified API for workflow operations using Electron IPC.
 * Desktop-only - no HTTP fallbacks.
 */

import {
  DBWorkflow,
  DBNode,
  DBEdge,
  WorkflowSummary,
} from "app-types/workflow";

/**
 * Check if we're running in Electron mode
 */
export function isElectronMode(): boolean {
  return typeof window !== "undefined" && !!window.electronAPI;
}

/**
 * Get current user ID from Electron auth
 */
async function getElectronUserId(): Promise<string> {
  const user = await window.electronAPI.auth.getCurrentUser();
  return user?.id || "local-user";
}

/**
 * Get current user ID - exposed for components that need the correct user ID
 */
export async function getCurrentUserId(): Promise<string | undefined> {
  return getElectronUserId();
}

/**
 * Unified Workflow API - Desktop Only (IPC)
 */
export const workflowApi = {
  /**
   * Get all workflows for the current user
   */
  async getAll(): Promise<WorkflowSummary[]> {
    const userId = await getElectronUserId();
    return window.electronAPI.db.workflows.getAll(userId);
  },

  /**
   * Get a single workflow by ID with nodes and edges
   */
  async getById(
    id: string,
  ): Promise<(DBWorkflow & { nodes: DBNode[]; edges: DBEdge[] }) | null> {
    return window.electronAPI.db.workflows.getById(id);
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
    const userId = await getElectronUserId();
    return window.electronAPI.db.workflows.create({
      ...data,
      userId,
    });
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
    return window.electronAPI.db.workflows.update(id, data);
  },

  /**
   * Delete a workflow
   */
  async delete(id: string): Promise<void> {
    await window.electronAPI.db.workflows.delete(id);
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
    await window.electronAPI.db.workflows.saveStructure(workflowId, data);
  },

  /**
   * Execute a workflow with callback-based event streaming
   * This is the primary method for desktop workflow execution
   */
  async executeWithCallback(
    workflowId: string,
    input: Record<string, any>,
    onEvent: (event: { type: string; [key: string]: any }) => void,
  ): Promise<{ success: boolean }> {
    // Set up event listener
    const cleanup = window.electronAPI.workflow.onEvent((data) => {
      if (data.workflowId === workflowId) {
        onEvent(data.event);
      }
    });

    try {
      // Execute the workflow
      const result = await window.electronAPI.workflow.execute(workflowId, input);
      return result;
    } finally {
      // Clean up event listener
      cleanup();
    }
  },

  /**
   * Cancel a running workflow execution
   */
  async cancel(workflowId: string): Promise<{ success: boolean; cancelled: boolean }> {
    return window.electronAPI.workflow.cancel(workflowId);
  },

  /**
   * Execute a workflow - returns a ReadableStream for compatibility
   * Wraps the IPC streaming in a ReadableStream interface
   */
  async execute(
    workflowId: string,
    query: Record<string, any>,
  ): Promise<ReadableStreamDefaultReader<Uint8Array>> {
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        // Set up event listener
        const cleanup = window.electronAPI.workflow.onEvent((data) => {
          if (data.workflowId === workflowId) {
            // Encode event as JSON line
            const chunk = encoder.encode(JSON.stringify(data.event) + "\n");
            controller.enqueue(chunk);

            // Close stream on completion or error
            if (data.event.type === "complete" || data.event.type === "error") {
              cleanup();
              controller.close();
            }
          }
        });

        // Start execution
        window.electronAPI.workflow.execute(workflowId, query).catch((error) => {
          cleanup();
          controller.error(error);
        });
      },
    });

    return stream.getReader();
  },

  /**
   * Execute a workflow with stream - returns a Response for fetch-like interface
   */
  async executeWithStream(
    workflowId: string,
    query: Record<string, any>,
    signal?: AbortSignal,
  ): Promise<Response> {
    const encoder = new TextEncoder();

    // Handle abort signal
    if (signal) {
      signal.addEventListener("abort", () => {
        this.cancel(workflowId);
      });
    }

    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        // Set up event listener
        const cleanup = window.electronAPI.workflow.onEvent((data) => {
          if (data.workflowId === workflowId) {
            // Encode event as JSON line
            const chunk = encoder.encode(JSON.stringify(data.event) + "\n");
            controller.enqueue(chunk);

            // Close stream on completion or error
            if (data.event.type === "complete" || data.event.type === "error") {
              cleanup();
              controller.close();
            }
          }
        });

        // Start execution
        window.electronAPI.workflow.execute(workflowId, query).catch((error) => {
          cleanup();
          controller.error(error);
        });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      },
    });
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

  // Unrecognized pattern
  console.warn(
    `[workflowFetcher] Unrecognized URL pattern: ${url}, returning empty array`,
  );
  return [];
}

export default workflowApi;
