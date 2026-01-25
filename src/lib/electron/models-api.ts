/**
 * Unified Models API for Desktop (Electron)
 *
 * This module provides a unified API for model operations using Electron IPC.
 * Desktop-only - no HTTP fallbacks.
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
  // ACP Agent-specific fields
  isACPAgent?: boolean;
  acpProvider?: "anthropic" | "openai" | "google";
  acpAuthenticated?: boolean;
  acpRunning?: boolean;
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
 * Unified Models API - Desktop Only (IPC)
 * Models are now fetched dynamically from provider APIs instead of using hard-coded lists
 */
export const modelsApi = {
  /**
   * Get available chat models
   */
  async getChatModels(): Promise<ProviderModels[]> {
    // Get API keys to determine which providers are available
    const apiKeys = await window.electronAPI.models.getApiKeys();
    // Include providers that have API keys (even if not validated yet)
    const providersWithKeys = new Set(apiKeys.map((k) => k.providerId));

    // Build the response by dynamically fetching models from APIs
    const result: ProviderModels[] = [];

    // List of cloud providers that support dynamic fetching
    const cloudProviders = [
      "anthropic",
      "openai",
      "google",
      "groq",
      "xai",
      "cerebras",
      "openRouter",
    ];

    // Fetch models for providers with API keys using IPC (main process)
    await Promise.all(
      cloudProviders.map(async (provider) => {
        if (providersWithKeys.has(provider)) {
          try {
            const apiKey =
              await window.electronAPI.models.getDecryptedApiKey(provider);
            if (apiKey) {
              const fetchResult =
                await window.electronAPI.models.fetchProviderModels({
                  providerId: provider,
                  apiKey,
                });

              if (fetchResult.success && fetchResult.models) {
                // Transform to ChatModelInfo format
                const chatModels: ChatModelInfo[] = fetchResult.models.map(
                  (m) => ({
                    name: m.id,
                    displayName: m.displayName,
                    isToolCallUnsupported: !m.isToolCallSupported,
                    isImageInputUnsupported: !m.isImageInputSupported,
                    supportedFileMimeTypes: m.supportedFileMimeTypes,
                    isReasoningModel: m.isReasoningModel,
                    workflowGenerationSupport: "full" as const,
                    toolCallUnsupportedReason: m.toolCallUnsupportedReason,
                    reasoningEffort: m.reasoningEffort,
                    thinkingLevel: m.thinkingLevel,
                  }),
                );
                result.push({
                  provider,
                  hasAPIKey: true,
                  models: chatModels,
                });
              } else {
                console.warn(
                  `[modelsApi] Failed to fetch models for ${provider}:`,
                  fetchResult.error,
                );
              }
            }
          } catch (error) {
            console.warn(
              `[modelsApi] Failed to fetch models for ${provider}:`,
              error,
            );
          }
        }
      }),
    );

    // Also check for local models (Ollama, LM Studio) and ACP agents
    try {
      const { localModels, acpAgents } =
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

      // Add ACP agents (Claude Code, Codex, Gemini CLI) as "coding-agents" group
      if (acpAgents && acpAgents.length > 0) {
        result.push({
          provider: "coding-agents",
          hasAPIKey: true,
          models: acpAgents.map((agent: any) => ({
            name: agent.id,
            displayName: agent.displayName,
            isToolCallUnsupported: false,
            isImageInputUnsupported: true,
            supportedFileMimeTypes: [],
            isReasoningModel: false,
            workflowGenerationSupport: "full" as const,
            // ACP-specific fields
            isACPAgent: true,
            acpProvider: agent.iconProvider, // 'anthropic', 'openai', 'google' for icon selection
            acpAuthenticated: agent.authenticated,
            acpRunning: agent.running,
          })),
        });
      }
    } catch (e) {
      console.warn("[modelsApi] Failed to get local models:", e);
    }

    // Filter to only include providers with API keys (or local/ACP providers with models)
    return result.filter((p) => {
      // Local providers (ollama, lmstudio) and coding-agents don't need API keys - include if they have models
      if (
        p.provider === "ollama" ||
        p.provider === "lmstudio" ||
        p.provider === "coding-agents"
      ) {
        return p.models && p.models.length > 0;
      }
      // Cloud providers must have API keys
      return p.hasAPIKey === true;
    });
  },

  /**
   * Get API keys (returns keys array in a wrapper object for dashboard compatibility)
   * Transforms the response to include hasKey field for UI compatibility
   */
  async getApiKeys() {
    const keys = await window.electronAPI.models.getApiKeys();
    // Transform keys to include hasKey field - if a record exists, the key exists
    const transformedKeys = keys.map((key) => ({
      ...key,
      hasKey: true,
    }));
    return { keys: transformedKeys };
  },

  /**
   * Get API keys info (for /api/models/keys endpoint)
   * Transforms the response to include hasKey field for UI compatibility
   */
  async getKeysInfo() {
    const keys = await window.electronAPI.models.getApiKeys();
    // Transform keys to include hasKey field - if a record exists, the key exists
    const transformedKeys = keys.map((key) => ({
      ...key,
      hasKey: true,
    }));
    return { keys: transformedKeys };
  },

  /**
   * Get local models (Ollama, LM Studio)
   */
  async getLocalModels() {
    try {
      const { localModels } =
        await window.electronAPI.models.getAvailableModels();
      return { models: localModels || [] };
    } catch (e) {
      console.warn("[modelsApi] Failed to get local models:", e);
      return { models: [] };
    }
  },

  /**
   * Save API key
   */
  async saveApiKey(data: {
    providerId: string;
    apiKey: string;
    validate?: boolean;
  }) {
    return window.electronAPI.models.saveApiKey(data);
  },

  /**
   * Test API key (validates without saving)
   */
  async testApiKey(data: { providerId: string; apiKey: string }) {
    return window.electronAPI.models.validateApiKey(data);
  },

  /**
   * Save API key via /api/models/keys endpoint
   */
  async saveKey(data: { providerId: string; apiKey: string }) {
    const result = await window.electronAPI.models.saveApiKey(data);
    // Refresh local models after save to update status
    try {
      await window.electronAPI.models.refreshLocalModels({
        providerId: data.providerId,
      });
    } catch (e) {
      console.warn("[modelsApi] Failed to refresh models:", e);
    }
    return result;
  },

  /**
   * Delete API key
   */
  async deleteKey(providerId: string) {
    return window.electronAPI.models.deleteApiKey(providerId);
  },

  /**
   * Invalidate model cache for a provider
   * In Electron mode, this refreshes local models to update the cache
   */
  async invalidateCache(providerId: string) {
    return window.electronAPI.models.refreshLocalModels({ providerId });
  },

  /**
   * Refresh local models (Ollama, LM Studio) for a provider
   */
  async refreshLocalModels(_providerId: string) {
    try {
      const { localModels } =
        await window.electronAPI.models.getAvailableModels();
      return { success: true, models: localModels || [] };
    } catch (e) {
      console.warn("[modelsApi] Failed to refresh local models:", e);
      return { success: false, error: String(e) };
    }
  },

  /**
   * Get providers
   */
  async getProviders() {
    return window.electronAPI.models.getProviders();
  },

  /**
   * Get available models status
   */
  async getStatus() {
    return window.electronAPI.models.getStatus();
  },

  // ========================================================================
  // Ollama-specific methods
  // ========================================================================

  /**
   * Check if Ollama is installed
   */
  async ollamaIsInstalled() {
    return window.electronAPI.models.ollamaIsInstalled();
  },

  /**
   * Check Ollama health (installed + running)
   */
  async ollamaCheckHealth() {
    return window.electronAPI.models.ollamaCheckHealth();
  },

  /**
   * Start Ollama service
   */
  async ollamaTryStart() {
    return window.electronAPI.models.ollamaTryStart();
  },

  /**
   * Install Ollama
   */
  async ollamaInstall() {
    return window.electronAPI.models.ollamaInstall();
  },

  /**
   * Get Ollama models
   */
  async ollamaGetModels() {
    return window.electronAPI.models.ollamaGetModels();
  },

  /**
   * Show Ollama model details
   */
  async ollamaShowModel(data: { modelName: string }) {
    return window.electronAPI.models.ollamaShowModel(data);
  },

  /**
   * Get available models from Ollama library (for browsing/downloading)
   */
  async ollamaGetLibraryModels() {
    return window.electronAPI.models.ollamaGetLibraryModels();
  },

  /**
   * Search Ollama library for models
   */
  async ollamaSearchLibrary(data: { query: string }) {
    return window.electronAPI.models.ollamaSearchLibrary(data);
  },

  // ========================================================================
  // LM Studio-specific methods
  // ========================================================================

  /**
   * Check LM Studio health (installed + running)
   */
  async lmstudioCheckHealth() {
    return window.electronAPI.models.lmstudioCheckHealth();
  },

  /**
   * Get LM Studio models
   */
  async lmstudioGetModels() {
    return window.electronAPI.models.lmstudioGetModels();
  },

  // ========================================================================
  // Download management
  // ========================================================================

  /**
   * Download a model
   */
  async downloadModel(data: { modelName: string; baseUrl?: string }) {
    return window.electronAPI.models.downloadModel(data);
  },

  /**
   * Cancel a model download
   */
  async cancelDownload(data: { modelId: string }) {
    return window.electronAPI.models.cancelDownload(data);
  },

  /**
   * Delete a local model (from DB and optionally from provider)
   */
  async deleteLocalModel(data: {
    id?: string;
    modelName?: string;
    providerId?: string;
    deleteFromProvider?: boolean;
  }) {
    return window.electronAPI.models.deleteLocalModel(data);
  },

  // ========================================================================
  // Curated models
  // ========================================================================

  /**
   * Get curated local models list
   */
  async getCuratedModels() {
    return window.electronAPI.models.getCuratedModels();
  },

  // ========================================================================
  // Model warmup / preload (PERFORMANCE CRITICAL)
  // ========================================================================

  /**
   * Warmup / preload an Ollama model into memory for instant responses.
   * This keeps the model loaded with keep_alive: -1 for fast inference.
   * Call this when a model is selected or before starting a conversation.
   */
  async warmupOllamaModel(data: { modelName: string; baseUrl?: string }) {
    return window.electronAPI.models.ollamaWarmup(data);
  },

  /**
   * Unload an Ollama model from memory to free up resources.
   * Call this when switching models or closing the app.
   */
  async unloadOllamaModel(data: { modelName: string; baseUrl?: string }) {
    return window.electronAPI.models.ollamaUnload(data);
  },

  // ========================================================================
  // Event listeners (for download progress, etc.)
  // ========================================================================

  /**
   * Subscribe to download progress events
   */
  onDownloadProgress(
    callback: (data: {
      modelId: string;
      modelName: string;
      progress: number;
      status?: string;
      total?: number;
      completed?: number;
    }) => void,
  ) {
    return window.electronAPI.models.onDownloadProgress(callback);
  },

  /**
   * Subscribe to download complete events
   */
  onDownloadComplete(
    callback: (data: { modelId: string; modelName: string }) => void,
  ) {
    return window.electronAPI.models.onDownloadComplete(callback);
  },

  /**
   * Subscribe to download error events
   */
  onDownloadError(
    callback: (data: {
      modelId: string;
      modelName: string;
      error: string;
    }) => void,
  ) {
    return window.electronAPI.models.onDownloadError(callback);
  },

  /**
   * Subscribe to Ollama install progress events
   */
  onOllamaInstallProgress(
    callback: (data: {
      stage: string;
      percent: number;
      message: string;
    }) => void,
  ) {
    return window.electronAPI.models.onOllamaInstallProgress(callback);
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

  // Unrecognized pattern - return empty array
  console.warn(
    `[modelsFetcher] Unrecognized URL pattern: ${url}, returning empty array`,
  );
  return [];
}

export default modelsApi;
