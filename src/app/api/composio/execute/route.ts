import {
  SERVICE_CREDIT_COSTS,
  checkComposioLimit,
  trackComposioAction,
} from "lib/billing";
import { subscriptionRepository } from "lib/db/repository";
import { getComposioRouteContext } from "../utils";

export async function POST(request: Request) {
  const ctx = await getComposioRouteContext({ errorOnDisabled: true });
  if (!ctx.success) return ctx.response;

  // Check composio limit before executing action
  const composioLimitCheck = await checkComposioLimit(ctx.userId);
  if (!composioLimitCheck.allowed) {
    console.warn(
      `[Billing] Composio limit exceeded for user ${ctx.userId}: ${composioLimitCheck.usage}/${composioLimitCheck.limit}`,
    );
    return Response.json(
      {
        error: "limit_exceeded",
        message: composioLimitCheck.reason,
        usage: composioLimitCheck.usage,
        limit: composioLimitCheck.limit,
        tier: composioLimitCheck.tier,
      },
      { status: 429 },
    );
  }

  try {
    const body = await request.json();
    const { actionName, params } = body;

    if (!actionName) {
      return Response.json(
        { error: "actionName is required" },
        { status: 400 },
      );
    }

    const result = await ctx.client.executeAction(actionName, params || {});

    // Track Composio action for billing
    trackComposioAction({
      userId: ctx.userId,
      actionName,
    }).catch(console.error);

    subscriptionRepository
      .recordUsageEvent({
        userId: ctx.userId,
        eventType: "composio_action",
        amount: "1",
        metadata: {
          actionName,
          creditsConsumed: SERVICE_CREDIT_COSTS.composioPerAction,
        },
      })
      .catch(console.error);

    return Response.json({ success: true, data: result });
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Failed to execute action" },
      { status: 500 },
    );
  }
}
