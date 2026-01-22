/**
 * Client-side dynamic model fetching for Electron
 * This allows fetching models directly from provider APIs using API keys from Electron secure storage
 */

/**
 * Client-side model capability detection (simplified version)
 */
function getModelCapabilities(modelId: string) {
  // Reasoning models
  const isReasoning =
    /(^|[/:-])o[134]/i.test(modelId) ||
    /gpt-5/i.test(modelId) ||
    /codex/i.test(modelId) ||
    /deepseek-r1/i.test(modelId);

  // Built-in tools
  const hasBuiltIn = /gpt-oss/i.test(modelId);

  // Requires Responses API
  const needsResponsesAPI = /computer-use/i.test(modelId);

  // Image support
  const isImageInputSupported =
    /4o/i.test(modelId) ||
    /4\.1/i.test(modelId) ||
    /gpt-5/i.test(modelId) ||
    /gemini/i.test(modelId) ||
    /claude/i.test(modelId) ||
    /grok/i.test(modelId);

  // Tool call support
  const isToolCallSupported = !hasBuiltIn && !needsResponsesAPI;

  // Workflow support
  let workflowGenerationSupport: "full" | "limited" | "none" = "full";
  let toolCallUnsupportedReason:
    | "reasoning-model"
    | "built-in-tools"
    | "responses-api-only"
    | undefined;

  if (hasBuiltIn) {
    workflowGenerationSupport = "none";
    toolCallUnsupportedReason = "built-in-tools";
  } else if (needsResponsesAPI) {
    workflowGenerationSupport = "none";
    toolCallUnsupportedReason = "responses-api-only";
  }

  // Reasoning effort levels
  const reasoningEffort: string[] | undefined = isReasoning
    ? ["low", "medium", "high"]
    : undefined;

  // Thinking levels (for specific models)
  const thinkingLevel: string[] | undefined =
    /gemini-[23]/i.test(modelId) ||
    /claude-opus-4-5/i.test(modelId) ||
    /claude-sonnet-4-5/i.test(modelId)
      ? ["none", "low", "medium", "high"]
      : undefined;

  return {
    isReasoningModel: isReasoning,
    isToolCallSupported,
    isImageInputSupported,
    workflowGenerationSupport,
    toolCallUnsupportedReason,
    reasoningEffort,
    thinkingLevel,
  };
}

interface ModelListResponse {
  data: Array<{
    id: string;
    created?: number;
    created_at?: string;
    display_name?: string;
    context_window?: number;
    owned_by?: string;
  }>;
}

interface DynamicModelInfo {
  id: string;
  name: string;
  isToolCallSupported: boolean;
  isImageInputSupported: boolean;
  isReasoningModel: boolean;
  workflowGenerationSupport: "full" | "limited" | "none";
  toolCallUnsupportedReason?:
    | "reasoning-model"
    | "built-in-tools"
    | "responses-api-only";
  reasoningEffort?: string[];
  thinkingLevel?: string[];
  supportedFileMimeTypes: string[];
}

/**
 * Format Anthropic display name
 */
function formatAnthropicDisplayName(
  modelId: string,
  displayName?: string,
): string {
  if (displayName) return displayName;

  const name = modelId
    .replace("claude-", "Claude ")
    .replace("-3-5-", " 3.5 ")
    .replace("-4-5-", " 4.5 ")
    .replace("-4-", " 4 ")
    .replace("-3-", " 3 ")
    .replace("-sonnet", " Sonnet")
    .replace("-opus", " Opus")
    .replace("-haiku", " Haiku")
    .replace(/-\d{8}/g, "")
    .replace(/-latest/g, "");

  return name.trim();
}

/**
 * Format OpenAI display name
 */
function formatOpenAIDisplayName(modelId: string): string {
  let name = modelId;

  if (name.startsWith("gpt-")) {
    name = name.replace("gpt-", "GPT-");
  } else if (
    name.startsWith("o1") ||
    name.startsWith("o3") ||
    name.startsWith("o4")
  ) {
    name = name.toUpperCase();
  }

  name = name
    .replace(/-preview/g, " Preview")
    .replace(/-mini/g, " Mini")
    .replace(/-nano/g, " Nano")
    .replace(/-turbo/g, " Turbo")
    .replace(/-chat/g, " Chat")
    .replace(/-latest/g, "")
    .replace(/-pro/g, " Pro")
    .replace(/-\d{4}-\d{2}-\d{2}/g, "");

  return name;
}

/**
 * Format Google display name
 */
function formatGoogleDisplayName(
  modelId: string,
  displayName?: string,
): string {
  if (displayName && !displayName.startsWith("models/")) return displayName;

  const name = modelId
    .replace("models/", "")
    .replace("gemini-", "Gemini ")
    .replace("-pro", " Pro")
    .replace("-flash", " Flash")
    .replace("-lite", " Lite")
    .replace("-thinking", " Thinking")
    .replace(/-\d{4}/g, "");

  return name.trim();
}

/**
 * Fetch with timeout
 */
async function fetchWithTimeout(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Transform model to DynamicModelInfo
 */
function transformModel(
  modelId: string,
  displayName: string,
  supportedFileMimeTypes: string[],
  _contextWindow?: number,
): DynamicModelInfo {
  const capabilities = getModelCapabilities(modelId);

  return {
    id: modelId,
    name: displayName,
    isToolCallSupported: capabilities.isToolCallSupported,
    isImageInputSupported: capabilities.isImageInputSupported,
    isReasoningModel: capabilities.isReasoningModel,
    workflowGenerationSupport: capabilities.workflowGenerationSupport,
    toolCallUnsupportedReason: capabilities.toolCallUnsupportedReason,
    reasoningEffort: capabilities.reasoningEffort,
    thinkingLevel: capabilities.thinkingLevel,
    supportedFileMimeTypes,
  };
}

/**
 * Fetch Anthropic models
 */
export async function fetchAnthropicModelsClient(
  apiKey: string,
  timeoutMs: number = 10000,
): Promise<DynamicModelInfo[]> {
  try {
    const response = await fetchWithTimeout(
      "https://api.anthropic.com/v1/models",
      {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      timeoutMs,
    );

    if (!response.ok) {
      console.error(`Anthropic models API error: ${response.status}`);
      return [];
    }

    const data = (await response.json()) as ModelListResponse;

    const models = data.data
      .filter((model) => model.id.includes("claude"))
      .sort((a, b) => {
        const aTime =
          a.created ??
          (a.created_at ? new Date(a.created_at).getTime() / 1000 : 0);
        const bTime =
          b.created ??
          (b.created_at ? new Date(b.created_at).getTime() / 1000 : 0);
        return bTime - aTime;
      })
      .map((model) =>
        transformModel(
          model.id,
          formatAnthropicDisplayName(model.id, model.display_name),
          [
            "application/pdf",
            "text/plain",
            "text/csv",
            "text/html",
            "image/jpeg",
            "image/png",
            "image/gif",
            "image/webp",
          ],
          model.context_window,
        ),
      );

    return models;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.warn("Anthropic models fetch timed out");
    } else {
      console.error("Failed to fetch Anthropic models:", error);
    }
    return [];
  }
}

/**
 * Fetch OpenAI models
 */
export async function fetchOpenAIModelsClient(
  apiKey: string,
  timeoutMs: number = 10000,
): Promise<DynamicModelInfo[]> {
  try {
    const response = await fetchWithTimeout(
      "https://api.openai.com/v1/models",
      {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      timeoutMs,
    );

    if (!response.ok) {
      console.error(`OpenAI models API error: ${response.status}`);
      return [];
    }

    const data = (await response.json()) as ModelListResponse;

    const models = data.data
      .filter(
        (model) =>
          model.id.startsWith("gpt-") ||
          model.id.startsWith("o1") ||
          model.id.startsWith("o3") ||
          model.id.startsWith("o4"),
      )
      .sort((a, b) => {
        const aTime =
          a.created ??
          (a.created_at ? new Date(a.created_at).getTime() / 1000 : 0);
        const bTime =
          b.created ??
          (b.created_at ? new Date(b.created_at).getTime() / 1000 : 0);
        return bTime - aTime;
      })
      .map((model) =>
        transformModel(
          model.id,
          formatOpenAIDisplayName(model.id),
          ["image/jpeg", "image/png", "image/gif", "image/webp"],
          model.context_window,
        ),
      );

    return models;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.warn("OpenAI models fetch timed out");
    } else {
      console.error("Failed to fetch OpenAI models:", error);
    }
    return [];
  }
}

/**
 * Fetch Google models
 */
export async function fetchGoogleModelsClient(
  apiKey: string,
  timeoutMs: number = 10000,
): Promise<DynamicModelInfo[]> {
  try {
    const response = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
      {
        "Content-Type": "application/json",
      },
      timeoutMs,
    );

    if (!response.ok) {
      console.error(`Google models API error: ${response.status}`);
      return [];
    }

    const data = (await response.json()) as {
      models?: ModelListResponse["data"];
    };

    if (!data.models) return [];

    const models = data.models
      .filter((model) => model.id.includes("gemini"))
      .sort((a, b) => {
        const aTime =
          a.created ??
          (a.created_at ? new Date(a.created_at).getTime() / 1000 : 0);
        const bTime =
          b.created ??
          (b.created_at ? new Date(b.created_at).getTime() / 1000 : 0);
        return bTime - aTime;
      })
      .map((model) =>
        transformModel(
          model.id,
          formatGoogleDisplayName(model.id, model.display_name),
          ["image/jpeg", "image/png", "image/gif", "image/webp"],
          model.context_window,
        ),
      );

    return models;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.warn("Google models fetch timed out");
    } else {
      console.error("Failed to fetch Google models:", error);
    }
    return [];
  }
}

/**
 * Fetch Groq models
 */
export async function fetchGroqModelsClient(
  apiKey: string,
  timeoutMs: number = 10000,
): Promise<DynamicModelInfo[]> {
  try {
    const response = await fetchWithTimeout(
      "https://api.groq.com/openai/v1/models",
      {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      timeoutMs,
    );

    if (!response.ok) {
      console.error(`Groq models API error: ${response.status}`);
      return [];
    }

    const data = (await response.json()) as ModelListResponse;

    const models = data.data
      .sort((a, b) => {
        const aTime =
          a.created ??
          (a.created_at ? new Date(a.created_at).getTime() / 1000 : 0);
        const bTime =
          b.created ??
          (b.created_at ? new Date(b.created_at).getTime() / 1000 : 0);
        return bTime - aTime;
      })
      .map((model) =>
        transformModel(
          model.id,
          model.id.replace("llama-", "Llama ").replace("mixtral-", "Mixtral "),
          [],
          model.context_window,
        ),
      );

    return models;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.warn("Groq models fetch timed out");
    } else {
      console.error("Failed to fetch Groq models:", error);
    }
    return [];
  }
}

/**
 * Fetch xAI models
 */
export async function fetchXAIModelsClient(
  apiKey: string,
  timeoutMs: number = 10000,
): Promise<DynamicModelInfo[]> {
  try {
    const response = await fetchWithTimeout(
      "https://api.x.ai/v1/models",
      {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      timeoutMs,
    );

    if (!response.ok) {
      console.error(`xAI models API error: ${response.status}`);
      return [];
    }

    const data = (await response.json()) as ModelListResponse;

    const models = data.data
      .filter((model) => model.id.includes("grok"))
      .sort((a, b) => {
        const aTime =
          a.created ??
          (a.created_at ? new Date(a.created_at).getTime() / 1000 : 0);
        const bTime =
          b.created ??
          (b.created_at ? new Date(b.created_at).getTime() / 1000 : 0);
        return bTime - aTime;
      })
      .map((model) =>
        transformModel(
          model.id,
          model.id.replace("grok-", "Grok ").replace(/-/g, " "),
          ["image/jpeg", "image/png", "image/gif", "image/webp"],
          model.context_window,
        ),
      );

    return models;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.warn("xAI models fetch timed out");
    } else {
      console.error("Failed to fetch xAI models:", error);
    }
    return [];
  }
}

/**
 * Fetch Cerebras models
 */
export async function fetchCerebrasModelsClient(
  apiKey: string,
  timeoutMs: number = 10000,
): Promise<DynamicModelInfo[]> {
  try {
    const response = await fetchWithTimeout(
      "https://api.cerebras.ai/v1/models",
      {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      timeoutMs,
    );

    if (!response.ok) {
      console.error(`Cerebras models API error: ${response.status}`);
      return [];
    }

    const data = (await response.json()) as ModelListResponse;

    const models = data.data
      .sort((a, b) => {
        const aTime =
          a.created ??
          (a.created_at ? new Date(a.created_at).getTime() / 1000 : 0);
        const bTime =
          b.created ??
          (b.created_at ? new Date(b.created_at).getTime() / 1000 : 0);
        return bTime - aTime;
      })
      .map((model) =>
        transformModel(
          model.id,
          model.display_name || model.id,
          [],
          model.context_window,
        ),
      );

    return models;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.warn("Cerebras models fetch timed out");
    } else {
      console.error("Failed to fetch Cerebras models:", error);
    }
    return [];
  }
}

/**
 * Fetch OpenRouter models
 */
export async function fetchOpenRouterModelsClient(
  apiKey: string,
  timeoutMs: number = 10000,
): Promise<DynamicModelInfo[]> {
  try {
    const response = await fetchWithTimeout(
      "https://openrouter.ai/api/v1/models",
      {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      timeoutMs,
    );

    if (!response.ok) {
      console.error(`OpenRouter models API error: ${response.status}`);
      return [];
    }

    const data = (await response.json()) as { data: ModelListResponse["data"] };

    const models = data.data
      .sort((a, b) => {
        const aTime =
          a.created ??
          (a.created_at ? new Date(a.created_at).getTime() / 1000 : 0);
        const bTime =
          b.created ??
          (b.created_at ? new Date(b.created_at).getTime() / 1000 : 0);
        return bTime - aTime;
      })
      .map((model) =>
        transformModel(
          model.id,
          model.display_name || model.id,
          [],
          model.context_window,
        ),
      );

    return models;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.warn("OpenRouter models fetch timed out");
    } else {
      console.error("Failed to fetch OpenRouter models:", error);
    }
    return [];
  }
}
