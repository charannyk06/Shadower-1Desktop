import {
  UIMessage,
  convertToModelMessages,
  smoothStream,
  streamText,
} from "ai";
import { getSession } from "auth/server";
import { customModelProvider } from "lib/ai/models";
import { buildUserSystemPrompt } from "lib/ai/prompts";
import { checkTokenLimit } from "lib/billing";
import {
  createLimitExceededResponse,
  createUsageTrackingCallback,
  getDefaultModelConfig,
} from "lib/billing/usage-tracking";
import { getUserPreferences } from "lib/user/server";
import globalLogger from "logger";

import { colorize } from "consola/utils";

const logger = globalLogger.withDefaults({
  message: colorize("blackBright", `Temporary Chat API: `),
});

export async function POST(request: Request) {
  try {
    const json = await request.json();

    const session = await getSession();
    if (!session) {
      return new Response("Unauthorized", { status: 401 });
    }

    const { messages, chatModel, instructions } = json as {
      messages: UIMessage[];
      chatModel?: {
        provider: string;
        model: string;
      };
      instructions?: string;
    };

    const modelConfig = getDefaultModelConfig(chatModel);

    // Check token limit with model multiplier
    // Use reasonable minimum estimate to prevent edge cases at exact limit
    const estimatedMinTokens = 500; // Smaller estimate for temporary/simple requests
    const tokenLimitCheck = await checkTokenLimit(
      session.user.id,
      estimatedMinTokens,
      modelConfig.model,
      modelConfig.provider,
    );
    if (!tokenLimitCheck.allowed) {
      logger.warn(
        `[Billing] Token limit exceeded for user ${session.user.id}: ${tokenLimitCheck.usage}/${tokenLimitCheck.limit}`,
      );
      return createLimitExceededResponse(tokenLimitCheck);
    }

    logger.info(`model: ${modelConfig.provider}/${modelConfig.model}`);
    const model = customModelProvider.getModel(chatModel);
    const userPreferences =
      (await getUserPreferences(session.user.id)) || undefined;

    // Estimate input tokens from messages
    const inputText = messages
      .map((m) => (m.parts ? JSON.stringify(m.parts) : ""))
      .join(" ");

    const result = streamText({
      model,
      system: `${buildUserSystemPrompt(session.user, userPreferences)} ${
        instructions ? `\n\n${instructions}` : ""
      }`.trim(),
      messages: await convertToModelMessages(messages),
      experimental_transform: smoothStream({ chunking: "word" }),
      onFinish: createUsageTrackingCallback(
        {
          userId: session.user.id,
          model: modelConfig.model,
          provider: modelConfig.provider,
          tier: tokenLimitCheck.tier,
          source: "temporary_chat",
          logger,
        },
        () => inputText,
      ),
    });

    return result.toUIMessageStreamResponse();
  } catch (error: any) {
    logger.error(error);
    return new Response(error.message || "Oops, an error occured!", {
      status: 500,
    });
  }
}
