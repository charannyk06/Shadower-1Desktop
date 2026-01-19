import "server-only";

import { OpenMeter } from "@openmeter/sdk";
import { getModelMultiplier } from "./model-multipliers";
import {
  SERVICE_CREDIT_COSTS,
  UsageEvent,
  UsageEventType,
  getImageCredits,
} from "./types";

const OPENMETER_API_KEY = process.env.OPENMETER_API_KEY;
const OPENMETER_BASE_URL =
  process.env.OPENMETER_BASE_URL || "https://openmeter.cloud";

let openmeterClient: OpenMeter | null = null;

function getClient(): OpenMeter | null {
  if (!OPENMETER_API_KEY) {
    return null;
  }
  if (!openmeterClient) {
    openmeterClient = new OpenMeter({
      baseUrl: OPENMETER_BASE_URL as "https://openmeter.cloud",
      apiKey: OPENMETER_API_KEY,
    });
  }
  return openmeterClient;
}

export function isOpenMeterEnabled(): boolean {
  return !!OPENMETER_API_KEY && process.env.BILLING_ENABLED === "1";
}

export async function trackUsageEvent(event: UsageEvent): Promise<void> {
  const client = getClient();
  if (!client) {
    return;
  }

  try {
    await client.events.ingest({
      specversion: "1.0",
      id: `${event.userId}-${event.type}-${Date.now()}`,
      source: "shadower-app",
      type: event.type,
      subject: event.userId,
      time: new Date(event.timestamp || Date.now()),
      data: event.data,
    });
  } catch (error) {
    console.error("[OpenMeter] Failed to track event:", error);
  }
}

export async function trackLLMUsage(params: {
  userId: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  tier?: "free" | "pro" | "ultra";
}): Promise<void> {
  // Calculate credits based on model multiplier
  const tier = params.tier || "free";
  const multiplier = getModelMultiplier(params.model, params.provider, tier);
  const creditsConsumed = Math.ceil(params.totalTokens * multiplier);

  await trackUsageEvent({
    type: "llm_tokens",
    userId: params.userId,
    data: {
      model: params.model,
      provider: params.provider,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      totalTokens: params.totalTokens,
      creditsConsumed,
    },
  });
}

export async function trackImageGeneration(params: {
  userId: string;
  model: string;
  provider: string;
  imageCount: number;
  imageResolution?: string; // For 4K detection on Gemini models
}): Promise<void> {
  // Calculate credits based on model and resolution
  const creditPerImage = getImageCredits(params.model, params.imageResolution);
  const creditsConsumed = creditPerImage * params.imageCount;

  await trackUsageEvent({
    type: "image_generation",
    userId: params.userId,
    data: {
      model: params.model,
      provider: params.provider,
      imageCount: params.imageCount,
      imageResolution: params.imageResolution,
      creditsConsumed,
    },
  });
}

export async function trackSandboxExecution(params: {
  userId: string;
  executionMs: number;
}): Promise<void> {
  // Fixed credit cost per sandbox execution
  const creditsConsumed = SERVICE_CREDIT_COSTS.sandboxPerExecution;

  await trackUsageEvent({
    type: "sandbox_execution",
    userId: params.userId,
    data: {
      executionMs: params.executionMs,
      creditsConsumed,
    },
  });
}

export async function trackVoiceMinutes(params: {
  userId: string;
  minutes: number;
  model?: string;
}): Promise<void> {
  // Calculate credits based on voice minutes
  const creditsConsumed = Math.ceil(
    SERVICE_CREDIT_COSTS.voicePerMinute * params.minutes,
  );

  await trackUsageEvent({
    type: "voice_minutes",
    userId: params.userId,
    data: {
      minutes: params.minutes,
      model: params.model,
      creditsConsumed,
    },
  });
}

export async function trackMcpToolCall(params: {
  userId: string;
  toolName: string;
}): Promise<void> {
  // Fixed credit cost per MCP call
  const creditsConsumed = SERVICE_CREDIT_COSTS.mcpPerCall;

  await trackUsageEvent({
    type: "mcp_tool_call",
    userId: params.userId,
    data: {
      toolName: params.toolName,
      creditsConsumed,
    },
  });
}

export async function trackWorkflowExecution(params: {
  userId: string;
  workflowId: string;
}): Promise<void> {
  // Fixed credit cost per workflow run
  const creditsConsumed = SERVICE_CREDIT_COSTS.workflowPerRun;

  await trackUsageEvent({
    type: "workflow_execution",
    userId: params.userId,
    data: {
      workflowId: params.workflowId,
      creditsConsumed,
    },
  });
}

export async function trackWebSearch(params: {
  userId: string;
  query: string;
  toolName?: string; // webSearch or webContent
}): Promise<void> {
  // Fixed credit cost per web search query
  const creditsConsumed = SERVICE_CREDIT_COSTS.webSearchPerQuery;

  await trackUsageEvent({
    type: "web_search",
    userId: params.userId,
    data: {
      query: params.query,
      toolName: params.toolName || "webSearch",
      creditsConsumed,
    },
  });
}

export async function getUserUsage(
  userId: string,
  from: Date,
  to: Date,
): Promise<Record<UsageEventType, number>> {
  const client = getClient();
  if (!client) {
    return {
      llm_tokens: 0,
      image_generation: 0,
      sandbox_execution: 0,
      voice_minutes: 0,
      mcp_tool_call: 0,
      workflow_execution: 0,
      web_search: 0,
    };
  }

  const meterTypes: UsageEventType[] = [
    "llm_tokens",
    "image_generation",
    "sandbox_execution",
    "voice_minutes",
    "mcp_tool_call",
    "workflow_execution",
    "web_search",
  ];

  const results: Record<UsageEventType, number> = {
    llm_tokens: 0,
    image_generation: 0,
    sandbox_execution: 0,
    voice_minutes: 0,
    mcp_tool_call: 0,
    workflow_execution: 0,
    web_search: 0,
  };

  try {
    for (const meterType of meterTypes) {
      const query = await client.meters.query(meterType, {
        subject: [userId],
        from: from.toISOString(),
        to: to.toISOString(),
      });

      if (query.data && query.data.length > 0) {
        results[meterType] = query.data.reduce(
          (sum, item) => sum + (item.value || 0),
          0,
        );
      }
    }
  } catch (error) {
    console.error("[OpenMeter] Failed to query usage:", error);
  }

  return results;
}

export const openmeter = {
  isEnabled: isOpenMeterEnabled,
  trackUsageEvent,
  trackLLMUsage,
  trackImageGeneration,
  trackSandboxExecution,
  trackVoiceMinutes,
  trackMcpToolCall,
  trackWorkflowExecution,
  trackWebSearch,
  getUserUsage,
};
