import { expect, test } from "@playwright/test";
import { TEST_USERS } from "../constants/test-users";
import {
  cerebrasHasApiKey,
  getModelsForProvider,
  isCerebrasAvailable,
} from "../helpers/provider-test-helpers";

/**
 * E2E tests for Cerebras provider integration.
 * These tests verify that the Cerebras provider is properly integrated
 * and returns correct model information.
 */
test.describe("Cerebras Provider Integration", () => {
  test.use({ storageState: TEST_USERS.admin.authFile });

  test.describe("Provider Availability", () => {
    test("should include Cerebras in providers list", async ({ page }) => {
      const response = await page.request.get("/api/chat/models");
      expect(response.ok()).toBeTruthy();

      const data = await response.json();
      const providers = data.map((p: { provider: string }) => p.provider);

      // Cerebras should always be in the list (even without API key, uses fallback)
      expect(providers).toContain("cerebras");
    });

    test("should have Cerebras provider data structure", async ({ page }) => {
      const response = await page.request.get("/api/chat/models");
      const data = await response.json();

      const cerebras = data.find(
        (p: { provider: string }) => p.provider === "cerebras",
      );

      expect(cerebras).toBeDefined();
      expect(cerebras).toHaveProperty("provider", "cerebras");
      expect(cerebras).toHaveProperty("hasAPIKey");
      expect(cerebras).toHaveProperty("models");
      expect(Array.isArray(cerebras.models)).toBeTruthy();
    });
  });

  test.describe("Model Structure", () => {
    test("should return models with required fields", async ({ page }) => {
      const isAvailable = await isCerebrasAvailable(page);
      test.skip(!isAvailable, "Cerebras provider not available");

      const models = await getModelsForProvider(page, "cerebras");
      expect(models.length).toBeGreaterThan(0);

      for (const model of models) {
        // Required base fields
        expect(model).toHaveProperty("name");
        expect(model).toHaveProperty("displayName");
        expect(model).toHaveProperty("isToolCallUnsupported");
        expect(model).toHaveProperty("isImageInputUnsupported");
        expect(model).toHaveProperty("supportedFileMimeTypes");

        // New capability fields
        expect(model).toHaveProperty("isReasoningModel");
        expect(model).toHaveProperty("workflowGenerationSupport");

        // Type validation
        expect(typeof model.name).toBe("string");
        expect(typeof model.displayName).toBe("string");
        expect(typeof model.isToolCallUnsupported).toBe("boolean");
        expect(typeof model.isImageInputUnsupported).toBe("boolean");
        expect(Array.isArray(model.supportedFileMimeTypes)).toBeTruthy();
        expect(typeof model.isReasoningModel).toBe("boolean");
      }
    });

    test("should have proper display names for Cerebras models", async ({
      page,
    }) => {
      const isAvailable = await isCerebrasAvailable(page);
      test.skip(!isAvailable, "Cerebras provider not available");

      const models = await getModelsForProvider(page, "cerebras");

      for (const model of models) {
        // Display name should be human-readable
        expect(model.displayName.length).toBeGreaterThan(0);

        // Display name should be formatted (not just raw ID)
        // Cerebras display names typically include model family and size
        const isFormatted =
          model.displayName.includes(" ") ||
          /[A-Z]/.test(model.displayName) ||
          model.displayName !== model.name;

        expect(isFormatted).toBeTruthy();
      }
    });
  });

  test.describe("With API Key (Conditional)", () => {
    test("should indicate API key presence correctly", async ({ page }) => {
      const hasKey = await cerebrasHasApiKey(page);
      const response = await page.request.get("/api/chat/models");
      const data = await response.json();

      const cerebras = data.find(
        (p: { provider: string }) => p.provider === "cerebras",
      );

      // The hasAPIKey field should match whether we detected a key
      expect(cerebras.hasAPIKey).toBe(hasKey);
    });

    test("should return dynamic models when API key is present", async ({
      page,
    }) => {
      const hasKey = await cerebrasHasApiKey(page);
      test.skip(!hasKey, "No Cerebras API key configured");

      const models = await getModelsForProvider(page, "cerebras");

      // With API key, should have models from dynamic fetch
      expect(models.length).toBeGreaterThan(0);

      // Should include expected model families
      const modelNames = models.map((m) => m.name.toLowerCase());
      const hasExpectedModels =
        modelNames.some((n) => n.includes("llama")) ||
        modelNames.some((n) => n.includes("zai")) ||
        modelNames.some((n) => n.includes("qwen")) ||
        modelNames.some((n) => n.includes("gpt-oss"));

      expect(hasExpectedModels).toBeTruthy();
    });

    test("should include zai-glm models when available", async ({ page }) => {
      const hasKey = await cerebrasHasApiKey(page);
      test.skip(!hasKey, "No Cerebras API key configured");

      const models = await getModelsForProvider(page, "cerebras");
      const zaiModels = models.filter((m) =>
        m.name.toLowerCase().includes("zai"),
      );

      // ZAI-GLM models are Cerebras' flagship models
      // They may or may not be available depending on the API
      if (zaiModels.length > 0) {
        for (const model of zaiModels) {
          expect(model.displayName).toContain("ZAI");
        }
      }
    });
  });

  test.describe("Without API Key (Fallback)", () => {
    test("should have static fallback models when no API key", async ({
      page,
    }) => {
      // This test verifies fallback behavior
      // Even without API key, Cerebras should have fallback models
      const response = await page.request.get("/api/chat/models");
      const data = await response.json();

      const cerebras = data.find(
        (p: { provider: string }) => p.provider === "cerebras",
      );

      // Should always have at least some models (static fallback)
      expect(cerebras.models.length).toBeGreaterThan(0);
    });
  });

  test.describe("Model Capabilities", () => {
    test("should mark gpt-oss models as workflow unsupported", async ({
      page,
    }) => {
      const isAvailable = await isCerebrasAvailable(page);
      test.skip(!isAvailable, "Cerebras provider not available");

      const models = await getModelsForProvider(page, "cerebras");
      const gptOssModels = models.filter((m) =>
        m.name.toLowerCase().includes("gpt-oss"),
      );

      // gpt-oss models have built-in tools
      for (const model of gptOssModels) {
        expect(model.workflowGenerationSupport).toBe("none");
        expect(model.toolCallUnsupportedReason).toBe("built-in-tools");
        expect(model.isToolCallUnsupported).toBe(true);
      }
    });

    test("should have correct image input support", async ({ page }) => {
      const isAvailable = await isCerebrasAvailable(page);
      test.skip(!isAvailable, "Cerebras provider not available");

      const models = await getModelsForProvider(page, "cerebras");

      // Cerebras models are currently text-only
      for (const model of models) {
        expect(model.isImageInputUnsupported).toBe(true);
        expect(model.supportedFileMimeTypes).toEqual([]);
      }
    });

    test("should identify reasoning models correctly", async ({ page }) => {
      const isAvailable = await isCerebrasAvailable(page);
      test.skip(!isAvailable, "Cerebras provider not available");

      const models = await getModelsForProvider(page, "cerebras");

      for (const model of models) {
        const name = model.name.toLowerCase();

        // DeepSeek R1 and O-series are reasoning models
        const shouldBeReasoning =
          name.includes("deepseek-r1") ||
          /^o[134]/i.test(name) ||
          name.includes("codex");

        if (shouldBeReasoning) {
          expect(model.isReasoningModel).toBe(true);
        }
      }
    });

    test("should have standard Llama models support tools", async ({
      page,
    }) => {
      const isAvailable = await isCerebrasAvailable(page);
      test.skip(!isAvailable, "Cerebras provider not available");

      const models = await getModelsForProvider(page, "cerebras");
      const llamaModels = models.filter(
        (m) =>
          m.name.toLowerCase().includes("llama") &&
          !m.name.toLowerCase().includes("gpt-oss"),
      );

      // Standard Llama models should support tools
      for (const model of llamaModels) {
        // Unless specifically unsupported, Llama models support tools
        if (model.workflowGenerationSupport !== "none") {
          expect(model.isToolCallUnsupported).toBe(false);
        }
      }
    });
  });

  test.describe("Model Ordering", () => {
    test("should return models in priority order", async ({ page }) => {
      const hasKey = await cerebrasHasApiKey(page);
      test.skip(!hasKey, "No Cerebras API key configured");

      const models = await getModelsForProvider(page, "cerebras");

      // ZAI-GLM models should come first if available
      const firstModel = models[0];
      if (firstModel) {
        // First model should be one of the flagship models
        const isHighPriority =
          firstModel.name.toLowerCase().includes("zai") ||
          firstModel.name.toLowerCase().includes("llama-3.3") ||
          firstModel.name.toLowerCase().includes("gpt-oss");

        // This may vary based on availability, but high priority models should be first
        expect(isHighPriority || models.length === 1).toBeTruthy();
      }
    });
  });

  test.describe("Error Handling", () => {
    test("should handle API gracefully and return valid response", async ({
      page,
    }) => {
      // Even if Cerebras API has issues, endpoint should return valid response
      const response = await page.request.get("/api/chat/models");
      expect(response.ok()).toBeTruthy();

      const data = await response.json();
      expect(Array.isArray(data)).toBeTruthy();

      // Cerebras should be in the list with valid structure
      const cerebras = data.find(
        (p: { provider: string }) => p.provider === "cerebras",
      );
      expect(cerebras).toBeDefined();
      expect(Array.isArray(cerebras.models)).toBeTruthy();
    });
  });
});
