/**
 * Tool Tracking Wrapper
 *
 * Wraps AI SDK tools with billing tracking to ensure usage is recorded
 * even when tools execute inside the ToolLoopAgent (agent mode).
 *
 * The default tracking in chat/route.ts only works in streamText mode
 * because it relies on responseMessage.parts which doesn't contain
 * tool results in agent mode.
 */

import { subscriptionRepository } from "@/lib/db/repository";
import type { Tool } from "ai";
import {
  trackImageGeneration,
  trackMcpToolCall,
  trackWebSearch,
} from "./openmeter";
import { SERVICE_CREDIT_COSTS, getImageCredits } from "./types";

const IMAGE_TOOL_NAME = "image_manager";
const WEB_SEARCH_TOOL_NAME = "webSearch";
const WEB_CONTENT_TOOL_NAME = "webContent";

/**
 * Wraps tools with billing tracking
 * This ensures usage is recorded regardless of whether tools run in
 * agent mode (ToolLoopAgent) or streamText mode.
 *
 * @param tools - Record of tool name to Tool object
 * @param userId - User ID for billing
 * @returns Wrapped tools with tracking
 */
export function wrapToolsWithTracking(
  tools: Record<string, Tool>,
  userId: string,
): Record<string, Tool> {
  const wrappedTools: Record<string, Tool> = {};

  for (const [toolName, tool] of Object.entries(tools)) {
    // Skip tools that already have tracking or don't need it
    if (shouldSkipTracking(toolName)) {
      wrappedTools[toolName] = tool;
      continue;
    }

    // Wrap the tool's execute function
    wrappedTools[toolName] = wrapToolWithTracking(toolName, tool, userId);
  }

  return wrappedTools;
}

/**
 * Determines if a tool should skip tracking
 * Planning/context tools don't need billing tracking
 */
function shouldSkipTracking(toolName: string): boolean {
  const skipTools = [
    "createPlan",
    "updateTaskStatus",
    "getNextTask",
    "getPlanStatus",
    "setContext",
    "getContext",
    "getAllContext",
    "spawnUserAgent",
    "spawnParallelAgents",
    "executeWorkflow",
  ];
  return skipTools.includes(toolName);
}

/**
 * Wraps a single tool with tracking based on its type
 */
function wrapToolWithTracking(
  toolName: string,
  tool: Tool,
  userId: string,
): Tool {
  const originalExecute = tool.execute;

  // If no execute function, return as-is
  if (!originalExecute) {
    return tool;
  }

  // Create wrapped execute function
  const wrappedExecute = async (
    args: Parameters<NonNullable<Tool["execute"]>>[0],
    options: Parameters<NonNullable<Tool["execute"]>>[1],
  ) => {
    // Execute the original tool first
    const result = await originalExecute(args, options);

    // Track based on tool type (fire and forget)
    try {
      if (toolName === IMAGE_TOOL_NAME) {
        await trackImageTool(userId, args, result);
      } else if (
        toolName === WEB_SEARCH_TOOL_NAME ||
        toolName === WEB_CONTENT_TOOL_NAME
      ) {
        await trackWebSearchTool(userId, toolName, args);
      } else if (toolName.includes("_")) {
        // MCP tools have underscores in their names (e.g., "mcp_server_tool")
        await trackMcpTool(userId, toolName);
      }
    } catch (err) {
      // Don't fail the tool execution if tracking fails
      console.error(`[Billing] Failed to track ${toolName}:`, err);
    }

    return result;
  };

  // Return new tool with wrapped execute
  return {
    ...tool,
    execute: wrappedExecute,
  } as Tool;
}

/**
 * Track image generation tool usage
 */
async function trackImageTool(
  userId: string,
  _args: unknown,
  result: unknown,
): Promise<void> {
  const typedResult = result as {
    images?: Array<{ size?: string }>;
    model?: string;
  };
  const imageCount = typedResult?.images?.length || 1;
  const imageModel = typedResult?.model || "unknown";
  const imageResolution = typedResult?.images?.[0]?.size;

  // Track in OpenMeter
  trackImageGeneration({
    userId,
    model: imageModel,
    provider: "image",
    imageCount,
    imageResolution,
  }).catch(console.error);

  // Calculate credits
  const imageCredits =
    getImageCredits(imageModel, imageResolution) * imageCount;

  // Record usage event
  await subscriptionRepository.recordUsageEvent({
    userId,
    eventType: "image_generation",
    amount: String(imageCount),
    metadata: {
      toolName: IMAGE_TOOL_NAME,
      model: imageModel,
      imageResolution,
      creditsConsumed: imageCredits,
      source: "agent_mode",
    },
  });

  console.log(
    `[Billing] Image generation tracked (agent mode): ${imageCount} images, ${imageCredits} credits for user ${userId}`,
  );
}

/**
 * Track web search tool usage
 */
async function trackWebSearchTool(
  userId: string,
  toolName: string,
  args: unknown,
): Promise<void> {
  const typedArgs = args as { query?: string; urls?: string[] };
  const searchQuery =
    typedArgs?.query || typedArgs?.urls?.join(", ") || "unknown";

  // Track in OpenMeter
  trackWebSearch({
    userId,
    query: searchQuery,
    toolName,
  }).catch(console.error);

  // Record usage event
  await subscriptionRepository.recordUsageEvent({
    userId,
    eventType: "web_search",
    amount: "1",
    metadata: {
      toolName,
      query: searchQuery,
      creditsConsumed: SERVICE_CREDIT_COSTS.webSearchPerQuery,
      source: "agent_mode",
    },
  });

  console.log(
    `[Billing] Web search tracked (agent mode): ${toolName} for user ${userId}`,
  );
}

/**
 * Track MCP tool usage
 */
async function trackMcpTool(userId: string, toolName: string): Promise<void> {
  // Track in OpenMeter
  trackMcpToolCall({
    userId,
    toolName,
  }).catch(console.error);

  // Record usage event
  await subscriptionRepository.recordUsageEvent({
    userId,
    eventType: "mcp_tool_call",
    amount: "1",
    metadata: {
      toolName,
      creditsConsumed: SERVICE_CREDIT_COSTS.mcpPerCall,
      source: "agent_mode",
    },
  });

  console.log(
    `[Billing] MCP tool tracked (agent mode): ${toolName} for user ${userId}`,
  );
}
