import { colorize } from "consola/utils";
import globalLogger from "logger";
import { ComposioClient, createComposioClient } from "./composio-client";

const logger = globalLogger.withDefaults({
  message: colorize("magenta", `Composio Manager: `),
});

declare global {
  // eslint-disable-next-line no-var
  var __composioClient__: ComposioClient | undefined;
}

// Runtime check - must be a function to evaluate at runtime, not build time
export function isComposioEnabled(): boolean {
  return process.env.COMPOSIO_ENABLED === "1" && !!process.env.COMPOSIO_API_KEY;
}

function getComposioClient(): ComposioClient | null {
  if (!isComposioEnabled()) {
    return null;
  }

  if (!globalThis.__composioClient__) {
    logger.info("Initializing Composio client");
    globalThis.__composioClient__ = createComposioClient();
  }

  return globalThis.__composioClient__;
}

export const composioClient = getComposioClient();

export function getComposioClientForUser(
  entityId: string,
): ComposioClient | null {
  if (!isComposioEnabled()) {
    return null;
  }

  const client = createComposioClient({ entityId });
  return client;
}
