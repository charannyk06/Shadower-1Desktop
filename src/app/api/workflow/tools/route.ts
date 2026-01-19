import { getSession } from "auth/server";
import { mcpClientsManager } from "lib/ai/mcp/mcp-manager";
import { WorkflowToolKey } from "lib/ai/workflow/workflow.interface";
import { withRetry } from "lib/api-retry";
import { mcpRepository, workflowRepository } from "lib/db/repository";
import logger from "logger";

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
            id: tool.name,
            type: "mcp-tool",
            serverId: server.id,
            serverName: server.name,
          } as WorkflowToolKey);
        });
      }
    }
    return tools;
  })();

  const [workflows, mcpTools] = await Promise.all([
    workflowsPromise,
    mcpToolsPromise,
  ]);

  // Server-side logging
  logger.debug("[Workflow Tools API] Fetched tools", {
    mcpCount: mcpTools.length,
    workflowCount: workflows.length,
  });

  const formattedWorkflows = workflows.map((w) => ({
    ...w,
    id: w.id,
    type: "workflow" as const,
  }));

  return Response.json([...mcpTools, ...formattedWorkflows]);
}
