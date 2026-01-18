import { getSession } from "auth/server";
import { mcpClientsManager } from "lib/ai/mcp/mcp-manager";
import { WorkflowToolKey } from "lib/ai/workflow/workflow.interface";
import { withRetry } from "lib/api-retry";
import { mcpRepository, workflowRepository } from "lib/db/repository";
import logger from "logger";
import { getComposioRouteContext } from "../../composio/utils";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return Response.json([]);
  }

  // 1. Fetch Workflows (with retry for deadlocks)
  const workflowsPromise = withRetry(
    () => workflowRepository.selectExecuteAbility(session.user.id),
    {
      maxRetries: 3,
      baseDelay: 100,
      retryableErrors: ["40P01"],
    },
  );

  // 2. Fetch MCP Tools (with retry for deadlocks)
  const mcpToolsPromise = (async () => {
    const servers = await withRetry(
      () => mcpRepository.selectAllForUser(session.user.id),
      {
        maxRetries: 3,
        baseDelay: 100,
        retryableErrors: ["40P01"],
      },
    );
    const memoryClients = await mcpClientsManager.getClients();
    const memoryMap = new Map(
      memoryClients.map(({ id, client }) => [id, client] as const),
    );

    const tools: WorkflowToolKey[] = [];

    for (const server of servers) {
      const mem = memoryMap.get(server.id);
      const info = mem?.getInfo();
      if (info?.status === "connected" && info?.toolInfo) {
        info.toolInfo.forEach((tool) => {
          tools.push({
            ...tool,
            id: tool.name, // WorkflowToolKey uses 'id' as name
            type: "mcp-tool",
            serverId: server.id,
            serverName: server.name,
          } as WorkflowToolKey);
        });
      }
    }
    return tools;
  })();

  // 3. Fetch Composio Tools
  const composioToolsPromise = (async () => {
    try {
      const ctx = await getComposioRouteContext();
      if (!ctx.success) return [];

      const connections = await ctx.client.getConnections();
      const connectedApps = connections
        .filter((c) => c.status === "active")
        .map((c) => c.appName);

      const allTools = await Promise.all(
        connectedApps.map((app) => ctx.client.getToolsForApp(app)),
      );

      return allTools.flat().map(
        (tool): WorkflowToolKey => ({
          id: tool.name,
          description: tool.description || "",
          parameterSchema:
            tool.parameters as WorkflowToolKey["parameterSchema"],
          type: "composio-tool",
          appName: tool.appName,
        }),
      );
    } catch (e) {
      logger.error("Failed to fetch composio tools", e);
      return [];
    }
  })();

  const [workflows, mcpTools, composioTools] = await Promise.all([
    workflowsPromise,
    mcpToolsPromise,
    composioToolsPromise,
  ]);

  // Server-side logging
  logger.debug("[Workflow Tools API] Fetched tools", {
    mcpCount: mcpTools.length,
    composioCount: composioTools.length,
    workflowCount: workflows.length,
  });
  if (composioTools.length > 0) {
    logger.debug("[Workflow Tools API] Composio tools sample", {
      sample: composioTools.slice(0, 3).map((t) => ({
        id: t.id,
        type: t.type,
        appName: "appName" in t ? t.appName : undefined,
      })),
    });
  }

  // Combine and map workflows to tool shape if they are to be used as tools (Optional, preserving existing logic)
  // The existing logic returned raw workflows. The builder needs *tools*.
  // We will return a combined list. The frontend likely expects WorkflowToolKey[] based on usage in `WorkflowToolSelect`.

  // Existing frontend expects `WorkflowToolKey`.
  // Let's verify `app-types/workflow` or where `WorkflowToolKey` is used to ensure no breaking change for existing tool selector.
  // The existing tool selector uses `WorkflowToolKey`.
  // If `workflowRepository.selectExecuteAbility` returns specific workflow objects,
  // we might need to adapt them or just return them if the UI handles them (Code check: `useWorkflowToolList` calls this).

  const formattedWorkflows = workflows.map((w) => ({
    ...w,
    id: w.id, // Explicitly use UUID for ID
    type: "workflow" as const, // Ensure it matches the newly added type field
  }));

  // Note: The original returned `workflows`. If the original `selectExecuteAbility` returned `Workflow[]`,
  // and the frontend consumed them, we should be careful.
  // But since we are building a *new* builder, we need unified tools.
  // Returns a union of WorkflowToolKey[] and formatted workflow objects
  return Response.json([...mcpTools, ...composioTools, ...formattedWorkflows]);
}
