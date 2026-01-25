import { ipcMain, safeStorage } from "electron";
import { eq, and, desc } from "drizzle-orm";
import log from "electron-log/main";
import { getDatabase, schema } from "../services/database";
import { ElectronAuthService } from "../services/auth";
import * as ollamaService from "../services/ollama-service";
import * as lmStudioService from "../services/lm-studio-service";
import { CURATED_LOCAL_MODELS } from "../../src/lib/ai/curated-local-models";
import { localModelSupportsTools } from "../../src/lib/ai/providers/capabilities";
import { getACPAgentManager } from "../services/acp-agent-service";
import { AGENT_DISPLAY_NAMES, AGENT_ICON_PROVIDERS } from "../services/acp-agents";

// =============================================================================
// LOCAL MODEL PERFORMANCE CACHE
// Cache local model responses to avoid repeated API calls
// =============================================================================

interface LocalModelCache {
  data: any;
  timestamp: number;
}

// Cache for local model responses (30 second TTL for fast iteration)
const LOCAL_MODEL_CACHE_TTL = 30 * 1000; // 30 seconds
const localModelCache = new Map<string, LocalModelCache>();

// Tool support cache (5 minute TTL - less volatile)
const TOOL_SUPPORT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const toolSupportCache = new Map<string, { supported: boolean; timestamp: number }>();

function getCachedLocalModels(key: string): any | null {
  const cached = localModelCache.get(key);
  if (cached && Date.now() - cached.timestamp < LOCAL_MODEL_CACHE_TTL) {
    log.info(`[Models Cache] HIT for ${key}`);
    return cached.data;
  }
  return null;
}

function setCachedLocalModels(key: string, data: any): void {
  localModelCache.set(key, { data, timestamp: Date.now() });
  log.info(`[Models Cache] SET for ${key}`);
}

function getCachedToolSupport(modelName: string): boolean | null {
  const cached = toolSupportCache.get(modelName);
  if (cached && Date.now() - cached.timestamp < TOOL_SUPPORT_CACHE_TTL) {
    return cached.supported;
  }
  return null;
}

function setCachedToolSupport(modelName: string, supported: boolean): void {
  toolSupportCache.set(modelName, { supported, timestamp: Date.now() });
}

// Clear stale cache entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of localModelCache.entries()) {
    if (now - value.timestamp > LOCAL_MODEL_CACHE_TTL * 2) {
      localModelCache.delete(key);
    }
  }
  for (const [key, value] of toolSupportCache.entries()) {
    if (now - value.timestamp > TOOL_SUPPORT_CACHE_TTL * 2) {
      toolSupportCache.delete(key);
    }
  }
}, 60 * 1000); // Clean up every minute

// Provider validation URLs for testing API keys
const PROVIDER_VALIDATION_ENDPOINTS: Record<
  string,
  { url: string; method: string; headers?: Record<string, string> }
> = {
  openai: {
    url: "https://api.openai.com/v1/models",
    method: "GET",
  },
  anthropic: {
    url: "https://api.anthropic.com/v1/messages",
    method: "POST",
  },
  google: {
    url: "https://generativelanguage.googleapis.com/v1beta/models",
    method: "GET",
  },
  xai: {
    url: "https://api.x.ai/v1/models",
    method: "GET",
  },
  groq: {
    url: "https://api.groq.com/openai/v1/models",
    method: "GET",
  },
  openRouter: {
    url: "https://openrouter.ai/api/v1/models",
    method: "GET",
  },
  cerebras: {
    url: "https://api.cerebras.ai/v1/models",
    method: "GET",
  },
};

// Encrypt API key using Electron's safeStorage
// SECURITY: Encryption is REQUIRED - no insecure fallback
function encryptApiKey(key: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      "Secure storage is not available. Cannot store API keys safely. " +
        "Please ensure your system keychain is unlocked and try again.",
    );
  }
  const encrypted = safeStorage.encryptString(key);
  return encrypted.toString("base64");
}

// Decrypt API key
// SECURITY: Encryption is REQUIRED - no insecure fallback
function decryptApiKey(encryptedKey: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      "Secure storage is not available. Cannot decrypt API keys. " +
        "Please ensure your system keychain is unlocked and try again.",
    );
  }
  const buffer = Buffer.from(encryptedKey, "base64");
  return safeStorage.decryptString(buffer);
}

// Get last 4 characters for display hint
function getKeyHint(key: string): string {
  if (key.length <= 4) return "****";
  return `...${key.slice(-4)}`;
}

// Validate API key format (basic validation)
function validateApiKeyFormat(providerId: string, apiKey: string): boolean {
  const patterns: Record<string, RegExp> = {
    openai: /^sk-[a-zA-Z0-9-_]{20,}$/,
    anthropic: /^sk-ant-[a-zA-Z0-9-_]{20,}$/,
    google: /^[a-zA-Z0-9-_]{30,}$/,
    xai: /^xai-[a-zA-Z0-9-_]{20,}$/,
    groq: /^gsk_[a-zA-Z0-9]{20,}$/,
    openRouter: /^sk-or-[a-zA-Z0-9-_]{20,}$/,
    cerebras: /^[a-zA-Z0-9-_]{20,}$/,
  };

  const pattern = patterns[providerId];
  if (!pattern) return true; // Unknown provider, allow any format
  return pattern.test(apiKey);
}

// Test API key with actual API call
async function testApiKey(
  providerId: string,
  apiKey: string,
  baseUrl?: string,
): Promise<{ success: boolean; error?: string; modelCount?: number }> {
  const endpoint = PROVIDER_VALIDATION_ENDPOINTS[providerId];
  if (!endpoint) {
    // For custom providers, test the base URL
    if (baseUrl) {
      try {
        const response = await fetch(`${baseUrl}/models`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          signal: AbortSignal.timeout(10000),
        });
        if (response.ok) {
          return { success: true };
        }
        return {
          success: false,
          error: `API returned ${response.status}: ${response.statusText}`,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Connection failed",
        };
      }
    }
    return { success: true }; // Allow if no endpoint configured
  }

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    // Provider-specific auth headers
    switch (providerId) {
      case "openai":
      case "groq":
      case "openRouter":
      case "cerebras":
      case "xai":
        headers["Authorization"] = `Bearer ${apiKey}`;
        break;
      case "anthropic":
        headers["x-api-key"] = apiKey;
        headers["anthropic-version"] = "2023-06-01";
        break;
      case "google":
        // Google uses API key in query param
        break;
    }

    let url = endpoint.url;
    if (providerId === "google") {
      url = `${endpoint.url}?key=${apiKey}`;
    }

    const response = await fetch(url, {
      method: endpoint.method,
      headers,
      body:
        endpoint.method === "POST"
          ? JSON.stringify({
              model: "claude-3-haiku-20240307",
              max_tokens: 1,
              messages: [{ role: "user", content: "test" }],
            })
          : undefined,
      signal: AbortSignal.timeout(10000),
    });

    if (response.ok) {
      const data = (await response.json()) as { data?: unknown[] };
      return {
        success: true,
        modelCount: Array.isArray(data?.data) ? data.data.length : undefined,
      };
    }

    // Parse error response
    const errorData = (await response.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    const errorMessage =
      errorData?.error?.message ||
      `HTTP ${response.status}: ${response.statusText}`;

    // Specific error handling
    if (response.status === 401) {
      return { success: false, error: "Invalid API key" };
    }
    if (response.status === 403) {
      return { success: false, error: "API key does not have access" };
    }
    if (response.status === 429) {
      return { success: false, error: "Rate limit exceeded - key is valid" };
    }

    return { success: false, error: errorMessage };
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === "TimeoutError") {
        return { success: false, error: "Connection timed out" };
      }
      return { success: false, error: error.message };
    }
    return { success: false, error: "Unknown error" };
  }
}

// Fetch models from local provider (Ollama/LM Studio)
async function fetchLocalModels(
  providerId: string,
  baseUrl: string,
): Promise<{
  success: boolean;
  models?: Array<{ name: string; size?: number; family?: string }>;
  error?: string;
}> {
  try {
    let modelsUrl: string;
    if (providerId === "ollama") {
      modelsUrl = `${baseUrl.replace(/\/api$/, "")}/api/tags`;
    } else {
      // LM Studio and OpenAI-compatible endpoints
      modelsUrl = `${baseUrl}/models`;
    }

    const response = await fetch(modelsUrl, {
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return {
        success: false,
        error: `Provider not available: ${response.status}`,
      };
    }

    const data = (await response.json()) as {
      models?: Array<{
        name?: string;
        model?: string;
        size?: number;
        details?: { family?: string };
      }>;
      data?: Array<{ id: string }>;
    };

    // Ollama format
    if (data.models) {
      return {
        success: true,
        models: data.models.map((m) => ({
          name: m.name || m.model || "",
          size: m.size,
          family: m.details?.family,
        })),
      };
    }

    // OpenAI format (LM Studio)
    if (data.data) {
      return {
        success: true,
        models: data.data.map((m) => ({ name: m.id })),
      };
    }

    return { success: true, models: [] };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Connection failed",
    };
  }
}

/**
 * Check if an Ollama model supports tool/function calling
 * by examining the model's template for .Tools variable
 *
 * Reference: https://ollama.com/blog/tool-support
 * Models that support tools have {{ .Tools }} in their template
 *
 * PERFORMANCE OPTIMIZED:
 * - Reduced timeout from 10s to 3s (local models should respond fast)
 * - Added caching to avoid repeated API calls
 * - Uses HTTP keep-alive via fetch
 */
async function checkOllamaModelToolSupport(
  modelName: string,
  baseUrl: string = "http://localhost:11434"
): Promise<boolean> {
  // Check cache first
  const cached = getCachedToolSupport(modelName);
  if (cached !== null) {
    return cached;
  }

  // Also check pattern-based detection first (instant, no API call)
  if (localModelSupportsTools(modelName)) {
    setCachedToolSupport(modelName, true);
    return true;
  }

  try {
    const response = await fetch(`${baseUrl}/api/show`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Connection": "keep-alive", // Reuse connections
      },
      body: JSON.stringify({ name: modelName }),
      signal: AbortSignal.timeout(3000), // REDUCED: 3s timeout (was 10s)
    });

    if (!response.ok) {
      log.warn(`[Models] Failed to get model info for ${modelName}: ${response.status}`);
      // Fall back to pattern-based detection
      const patternBased = localModelSupportsTools(modelName);
      setCachedToolSupport(modelName, patternBased);
      return patternBased;
    }

    const data = await response.json() as {
      template?: string;
      modelfile?: string;
    };

    // Check if the template contains .Tools or {{ .Tools }}
    // This indicates the model was configured for tool calling
    const template = data.template || "";
    const modelfile = data.modelfile || "";

    const supportsTools =
      template.includes(".Tools") ||
      template.includes("{{.Tools}}") ||
      modelfile.includes(".Tools") ||
      modelfile.includes("{{.Tools}}") ||
      localModelSupportsTools(modelName); // Also check pattern

    log.info(
      `[Models] Tool support check for ${modelName}: ${supportsTools ? "YES" : "NO"}`
    );

    setCachedToolSupport(modelName, supportsTools);
    return supportsTools;
  } catch (error) {
    log.warn(
      `[Models] Error checking tool support for ${modelName}:`,
      error instanceof Error ? error.message : "Unknown error"
    );
    // Fall back to pattern-based detection
    const patternBased = localModelSupportsTools(modelName);
    setCachedToolSupport(modelName, patternBased);
    return patternBased;
  }
}

/**
 * Check tool support for multiple Ollama models in parallel
 * Returns a map of model name -> tool support boolean
 *
 * PERFORMANCE OPTIMIZED:
 * - Increased concurrency from 5 to 20 (local Ollama handles many concurrent requests)
 * - Uses Promise.allSettled for graceful error handling
 * - Skips already-cached models
 */
async function checkOllamaModelsToolSupport(
  modelNames: string[],
  baseUrl: string = "http://localhost:11434"
): Promise<Map<string, boolean>> {
  const results = new Map<string, boolean>();

  // First, check cache and pattern-based detection to skip API calls
  const uncheckedModels: string[] = [];
  for (const name of modelNames) {
    const cached = getCachedToolSupport(name);
    if (cached !== null) {
      results.set(name, cached);
    } else if (localModelSupportsTools(name)) {
      // Pattern says it supports tools - use that
      results.set(name, true);
      setCachedToolSupport(name, true);
    } else {
      uncheckedModels.push(name);
    }
  }

  if (uncheckedModels.length === 0) {
    return results;
  }

  // Check remaining models in parallel with HIGHER concurrency
  const CONCURRENCY = 20; // INCREASED from 5 to 20
  for (let i = 0; i < uncheckedModels.length; i += CONCURRENCY) {
    const batch = uncheckedModels.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map(async (name) => ({
        name,
        supportsTools: await checkOllamaModelToolSupport(name, baseUrl),
      }))
    );

    for (const result of batchResults) {
      if (result.status === "fulfilled") {
        results.set(result.value.name, result.value.supportsTools);
      } else {
        // On error, use pattern-based detection
        const name = batch[batchResults.indexOf(result)];
        const patternBased = localModelSupportsTools(name);
        results.set(name, patternBased);
      }
    }
  }

  return results;
}

// Helper to require authenticated user
async function requireAuth(authService: ElectronAuthService) {
  const user = await authService.getCurrentUser();
  if (!user) {
    throw new Error("Authentication required");
  }
  return user;
}

export function registerModelsHandlers() {
  const db = getDatabase();
  const authService = ElectronAuthService.getInstance();

  // ========================================================================
  // Provider Configuration Handlers
  // ========================================================================

  // Get all provider configurations
  ipcMain.handle("models:getProviders", async () => {
    try {
      const user = await requireAuth(authService);
      const providers = await db
        .select()
        .from(schema.ProviderConfigTable)
        .where(eq(schema.ProviderConfigTable.userId, user.id))
        .orderBy(desc(schema.ProviderConfigTable.createdAt));

      return providers;
    } catch (error) {
      console.error("[IPC] Error getting providers:", error);
      throw error;
    }
  });

  // Get provider by ID
  ipcMain.handle("models:getProvider", async (_event, id: string) => {
    try {
      const [provider] = await db
        .select()
        .from(schema.ProviderConfigTable)
        .where(eq(schema.ProviderConfigTable.id, id))
        .limit(1);

      return provider || null;
    } catch (error) {
      console.error("[IPC] Error getting provider:", error);
      throw error;
    }
  });

  // Save provider configuration
  ipcMain.handle(
    "models:saveProvider",
    async (
      _event,
      data: {
        id?: string;
        name: string;
        providerId: string;
        type: "cloud" | "local";
        baseUrl?: string;
        authType: "api-key" | "oauth" | "none";
        enabled?: boolean;
        metadata?: Record<string, unknown>;
      },
    ) => {
      try {
        const user = await requireAuth(authService);

        if (data.id) {
          // Update existing
          const [provider] = await db
            .update(schema.ProviderConfigTable)
            .set({
              name: data.name,
              baseUrl: data.baseUrl,
              authType: data.authType,
              enabled: data.enabled,
              metadata: data.metadata,
              updatedAt: new Date(),
            })
            .where(eq(schema.ProviderConfigTable.id, data.id))
            .returning();

          return provider;
        } else {
          // Create new
          const [provider] = await db
            .insert(schema.ProviderConfigTable)
            .values({
              name: data.name,
              providerId: data.providerId,
              type: data.type,
              baseUrl: data.baseUrl,
              authType: data.authType,
              enabled: data.enabled !== undefined ? data.enabled : true,
              status: "disconnected",
              userId: user.id,
              metadata: data.metadata,
            })
            .returning();

          return provider;
        }
      } catch (error) {
        console.error("[IPC] Error saving provider:", error);
        throw error;
      }
    },
  );

  // Delete provider
  // SECURITY: Requires authentication and ownership verification
  ipcMain.handle("models:deleteProvider", async (_event, id: string) => {
    try {
      const user = await requireAuth(authService);

      // Verify user owns this provider before deleting
      const [provider] = await db
        .select()
        .from(schema.ProviderConfigTable)
        .where(
          and(
            eq(schema.ProviderConfigTable.id, id),
            eq(schema.ProviderConfigTable.userId, user.id),
          ),
        )
        .limit(1);

      if (!provider) {
        throw new Error("Provider not found or access denied");
      }

      await db
        .delete(schema.ProviderConfigTable)
        .where(eq(schema.ProviderConfigTable.id, id));

      return { success: true };
    } catch (error) {
      console.error("[IPC] Error deleting provider:", error);
      throw error;
    }
  });

  // Test provider connection
  ipcMain.handle(
    "models:testProvider",
    async (
      _event,
      data: { providerId: string; baseUrl?: string; apiKey?: string },
    ) => {
      try {
        const user = await requireAuth(authService);

        // Get API key if not provided
        let apiKey = data.apiKey;
        if (!apiKey) {
          const [keyRecord] = await db
            .select()
            .from(schema.ApiKeyTable)
            .where(
              and(
                eq(schema.ApiKeyTable.userId, user.id),
                eq(schema.ApiKeyTable.providerId, data.providerId),
              ),
            )
            .limit(1);

          if (keyRecord) {
            apiKey = decryptApiKey(keyRecord.encryptedKey);
          }
        }

        // Test based on provider type
        const isLocal = ["ollama", "lmstudio", "custom-local"].includes(
          data.providerId,
        );

        if (isLocal) {
          const baseUrl =
            data.baseUrl ||
            (data.providerId === "ollama"
              ? "http://localhost:11434"
              : "http://localhost:1234/v1");

          const result = await fetchLocalModels(data.providerId, baseUrl);

          // Update provider status
          const [provider] = await db
            .select()
            .from(schema.ProviderConfigTable)
            .where(
              and(
                eq(schema.ProviderConfigTable.userId, user.id),
                eq(schema.ProviderConfigTable.providerId, data.providerId),
              ),
            )
            .limit(1);

          if (provider) {
            await db
              .update(schema.ProviderConfigTable)
              .set({
                status: result.success ? "connected" : "error",
                lastTestedAt: new Date(),
                errorMessage: result.error || null,
                updatedAt: new Date(),
              })
              .where(eq(schema.ProviderConfigTable.id, provider.id));
          }

          return result;
        } else {
          // Cloud provider
          if (!apiKey) {
            return { success: false, error: "No API key configured" };
          }

          const result = await testApiKey(
            data.providerId,
            apiKey,
            data.baseUrl,
          );

          // Update provider status
          const [provider] = await db
            .select()
            .from(schema.ProviderConfigTable)
            .where(
              and(
                eq(schema.ProviderConfigTable.userId, user.id),
                eq(schema.ProviderConfigTable.providerId, data.providerId),
              ),
            )
            .limit(1);

          if (provider) {
            await db
              .update(schema.ProviderConfigTable)
              .set({
                status: result.success ? "connected" : "error",
                lastTestedAt: new Date(),
                errorMessage: result.error || null,
                updatedAt: new Date(),
              })
              .where(eq(schema.ProviderConfigTable.id, provider.id));
          }

          return result;
        }
      } catch (error) {
        console.error("[IPC] Error testing provider:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  );

  // ========================================================================
  // API Key Handlers
  // ========================================================================

  // Get all API keys (without actual key values)
  ipcMain.handle("models:getApiKeys", async () => {
    try {
      const user = await requireAuth(authService);
      const keys = await db
        .select({
          id: schema.ApiKeyTable.id,
          providerId: schema.ApiKeyTable.providerId,
          keyHint: schema.ApiKeyTable.keyHint,
          isValid: schema.ApiKeyTable.isValid,
          lastValidatedAt: schema.ApiKeyTable.lastValidatedAt,
          errorMessage: schema.ApiKeyTable.errorMessage,
          createdAt: schema.ApiKeyTable.createdAt,
          updatedAt: schema.ApiKeyTable.updatedAt,
        })
        .from(schema.ApiKeyTable)
        .where(eq(schema.ApiKeyTable.userId, user.id));

      return keys;
    } catch (error) {
      console.error("[IPC] Error getting API keys:", error);
      throw error;
    }
  });

  // Save/Update API key
  ipcMain.handle(
    "models:saveApiKey",
    async (
      _event,
      data: { providerId: string; apiKey: string; validate?: boolean },
    ) => {
      try {
        const user = await requireAuth(authService);

        // Validate format
        if (!validateApiKeyFormat(data.providerId, data.apiKey)) {
          return {
            success: false,
            error: `Invalid API key format for ${data.providerId}`,
          };
        }

        // Test key if validation requested
        let isValid = false;
        let errorMessage: string | null = null;
        let lastValidatedAt: Date | null = null;

        if (data.validate !== false) {
          const testResult = await testApiKey(data.providerId, data.apiKey);
          isValid = testResult.success;
          errorMessage = testResult.error || null;
          lastValidatedAt = new Date();
        }

        const encryptedKey = encryptApiKey(data.apiKey);
        const keyHint = getKeyHint(data.apiKey);

        // Check if key exists
        const [existing] = await db
          .select()
          .from(schema.ApiKeyTable)
          .where(
            and(
              eq(schema.ApiKeyTable.userId, user.id),
              eq(schema.ApiKeyTable.providerId, data.providerId),
            ),
          )
          .limit(1);

        if (existing) {
          // Update existing key
          const [updated] = await db
            .update(schema.ApiKeyTable)
            .set({
              encryptedKey,
              keyHint,
              isValid,
              lastValidatedAt,
              errorMessage,
              updatedAt: new Date(),
            })
            .where(eq(schema.ApiKeyTable.id, existing.id))
            .returning();

          return {
            success: true,
            isValid,
            error: errorMessage,
            key: {
              id: updated.id,
              providerId: updated.providerId,
              keyHint: updated.keyHint,
              isValid: updated.isValid,
            },
          };
        } else {
          // Create new key
          const [created] = await db
            .insert(schema.ApiKeyTable)
            .values({
              providerId: data.providerId,
              encryptedKey,
              keyHint,
              isValid,
              lastValidatedAt,
              errorMessage,
              userId: user.id,
            })
            .returning();

          // Also create provider config if it doesn't exist
          const [existingProvider] = await db
            .select()
            .from(schema.ProviderConfigTable)
            .where(
              and(
                eq(schema.ProviderConfigTable.userId, user.id),
                eq(schema.ProviderConfigTable.providerId, data.providerId),
              ),
            )
            .limit(1);

          if (!existingProvider) {
            await db.insert(schema.ProviderConfigTable).values({
              name: data.providerId,
              providerId: data.providerId,
              type: "cloud",
              authType: "api-key",
              enabled: isValid,
              status: isValid ? "connected" : "disconnected",
              lastTestedAt: lastValidatedAt,
              errorMessage,
              userId: user.id,
            });
          } else {
            // Update provider status
            await db
              .update(schema.ProviderConfigTable)
              .set({
                enabled: isValid,
                status: isValid ? "connected" : "error",
                lastTestedAt: lastValidatedAt,
                errorMessage,
                updatedAt: new Date(),
              })
              .where(eq(schema.ProviderConfigTable.id, existingProvider.id));
          }

          return {
            success: true,
            isValid,
            error: errorMessage,
            key: {
              id: created.id,
              providerId: created.providerId,
              keyHint: created.keyHint,
              isValid: created.isValid,
            },
          };
        }
      } catch (error) {
        console.error("[IPC] Error saving API key:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  );

  // Delete API key
  ipcMain.handle("models:deleteApiKey", async (_event, providerId: string) => {
    try {
      const user = await requireAuth(authService);

      await db
        .delete(schema.ApiKeyTable)
        .where(
          and(
            eq(schema.ApiKeyTable.userId, user.id),
            eq(schema.ApiKeyTable.providerId, providerId),
          ),
        );

      // Update provider status
      await db
        .update(schema.ProviderConfigTable)
        .set({
          status: "disconnected",
          enabled: false,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.ProviderConfigTable.userId, user.id),
            eq(schema.ProviderConfigTable.providerId, providerId),
          ),
        );

      return { success: true };
    } catch (error) {
      console.error("[IPC] Error deleting API key:", error);
      throw error;
    }
  });

  // Validate API key (test without saving)
  ipcMain.handle(
    "models:validateApiKey",
    async (
      _event,
      data: { providerId: string; apiKey: string; baseUrl?: string },
    ) => {
      try {
        // Format validation
        if (!validateApiKeyFormat(data.providerId, data.apiKey)) {
          return {
            success: false,
            error: `Invalid API key format for ${data.providerId}`,
          };
        }

        // API test
        const result = await testApiKey(
          data.providerId,
          data.apiKey,
          data.baseUrl,
        );

        return result;
      } catch (error) {
        console.error("[IPC] Error validating API key:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  );

  // Get decrypted API key (for internal use only)
  ipcMain.handle(
    "models:getDecryptedApiKey",
    async (_event, providerId: string) => {
      try {
        const user = await requireAuth(authService);

        const [keyRecord] = await db
          .select()
          .from(schema.ApiKeyTable)
          .where(
            and(
              eq(schema.ApiKeyTable.userId, user.id),
              eq(schema.ApiKeyTable.providerId, providerId),
            ),
          )
          .limit(1);

        if (!keyRecord) {
          return null;
        }

        return decryptApiKey(keyRecord.encryptedKey);
      } catch (error) {
        console.error("[IPC] Error getting decrypted API key:", error);
        throw error;
      }
    },
  );

  // Fetch models from cloud provider API
  ipcMain.handle(
    "models:fetchProviderModels",
    async (
      _event,
      data: { providerId: string; apiKey: string },
    ): Promise<{
      success: boolean;
      models?: Array<{
        id: string;
        name: string;
        displayName: string;
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
      }>;
      error?: string;
    }> => {
      try {
        const { providerId, apiKey } = data;

        let url: string;
        let headers: Record<string, string>;

        switch (providerId) {
          case "anthropic":
            url = "https://api.anthropic.com/v1/models";
            headers = {
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
              "Content-Type": "application/json",
            };
            break;
          case "openai":
            url = "https://api.openai.com/v1/models";
            headers = {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            };
            break;
          case "google":
            url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
            headers = {
              "Content-Type": "application/json",
            };
            break;
          case "groq":
            url = "https://api.groq.com/openai/v1/models";
            headers = {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            };
            break;
          case "xai":
            url = "https://api.x.ai/v1/models";
            headers = {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            };
            break;
          case "cerebras":
            url = "https://api.cerebras.ai/v1/models";
            headers = {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            };
            break;
          case "openRouter":
            url = "https://openrouter.ai/api/v1/models";
            headers = {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            };
            break;
          default:
            return {
              success: false,
              error: `Unsupported provider: ${providerId}`,
            };
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        try {
          const response = await fetch(url, {
            headers,
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          if (!response.ok) {
            return {
              success: false,
              error: `API error: ${response.status}`,
            };
          }

          const data = (await response.json()) as {
            data?: Array<{
              id: string;
              created?: number;
              created_at?: string;
              display_name?: string;
              context_window?: number;
            }>;
            models?: Array<{
              id: string;
              created?: number;
              created_at?: string;
              display_name?: string;
              context_window?: number;
            }>;
          };

          const rawModels = data.data || data.models || [];

          // Filter and transform models based on provider
          let filteredModels = rawModels;
          if (providerId === "anthropic") {
            filteredModels = rawModels.filter((m) => m.id.includes("claude"));
          } else if (providerId === "openai") {
            filteredModels = rawModels.filter(
              (m) =>
                m.id.startsWith("gpt-") ||
                m.id.startsWith("o1") ||
                m.id.startsWith("o3") ||
                m.id.startsWith("o4"),
            );
          } else if (providerId === "google") {
            filteredModels = rawModels.filter((m) => m.id.includes("gemini"));
          } else if (providerId === "xai") {
            filteredModels = rawModels.filter((m) => m.id.includes("grok"));
          }

          // Sort by creation date (newest first)
          filteredModels.sort((a, b) => {
            const aTime =
              a.created ??
              (a.created_at ? new Date(a.created_at).getTime() / 1000 : 0);
            const bTime =
              b.created ??
              (b.created_at ? new Date(b.created_at).getTime() / 1000 : 0);
            return bTime - aTime;
          });

          // Transform to our format
          const models = filteredModels.map((model) => {
            const modelId = model.id;
            const displayName = formatModelDisplayName(
              providerId,
              modelId,
              model.display_name,
            );
            const capabilities = getModelCapabilities(modelId);

            return {
              id: modelId,
              name: displayName,
              displayName,
              isToolCallSupported: capabilities.isToolCallSupported,
              isImageInputSupported: capabilities.isImageInputSupported,
              isReasoningModel: capabilities.isReasoningModel,
              workflowGenerationSupport: capabilities.workflowGenerationSupport,
              toolCallUnsupportedReason: capabilities.toolCallUnsupportedReason,
              reasoningEffort: capabilities.reasoningEffort,
              thinkingLevel: capabilities.thinkingLevel,
              supportedFileMimeTypes: getSupportedFileTypes(providerId),
            };
          });

          return {
            success: true,
            models,
          };
        } catch (fetchError) {
          clearTimeout(timeoutId);
          if (fetchError instanceof Error && fetchError.name === "AbortError") {
            return {
              success: false,
              error: "Request timed out",
            };
          }
          throw fetchError;
        }
      } catch (error) {
        console.error("[IPC] Error fetching provider models:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  );

  // ========================================================================
  // Helper Functions for Model Fetching
  // ========================================================================

  // Format model display name
  function formatModelDisplayName(
    providerId: string,
    modelId: string,
    displayName?: string,
  ): string {
    if (displayName && !displayName.startsWith("models/")) {
      return displayName;
    }

    switch (providerId) {
      case "anthropic": {
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
      case "openai": {
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
      case "google": {
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
      case "groq": {
        let name = modelId;
        if (name.includes("/")) {
          name = name.split("/").pop() || name;
        }
        name = name
          .replace("llama-", "Llama ")
          .replace("mixtral-", "Mixtral ")
          .replace(/-/g, " ");
        return name;
      }
      case "xai": {
        return modelId.replace("grok-", "Grok ").replace(/-/g, " ");
      }
      default:
        return displayName || modelId;
    }
  }

  // Get model capabilities
  function getModelCapabilities(modelId: string): {
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
  } {
    // Reasoning models
    const isReasoning =
      /(^|[/:-])o[134]/i.test(modelId) ||
      /gpt-5/i.test(modelId) ||
      /codex/i.test(modelId) ||
      /deepseek-r1/i.test(modelId);

    // Built-in tools - NONE for local models (gpt-oss removed - supports tools locally!)
    const hasBuiltIn = false;

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
      isToolCallSupported,
      isImageInputSupported,
      isReasoningModel: isReasoning,
      workflowGenerationSupport,
      toolCallUnsupportedReason,
      reasoningEffort,
      thinkingLevel,
    };
  }

  // Get supported file types for provider
  function getSupportedFileTypes(providerId: string): string[] {
    switch (providerId) {
      case "anthropic":
        return [
          "application/pdf",
          "text/plain",
          "text/csv",
          "text/html",
          "image/jpeg",
          "image/png",
          "image/gif",
          "image/webp",
        ];
      case "openai":
      case "google":
      case "xai":
        return ["image/jpeg", "image/png", "image/gif", "image/webp"];
      default:
        return [];
    }
  }

  // ========================================================================
  // Local Model Handlers
  // ========================================================================

  // Get all local models
  ipcMain.handle("models:getLocalModels", async () => {
    try {
      const user = await requireAuth(authService);
      const models = await db
        .select()
        .from(schema.LocalModelTable)
        .where(eq(schema.LocalModelTable.userId, user.id))
        .orderBy(desc(schema.LocalModelTable.createdAt));

      return models;
    } catch (error) {
      console.error("[IPC] Error getting local models:", error);
      throw error;
    }
  });

  // Refresh local models from provider
  ipcMain.handle(
    "models:refreshLocalModels",
    async (_event, data: { providerId: string; baseUrl?: string }) => {
      try {
        const user = await requireAuth(authService);

        const baseUrl =
          data.baseUrl ||
          (data.providerId === "ollama"
            ? "http://localhost:11434"
            : "http://localhost:1234/v1");

        const result = await fetchLocalModels(data.providerId, baseUrl);

        if (!result.success || !result.models) {
          return result;
        }

        // Check tool support for all models dynamically via Ollama API
        let toolSupportMap = new Map<string, boolean>();
        if (data.providerId === "ollama") {
          const modelNames = result.models.map((m: { name: string }) => m.name);
          log.info(
            `[IPC] Checking tool support for ${modelNames.length} Ollama models...`
          );
          toolSupportMap = await checkOllamaModelsToolSupport(modelNames, baseUrl);
          log.info(
            `[IPC] Tool support results: ${Array.from(toolSupportMap.entries())
              .map(([name, supports]) => `${name}=${supports}`)
              .join(", ")}`
          );
        }

        // Sync models with database
        for (const model of result.models) {
          const [existing] = await db
            .select()
            .from(schema.LocalModelTable)
            .where(
              and(
                eq(schema.LocalModelTable.userId, user.id),
                eq(schema.LocalModelTable.providerId, data.providerId),
                eq(schema.LocalModelTable.name, model.name),
              ),
            )
            .limit(1);

          if (existing) {
            // Update existing - also update tool support if we have it
            const toolSupport =
              data.providerId === "ollama"
                ? toolSupportMap.get(model.name)
                : existing.isToolCallSupported;

            await db
              .update(schema.LocalModelTable)
              .set({
                size: model.size,
                family: model.family,
                status: "available",
                isToolCallSupported: toolSupport ?? existing.isToolCallSupported,
                updatedAt: new Date(),
              })
              .where(eq(schema.LocalModelTable.id, existing.id));
          } else {
            // Create new
            const isVision =
              model.name.includes("vision") || 
              model.name.includes("llava") ||
              /-vl[:\-]/i.test(model.name) || // qwen3-vl, qwen2-vl, etc.
              model.name.endsWith("-vl");

            // Get dynamic tool support for Ollama, use heuristic fallback for others
            const isToolCallSupported =
              data.providerId === "ollama"
                ? toolSupportMap.get(model.name) ?? false
                : localModelSupportsTools(model.name);

            await db.insert(schema.LocalModelTable).values({
              name: model.name,
              displayName: formatModelDisplayName(data.providerId, model.name),
              providerId: data.providerId,
              size: model.size,
              family: model.family,
              status: "available",
              isVision,
              isToolCallSupported,
              userId: user.id,
            });
          }
        }

        // Get updated list
        const models = await db
          .select()
          .from(schema.LocalModelTable)
          .where(
            and(
              eq(schema.LocalModelTable.userId, user.id),
              eq(schema.LocalModelTable.providerId, data.providerId),
            ),
          );

        return { success: true, models };
      } catch (error) {
        console.error("[IPC] Error refreshing local models:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  );

  // Track active downloads for cancellation
  const activeDownloads = new Map<string, AbortController>();

  // Download model via Ollama with streaming progress
  ipcMain.handle(
    "models:downloadModel",
    async (event, data: { modelName: string; baseUrl?: string }) => {
      try {
        const user = await requireAuth(authService);
        const baseUrl = data.baseUrl || "http://localhost:11434";

        // Create model record with downloading status
        // Use pattern-based heuristic for initial tool support (will be updated after download)
        const [model] = await db
          .insert(schema.LocalModelTable)
          .values({
            name: data.modelName,
            displayName: formatModelDisplayName("ollama", data.modelName),
            providerId: "ollama",
            status: "downloading",
            downloadProgress: 0,
            isVision:
              data.modelName.includes("vision") ||
              data.modelName.includes("llava") ||
              /-vl[:\-]/i.test(data.modelName) || // qwen3-vl, qwen2-vl, etc.
              data.modelName.endsWith("-vl"),
            isToolCallSupported: localModelSupportsTools(data.modelName),
            userId: user.id,
          })
          .onConflictDoUpdate({
            target: [
              schema.LocalModelTable.userId,
              schema.LocalModelTable.providerId,
              schema.LocalModelTable.name,
            ],
            set: {
              status: "downloading",
              downloadProgress: 0,
              errorMessage: null,
              updatedAt: new Date(),
            },
          })
          .returning();

        // Create abort controller for this download
        const abortController = new AbortController();
        activeDownloads.set(model.id, abortController);

        // Start download with streaming (non-blocking)
        const pullUrl = `${baseUrl.replace(/\/api$/, "")}/api/pull`;

        // Process download in background
        (async () => {
          try {
            const response = await fetch(pullUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: data.modelName, stream: true }),
              signal: abortController.signal,
            });

            if (!response.ok || !response.body) {
              const errorText = await response.text();
              throw new Error(
                `Failed to start download: ${response.status} - ${errorText}`,
              );
            }

            // Parse streaming NDJSON response
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let lastProgress = 0;
            let downloadComplete = false;
            let lastStatusMessage = "";

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() || "";

              for (const line of lines) {
                if (!line.trim()) continue;
                try {
                  const progress = JSON.parse(line) as {
                    status: string;
                    digest?: string;
                    total?: number;
                    completed?: number;
                    error?: string;
                  };

                  // Handle error status from Ollama
                  if (progress.error) {
                    throw new Error(progress.error);
                  }

                  // Track status message for debugging
                  lastStatusMessage = progress.status || "";

                  // Check for completion status
                  // Ollama sends "success" when the model is fully pulled
                  if (progress.status === "success") {
                    downloadComplete = true;
                    lastProgress = 100;
                  }

                  // Calculate progress percentage
                  if (progress.total && progress.completed) {
                    const percent = Math.round(
                      (progress.completed / progress.total) * 100,
                    );

                    // Only update if progress changed (to avoid too many DB writes)
                    if (percent !== lastProgress) {
                      lastProgress = percent;

                      // Update database
                      await db
                        .update(schema.LocalModelTable)
                        .set({
                          downloadProgress: percent,
                          updatedAt: new Date(),
                        })
                        .where(eq(schema.LocalModelTable.id, model.id));

                      // Send progress event to renderer
                      event.sender.send("models:download:progress", {
                        modelId: model.id,
                        modelName: data.modelName,
                        progress: percent,
                        status: progress.status,
                        digest: progress.digest,
                        total: progress.total,
                        completed: progress.completed,
                      });
                    }
                  } else if (progress.status && !progress.total) {
                    // Status update without progress (e.g., "pulling manifest", "verifying sha256")
                    // Send status update to keep UI informed
                    event.sender.send("models:download:progress", {
                      modelId: model.id,
                      modelName: data.modelName,
                      progress: lastProgress,
                      status: progress.status,
                    });
                  }
                } catch (parseError) {
                  // Only log if it looks like a real error, not just malformed JSON
                  if (parseError instanceof Error && parseError.message !== "Unexpected end of JSON input") {
                    log.warn(`[IPC] Download parse error for ${data.modelName}:`, parseError.message);
                    // Re-throw actual errors from Ollama
                    if (line.includes('"error"')) {
                      throw parseError;
                    }
                  }
                }
              }
            }

            // Process any remaining buffer
            if (buffer.trim()) {
              try {
                const progress = JSON.parse(buffer) as { status: string; error?: string };
                if (progress.error) {
                  throw new Error(progress.error);
                }
                if (progress.status === "success") {
                  downloadComplete = true;
                }
              } catch {
                // Ignore parse errors in final buffer
              }
            }

            // Verify download completed successfully
            // Check if the model is now available in Ollama
            if (!downloadComplete) {
              log.info(`[IPC] Stream ended for ${data.modelName}, verifying download...`);
              try {
                const verifyResponse = await fetch(`${baseUrl.replace(/\/api$/, "")}/api/tags`, {
                  signal: AbortSignal.timeout(5000),
                });
                if (verifyResponse.ok) {
                  const tagsData = await verifyResponse.json() as { models?: Array<{ name: string }> };
                  const modelNames = (tagsData.models || []).map(m => m.name.split(":")[0]);
                  const requestedName = data.modelName.split(":")[0];
                  if (modelNames.includes(requestedName) || modelNames.some(n => n.includes(requestedName))) {
                    downloadComplete = true;
                    log.info(`[IPC] Verified ${data.modelName} is available in Ollama`);
                  }
                }
              } catch (verifyError) {
                log.warn(`[IPC] Could not verify download for ${data.modelName}:`, verifyError);
              }
            }

            if (!downloadComplete) {
              throw new Error(`Download stream ended unexpectedly for ${data.modelName}. Last status: ${lastStatusMessage}`);
            }

            // Download complete - check tool support dynamically
            const supportsTools = await checkOllamaModelToolSupport(
              data.modelName,
              baseUrl
            );
            log.info(
              `[IPC] Tool support for ${data.modelName}: ${supportsTools ? "YES" : "NO"}`
            );

            await db
              .update(schema.LocalModelTable)
              .set({
                status: "available",
                downloadProgress: 100,
                isToolCallSupported: supportsTools,
                errorMessage: null,
                updatedAt: new Date(),
              })
              .where(eq(schema.LocalModelTable.id, model.id));

            log.info(`[IPC] Download complete for ${data.modelName}`);

            // Send completion event
            event.sender.send("models:download:complete", {
              modelId: model.id,
              modelName: data.modelName,
            });
          } catch (error) {
            // Handle cancellation
            if (
              error instanceof Error &&
              error.name === "AbortError"
            ) {
              await db
                .update(schema.LocalModelTable)
                .set({
                  status: "error",
                  errorMessage: "Download cancelled",
                  updatedAt: new Date(),
                })
                .where(eq(schema.LocalModelTable.id, model.id));

              event.sender.send("models:download:error", {
                modelId: model.id,
                modelName: data.modelName,
                error: "Download cancelled",
              });
            } else {
              // Handle other errors
              const errorMessage =
                error instanceof Error ? error.message : "Download failed";

              await db
                .update(schema.LocalModelTable)
                .set({
                  status: "error",
                  errorMessage,
                  updatedAt: new Date(),
                })
                .where(eq(schema.LocalModelTable.id, model.id));

              event.sender.send("models:download:error", {
                modelId: model.id,
                modelName: data.modelName,
                error: errorMessage,
              });
            }
          } finally {
            activeDownloads.delete(model.id);
          }
        })();

        return { success: true, modelId: model.id };
      } catch (error) {
        console.error("[IPC] Error downloading model:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  );

  // Cancel a model download
  ipcMain.handle(
    "models:cancelDownload",
    async (_event, data: { modelId: string }) => {
      const controller = activeDownloads.get(data.modelId);
      if (controller) {
        controller.abort();
        activeDownloads.delete(data.modelId);
        return { success: true };
      }
      return { success: false, error: "Download not found" };
    },
  );

  // Delete local model - also removes from Ollama/LM Studio
  ipcMain.handle(
    "models:deleteLocalModel",
    async (
      _event,
      data: {
        id?: string;
        modelName?: string;
        providerId?: string;
        deleteFromProvider?: boolean;
      },
    ) => {
      try {
        const user = await requireAuth(authService);
        let modelName = data.modelName;
        let providerId = data.providerId;

        // If only ID provided, look up the model details first
        if (data.id && !modelName) {
          const [existingModel] = await db
            .select()
            .from(schema.LocalModelTable)
            .where(eq(schema.LocalModelTable.id, data.id))
            .limit(1);

          if (existingModel) {
            modelName = existingModel.name;
            providerId = existingModel.providerId;
          }
        }

        // Delete from Ollama if it's an Ollama model (default behavior)
        const shouldDeleteFromProvider = data.deleteFromProvider !== false;
        if (shouldDeleteFromProvider && providerId === "ollama" && modelName) {
          const baseUrl = "http://localhost:11434";
          const deleteUrl = `${baseUrl}/api/delete`;

          try {
            const response = await fetch(deleteUrl, {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: modelName }),
            });

            if (!response.ok) {
              const errorText = await response.text();
              console.warn(
                `[IPC] Ollama delete returned ${response.status}: ${errorText}`,
              );
              // Continue to delete from DB even if Ollama delete fails
              // (model might not exist in Ollama anymore)
            }
          } catch (ollamaError) {
            console.warn("[IPC] Failed to delete from Ollama:", ollamaError);
            // Continue to delete from DB
          }
        }

        // Delete from database
        if (data.id) {
          await db
            .delete(schema.LocalModelTable)
            .where(eq(schema.LocalModelTable.id, data.id));
        } else if (modelName && providerId) {
          await db
            .delete(schema.LocalModelTable)
            .where(
              and(
                eq(schema.LocalModelTable.userId, user.id),
                eq(schema.LocalModelTable.providerId, providerId),
                eq(schema.LocalModelTable.name, modelName),
              ),
            );
        }

        return { success: true };
      } catch (error) {
        console.error("[IPC] Error deleting local model:", error);
        throw error;
      }
    },
  );

  // ========================================================================
  // Combined Model Status
  // ========================================================================

  // Get all available models (combines cloud providers with API keys + local models)
  // PERFORMANCE OPTIMIZED: Uses caching to avoid repeated API calls
  ipcMain.handle("models:getAvailableModels", async () => {
    try {
      const user = await requireAuth(authService);
      const startTime = Date.now();

      // Get providers with valid API keys (database is fast, no cache needed)
      const apiKeys = await db
        .select()
        .from(schema.ApiKeyTable)
        .where(
          and(
            eq(schema.ApiKeyTable.userId, user.id),
            eq(schema.ApiKeyTable.isValid, true),
          ),
        );

      // Get enabled providers
      const providers = await db
        .select()
        .from(schema.ProviderConfigTable)
        .where(
          and(
            eq(schema.ProviderConfigTable.userId, user.id),
            eq(schema.ProviderConfigTable.enabled, true),
          ),
        );

      // Check cache first for local models
      const cachedOllama = getCachedLocalModels("ollama-models");
      const cachedLMStudio = getCachedLocalModels("lmstudio-models");

      const localModels: Array<{
        id: string;
        name: string;
        displayName: string;
        providerId: string;
        size?: number;
        quantization?: string;
        family?: string;
        status: string;
        isVision?: boolean;
        isToolCallSupported?: boolean;
      }> = [];

      // Fetch from Ollama (use cache if available)
      if (cachedOllama) {
        localModels.push(...cachedOllama);
      } else {
        try {
          const ollamaResult = await ollamaService.getOllamaModels();
          if (ollamaResult.success && ollamaResult.models) {
            const ollamaModels: typeof localModels = [];
            for (const model of ollamaResult.models) {
              ollamaModels.push({
                id: `ollama-${model.name}`,
                name: model.name,
                displayName: model.name,
                providerId: "ollama",
                size: model.size,
                quantization: model.details?.quantization_level,
                family: model.details?.family,
                status: "available",
                isVision: model.name.includes("vision") || model.name.includes("llava") || /-vl[:\-]/i.test(model.name) || model.name.endsWith("-vl"),
                isToolCallSupported: localModelSupportsTools(model.name), // Use fast pattern matching
              });
            }
            setCachedLocalModels("ollama-models", ollamaModels);
            localModels.push(...ollamaModels);
          }
        } catch (e) {
          log.warn("[IPC] Failed to fetch Ollama models:", e);
        }
      }

      // Fetch from LM Studio (use cache if available)
      if (cachedLMStudio) {
        localModels.push(...cachedLMStudio);
      } else {
        try {
          const lmStudioResult = await lmStudioService.getLMStudioModels();
          if (lmStudioResult.success && lmStudioResult.models) {
            const lmStudioModels: typeof localModels = [];
            for (const model of lmStudioResult.models) {
              lmStudioModels.push({
                id: `lmstudio-${model.id}`,
                name: model.id,
                displayName: model.id,
                providerId: "lmstudio",
                status: "available",
                isToolCallSupported: localModelSupportsTools(model.id), // Use fast pattern matching
              });
            }
            setCachedLocalModels("lmstudio-models", lmStudioModels);
            localModels.push(...lmStudioModels);
          }
        } catch (e) {
          log.warn("[IPC] Failed to fetch LM Studio models:", e);
        }
      }

      // Get installed ACP agents
      let acpAgents: Array<{
        id: string;
        name: string;
        displayName: string;
        installed: boolean;
        authenticated: boolean;
        running: boolean;
        iconProvider: "anthropic" | "openai" | "google";
        isACPAgent: true;
      }> = [];

      try {
        const acpManager = getACPAgentManager();
        const detectedAgents = await acpManager.detectInstalledAgents();
        acpAgents = detectedAgents
          .filter((agent) => agent.installed)
          .map((agent) => ({
            id: agent.id,
            name: agent.id,
            displayName: AGENT_DISPLAY_NAMES[agent.id] || agent.id,
            installed: agent.installed,
            authenticated: agent.authenticated,
            running: agent.running,
            iconProvider: AGENT_ICON_PROVIDERS[agent.id] || "anthropic",
            isACPAgent: true as const,
          }));
        log.info(`[IPC] Detected ${acpAgents.length} installed ACP agents`);
      } catch (acpError) {
        log.warn("[IPC] Failed to detect ACP agents:", acpError);
      }

      const duration = Date.now() - startTime;
      log.info(`[IPC] models:getAvailableModels completed in ${duration}ms (${localModels.length} local models, ${acpAgents.length} ACP agents)`);

      return {
        cloudProviders: apiKeys.map((k) => k.providerId),
        providers,
        localModels,
        acpAgents,
      };
    } catch (error) {
      console.error("[IPC] Error getting available models:", error);
      throw error;
    }
  });

  // Get model status summary
  ipcMain.handle("models:getStatus", async () => {
    try {
      const user = await requireAuth(authService);

      const [providers, apiKeys, localModels] = await Promise.all([
        db
          .select()
          .from(schema.ProviderConfigTable)
          .where(eq(schema.ProviderConfigTable.userId, user.id)),
        db
          .select()
          .from(schema.ApiKeyTable)
          .where(eq(schema.ApiKeyTable.userId, user.id)),
        db
          .select()
          .from(schema.LocalModelTable)
          .where(eq(schema.LocalModelTable.userId, user.id)),
      ]);

      const validApiKeys = apiKeys.filter((k) => k.isValid).length;
      const connectedProviders = providers.filter(
        (p) => p.status === "connected",
      ).length;
      const availableLocalModels = localModels.filter(
        (m) => m.status === "available",
      ).length;

      return {
        totalProviders: providers.length,
        connectedProviders,
        validApiKeys,
        totalLocalModels: localModels.length,
        availableLocalModels,
        downloadingModels: localModels.filter((m) => m.status === "downloading")
          .length,
      };
    } catch (error) {
      console.error("[IPC] Error getting model status:", error);
      throw error;
    }
  });

  // ========================================================================
  // Ollama Service Handlers
  // ========================================================================

  // Check if Ollama is installed
  ipcMain.handle("models:ollama:isInstalled", async () => {
    try {
      return await ollamaService.isOllamaInstalled();
    } catch (error) {
      console.error("[IPC] Error checking Ollama installation:", error);
      return { installed: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  });

  // Check Ollama health (installed + running)
  ipcMain.handle("models:ollama:checkHealth", async () => {
    try {
      return await ollamaService.checkOllamaHealth();
    } catch (error) {
      console.error("[IPC] Error checking Ollama health:", error);
      return {
        installed: false,
        running: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

  // Start Ollama service
  ipcMain.handle("models:ollama:tryStart", async () => {
    try {
      return await ollamaService.startOllamaService();
    } catch (error) {
      console.error("[IPC] Error starting Ollama:", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

  // Install Ollama
  ipcMain.handle("models:ollama:install", async (event) => {
    try {
      const result = await ollamaService.installOllama((progress) => {
        // Send progress updates to renderer
        event.sender.send("models:ollama:install:progress", progress);
      });
      return result;
    } catch (error) {
      console.error("[IPC] Error installing Ollama:", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

  // Get Ollama models
  ipcMain.handle("models:ollama:getModels", async () => {
    try {
      return await ollamaService.getOllamaModels();
    } catch (error) {
      console.error("[IPC] Error getting Ollama models:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

  // Show Ollama model details
  ipcMain.handle(
    "models:ollama:showModel",
    async (_event, data: { modelName: string }) => {
      try {
        return await ollamaService.showOllamaModel(data.modelName);
      } catch (error) {
        console.error("[IPC] Error showing Ollama model:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  );

  // Get Ollama library models (available for download)
  ipcMain.handle("models:ollama:getLibraryModels", async () => {
    try {
      return await ollamaService.getOllamaLibraryModels();
    } catch (error) {
      console.error("[IPC] Error getting Ollama library models:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

  // Search Ollama library
  ipcMain.handle(
    "models:ollama:searchLibrary",
    async (_event, data: { query: string }) => {
      try {
        return await ollamaService.searchOllamaLibrary(data.query);
      } catch (error) {
        console.error("[IPC] Error searching Ollama library:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  );

  // ========================================================================
  // LM Studio Service Handlers
  // ========================================================================

  // Check LM Studio health (installed + running)
  ipcMain.handle("models:lmstudio:checkHealth", async () => {
    try {
      return await lmStudioService.checkLMStudioHealth();
    } catch (error) {
      console.error("[IPC] Error checking LM Studio health:", error);
      return {
        installed: false,
        running: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

  // Get LM Studio models
  ipcMain.handle("models:lmstudio:getModels", async () => {
    try {
      return await lmStudioService.getLMStudioModels();
    } catch (error) {
      console.error("[IPC] Error getting LM Studio models:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

  // ========================================================================
  // Curated Models
  // ========================================================================

  // Get curated local models list
  ipcMain.handle("models:getCuratedModels", async () => {
    try {
      return { success: true, models: CURATED_LOCAL_MODELS };
    } catch (error) {
      console.error("[IPC] Error getting curated models:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

  // ========================================================================
  // Model Warmup / Preload
  // ========================================================================
  
  /**
   * Warmup / preload a model into Ollama's memory
   * This sends a minimal request to load the model so subsequent requests are fast.
   * Uses keep_alive: -1 to keep the model loaded indefinitely.
   */
  ipcMain.handle(
    "models:ollama:warmup",
    async (_event, data: { modelName: string; baseUrl?: string }) => {
      const baseUrl = data.baseUrl || "http://localhost:11434";
      
      log.info(`[Models] Warming up Ollama model: ${data.modelName}`);
      
      try {
        // Send a minimal generate request with keep_alive to load model into memory
        // The empty prompt + num_predict: 1 makes this very fast
        const startTime = Date.now();
        
        const response = await fetch(`${baseUrl}/api/generate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: data.modelName,
            prompt: "", // Empty prompt - just load the model
            stream: false,
            keep_alive: "10m", // Keep loaded for 10 minutes (safer than indefinite)
            options: {
              num_predict: 1,  // Minimal output
              num_ctx: 512,    // Minimal context for warmup
              num_batch: 64,   // Small batch for safety
            },
          }),
          signal: AbortSignal.timeout(120000), // 2 minute timeout for model loading
        });

        const elapsed = Date.now() - startTime;
        
        if (response.ok) {
          const result = await response.json();
          log.info(`[Models] Model ${data.modelName} warmed up in ${elapsed}ms. Load duration: ${result.load_duration ? Math.round(result.load_duration / 1000000) + 'ms' : 'N/A'}`);
          return {
            success: true,
            message: `Model loaded in ${elapsed}ms`,
            loadDuration: result.load_duration,
          };
        } else {
          const errorText = await response.text();
          log.error(`[Models] Warmup failed for ${data.modelName}: ${response.status} - ${errorText}`);
          return {
            success: false,
            error: `HTTP ${response.status}: ${errorText}`,
          };
        }
      } catch (error) {
        log.error(`[Models] Error warming up model ${data.modelName}:`, error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  );

  /**
   * Unload a model from Ollama's memory to free up resources
   */
  ipcMain.handle(
    "models:ollama:unload",
    async (_event, data: { modelName: string; baseUrl?: string }) => {
      const baseUrl = data.baseUrl || "http://localhost:11434";
      
      log.info(`[Models] Unloading Ollama model: ${data.modelName}`);
      
      try {
        const response = await fetch(`${baseUrl}/api/generate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: data.modelName,
            prompt: "",
            stream: false,
            keep_alive: 0, // Unload immediately
          }),
          signal: AbortSignal.timeout(10000), // 10 second timeout
        });

        if (response.ok) {
          log.info(`[Models] Model ${data.modelName} unloaded successfully`);
          return { success: true, message: "Model unloaded" };
        } else {
          const errorText = await response.text();
          return { success: false, error: `HTTP ${response.status}: ${errorText}` };
        }
      } catch (error) {
        log.error(`[Models] Error unloading model ${data.modelName}:`, error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  );

  console.log("[IPC] Models handlers registered");
}
