import { expect, test } from "@playwright/test";
import {
  ModelInfo,
  combineFilters,
  getAllModels,
  getAllProviders,
  getModelsMatching,
  modelFilters,
  notFilter,
} from "../helpers/provider-test-helpers";

/**
 * E2E tests for enhanced model capabilities via the /api/chat/models endpoint.
 * These tests verify that the new capability fields introduced in the new-feature branch
 * are properly returned and have correct values.
 */
test.describe("Model Capabilities API", () => {
  test.use({ storageState: "tests/.auth/admin.json" });

  test.describe("Capability Fields Structure", () => {
    test("should return workflowGenerationSupport field for all models", async ({
      page,
    }) => {
      const providers = await getAllProviders(page);
      expect(providers.length).toBeGreaterThan(0);

      for (const provider of providers) {
        for (const model of provider.models) {
          expect(model).toHaveProperty("workflowGenerationSupport");
          expect(["full", "limited", "none"]).toContain(
            model.workflowGenerationSupport,
          );
        }
      }
    });

    test("should return isReasoningModel flag for all models", async ({
      page,
    }) => {
      const models = await getAllModels(page);

      for (const model of models) {
        expect(model).toHaveProperty("isReasoningModel");
        expect(typeof model.isReasoningModel).toBe("boolean");
      }
    });

    test("should return consistent capability structure for all models", async ({
      page,
    }) => {
      const providers = await getAllProviders(page);

      for (const provider of providers) {
        expect(provider).toHaveProperty("provider");
        expect(provider).toHaveProperty("hasAPIKey");
        expect(provider).toHaveProperty("models");

        for (const model of provider.models) {
          // Required fields
          expect(model).toHaveProperty("name");
          expect(model).toHaveProperty("displayName");
          expect(model).toHaveProperty("isToolCallUnsupported");
          expect(model).toHaveProperty("isImageInputUnsupported");
          expect(model).toHaveProperty("supportedFileMimeTypes");

          // New capability fields
          expect(model).toHaveProperty("isReasoningModel");
          expect(model).toHaveProperty("workflowGenerationSupport");

          // Optional fields should be undefined or have correct type
          if (model.toolCallUnsupportedReason !== undefined) {
            expect([
              "reasoning-model",
              "built-in-tools",
              "responses-api-only",
            ]).toContain(model.toolCallUnsupportedReason);
          }

          if (model.reasoningEffort !== undefined) {
            expect(Array.isArray(model.reasoningEffort)).toBeTruthy();
          }

          if (model.thinkingLevel !== undefined) {
            expect(Array.isArray(model.thinkingLevel)).toBeTruthy();
          }
        }
      }
    });
  });

  test.describe("Reasoning Model Detection", () => {
    test("should identify o-series models as reasoning models", async ({
      page,
    }) => {
      const oSeriesModels = await getModelsMatching(
        page,
        modelFilters.byRegex(/^o[134]/i),
      );

      for (const model of oSeriesModels) {
        expect(model.isReasoningModel).toBe(true);
      }
    });

    test("should identify codex models as reasoning models", async ({
      page,
    }) => {
      const codexModels = await getModelsMatching(page, modelFilters.codex);

      for (const model of codexModels) {
        expect(model.isReasoningModel).toBe(true);
      }
    });

    test("should identify deepseek-r1 as a reasoning model", async ({
      page,
    }) => {
      const deepseekR1Models = await getModelsMatching(
        page,
        modelFilters.deepseekR1,
      );

      for (const model of deepseekR1Models) {
        expect(model.isReasoningModel).toBe(true);
      }
    });

    test("should NOT mark standard GPT models as reasoning models", async ({
      page,
    }) => {
      const standardGptModels = await getModelsMatching(
        page,
        modelFilters.standardGpt4o,
      );

      for (const model of standardGptModels) {
        expect(model.isReasoningModel).toBe(false);
      }
    });
  });

  test.describe("Reasoning Effort Configuration", () => {
    test("should return reasoningEffort array for o3/o4 models", async ({
      page,
    }) => {
      const o3o4Models = await getModelsMatching(page, modelFilters.o3o4);

      for (const model of o3o4Models) {
        if (model.reasoningEffort) {
          expect(Array.isArray(model.reasoningEffort)).toBeTruthy();
          expect(model.reasoningEffort.length).toBeGreaterThan(0);

          const validEfforts = [
            "none",
            "minimal",
            "low",
            "medium",
            "high",
            "xhigh",
          ];
          for (const effort of model.reasoningEffort) {
            expect(validEfforts).toContain(effort);
          }
        }
      }
    });

    test("should NOT return reasoningEffort for standard models", async ({
      page,
    }) => {
      const standardModels = await getModelsMatching(
        page,
        combineFilters(
          (m: ModelInfo) =>
            m.name.toLowerCase().includes("gpt-4o") ||
            m.name.toLowerCase().includes("gpt-4.1"),
          notFilter(modelFilters.o3o4),
          notFilter(modelFilters.codex),
        ),
      );

      for (const model of standardModels) {
        expect(model.reasoningEffort).toBeUndefined();
      }
    });
  });

  test.describe("Thinking Level Configuration", () => {
    test("should return thinkingLevel array for supported models", async ({
      page,
    }) => {
      const thinkingModels = await getModelsMatching(
        page,
        (m: ModelInfo) =>
          modelFilters.geminiThinking(m) || modelFilters.claudeThinking(m),
      );

      for (const model of thinkingModels) {
        if (model.thinkingLevel) {
          expect(Array.isArray(model.thinkingLevel)).toBeTruthy();
          expect(model.thinkingLevel.length).toBeGreaterThan(0);

          const validLevels = ["none", "low", "medium", "high"];
          for (const level of model.thinkingLevel) {
            expect(validLevels).toContain(level);
          }
        }
      }
    });
  });

  test.describe("Workflow Generation Support", () => {
    test("should mark gpt-oss models as workflow unsupported", async ({
      page,
    }) => {
      const gptOssModels = await getModelsMatching(page, modelFilters.gptOss);

      for (const model of gptOssModels) {
        expect(model.workflowGenerationSupport).toBe("none");
        expect(model.toolCallUnsupportedReason).toBe("built-in-tools");
      }
    });

    test("should mark computer-use models as workflow unsupported", async ({
      page,
    }) => {
      const computerUseModels = await getModelsMatching(
        page,
        modelFilters.computerUse,
      );

      for (const model of computerUseModels) {
        expect(model.workflowGenerationSupport).toBe("none");
        expect(model.toolCallUnsupportedReason).toBe("responses-api-only");
      }
    });

    test("should allow reasoning models for workflow generation", async ({
      page,
    }) => {
      const reasoningModelsForWorkflow = await getModelsMatching(
        page,
        combineFilters(
          modelFilters.reasoning,
          notFilter(modelFilters.gptOss),
          notFilter(modelFilters.computerUse),
        ),
      );

      for (const model of reasoningModelsForWorkflow) {
        expect(model.workflowGenerationSupport).not.toBe("none");
      }
    });

    test("should support workflow generation for standard tool-capable models", async ({
      page,
    }) => {
      const standardModels = await getModelsMatching(
        page,
        combineFilters(
          (m: ModelInfo) =>
            m.name.toLowerCase().includes("gpt-4o") ||
            m.name.toLowerCase().includes("claude") ||
            m.name.toLowerCase().includes("gemini"),
          notFilter(modelFilters.gptOss),
          notFilter(modelFilters.computerUse),
        ),
      );

      for (const model of standardModels) {
        if (!model.isToolCallUnsupported) {
          expect(model.workflowGenerationSupport).toBe("full");
        }
      }
    });
  });

  test.describe("Tool Call Support Consistency", () => {
    test("should have consistent isToolCallUnsupported and toolCallUnsupportedReason", async ({
      page,
    }) => {
      const models = await getAllModels(page);

      for (const model of models) {
        if (model.isToolCallUnsupported && model.toolCallUnsupportedReason) {
          expect([
            "reasoning-model",
            "built-in-tools",
            "responses-api-only",
          ]).toContain(model.toolCallUnsupportedReason);
        }
      }
    });

    test("should have toolCallUnsupportedReason when workflowGenerationSupport is none", async ({
      page,
    }) => {
      const noWorkflowModels = await getModelsMatching(
        page,
        modelFilters.workflowUnsupported,
      );

      for (const model of noWorkflowModels) {
        expect(model.toolCallUnsupportedReason).toBeDefined();
        expect([
          "reasoning-model",
          "built-in-tools",
          "responses-api-only",
        ]).toContain(model.toolCallUnsupportedReason);
      }
    });
  });

  test.describe("Provider Coverage", () => {
    test("should include Cerebras in providers list", async ({ page }) => {
      const providers = await getAllProviders(page);
      const providerNames = providers.map((p) => p.provider);

      expect(providerNames).toContain("cerebras");
    });

    test("should return capabilities for all known providers", async ({
      page,
    }) => {
      const providers = await getAllProviders(page);
      const expectedProviders = [
        "openai",
        "anthropic",
        "google",
        "groq",
        "xai",
        "openRouter",
        "ollama",
        "cerebras",
      ];

      const returnedProviders = providers.map((p) => p.provider.toLowerCase());

      for (const expected of expectedProviders) {
        const found = returnedProviders.some(
          (p) => p.toLowerCase() === expected.toLowerCase(),
        );
        expect(found).toBeTruthy();
      }
    });

    test("should return models with capability fields for each provider", async ({
      page,
    }) => {
      const providers = await getAllProviders(page);

      for (const provider of providers) {
        expect(provider.models.length).toBeGreaterThan(0);

        const firstModel = provider.models[0];
        expect(firstModel).toHaveProperty("isReasoningModel");
        expect(firstModel).toHaveProperty("workflowGenerationSupport");
      }
    });
  });
});
