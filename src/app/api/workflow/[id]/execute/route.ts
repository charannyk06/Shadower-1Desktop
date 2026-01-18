import { colorize } from "consola/utils";
import { createWorkflowExecutor } from "lib/ai/workflow/executor/workflow-executor";
import { encodeWorkflowEvent } from "lib/ai/workflow/shared.workflow";
import { validateSession } from "lib/api/auth-helpers";
import {
  createLimitExceededResponse,
  validateWorkflowLimit,
} from "lib/api/limit-helpers";
import { SERVICE_CREDIT_COSTS, trackWorkflowExecution } from "lib/billing";
import { subscriptionRepository, workflowRepository } from "lib/db/repository";
import { safeJSONParse, toAny } from "lib/utils";
import logger from "logger";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { query } = await request.json();

  const auth = await validateSession();
  if (!auth.success) return auth.response;

  const hasAccess = await workflowRepository.checkAccess(id, auth.userId);
  if (!hasAccess) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Check billing limits before processing
  const limitError = await validateWorkflowLimit(auth.userId);
  if (limitError) {
    logger.warn(
      `[Billing] Workflow limit exceeded for user ${auth.userId}: ${limitError.usage}/${limitError.limit}`,
    );
    return createLimitExceededResponse(limitError);
  }

  const workflow = await workflowRepository.selectStructureById(id);
  if (!workflow) {
    return new Response("Workflow not found", { status: 404 });
  }

  const wfLogger = logger.withDefaults({
    message: colorize("cyan", `WORKFLOW '${workflow.name}' `),
  });
  const app = createWorkflowExecutor({
    edges: workflow.edges,
    nodes: workflow.nodes,
    logger: wfLogger,
    userId: auth.userId, // Pass userId for Composio tool execution
  });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let isAborted = false;
      // Subscribe to workflow events
      app.subscribe((evt) => {
        if (isAborted) return;
        if (
          (evt.eventType == "NODE_START" || evt.eventType == "NODE_END") &&
          evt.node.name == "SKIP"
        ) {
          return;
        }
        try {
          const err = toAny(evt)?.error;
          if (err) {
            toAny(evt).error = {
              name: err.name || "ERROR",
              message: err?.message || safeJSONParse(err).value,
            };
          }
          // Use custom encoding instead of SSE format
          const data = encodeWorkflowEvent(evt);
          controller.enqueue(encoder.encode(data));
          // Close stream when workflow ends
          if (evt.eventType === "WORKFLOW_END") {
            controller.close();
          }
        } catch (error) {
          logger.error("Stream write error:", error);
          controller.error(error);
        }
      });

      // Handle client disconnection
      request.signal.addEventListener("abort", async () => {
        isAborted = true;
        void app.exit();
        controller.close();
      });

      // Start the workflow
      app
        .run(
          { query },
          {
            disableHistory: true,
            timeout: 1000 * 60 * 5,
          },
        )
        .then((result) => {
          if (!result.isOk) {
            logger.error("Workflow execution error:", result.error);
          }

          // Track workflow execution for billing
          logger.info(
            `[Billing] Recording workflow execution for user ${auth.userId}`,
          );

          trackWorkflowExecution({
            userId: auth.userId,
            workflowId: id,
          }).catch(console.error);

          subscriptionRepository
            .recordUsageEvent({
              userId: auth.userId,
              eventType: "workflow_execution",
              amount: "1",
              metadata: {
                workflowId: id,
                workflowName: workflow.name,
                creditsConsumed: SERVICE_CREDIT_COSTS.workflowPerRun,
              },
            })
            .then(() => logger.info("[Billing] Workflow execution recorded"))
            .catch((err) =>
              logger.error("[Billing] Failed to record workflow:", err),
            );
        });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
