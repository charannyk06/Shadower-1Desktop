import { describe, expect, it, vi } from "vitest";

// Mock server-only module before importing
vi.mock("server-only", () => ({}));

import {
  getModelCapabilities,
  getReasoningEffortLevels,
  getSuggestedWorkflowModels,
  getThinkingLevels,
  getWorkflowUnsupportedReason,
  hasBuiltInTools,
  isReasoningModel,
  isToolCallUnsupportedModel,
  requiresResponsesAPI,
  supportsImageInput,
  supportsNativeStructuredOutputs,
  supportsWorkflowGeneration,
} from "./capabilities";

describe("Model Pattern Detection", () => {
  describe("isReasoningModel", () => {
    it("should identify o1 models as reasoning", () => {
      expect(isReasoningModel("o1")).toBeTruthy();
      expect(isReasoningModel("o1-mini")).toBeTruthy();
      expect(isReasoningModel("o1-preview")).toBeTruthy();
    });

    it("should identify o3 models as reasoning", () => {
      expect(isReasoningModel("o3")).toBeTruthy();
      expect(isReasoningModel("o3-mini")).toBeTruthy();
    });

    it("should identify o4-mini as reasoning", () => {
      expect(isReasoningModel("o4-mini")).toBeTruthy();
    });

    it("should identify gpt-5 series as reasoning", () => {
      expect(isReasoningModel("gpt-5")).toBeTruthy();
      expect(isReasoningModel("gpt-5-turbo")).toBeTruthy();
    });

    it("should identify codex models as reasoning", () => {
      expect(isReasoningModel("gpt-5.1-codex-mini")).toBeTruthy();
      expect(isReasoningModel("codex")).toBeTruthy();
      expect(isReasoningModel("codex-mini")).toBeTruthy();
    });

    it("should identify deepseek-r1 as reasoning", () => {
      expect(isReasoningModel("deepseek-r1")).toBeTruthy();
      expect(isReasoningModel("deepseek-r1-distill")).toBeTruthy();
    });

    it("should handle case-insensitive matching", () => {
      expect(isReasoningModel("O3")).toBeTruthy();
      expect(isReasoningModel("O3-MINI")).toBeTruthy();
      expect(isReasoningModel("DeepSeek-R1")).toBeTruthy();
    });

    it("should not identify regular models as reasoning", () => {
      expect(isReasoningModel("gpt-4o")).toBeFalsy();
      expect(isReasoningModel("gpt-4o-mini")).toBeFalsy();
      expect(isReasoningModel("gpt-4-turbo")).toBeFalsy();
      expect(isReasoningModel("claude-sonnet-4")).toBeFalsy();
      expect(isReasoningModel("claude-3-opus")).toBeFalsy();
      expect(isReasoningModel("gemini-3-flash")).toBeFalsy();
      expect(isReasoningModel("gemini-2.5-pro")).toBeFalsy();
      expect(isReasoningModel("llama-3.3-70b")).toBeFalsy();
    });

    it("should handle provider-prefixed model names", () => {
      expect(isReasoningModel("openai/o3")).toBeTruthy();
      expect(isReasoningModel("openai/o3-mini")).toBeTruthy();
      expect(isReasoningModel("openrouter/deepseek-r1")).toBeTruthy();
    });
  });

  describe("hasBuiltInTools", () => {
    // NOTE: gpt-oss (open-weight local models) was intentionally removed from BUILT_IN_TOOL_PATTERNS
    // because open-weight local models DO support tool calling.
    // The "built-in tools" restriction only applies to certain cloud API models.
    it("should not flag gpt-oss models as having built-in tools (they support tool calling)", () => {
      // gpt-oss open-weight models CAN use custom tools
      expect(hasBuiltInTools("gpt-oss-120b")).toBeFalsy();
      expect(hasBuiltInTools("gpt-oss")).toBeFalsy();
      expect(hasBuiltInTools("GPT-OSS-120b")).toBeFalsy();
      expect(hasBuiltInTools("openai/gpt-oss-120b")).toBeFalsy();
      expect(hasBuiltInTools("cerebras/gpt-oss-120b")).toBeFalsy();
    });

    it("should not flag regular models", () => {
      expect(hasBuiltInTools("gpt-4o")).toBeFalsy();
      expect(hasBuiltInTools("gpt-4o-mini")).toBeFalsy();
      expect(hasBuiltInTools("claude-sonnet-4")).toBeFalsy();
      expect(hasBuiltInTools("gemini-3-flash")).toBeFalsy();
      expect(hasBuiltInTools("llama-3.3-70b")).toBeFalsy();
      expect(hasBuiltInTools("o3")).toBeFalsy();
    });
  });

  describe("requiresResponsesAPI", () => {
    it("should identify computer-use models", () => {
      expect(requiresResponsesAPI("computer-use-preview")).toBeTruthy();
      expect(requiresResponsesAPI("computer-use")).toBeTruthy();
    });

    it("should handle case-insensitive matching", () => {
      expect(requiresResponsesAPI("Computer-Use-Preview")).toBeTruthy();
      expect(requiresResponsesAPI("COMPUTER-USE")).toBeTruthy();
    });

    it("should handle provider-prefixed model names", () => {
      expect(requiresResponsesAPI("openai/computer-use-preview")).toBeTruthy();
    });

    it("should not flag codex models (they use standard API)", () => {
      expect(requiresResponsesAPI("gpt-5.1-codex-mini")).toBeFalsy();
      expect(requiresResponsesAPI("codex")).toBeFalsy();
    });

    it("should not flag regular models", () => {
      expect(requiresResponsesAPI("gpt-4o")).toBeFalsy();
      expect(requiresResponsesAPI("claude-sonnet-4")).toBeFalsy();
      expect(requiresResponsesAPI("gemini-3-flash")).toBeFalsy();
      expect(requiresResponsesAPI("o3")).toBeFalsy();
    });
  });

  describe("supportsImageInput", () => {
    it("should identify gpt-4o series as image-capable", () => {
      expect(supportsImageInput("gpt-4o")).toBeTruthy();
      expect(supportsImageInput("gpt-4o-mini")).toBeTruthy();
    });

    it("should identify gpt-4.1 series as image-capable", () => {
      expect(supportsImageInput("gpt-4.1")).toBeTruthy();
      expect(supportsImageInput("gpt-4.1-mini")).toBeTruthy();
    });

    it("should identify gpt-5 series as image-capable", () => {
      expect(supportsImageInput("gpt-5")).toBeTruthy();
      expect(supportsImageInput("gpt-5-turbo")).toBeTruthy();
    });

    it("should identify all Gemini models as image-capable", () => {
      expect(supportsImageInput("gemini-3-flash")).toBeTruthy();
      expect(supportsImageInput("gemini-3-pro")).toBeTruthy();
      expect(supportsImageInput("gemini-2.5-pro")).toBeTruthy();
      expect(supportsImageInput("gemini-2.0-flash")).toBeTruthy();
    });

    it("should identify all Claude models as image-capable", () => {
      expect(supportsImageInput("claude-sonnet-4")).toBeTruthy();
      expect(supportsImageInput("claude-opus-4")).toBeTruthy();
      expect(supportsImageInput("claude-3-opus")).toBeTruthy();
      expect(supportsImageInput("claude-3.5-sonnet")).toBeTruthy();
    });

    it("should identify Grok models as image-capable", () => {
      expect(supportsImageInput("grok-4")).toBeTruthy();
      expect(supportsImageInput("grok-2")).toBeTruthy();
    });

    it("should handle case-insensitive matching", () => {
      expect(supportsImageInput("GPT-4O")).toBeTruthy();
      expect(supportsImageInput("GEMINI-3-FLASH")).toBeTruthy();
      expect(supportsImageInput("CLAUDE-SONNET-4")).toBeTruthy();
    });

    it("should not flag text-only models", () => {
      expect(supportsImageInput("llama-3.3-70b")).toBeFalsy();
      expect(supportsImageInput("mistral-large")).toBeFalsy();
      expect(supportsImageInput("qwen-3-32b")).toBeFalsy();
    });
  });

  describe("supportsNativeStructuredOutputs", () => {
    it("should identify Claude models as supporting structured outputs", () => {
      expect(supportsNativeStructuredOutputs("claude-sonnet-4")).toBeTruthy();
      expect(supportsNativeStructuredOutputs("claude-opus-4")).toBeTruthy();
      expect(supportsNativeStructuredOutputs("claude-3-opus")).toBeTruthy();
    });

    it("should identify Anthropic models as supporting structured outputs", () => {
      expect(
        supportsNativeStructuredOutputs("anthropic/claude-sonnet"),
      ).toBeTruthy();
    });

    it("should identify Gemini 2 and 3 series as supporting structured outputs", () => {
      expect(supportsNativeStructuredOutputs("gemini-2.5-pro")).toBeTruthy();
      expect(supportsNativeStructuredOutputs("gemini-2.0-flash")).toBeTruthy();
      expect(supportsNativeStructuredOutputs("gemini-3-flash")).toBeTruthy();
      expect(supportsNativeStructuredOutputs("gemini-3-pro")).toBeTruthy();
    });

    it("should handle case-insensitive matching", () => {
      expect(supportsNativeStructuredOutputs("CLAUDE-SONNET-4")).toBeTruthy();
      expect(supportsNativeStructuredOutputs("GEMINI-3-FLASH")).toBeTruthy();
    });

    it("should not flag models without native structured output support", () => {
      expect(supportsNativeStructuredOutputs("gpt-4o")).toBeFalsy();
      expect(supportsNativeStructuredOutputs("gpt-4o-mini")).toBeFalsy();
      expect(supportsNativeStructuredOutputs("llama-3.3-70b")).toBeFalsy();
      expect(supportsNativeStructuredOutputs("o3")).toBeFalsy();
    });

    it("should not flag Gemini 1.x series", () => {
      expect(supportsNativeStructuredOutputs("gemini-1.5-pro")).toBeFalsy();
      expect(supportsNativeStructuredOutputs("gemini-1.0-pro")).toBeFalsy();
    });
  });
});

describe("Reasoning Effort Levels", () => {
  it("should return effort levels for o3 models", () => {
    const levels = getReasoningEffortLevels("o3");
    expect(levels).toEqual([
      "none",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
  });

  it("should return effort levels for o3-mini", () => {
    const levels = getReasoningEffortLevels("o3-mini");
    expect(levels).toEqual(["none", "low", "medium", "high"]);
  });

  it("should return effort levels for o4-mini", () => {
    const levels = getReasoningEffortLevels("o4-mini");
    expect(levels).toEqual(["none", "low", "medium", "high"]);
  });

  it("should return effort levels for gpt-5.1-codex-mini", () => {
    const levels = getReasoningEffortLevels("gpt-5.1-codex-mini");
    expect(levels).toEqual(["low", "medium", "high"]);
  });

  it("should handle case-insensitive matching", () => {
    expect(getReasoningEffortLevels("O3")).toEqual([
      "none",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
    expect(getReasoningEffortLevels("O3-MINI")).toEqual([
      "none",
      "low",
      "medium",
      "high",
    ]);
  });

  it("should handle provider-prefixed model names", () => {
    expect(getReasoningEffortLevels("openai/o3")).toEqual([
      "none",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
    expect(getReasoningEffortLevels("openrouter/o3-mini")).toEqual([
      "none",
      "low",
      "medium",
      "high",
    ]);
  });

  it("should return undefined for non-reasoning models", () => {
    expect(getReasoningEffortLevels("gpt-4o")).toBeUndefined();
    expect(getReasoningEffortLevels("claude-sonnet-4")).toBeUndefined();
    expect(getReasoningEffortLevels("gemini-3-flash")).toBeUndefined();
  });

  it("should return undefined for reasoning models without effort levels", () => {
    // o1 is a reasoning model but doesn't have configurable effort levels in the config
    expect(getReasoningEffortLevels("o1")).toBeUndefined();
  });
});

describe("Thinking Levels", () => {
  it("should return thinking levels for Gemini 3 Pro Preview", () => {
    const levels = getThinkingLevels("gemini-3-pro-preview");
    expect(levels).toEqual(["none", "low", "medium", "high"]);
  });

  it("should return thinking levels for Gemini 3 Flash Preview", () => {
    const levels = getThinkingLevels("gemini-3-flash-preview");
    expect(levels).toEqual(["none", "low", "medium"]);
  });

  it("should return thinking levels for Gemini 2.5 Pro", () => {
    const levels = getThinkingLevels("gemini-2.5-pro");
    expect(levels).toEqual(["none", "low", "medium", "high"]);
  });

  it("should return thinking levels for Claude Opus 4.5", () => {
    const levels = getThinkingLevels("claude-opus-4-5-20251101");
    expect(levels).toEqual(["none", "medium", "high"]);
  });

  it("should return thinking levels for Claude Sonnet 4.5", () => {
    const levels = getThinkingLevels("claude-sonnet-4-5-20250929");
    expect(levels).toEqual(["none", "low", "medium"]);
  });

  it("should handle case-insensitive matching", () => {
    expect(getThinkingLevels("GEMINI-3-PRO-PREVIEW")).toEqual([
      "none",
      "low",
      "medium",
      "high",
    ]);
  });

  it("should handle provider-prefixed model names", () => {
    expect(getThinkingLevels("google/gemini-3-pro-preview")).toEqual([
      "none",
      "low",
      "medium",
      "high",
    ]);
    expect(getThinkingLevels("anthropic/claude-opus-4-5-20251101")).toEqual([
      "none",
      "medium",
      "high",
    ]);
  });

  it("should return undefined for non-thinking models", () => {
    expect(getThinkingLevels("gpt-4o")).toBeUndefined();
    expect(getThinkingLevels("o3")).toBeUndefined();
    expect(getThinkingLevels("llama-3.3-70b")).toBeUndefined();
  });

  it("should return undefined for older Gemini models without thinking", () => {
    expect(getThinkingLevels("gemini-1.5-pro")).toBeUndefined();
    expect(getThinkingLevels("gemini-2.0-flash")).toBeUndefined();
  });
});

describe("getModelCapabilities", () => {
  describe("Standard models", () => {
    it("should return full capabilities for gpt-4o", () => {
      const caps = getModelCapabilities("gpt-4o");

      expect(caps.isReasoningModel).toBeFalsy();
      expect(caps.isToolCallSupported).toBeTruthy();
      expect(caps.isImageInputSupported).toBeTruthy();
      expect(caps.workflowGenerationSupport).toBe("full");
      expect(caps.toolCallUnsupportedReason).toBeUndefined();
      expect(caps.requiresResponsesAPI).toBeFalsy();
      expect(caps.nativeStructuredOutputs).toBeFalsy();
      expect(caps.reasoningEffort).toBeUndefined();
      expect(caps.thinkingLevel).toBeUndefined();
    });

    it("should return full capabilities for claude-sonnet-4", () => {
      const caps = getModelCapabilities("claude-sonnet-4");

      expect(caps.isReasoningModel).toBeFalsy();
      expect(caps.isToolCallSupported).toBeTruthy();
      expect(caps.isImageInputSupported).toBeTruthy();
      expect(caps.workflowGenerationSupport).toBe("full");
      expect(caps.nativeStructuredOutputs).toBeTruthy();
    });

    it("should return full capabilities for gemini-3-flash", () => {
      const caps = getModelCapabilities("gemini-3-flash");

      expect(caps.isReasoningModel).toBeFalsy();
      expect(caps.isToolCallSupported).toBeTruthy();
      expect(caps.isImageInputSupported).toBeTruthy();
      expect(caps.workflowGenerationSupport).toBe("full");
      expect(caps.nativeStructuredOutputs).toBeTruthy();
    });
  });

  describe("Reasoning models", () => {
    it("should correctly identify o3 with full tool support", () => {
      const caps = getModelCapabilities("o3");

      expect(caps.isReasoningModel).toBeTruthy();
      expect(caps.isToolCallSupported).toBeTruthy(); // Reasoning models CAN use tools
      expect(caps.workflowGenerationSupport).toBe("full");
      expect(caps.reasoningEffort).toEqual([
        "none",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
      ]);
      expect(caps.toolCallUnsupportedReason).toBeUndefined();
    });

    it("should correctly identify o4-mini with full tool support", () => {
      const caps = getModelCapabilities("o4-mini");

      expect(caps.isReasoningModel).toBeTruthy();
      expect(caps.isToolCallSupported).toBeTruthy();
      expect(caps.workflowGenerationSupport).toBe("full");
      expect(caps.reasoningEffort).toEqual(["none", "low", "medium", "high"]);
    });

    it("should correctly identify deepseek-r1", () => {
      const caps = getModelCapabilities("deepseek-r1");

      expect(caps.isReasoningModel).toBeTruthy();
      expect(caps.isToolCallSupported).toBeTruthy();
      expect(caps.workflowGenerationSupport).toBe("full");
    });
  });

  describe("Open-weight local models (gpt-oss)", () => {
    // NOTE: gpt-oss open-weight local models SUPPORT tool calling
    // Unlike the cloud API versions, local models can use custom tools
    it("should support tool calling for gpt-oss models", () => {
      const caps = getModelCapabilities("gpt-oss-120b");

      expect(caps.isToolCallSupported).toBeTruthy();
      expect(caps.workflowGenerationSupport).toBe("full");
      expect(caps.toolCallUnsupportedReason).toBeUndefined();
    });

    it("should handle provider-prefixed gpt-oss with tool support", () => {
      const caps = getModelCapabilities("cerebras/gpt-oss-120b");

      expect(caps.isToolCallSupported).toBeTruthy();
      expect(caps.workflowGenerationSupport).toBe("full");
      expect(caps.toolCallUnsupportedReason).toBeUndefined();
    });
  });

  describe("Models requiring Responses API", () => {
    it("should block computer-use models from standard tool calling", () => {
      const caps = getModelCapabilities("computer-use-preview");

      expect(caps.isToolCallSupported).toBeFalsy();
      expect(caps.requiresResponsesAPI).toBeTruthy();
      expect(caps.workflowGenerationSupport).toBe("none");
      expect(caps.toolCallUnsupportedReason).toBe("responses-api-only");
    });
  });

  describe("Thinking-capable models", () => {
    it("should include thinking levels for gemini-3-pro-preview", () => {
      const caps = getModelCapabilities("gemini-3-pro-preview");

      expect(caps.thinkingLevel).toEqual(["none", "low", "medium", "high"]);
      expect(caps.isToolCallSupported).toBeTruthy();
      expect(caps.nativeStructuredOutputs).toBeTruthy();
    });

    it("should include thinking levels for claude-opus-4-5-20251101", () => {
      const caps = getModelCapabilities("claude-opus-4-5-20251101");

      expect(caps.thinkingLevel).toEqual(["none", "medium", "high"]);
      expect(caps.isToolCallSupported).toBeTruthy();
      expect(caps.nativeStructuredOutputs).toBeTruthy();
    });
  });
});

describe("Convenience Functions", () => {
  describe("supportsWorkflowGeneration", () => {
    it("should return true for capable models", () => {
      expect(supportsWorkflowGeneration("gpt-4o")).toBeTruthy();
      expect(supportsWorkflowGeneration("gpt-4o-mini")).toBeTruthy();
      expect(supportsWorkflowGeneration("claude-sonnet-4")).toBeTruthy();
      expect(supportsWorkflowGeneration("gemini-3-flash")).toBeTruthy();
      expect(supportsWorkflowGeneration("o3")).toBeTruthy();
      expect(supportsWorkflowGeneration("o4-mini")).toBeTruthy();
    });

    it("should return false for unsupported models", () => {
      // gpt-oss now supports workflow generation (open-weight local models support tools)
      expect(supportsWorkflowGeneration("gpt-oss-120b")).toBeTruthy();
      // computer-use still requires Responses API
      expect(supportsWorkflowGeneration("computer-use-preview")).toBeFalsy();
    });
  });

  describe("isToolCallUnsupportedModel", () => {
    it("should return false for supported models", () => {
      expect(isToolCallUnsupportedModel("gpt-4o")).toBeFalsy();
      expect(isToolCallUnsupportedModel("claude-sonnet-4")).toBeFalsy();
      expect(isToolCallUnsupportedModel("o3")).toBeFalsy();
    });

    it("should return true for unsupported models", () => {
      // gpt-oss now supports tool calling (open-weight local models)
      expect(isToolCallUnsupportedModel("gpt-oss-120b")).toBeFalsy();
      // computer-use still requires Responses API and doesn't support standard tool calling
      expect(isToolCallUnsupportedModel("computer-use-preview")).toBeTruthy();
    });
  });

  describe("getWorkflowUnsupportedReason", () => {
    it("should return null for supported models", () => {
      expect(getWorkflowUnsupportedReason("gpt-4o")).toBeNull();
      expect(getWorkflowUnsupportedReason("claude-sonnet-4")).toBeNull();
      expect(getWorkflowUnsupportedReason("o3")).toBeNull();
    });

    it("should return null for gpt-oss (now supports tools)", () => {
      // gpt-oss open-weight models now support tool calling
      const reason = getWorkflowUnsupportedReason("gpt-oss-120b");
      expect(reason).toBeNull();
    });

    it("should return reason for Responses API models", () => {
      const reason = getWorkflowUnsupportedReason("computer-use-preview");
      expect(reason).not.toBeNull();
      expect(reason).toContain("special API");
    });
  });

  describe("getSuggestedWorkflowModels", () => {
    it("should return array of suggested models", () => {
      const suggested = getSuggestedWorkflowModels();

      expect(Array.isArray(suggested)).toBeTruthy();
      expect(suggested.length).toBeGreaterThan(0);
    });

    it("should return models with required properties", () => {
      const suggested = getSuggestedWorkflowModels();

      for (const model of suggested) {
        expect(model).toHaveProperty("model");
        expect(model).toHaveProperty("provider");
        expect(typeof model.model).toBe("string");
        expect(typeof model.provider).toBe("string");
      }
    });

    it("should only suggest workflow-capable models", () => {
      const suggested = getSuggestedWorkflowModels();

      for (const { model } of suggested) {
        expect(supportsWorkflowGeneration(model)).toBeTruthy();
      }
    });
  });
});

describe("Edge Cases", () => {
  it("should handle empty string", () => {
    const caps = getModelCapabilities("");

    expect(caps.isReasoningModel).toBeFalsy();
    expect(caps.isToolCallSupported).toBeTruthy();
    expect(caps.workflowGenerationSupport).toBe("full");
  });

  it("should handle unknown model names", () => {
    const caps = getModelCapabilities("totally-unknown-model-xyz");

    expect(caps.isReasoningModel).toBeFalsy();
    expect(caps.isToolCallSupported).toBeTruthy();
    expect(caps.workflowGenerationSupport).toBe("full");
  });

  it("should handle models with special characters", () => {
    const caps = getModelCapabilities("model/with/slashes");
    expect(caps).toBeDefined();
  });

  it("should handle very long model names", () => {
    const longName = "a".repeat(1000);
    const caps = getModelCapabilities(longName);
    expect(caps).toBeDefined();
  });
});
