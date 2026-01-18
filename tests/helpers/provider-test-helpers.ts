import { Page } from "@playwright/test";

/**
 * Helper functions for provider-related E2E tests.
 * These utilities help with testing model capabilities and provider integrations.
 */

/**
 * Model information as returned by the /api/chat/models endpoint
 */
export interface ModelInfo {
  name: string;
  displayName: string;
  isToolCallUnsupported: boolean;
  isImageInputUnsupported: boolean;
  supportedFileMimeTypes: string[];
  isReasoningModel: boolean;
  workflowGenerationSupport: "full" | "limited" | "none";
  toolCallUnsupportedReason?: "built-in-tools" | "responses-api-only";
  reasoningEffort?: string[];
  thinkingLevel?: string[];
  nativeStructuredOutputs?: boolean;
  [key: string]: unknown; // Allow dynamic property access
}

/**
 * Provider information as returned by the /api/chat/models endpoint
 */
export interface ProviderInfo {
  provider: string;
  hasAPIKey: boolean;
  models: ModelInfo[];
}

/**
 * Model filter function type
 */
export type ModelFilter = (model: ModelInfo) => boolean;

/**
 * Fetches all providers and their models from the API
 */
export async function getAllProviders(page: Page): Promise<ProviderInfo[]> {
  const response = await page.request.get("/api/chat/models");
  if (!response.ok()) {
    throw new Error(`Failed to fetch models: ${response.status()}`);
  }
  return response.json();
}

/**
 * Gets models for a specific provider
 */
export async function getModelsForProvider(
  page: Page,
  provider: string,
): Promise<ModelInfo[]> {
  const providers = await getAllProviders(page);
  const providerData = providers.find(
    (p) => p.provider.toLowerCase() === provider.toLowerCase(),
  );
  return providerData?.models ?? [];
}

/**
 * Checks if a provider has an API key configured
 */
export async function providerHasApiKey(
  page: Page,
  provider: string,
): Promise<boolean> {
  const providers = await getAllProviders(page);
  const providerData = providers.find(
    (p) => p.provider.toLowerCase() === provider.toLowerCase(),
  );
  return providerData?.hasAPIKey ?? false;
}

/**
 * Gets models with a specific capability
 */
export async function getModelsWithCapability(
  page: Page,
  capability: keyof ModelInfo | string,
): Promise<ModelInfo[]> {
  const providers = await getAllProviders(page);
  const allModels = providers.flatMap((p) => p.models);

  switch (capability) {
    case "isReasoningModel":
      return allModels.filter((m) => m.isReasoningModel === true);

    case "workflowSupport":
      return allModels.filter((m) => m.workflowGenerationSupport !== "none");

    case "toolSupport":
      return allModels.filter((m) => !m.isToolCallUnsupported);

    case "imageSupport":
      return allModels.filter((m) => !m.isImageInputUnsupported);

    case "reasoningEffort":
      return allModels.filter(
        (m) => m.reasoningEffort && m.reasoningEffort.length > 0,
      );

    case "thinkingLevel":
      return allModels.filter(
        (m) => m.thinkingLevel && m.thinkingLevel.length > 0,
      );

    default:
      // For direct property access using index signature
      return allModels.filter((m) => m[capability] !== undefined);
  }
}

/**
 * Gets models that support workflow generation
 */
export async function getWorkflowCapableModels(
  page: Page,
): Promise<ModelInfo[]> {
  return getModelsWithCapability(page, "workflowSupport");
}

/**
 * Gets models that are reasoning models
 */
export async function getReasoningModels(page: Page): Promise<ModelInfo[]> {
  return getModelsWithCapability(page, "isReasoningModel");
}

/**
 * Gets models by pattern matching on model name
 */
export async function getModelsByPattern(
  page: Page,
  pattern: RegExp,
): Promise<ModelInfo[]> {
  const providers = await getAllProviders(page);
  const allModels = providers.flatMap((p) => p.models);
  return allModels.filter((m) => pattern.test(m.name));
}

/**
 * Gets the first available model from a specific provider
 * Useful for tests that need any model from a provider
 */
export async function getFirstModelFromProvider(
  page: Page,
  provider: string,
): Promise<ModelInfo | null> {
  const models = await getModelsForProvider(page, provider);
  return models.length > 0 ? models[0] : null;
}

/**
 * Gets a model suitable for workflow generation from any configured provider
 * Prefers providers with API keys
 */
export async function getWorkflowCapableModelWithKey(
  page: Page,
): Promise<{ provider: string; model: ModelInfo } | null> {
  const providers = await getAllProviders(page);

  // Sort by hasAPIKey to prefer providers with keys
  const sortedProviders = [...providers].sort((a, b) => {
    if (a.hasAPIKey && !b.hasAPIKey) return -1;
    if (!a.hasAPIKey && b.hasAPIKey) return 1;
    return 0;
  });

  for (const provider of sortedProviders) {
    const workflowCapable = provider.models.find(
      (m) => m.workflowGenerationSupport !== "none" && !m.isToolCallUnsupported,
    );
    if (workflowCapable) {
      return { provider: provider.provider, model: workflowCapable };
    }
  }

  return null;
}

/**
 * Checks if Cerebras provider is available and has models
 */
export async function isCerebrasAvailable(page: Page): Promise<boolean> {
  const providers = await getAllProviders(page);
  const cerebras = providers.find((p) => p.provider === "cerebras");
  return cerebras !== undefined && cerebras.models.length > 0;
}

/**
 * Checks if Cerebras has an API key configured
 */
export async function cerebrasHasApiKey(page: Page): Promise<boolean> {
  return providerHasApiKey(page, "cerebras");
}

/**
 * Gets all providers that have API keys configured
 */
export async function getProvidersWithApiKeys(
  page: Page,
): Promise<ProviderInfo[]> {
  const providers = await getAllProviders(page);
  return providers.filter((p) => p.hasAPIKey);
}

/**
 * Gets all models from all providers as a flat array
 */
export async function getAllModels(page: Page): Promise<ModelInfo[]> {
  const providers = await getAllProviders(page);
  return providers.flatMap((p) => p.models);
}

/**
 * Gets models matching a filter function
 */
export async function getModelsMatching(
  page: Page,
  filter: ModelFilter,
): Promise<ModelInfo[]> {
  const models = await getAllModels(page);
  return models.filter(filter);
}

/**
 * Common model filters for reuse across tests
 */
export const modelFilters = {
  /** Models containing a pattern in name (case-insensitive) */
  byNamePattern: (pattern: string): ModelFilter => {
    const lowerPattern = pattern.toLowerCase();
    return (m) => m.name.toLowerCase().includes(lowerPattern);
  },

  /** Models matching a regex pattern */
  byRegex: (regex: RegExp): ModelFilter => {
    return (m) => regex.test(m.name);
  },

  /** Reasoning models (o1, o3, o4, codex, deepseek-r1) */
  reasoning: (m: ModelInfo) => m.isReasoningModel === true,

  /** Models supporting workflow generation */
  workflowCapable: (m: ModelInfo) => m.workflowGenerationSupport !== "none",

  /** Models NOT supporting workflow generation */
  workflowUnsupported: (m: ModelInfo) => m.workflowGenerationSupport === "none",

  /** Models supporting tool calls */
  toolCapable: (m: ModelInfo) => !m.isToolCallUnsupported,

  /** Models with reasoning effort levels */
  hasReasoningEffort: (m: ModelInfo) =>
    m.reasoningEffort !== undefined && m.reasoningEffort.length > 0,

  /** Models with thinking levels */
  hasThinkingLevel: (m: ModelInfo) =>
    m.thinkingLevel !== undefined && m.thinkingLevel.length > 0,

  /** gpt-oss models (built-in tools) */
  gptOss: (m: ModelInfo) => m.name.toLowerCase().includes("gpt-oss"),

  /** computer-use models (Responses API) */
  computerUse: (m: ModelInfo) => m.name.toLowerCase().includes("computer-use"),

  /** o3/o4 reasoning models */
  o3o4: (m: ModelInfo) => {
    const name = m.name.toLowerCase();
    return name.includes("o3") || name.includes("o4");
  },

  /** Standard GPT-4o models (not reasoning variants) */
  standardGpt4o: (m: ModelInfo) => {
    const name = m.name.toLowerCase();
    return (
      name.includes("gpt-4o") &&
      !name.includes("codex") &&
      !/^o[134]/i.test(name)
    );
  },

  /** Gemini 3 or 2.5 models (thinking capable) */
  geminiThinking: (m: ModelInfo) => {
    const name = m.name.toLowerCase();
    return name.includes("gemini-3") || name.includes("gemini-2.5");
  },

  /** Claude Opus 4.5 or Sonnet 4.5 models (thinking capable) */
  claudeThinking: (m: ModelInfo) => {
    const name = m.name.toLowerCase();
    return (
      name.includes("claude-opus-4-5") || name.includes("claude-sonnet-4-5")
    );
  },

  /** Codex models */
  codex: (m: ModelInfo) => m.name.toLowerCase().includes("codex"),

  /** DeepSeek R1 models */
  deepseekR1: (m: ModelInfo) => m.name.toLowerCase().includes("deepseek-r1"),
};

/**
 * Combines multiple filters with AND logic
 */
export function combineFilters(...filters: ModelFilter[]): ModelFilter {
  return (m: ModelInfo) => filters.every((f) => f(m));
}

/**
 * Combines multiple filters with OR logic
 */
export function anyFilter(...filters: ModelFilter[]): ModelFilter {
  return (m: ModelInfo) => filters.some((f) => f(m));
}

/**
 * Negates a filter
 */
export function notFilter(filter: ModelFilter): ModelFilter {
  return (m: ModelInfo) => !filter(m);
}

/**
 * Checks if a provider with API key exists for workflow generation testing
 * Returns the first provider with API key that has workflow-capable models
 */
export async function findProviderForWorkflowTest(
  page: Page,
  preferredProviders: string[] = [
    "openai",
    "anthropic",
    "google",
    "openRouter",
  ],
): Promise<{ provider: string; model: string } | null> {
  const providers = await getAllProviders(page);

  for (const preferred of preferredProviders) {
    const provider = providers.find(
      (p) =>
        p.provider.toLowerCase() === preferred.toLowerCase() && p.hasAPIKey,
    );
    if (provider) {
      const workflowModel = provider.models.find(
        (m) =>
          m.workflowGenerationSupport !== "none" && !m.isToolCallUnsupported,
      );
      if (workflowModel) {
        return { provider: provider.provider, model: workflowModel.name };
      }
    }
  }

  return null;
}

/**
 * Creates a helper to get provider info with caching for the test session
 */
export function createProviderHelper(page: Page) {
  let cachedProviders: ProviderInfo[] | null = null;

  return {
    async getProviders(): Promise<ProviderInfo[]> {
      cachedProviders ??= await getAllProviders(page);
      return cachedProviders;
    },

    async getAllModels(): Promise<ModelInfo[]> {
      const providers = await this.getProviders();
      return providers.flatMap((p) => p.models);
    },

    async getModelsMatching(filter: ModelFilter): Promise<ModelInfo[]> {
      const models = await this.getAllModels();
      return models.filter(filter);
    },

    async hasProviderWithKey(providerName: string): Promise<boolean> {
      const providers = await this.getProviders();
      const provider = providers.find(
        (p) => p.provider.toLowerCase() === providerName.toLowerCase(),
      );
      return provider?.hasAPIKey ?? false;
    },

    clearCache() {
      cachedProviders = null;
    },
  };
}

/**
 * Creates a test context for provider tests with cached provider data
 */
export class ProviderTestContext {
  private providers: ProviderInfo[] | null = null;

  constructor(private readonly page: Page) {}

  async getProviders(): Promise<ProviderInfo[]> {
    this.providers ??= await getAllProviders(this.page);
    return this.providers;
  }

  async refresh(): Promise<ProviderInfo[]> {
    this.providers = null;
    return this.getProviders();
  }

  async getModels(provider: string): Promise<ModelInfo[]> {
    const providers = await this.getProviders();
    return providers.find((p) => p.provider === provider)?.models ?? [];
  }

  async hasApiKey(provider: string): Promise<boolean> {
    const providers = await this.getProviders();
    return providers.find((p) => p.provider === provider)?.hasAPIKey ?? false;
  }
}
