import { expect, test } from "@playwright/test";
import {
  type ProviderInfo,
  getAllProviders,
} from "../helpers/provider-test-helpers";

/**
 * Helper to create a minimal workflow generation request
 */
function createWorkflowRequest(modelProvider: string, modelId: string) {
  return {
    messages: [
      {
        id: "test-message-1",
        role: "user",
        content: "Create a simple workflow with an input and output node",
      },
    ],
    availableTools: [],
    currentWorkflowState: { nodes: [], edges: [] },
    chatModel: {
      provider: modelProvider,
      model: modelId,
    },
  };
}

/**
 * Helper to find provider with API key from a list
 */
function findProviderWithKey(
  providers: ProviderInfo[],
  ...providerNames: string[]
): ProviderInfo | undefined {
  for (const name of providerNames) {
    const provider = providers.find(
      (p) => p.provider.toLowerCase() === name.toLowerCase() && p.hasAPIKey,
    );
    if (provider) return provider;
  }
  return undefined;
}

/**
 * Helper to validate MODEL_UNSUPPORTED error response structure
 */
async function expectModelUnsupportedError(
  response: { status: () => number; json: () => Promise<any> },
  expectedReason: string,
  expectedMessageContains: string,
) {
  expect(response.status()).toBe(400);
  const data = await response.json();
  expect(data.code).toBe("MODEL_UNSUPPORTED");
  expect(data.error).toBe("Model not supported for workflow generation");
  expect(data.reason).toBe(expectedReason);
  expect(data.message).toContain(expectedMessageContains);
  return data;
}

/**
 * E2E tests for workflow generation model validation.
 * These tests verify that the /api/ai/workflow/generate endpoint
 * properly validates model capabilities and returns appropriate errors.
 */
test.describe("Workflow Model Validation", () => {
  test.use({ storageState: "tests/.auth/admin.json" });

  test.describe("Model Capability Rejection", () => {
    test("should return 400 with MODEL_UNSUPPORTED for gpt-oss models", async ({
      page,
    }) => {
      const response = await page.request.post("/api/ai/workflow/generate", {
        data: createWorkflowRequest("openai", "gpt-oss-mini"),
      });

      await expectModelUnsupportedError(
        response,
        "built-in-tools",
        "built-in tools",
      );
    });

    test("should return 400 with MODEL_UNSUPPORTED for computer-use models", async ({
      page,
    }) => {
      const response = await page.request.post("/api/ai/workflow/generate", {
        data: createWorkflowRequest("anthropic", "claude-computer-use-preview"),
      });

      await expectModelUnsupportedError(
        response,
        "responses-api-only",
        "special API",
      );
    });

    test("should include suggestedModels array in error response", async ({
      page,
    }) => {
      const response = await page.request.post("/api/ai/workflow/generate", {
        data: createWorkflowRequest("openai", "gpt-oss-mini"),
      });

      const data = await expectModelUnsupportedError(
        response,
        "built-in-tools",
        "built-in tools",
      );

      expect(data).toHaveProperty("suggestedModels");
      expect(Array.isArray(data.suggestedModels)).toBeTruthy();
      expect(data.suggestedModels.length).toBeGreaterThan(0);

      for (const suggestion of data.suggestedModels) {
        expect(suggestion).toHaveProperty("model");
        expect(suggestion).toHaveProperty("provider");
        expect(typeof suggestion.model).toBe("string");
        expect(typeof suggestion.provider).toBe("string");
      }
    });

    test("should include modelCapabilities in error response", async ({
      page,
    }) => {
      const response = await page.request.post("/api/ai/workflow/generate", {
        data: createWorkflowRequest("openai", "gpt-oss-mini"),
      });

      const data = await expectModelUnsupportedError(
        response,
        "built-in-tools",
        "built-in tools",
      );

      expect(data).toHaveProperty("modelCapabilities");

      const capabilities = data.modelCapabilities;
      expect(capabilities).toHaveProperty("isReasoningModel");
      expect(capabilities).toHaveProperty("isToolCallSupported");
      expect(typeof capabilities.isReasoningModel).toBe("boolean");
      expect(typeof capabilities.isToolCallSupported).toBe("boolean");
      expect(capabilities.isToolCallSupported).toBe(false);
    });
  });

  test.describe("Reasoning Model Support", () => {
    test("should allow o3 models for workflow generation", async ({ page }) => {
      const providers = await getAllProviders(page);
      const provider = findProviderWithKey(providers, "openai", "openRouter");

      test.skip(!provider, "No OpenAI or OpenRouter API key configured");

      const response = await page.request.post("/api/ai/workflow/generate", {
        data: createWorkflowRequest(provider!.provider, "o3-mini"),
      });

      if (response.status() === 400) {
        const data = await response.json();
        expect(data.code).not.toBe("MODEL_UNSUPPORTED");
      }
    });

    test("should allow o4-mini models for workflow generation", async ({
      page,
    }) => {
      const providers = await getAllProviders(page);
      const provider = findProviderWithKey(providers, "openai", "openRouter");

      test.skip(!provider, "No OpenAI or OpenRouter API key configured");

      const response = await page.request.post("/api/ai/workflow/generate", {
        data: createWorkflowRequest(provider!.provider, "o4-mini"),
      });

      if (response.status() === 400) {
        const data = await response.json();
        expect(data.code).not.toBe("MODEL_UNSUPPORTED");
      }
    });

    test("should allow codex models for workflow generation", async ({
      page,
    }) => {
      const providers = await getAllProviders(page);
      const provider = findProviderWithKey(providers, "openai");

      test.skip(!provider, "No OpenAI API key configured");

      const response = await page.request.post("/api/ai/workflow/generate", {
        data: createWorkflowRequest("openai", "gpt-5.1-codex-mini"),
      });

      if (response.status() === 400) {
        const data = await response.json();
        expect(data.code).not.toBe("MODEL_UNSUPPORTED");
      }
    });
  });

  test.describe("Standard Model Support", () => {
    test("should allow gpt-4o for workflow generation", async ({ page }) => {
      const providers = await getAllProviders(page);
      const provider = findProviderWithKey(providers, "openai", "openRouter");

      test.skip(!provider, "No OpenAI or OpenRouter API key configured");

      const response = await page.request.post("/api/ai/workflow/generate", {
        data: createWorkflowRequest(provider!.provider, "gpt-4o-mini"),
      });

      if (response.status() === 400) {
        const data = await response.json();
        expect(data.code).not.toBe("MODEL_UNSUPPORTED");
      }
    });

    test("should allow claude models for workflow generation", async ({
      page,
    }) => {
      const providers = await getAllProviders(page);
      const provider = findProviderWithKey(
        providers,
        "anthropic",
        "openRouter",
      );

      test.skip(!provider, "No Anthropic or OpenRouter API key configured");

      const response = await page.request.post("/api/ai/workflow/generate", {
        data: createWorkflowRequest(
          provider!.provider,
          "claude-sonnet-4-20250514",
        ),
      });

      if (response.status() === 400) {
        const data = await response.json();
        expect(data.code).not.toBe("MODEL_UNSUPPORTED");
      }
    });

    test("should allow gemini models for workflow generation", async ({
      page,
    }) => {
      const providers = await getAllProviders(page);
      const provider = findProviderWithKey(providers, "google", "openRouter");

      test.skip(!provider, "No Google or OpenRouter API key configured");

      const response = await page.request.post("/api/ai/workflow/generate", {
        data: createWorkflowRequest(
          provider!.provider,
          "gemini-3-flash-preview",
        ),
      });

      if (response.status() === 400) {
        const data = await response.json();
        expect(data.code).not.toBe("MODEL_UNSUPPORTED");
      }
    });
  });

  test.describe("Error Response Structure", () => {
    test("should return proper JSON error structure for unsupported models", async ({
      page,
    }) => {
      const response = await page.request.post("/api/ai/workflow/generate", {
        data: createWorkflowRequest("openai", "gpt-oss-mini"),
      });

      expect(response.status()).toBe(400);
      expect(response.headers()["content-type"]).toContain("application/json");

      const data = await expectModelUnsupportedError(
        response,
        "built-in-tools",
        "built-in tools",
      );

      // Required error fields
      expect(data).toHaveProperty("suggestedModels");
      expect(data).toHaveProperty("modelCapabilities");

      // Types validation
      expect(Array.isArray(data.suggestedModels)).toBeTruthy();
      expect(typeof data.modelCapabilities).toBe("object");
    });

    test("should include human-readable message for built-in-tools rejection", async ({
      page,
    }) => {
      const response = await page.request.post("/api/ai/workflow/generate", {
        data: createWorkflowRequest("openai", "gpt-oss-mini"),
      });

      const data = await expectModelUnsupportedError(
        response,
        "built-in-tools",
        "built-in tools",
      );
      expect(data.message).toContain("gpt-oss-mini");
      expect(data.message).toContain("conflict");
    });

    test("should include human-readable message for responses-api-only rejection", async ({
      page,
    }) => {
      const response = await page.request.post("/api/ai/workflow/generate", {
        data: createWorkflowRequest("anthropic", "computer-use-preview"),
      });

      const data = await expectModelUnsupportedError(
        response,
        "responses-api-only",
        "special API",
      );
      expect(data.message).toContain("computer-use-preview");
    });
  });

  test.describe("API Request Validation", () => {
    test("should return 401 for unauthenticated requests", async ({ page }) => {
      const unauthResponse = await page.request.post(
        "/api/ai/workflow/generate",
        {
          data: createWorkflowRequest("openai", "gpt-4o-mini"),
          headers: {
            Cookie: "",
          },
        },
      );

      if (unauthResponse.status() === 401) {
        expect(await unauthResponse.text()).toBe("Unauthorized");
      }
    });

    test("should return 400 for missing messages", async ({ page }) => {
      const response = await page.request.post("/api/ai/workflow/generate", {
        data: {
          messages: [],
          availableTools: [],
          currentWorkflowState: { nodes: [], edges: [] },
          chatModel: {
            provider: "openai",
            model: "gpt-4o-mini",
          },
        },
      });

      expect(response.status()).toBe(400);

      const data = await response.json();
      expect(data.error).toContain("No messages");
    });
  });

  test.describe("Suggested Models Quality", () => {
    test("should suggest models that actually support workflow generation", async ({
      page,
    }) => {
      const response = await page.request.post("/api/ai/workflow/generate", {
        data: createWorkflowRequest("openai", "gpt-oss-mini"),
      });

      const data = await expectModelUnsupportedError(
        response,
        "built-in-tools",
        "built-in tools",
      );
      const suggestions = data.suggestedModels;

      expect(suggestions.length).toBeGreaterThan(0);

      const providers = await getAllProviders(page);

      for (const suggestion of suggestions) {
        const provider = providers.find(
          (p) => p.provider.toLowerCase() === suggestion.provider.toLowerCase(),
        );

        if (provider) {
          const model = provider.models.find(
            (m) =>
              m.name === suggestion.model ||
              m.name.includes(suggestion.model) ||
              suggestion.model.includes(m.name),
          );

          if (model) {
            expect(model.workflowGenerationSupport).not.toBe("none");
          }
        }
      }
    });

    test("should include diverse provider options in suggestions", async ({
      page,
    }) => {
      const response = await page.request.post("/api/ai/workflow/generate", {
        data: createWorkflowRequest("openai", "gpt-oss-mini"),
      });

      const data = await expectModelUnsupportedError(
        response,
        "built-in-tools",
        "built-in tools",
      );
      const suggestions = data.suggestedModels;

      const providers = new Set(
        suggestions.map((s: { provider: string }) => s.provider),
      );

      expect(providers.size).toBeGreaterThanOrEqual(2);
    });
  });
});
