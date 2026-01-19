/**
 * Unified Models API for Desktop (Electron)
 *
 * This module provides a unified API for model operations that automatically
 * uses Electron IPC for all database operations.
 */

/**
 * Model information with capability fields for client-side validation
 */
interface ChatModelInfo {
  name: string;
  displayName: string;
  isToolCallUnsupported: boolean;
  isImageInputUnsupported: boolean;
  supportedFileMimeTypes: string[];
  isReasoningModel: boolean;
  workflowGenerationSupport: "full" | "limited" | "none";
  toolCallUnsupportedReason?:
    | "reasoning-model"
    | "built-in-tools"
    | "responses-api-only";
  reasoningEffort?: string[];
  thinkingLevel?: string[];
}

/**
 * Provider models response
 */
interface ProviderModels {
  provider: string;
  hasAPIKey: boolean;
  models: ChatModelInfo[];
}

/**
 * Check if we're running in Electron mode
 */
export function isElectronMode(): boolean {
  return (
    typeof window !== "undefined" &&
    window.electronAPI !== undefined &&
    window.electronAPI.models !== undefined
  );
}

// Define available models for each provider
const PROVIDER_MODELS: Record<string, ChatModelInfo[]> = {
  openai: [
    {
      name: "gpt-4o",
      displayName: "GPT-4o",
      isToolCallUnsupported: false,
      isImageInputUnsupported: false,
      supportedFileMimeTypes: [
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
      ],
      isReasoningModel: false,
      workflowGenerationSupport: "full",
    },
    {
      name: "gpt-4o-mini",
      displayName: "GPT-4o Mini",
      isToolCallUnsupported: false,
      isImageInputUnsupported: false,
      supportedFileMimeTypes: [
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
      ],
      isReasoningModel: false,
      workflowGenerationSupport: "full",
    },
    {
      name: "o1",
      displayName: "o1",
      isToolCallUnsupported: true,
      isImageInputUnsupported: false,
      supportedFileMimeTypes: [
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
      ],
      isReasoningModel: true,
      workflowGenerationSupport: "limited",
      toolCallUnsupportedReason: "reasoning-model",
      reasoningEffort: ["low", "medium", "high"],
    },
    {
      name: "o1-mini",
      displayName: "o1 Mini",
      isToolCallUnsupported: true,
      isImageInputUnsupported: true,
      supportedFileMimeTypes: [],
      isReasoningModel: true,
      workflowGenerationSupport: "limited",
      toolCallUnsupportedReason: "reasoning-model",
      reasoningEffort: ["low", "medium", "high"],
    },
  ],
  anthropic: [
    {
      name: "claude-sonnet-4-20250514",
      displayName: "Claude Sonnet 4",
      isToolCallUnsupported: false,
      isImageInputUnsupported: false,
      supportedFileMimeTypes: [
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
      ],
      isReasoningModel: false,
      workflowGenerationSupport: "full",
      thinkingLevel: ["none", "low", "medium", "high"],
    },
    {
      name: "claude-3-5-sonnet-20241022",
      displayName: "Claude 3.5 Sonnet",
      isToolCallUnsupported: false,
      isImageInputUnsupported: false,
      supportedFileMimeTypes: [
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
      ],
      isReasoningModel: false,
      workflowGenerationSupport: "full",
    },
    {
      name: "claude-3-5-haiku-20241022",
      displayName: "Claude 3.5 Haiku",
      isToolCallUnsupported: false,
      isImageInputUnsupported: false,
      supportedFileMimeTypes: [
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
      ],
      isReasoningModel: false,
      workflowGenerationSupport: "full",
    },
  ],
  google: [
    {
      name: "gemini-3-flash-preview",
      displayName: "Gemini 3 Flash Preview",
      isToolCallUnsupported: false,
      isImageInputUnsupported: false,
      supportedFileMimeTypes: [
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
      ],
      isReasoningModel: false,
      workflowGenerationSupport: "full",
      thinkingLevel: ["none", "low", "medium", "high"],
    },
    {
      name: "gemini-2.0-flash",
      displayName: "Gemini 2.0 Flash",
      isToolCallUnsupported: false,
      isImageInputUnsupported: false,
      supportedFileMimeTypes: [
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
      ],
      isReasoningModel: false,
      workflowGenerationSupport: "full",
    },
    {
      name: "gemini-2.5-flash-preview-05-20",
      displayName: "Gemini 2.5 Flash Preview",
      isToolCallUnsupported: false,
      isImageInputUnsupported: false,
      supportedFileMimeTypes: [
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
      ],
      isReasoningModel: false,
      workflowGenerationSupport: "full",
      thinkingLevel: ["none", "low", "medium", "high"],
    },
    {
      name: "gemini-2.5-pro-preview-05-06",
      displayName: "Gemini 2.5 Pro Preview",
      isToolCallUnsupported: false,
      isImageInputUnsupported: false,
      supportedFileMimeTypes: [
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
      ],
      isReasoningModel: false,
      workflowGenerationSupport: "full",
      thinkingLevel: ["none", "low", "medium", "high"],
    },
  ],
  xai: [
    {
      name: "grok-3",
      displayName: "Grok 3",
      isToolCallUnsupported: false,
      isImageInputUnsupported: false,
      supportedFileMimeTypes: [
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
      ],
      isReasoningModel: false,
      workflowGenerationSupport: "full",
    },
    {
      name: "grok-3-fast",
      displayName: "Grok 3 Fast",
      isToolCallUnsupported: false,
      isImageInputUnsupported: false,
      supportedFileMimeTypes: [
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
      ],
      isReasoningModel: false,
      workflowGenerationSupport: "full",
    },
  ],
  groq: [
    {
      name: "llama-3.3-70b-versatile",
      displayName: "Llama 3.3 70B",
      isToolCallUnsupported: false,
      isImageInputUnsupported: true,
      supportedFileMimeTypes: [],
      isReasoningModel: false,
      workflowGenerationSupport: "full",
    },
    {
      name: "mixtral-8x7b-32768",
      displayName: "Mixtral 8x7B",
      isToolCallUnsupported: false,
      isImageInputUnsupported: true,
      supportedFileMimeTypes: [],
      isReasoningModel: false,
      workflowGenerationSupport: "full",
    },
  ],
};

/**
 * Unified Models API
 */
export const modelsApi = {
  /**
   * Get available chat models
   */
  async getChatModels(): Promise<ProviderModels[]> {
    if (isElectronMode()) {
      // Get API keys to determine which providers are available
      const apiKeys = await window.electronAPI.models.getApiKeys();
      const validProviders = new Set(
        apiKeys.filter((k) => k.isValid).map((k) => k.providerId),
      );

      // Build the response with static model definitions
      const result: ProviderModels[] = [];

      for (const [provider, models] of Object.entries(PROVIDER_MODELS)) {
        const hasAPIKey = validProviders.has(provider);
        result.push({
          provider,
          hasAPIKey,
          models,
        });
      }

      // Also check for local models (Ollama, LM Studio)
      try {
        const { localModels } =
          await window.electronAPI.models.getAvailableModels();
        if (localModels && localModels.length > 0) {
          const ollamaModels = localModels.filter(
            (m: any) => m.providerId === "ollama",
          );
          const lmstudioModels = localModels.filter(
            (m: any) => m.providerId === "lmstudio",
          );

          if (ollamaModels.length > 0) {
            result.push({
              provider: "ollama",
              hasAPIKey: true,
              models: ollamaModels.map((m: any) => ({
                name: m.name,
                displayName: m.displayName || m.name,
                isToolCallUnsupported: !m.isToolCallSupported,
                isImageInputUnsupported: !m.isVision,
                supportedFileMimeTypes: m.isVision
                  ? ["image/jpeg", "image/png", "image/gif", "image/webp"]
                  : [],
                isReasoningModel: false,
                workflowGenerationSupport: "full" as const,
              })),
            });
          }

          if (lmstudioModels.length > 0) {
            result.push({
              provider: "lmstudio",
              hasAPIKey: true,
              models: lmstudioModels.map((m: any) => ({
                name: m.name,
                displayName: m.displayName || m.name,
                isToolCallUnsupported: !m.isToolCallSupported,
                isImageInputUnsupported: !m.isVision,
                supportedFileMimeTypes: m.isVision
                  ? ["image/jpeg", "image/png", "image/gif", "image/webp"]
                  : [],
                isReasoningModel: false,
                workflowGenerationSupport: "full" as const,
              })),
            });
          }
        }
      } catch (e) {
        console.warn("[modelsApi] Failed to get local models:", e);
      }

      return result;
    }

    // Web fallback
    const res = await fetch("/api/chat/models");
    if (!res.ok) throw new Error(`Failed to get models: ${res.status}`);
    return res.json();
  },

  /**
   * Get API keys (returns keys array in a wrapper object for dashboard compatibility)
   */
  async getApiKeys() {
    if (isElectronMode()) {
      const keys = await window.electronAPI.models.getApiKeys();
      return { keys };
    }
    const res = await fetch("/api/models/api-keys");
    if (!res.ok) throw new Error(`Failed to get API keys: ${res.status}`);
    return res.json();
  },

  /**
   * Get API keys info (for /api/models/keys endpoint)
   */
  async getKeysInfo() {
    if (isElectronMode()) {
      const keys = await window.electronAPI.models.getApiKeys();
      return { keys };
    }
    const res = await fetch("/api/models/keys");
    if (!res.ok) throw new Error(`Failed to get keys info: ${res.status}`);
    return res.json();
  },

  /**
   * Get local models (Ollama, LM Studio)
   */
  async getLocalModels() {
    if (isElectronMode()) {
      try {
        const { localModels } =
          await window.electronAPI.models.getAvailableModels();
        return { models: localModels || [] };
      } catch (e) {
        console.warn("[modelsApi] Failed to get local models:", e);
        return { models: [] };
      }
    }
    const res = await fetch("/api/models/local");
    if (!res.ok) throw new Error(`Failed to get local models: ${res.status}`);
    return res.json();
  },

  /**
   * Save API key
   */
  async saveApiKey(data: {
    providerId: string;
    apiKey: string;
    validate?: boolean;
  }) {
    if (isElectronMode()) {
      return window.electronAPI.models.saveApiKey(data);
    }
    const res = await fetch("/api/models/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Failed to save API key: ${res.status}`);
    return res.json();
  },

  /**
   * Test API key (validates without saving)
   */
  async testApiKey(data: { providerId: string; apiKey: string }) {
    if (isElectronMode()) {
      return window.electronAPI.models.testApiKey(data);
    }
    const res = await fetch("/api/models/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data, testOnly: true }),
    });
    return res.json();
  },

  /**
   * Save API key via /api/models/keys endpoint
   */
  async saveKey(data: { providerId: string; apiKey: string }) {
    if (isElectronMode()) {
      const result = await window.electronAPI.models.saveApiKey(data);
      // Invalidate model cache after save
      try {
        await window.electronAPI.models.invalidateCache(data.providerId);
      } catch (e) {
        console.warn("[modelsApi] Failed to invalidate cache:", e);
      }
      return result;
    }
    const res = await fetch("/api/models/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  /**
   * Delete API key
   */
  async deleteKey(providerId: string) {
    if (isElectronMode()) {
      return window.electronAPI.models.deleteApiKey(providerId);
    }
    const res = await fetch(`/api/models/keys?providerId=${providerId}`, {
      method: "DELETE",
    });
    return res.json();
  },

  /**
   * Invalidate model cache for a provider
   */
  async invalidateCache(providerId: string) {
    if (isElectronMode()) {
      return window.electronAPI.models.invalidateCache(providerId);
    }
    const res = await fetch("/api/models/invalidate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId }),
    });
    return res.json();
  },

  /**
   * Refresh local models (Ollama, LM Studio) for a provider
   */
  async refreshLocalModels(providerId: string) {
    if (isElectronMode()) {
      try {
        // In Electron mode, refresh by re-fetching available models
        const { localModels } =
          await window.electronAPI.models.getAvailableModels();
        return { success: true, models: localModels || [] };
      } catch (e) {
        console.warn("[modelsApi] Failed to refresh local models:", e);
        return { success: false, error: String(e) };
      }
    }
    const res = await fetch("/api/models/local", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId }),
    });
    return res.json();
  },

  /**
   * Get providers
   */
  async getProviders() {
    if (isElectronMode()) {
      return window.electronAPI.models.getProviders();
    }
    const res = await fetch("/api/models/providers");
    if (!res.ok) throw new Error(`Failed to get providers: ${res.status}`);
    return res.json();
  },

  /**
   * Get available models status
   */
  async getStatus() {
    if (isElectronMode()) {
      return window.electronAPI.models.getStatus();
    }
    const res = await fetch("/api/models/status");
    if (!res.ok) throw new Error(`Failed to get status: ${res.status}`);
    return res.json();
  },
};

/**
 * SWR-compatible fetcher that uses the models API
 */
export async function modelsFetcher(url: string): Promise<any> {
  // Handle different endpoint patterns
  if (url === "/api/chat/models" || url === "/api/chat/models/") {
    return modelsApi.getChatModels();
  }

  if (url === "/api/models/api-keys" || url === "/api/models/api-keys/") {
    return modelsApi.getApiKeys();
  }

  // Handle /api/models/keys endpoint (for models-dashboard)
  if (url === "/api/models/keys" || url === "/api/models/keys/") {
    return modelsApi.getKeysInfo();
  }

  // Handle /api/models/local endpoint (for models-dashboard)
  if (url === "/api/models/local" || url === "/api/models/local/") {
    return modelsApi.getLocalModels();
  }

  if (url === "/api/models/providers" || url === "/api/models/providers/") {
    return modelsApi.getProviders();
  }

  if (url === "/api/models/status" || url === "/api/models/status/") {
    return modelsApi.getStatus();
  }

  // Fallback - log warning and try to handle gracefully
  if (isElectronMode()) {
    console.warn(
      `[modelsFetcher] Unrecognized URL pattern: ${url}, returning empty array`,
    );
    return [];
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  return res.json();
}

export default modelsApi;
