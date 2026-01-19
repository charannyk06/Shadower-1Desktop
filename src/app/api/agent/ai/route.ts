import { streamObject } from "ai";

import { ChatModel } from "app-types/chat";
import { customModelProvider } from "lib/ai/models";
import { buildAgentGenerationPrompt } from "lib/ai/prompts";
import { checkTokenLimit } from "lib/billing";
import {
  createLimitExceededResponse,
  createUsageTrackingCallback,
  getDefaultModelConfig,
} from "lib/billing/usage-tracking";
import { workflowRepository } from "lib/db/repository";
import globalLogger from "logger";

import { AgentGenerateSchema } from "app-types/agent";
import { getSession } from "auth/server";
import { colorize } from "consola/utils";
import { mcpClientsManager } from "lib/ai/mcp/mcp-manager";
import { objectFlow } from "lib/utils";
import { safe } from "ts-safe";
import { z } from "zod";
import { loadAppDefaultTools } from "../../chat/shared.chat";

const logger = globalLogger.withDefaults({
  message: colorize("blackBright", `Agent Generate API: `),
});

export async function POST(request: Request) {
  try {
    const json = await request.json();

    const { chatModel, message = "hello" } = json as {
      chatModel?: ChatModel;
      message: string;
    };

    logger.info(`chatModel: ${chatModel?.provider}/${chatModel?.model}`);

    const session = await getSession();
    if (!session) {
      return new Response("Unauthorized", { status: 401 });
    }

    const modelConfig = getDefaultModelConfig(chatModel);

    // Check token limit with model multiplier
    // Use reasonable minimum estimate to prevent edge cases at exact limit
    const estimatedMinTokens = 500; // Agent generation is typically smaller
    const tokenLimitCheck = await checkTokenLimit(
      session.user.id,
      estimatedMinTokens,
      modelConfig.model,
      modelConfig.provider,
    );
    if (!tokenLimitCheck.allowed) {
      return createLimitExceededResponse(tokenLimitCheck);
    }

    const toolNames = new Set<string>();

    await safe(loadAppDefaultTools)
      .ifOk((appTools) => {
        objectFlow(appTools).forEach((_, toolName) => {
          toolNames.add(toolName);
        });
      })
      .unwrap();

    await safe(mcpClientsManager.tools())
      .ifOk((tools) => {
        objectFlow(tools).forEach((mcp) => {
          toolNames.add(mcp._originToolName);
        });
      })
      .unwrap();

    await safe(workflowRepository.selectExecuteAbility(session.user.id))
      .ifOk((tools) => {
        tools.forEach((tool) => {
          toolNames.add(tool.name);
        });
      })
      .unwrap();

    const dynamicAgentTable = AgentGenerateSchema.extend({
      tools: z
        .array(
          z.enum(
            Array.from(toolNames).length > 0
              ? ([
                  Array.from(toolNames)[0],
                  ...Array.from(toolNames).slice(1),
                ] as [string, ...string[]])
              : ([""] as [string]),
          ),
        )
        .describe("Agent allowed tools name")
        .nullable()
        .default([]),
    });

    const system = buildAgentGenerationPrompt(Array.from(toolNames));

    const result = streamObject({
      model: customModelProvider.getModel(chatModel),
      system,
      prompt: message,
      schema: dynamicAgentTable,
      onFinish: createUsageTrackingCallback(
        {
          userId: session.user.id,
          model: modelConfig.model,
          provider: modelConfig.provider,
          tier: tokenLimitCheck.tier,
          source: "agent_generation",
          logger,
        },
        () => message || "",
      ),
    });

    return result.toTextStreamResponse();
  } catch (error) {
    logger.error(error);
  }
}
