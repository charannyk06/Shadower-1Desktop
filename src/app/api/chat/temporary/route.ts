import {
  UIMessage,
  convertToModelMessages,
  smoothStream,
  streamText,
} from "ai";
import { getSession } from "auth/server";
import { customModelProvider } from "lib/ai/models";
import { buildUserSystemPrompt } from "lib/ai/prompts";
import { getUserPreferences } from "lib/user/server";
import globalLogger from "logger";

import { colorize } from "consola/utils";

const logger = globalLogger.withDefaults({
  message: colorize("blackBright", `Temporary Chat API: `),
});

// Local-only: Get model config from ChatModel
function getDefaultModelConfig(chatModel?: {
  provider: string;
  model: string;
}) {
  return {
    model: chatModel?.model || "gpt-4o-mini",
    provider: chatModel?.provider || "openai",
  };
}

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

    logger.info(`model: ${modelConfig.provider}/${modelConfig.model}`);
    const model = customModelProvider.getModel(chatModel);
    const userPreferences =
      (await getUserPreferences(session.user.id)) || undefined;

    const result = streamText({
      model,
      system: `${buildUserSystemPrompt(session.user, userPreferences)} ${
        instructions ? `\n\n${instructions}` : ""
      }`.trim(),
      messages: await convertToModelMessages(messages),
      experimental_transform: smoothStream({ chunking: "word" }),
    });

    return result.toUIMessageStreamResponse();
  } catch (error: any) {
    logger.error(error);
    return new Response(error.message || "Oops, an error occured!", {
      status: 500,
    });
  }
}
