import { smoothStream, streamText } from "ai";

import { ChatModel } from "app-types/chat";
import { getSession } from "auth/server";
import { colorize } from "consola/utils";
import { customModelProvider } from "lib/ai/models";
import { CREATE_THREAD_TITLE_PROMPT } from "lib/ai/prompts";
import { checkTokenLimit } from "lib/billing";
import {
  createLimitExceededResponse,
  getDefaultModelConfig,
  trackAndRecordUsage,
} from "lib/billing/usage-tracking";
import { chatRepository } from "lib/db/repository";
import globalLogger from "logger";
import { handleError } from "../shared.chat";

const logger = globalLogger.withDefaults({
  message: colorize("blackBright", `Title API: `),
});

export async function POST(request: Request) {
  try {
    const json = await request.json();

    const {
      chatModel,
      message = "hello",
      threadId,
    } = json as {
      chatModel?: ChatModel;
      message: string;
      threadId: string;
    };

    const session = await getSession();
    if (!session) {
      return new Response("Unauthorized", { status: 401 });
    }

    const modelConfig = getDefaultModelConfig(chatModel);

    // Check token limit with model multiplier
    // Use reasonable minimum estimate to prevent edge cases at exact limit
    const estimatedMinTokens = 200; // Title generation uses very few tokens
    const tokenLimitCheck = await checkTokenLimit(
      session.user.id,
      estimatedMinTokens,
      modelConfig.model,
      modelConfig.provider,
    );
    if (!tokenLimitCheck.allowed) {
      return createLimitExceededResponse(tokenLimitCheck);
    }

    logger.info(
      `chatModel: ${chatModel?.provider}/${chatModel?.model}, threadId: ${threadId}`,
    );

    const result = streamText({
      model: customModelProvider.getModel(chatModel),
      system: CREATE_THREAD_TITLE_PROMPT,
      experimental_transform: smoothStream({ chunking: "word" }),
      prompt: message,
      abortSignal: request.signal,
      onFinish: (ctx) => {
        // Save the title
        chatRepository
          .upsertThread({
            id: threadId,
            title: ctx.text,
            userId: session.user.id,
          })
          .catch((err) => logger.error(err));

        // Track token usage for billing with multiplier
        const inputTokens =
          ctx.usage?.inputTokens || Math.ceil((message?.length || 0) / 4);
        const outputTokens =
          ctx.usage?.outputTokens || Math.ceil((ctx.text?.length || 0) / 4);

        trackAndRecordUsage({
          userId: session.user.id,
          model: modelConfig.model,
          provider: modelConfig.provider,
          inputTokens,
          outputTokens,
          tier: tokenLimitCheck.tier,
          source: "title_generation",
          logger,
        }).catch((err) => logger.error("Failed to track usage:", err));
      },
    });

    return result.toUIMessageStreamResponse();
  } catch (err) {
    return new Response(handleError(err), { status: 500 });
  }
}
