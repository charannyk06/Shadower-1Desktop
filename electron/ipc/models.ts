import { ipcMain, safeStorage } from "electron";
import { eq, and, desc } from "drizzle-orm";
import { getDatabase, schema } from "../services/database";
import { ElectronAuthService } from "../services/auth";

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
function encryptApiKey(key: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(key);
    return encrypted.toString("base64");
  }
  // Fallback: base64 encode (less secure but works when encryption unavailable)
  return Buffer.from(key).toString("base64");
}

// Decrypt API key
function decryptApiKey(encryptedKey: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    const buffer = Buffer.from(encryptedKey, "base64");
    return safeStorage.decryptString(buffer);
  }
  // Fallback: base64 decode
  return Buffer.from(encryptedKey, "base64").toString("utf-8");
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

export function registerModelsHandlers() {
  const db = getDatabase();
  const authService = ElectronAuthService.getInstance();

  // ========================================================================
  // Provider Configuration Handlers
  // ========================================================================

  // Get all provider configurations
  ipcMain.handle("models:getProviders", async () => {
    try {
      const user = await authService.getCurrentUser();
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
        const user = await authService.getCurrentUser();

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
  ipcMain.handle("models:deleteProvider", async (_event, id: string) => {
    try {
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
        const user = await authService.getCurrentUser();

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
      const user = await authService.getCurrentUser();
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
        const user = await authService.getCurrentUser();

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
      const user = await authService.getCurrentUser();

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
        const user = await authService.getCurrentUser();

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

  // ========================================================================
  // Local Model Handlers
  // ========================================================================

  // Get all local models
  ipcMain.handle("models:getLocalModels", async () => {
    try {
      const user = await authService.getCurrentUser();
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
        const user = await authService.getCurrentUser();

        const baseUrl =
          data.baseUrl ||
          (data.providerId === "ollama"
            ? "http://localhost:11434"
            : "http://localhost:1234/v1");

        const result = await fetchLocalModels(data.providerId, baseUrl);

        if (!result.success || !result.models) {
          return result;
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
            // Update existing
            await db
              .update(schema.LocalModelTable)
              .set({
                size: model.size,
                family: model.family,
                status: "available",
                updatedAt: new Date(),
              })
              .where(eq(schema.LocalModelTable.id, existing.id));
          } else {
            // Create new
            const isVision =
              model.name.includes("vision") || model.name.includes("llava");

            await db.insert(schema.LocalModelTable).values({
              name: model.name,
              displayName: formatModelDisplayName(model.name),
              providerId: data.providerId,
              size: model.size,
              family: model.family,
              status: "available",
              isVision,
              isToolCallSupported: true,
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

  // Download model via Ollama
  ipcMain.handle(
    "models:downloadModel",
    async (_event, data: { modelName: string; baseUrl?: string }) => {
      try {
        const user = await authService.getCurrentUser();
        const baseUrl = data.baseUrl || "http://localhost:11434";

        // Create model record with downloading status
        const [model] = await db
          .insert(schema.LocalModelTable)
          .values({
            name: data.modelName,
            displayName: formatModelDisplayName(data.modelName),
            providerId: "ollama",
            status: "downloading",
            downloadProgress: 0,
            isVision:
              data.modelName.includes("vision") ||
              data.modelName.includes("llava"),
            isToolCallSupported: true,
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
              updatedAt: new Date(),
            },
          })
          .returning();

        // Start download (non-blocking)
        const pullUrl = `${baseUrl.replace(/\/api$/, "")}/api/pull`;

        fetch(pullUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: data.modelName, stream: false }),
        })
          .then(async (response) => {
            if (response.ok) {
              // Update status to available
              await db
                .update(schema.LocalModelTable)
                .set({
                  status: "available",
                  downloadProgress: 100,
                  updatedAt: new Date(),
                })
                .where(eq(schema.LocalModelTable.id, model.id));
            } else {
              const error = await response.text();
              await db
                .update(schema.LocalModelTable)
                .set({
                  status: "error",
                  errorMessage: error,
                  updatedAt: new Date(),
                })
                .where(eq(schema.LocalModelTable.id, model.id));
            }
          })
          .catch(async (error) => {
            await db
              .update(schema.LocalModelTable)
              .set({
                status: "error",
                errorMessage:
                  error instanceof Error ? error.message : "Download failed",
                updatedAt: new Date(),
              })
              .where(eq(schema.LocalModelTable.id, model.id));
          });

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

  // Delete local model
  ipcMain.handle(
    "models:deleteLocalModel",
    async (
      _event,
      data: { id?: string; modelName?: string; providerId?: string },
    ) => {
      try {
        const user = await authService.getCurrentUser();

        if (data.id) {
          await db
            .delete(schema.LocalModelTable)
            .where(eq(schema.LocalModelTable.id, data.id));
        } else if (data.modelName && data.providerId) {
          await db
            .delete(schema.LocalModelTable)
            .where(
              and(
                eq(schema.LocalModelTable.userId, user.id),
                eq(schema.LocalModelTable.providerId, data.providerId),
                eq(schema.LocalModelTable.name, data.modelName),
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
  ipcMain.handle("models:getAvailableModels", async () => {
    try {
      const user = await authService.getCurrentUser();

      // Get providers with valid API keys
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

      // Get local models
      const localModels = await db
        .select()
        .from(schema.LocalModelTable)
        .where(
          and(
            eq(schema.LocalModelTable.userId, user.id),
            eq(schema.LocalModelTable.status, "available"),
          ),
        );

      return {
        cloudProviders: apiKeys.map((k) => k.providerId),
        providers,
        localModels,
      };
    } catch (error) {
      console.error("[IPC] Error getting available models:", error);
      throw error;
    }
  });

  // Get model status summary
  ipcMain.handle("models:getStatus", async () => {
    try {
      const user = await authService.getCurrentUser();

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

  console.log("[IPC] Models handlers registered");
}

// Helper function to format model display names
function formatModelDisplayName(name: string): string {
  return name
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/(\d+)b/gi, "$1B")
    .replace(/(\d+)k/gi, "$1K")
    .trim();
}
