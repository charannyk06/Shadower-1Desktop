import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock server-only before importing the module
vi.mock("server-only", () => ({}));

// Mock logger
vi.mock("logger", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock capabilities
vi.mock("../../providers/capabilities", () => ({
  getModelCapabilities: vi.fn((modelId: string) => {
    const isGptOss = modelId.toLowerCase().includes("gpt-oss");
    return {
      isToolCallSupported: !isGptOss,
      isImageInputSupported: false,
      isReasoningModel: false,
      reasoningEffort: undefined,
      thinkingLevel: undefined,
      nativeStructuredOutputs: false,
      workflowGenerationSupport: isGptOss ? "none" : "full",
      toolCallUnsupportedReason: isGptOss ? "built-in-tools" : undefined,
    };
  }),
}));

// Mock display names
vi.mock("../display-names", () => ({
  formatCerebrasDisplayName: vi.fn((id: string) => {
    // Simple mock formatting
    return id
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }),
}));

describe("Cerebras Fetcher", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe("fetchCerebrasModels", () => {
    it("should return empty array when no API key is set", async () => {
      delete process.env.CEREBRAS_API_KEY;

      const { fetchCerebrasModels } = await import("./cerebras");
      const models = await fetchCerebrasModels(5000);

      expect(models).toEqual([]);
    });

    it("should return empty array when API key is placeholder", async () => {
      process.env.CEREBRAS_API_KEY = "****";

      const { fetchCerebrasModels } = await import("./cerebras");
      const models = await fetchCerebrasModels(5000);

      expect(models).toEqual([]);
    });

    it("should fetch models when API key is valid", async () => {
      process.env.CEREBRAS_API_KEY = "valid-api-key";

      // Mock successful fetch response
      const mockModels = {
        data: [
          { id: "llama-3.3-70b", created: 1700000000, context_window: 8192 },
          { id: "zai-glm-4.7", created: 1700000001, context_window: 32768 },
        ],
      };

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockModels),
        }),
      );

      const { fetchCerebrasModels } = await import("./cerebras");
      const models = await fetchCerebrasModels(5000);

      expect(models.length).toBe(2);
      expect(models[0]).toHaveProperty("id");
      expect(models[0]).toHaveProperty("name");
      expect(models[0]).toHaveProperty("isToolCallSupported");
    });

    it("should filter out non-chat models", async () => {
      process.env.CEREBRAS_API_KEY = "valid-api-key";

      const mockModels = {
        data: [
          { id: "llama-3.3-70b", created: 1700000000 },
          { id: "embed-model-v1", created: 1700000001 }, // Should be filtered
          { id: "whisper-large", created: 1700000002 }, // Should be filtered
          { id: "zai-glm-4.6", created: 1700000003 },
        ],
      };

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockModels),
        }),
      );

      const { fetchCerebrasModels } = await import("./cerebras");
      const models = await fetchCerebrasModels(5000);

      // Only chat models should be returned
      expect(models.length).toBe(2);
      expect(models.every((m) => !m.id.toLowerCase().includes("embed"))).toBe(
        true,
      );
      expect(models.every((m) => !m.id.toLowerCase().includes("whisper"))).toBe(
        true,
      );
    });

    it("should return proper DynamicModelInfo structure", async () => {
      process.env.CEREBRAS_API_KEY = "valid-api-key";

      const mockModels = {
        data: [
          { id: "llama-3.3-70b", created: 1700000000, context_window: 8192 },
        ],
      };

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockModels),
        }),
      );

      const { fetchCerebrasModels } = await import("./cerebras");
      const models = await fetchCerebrasModels(5000);

      expect(models.length).toBe(1);
      const model = models[0];

      // Verify required fields
      expect(model).toHaveProperty("id", "llama-3.3-70b");
      expect(model).toHaveProperty("name");
      expect(model).toHaveProperty("contextWindow", 8192);
      expect(model).toHaveProperty("isToolCallSupported");
      expect(model).toHaveProperty("isImageInputSupported");
      expect(model).toHaveProperty("isReasoningModel");
      expect(model).toHaveProperty("workflowGenerationSupport");
      expect(model).toHaveProperty("supportedFileMimeTypes");

      // Cerebras models are text-only
      expect(model.supportedFileMimeTypes).toEqual([]);
    });

    it("should mark gpt-oss models as tool-unsupported", async () => {
      process.env.CEREBRAS_API_KEY = "valid-api-key";

      const mockModels = {
        data: [
          { id: "gpt-oss-120b", created: 1700000000 },
          { id: "llama-3.3-70b", created: 1700000001 },
        ],
      };

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockModels),
        }),
      );

      const { fetchCerebrasModels } = await import("./cerebras");
      const models = await fetchCerebrasModels(5000);

      const gptOss = models.find((m) => m.id.includes("gpt-oss"));
      const llama = models.find((m) => m.id.includes("llama"));

      expect(gptOss?.isToolCallSupported).toBe(false);
      expect(gptOss?.workflowGenerationSupport).toBe("none");
      expect(gptOss?.toolCallUnsupportedReason).toBe("built-in-tools");

      expect(llama?.isToolCallSupported).toBe(true);
      expect(llama?.workflowGenerationSupport).toBe("full");
    });

    it("should return empty array on API error", async () => {
      process.env.CEREBRAS_API_KEY = "valid-api-key";

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
        }),
      );

      const { fetchCerebrasModels } = await import("./cerebras");
      const models = await fetchCerebrasModels(5000);

      expect(models).toEqual([]);
    });

    it("should return empty array on fetch timeout", async () => {
      process.env.CEREBRAS_API_KEY = "valid-api-key";

      // Mock fetch that throws abort error
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockRejectedValue(
            Object.assign(new Error("Aborted"), { name: "AbortError" }),
          ),
      );

      const { fetchCerebrasModels } = await import("./cerebras");
      const models = await fetchCerebrasModels(100); // Very short timeout

      expect(models).toEqual([]);
    });

    it("should return empty array on network error", async () => {
      process.env.CEREBRAS_API_KEY = "valid-api-key";

      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new Error("Network error")),
      );

      const { fetchCerebrasModels } = await import("./cerebras");
      const models = await fetchCerebrasModels(5000);

      expect(models).toEqual([]);
    });

    it("should sort models by priority", async () => {
      process.env.CEREBRAS_API_KEY = "valid-api-key";

      const mockModels = {
        data: [
          { id: "llama3.1-8b", created: 1700000000 },
          { id: "zai-glm-4.7", created: 1700000001 },
          { id: "llama-3.3-70b", created: 1700000002 },
        ],
      };

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockModels),
        }),
      );

      const { fetchCerebrasModels } = await import("./cerebras");
      const models = await fetchCerebrasModels(5000);

      // zai-glm-4.7 has highest priority (110)
      // llama-3.3-70b has second highest (100)
      // llama3.1-8b has lowest (80)
      expect(models[0].id).toBe("zai-glm-4.7");
      expect(models[1].id).toBe("llama-3.3-70b");
      expect(models[2].id).toBe("llama3.1-8b");
    });

    it("should deduplicate models by display name", async () => {
      process.env.CEREBRAS_API_KEY = "valid-api-key";

      const mockModels = {
        data: [
          { id: "llama-3.3-70b", created: 1700000000 },
          { id: "llama-3.3-70b-v2", created: 1700000001 }, // Different ID, potentially same display name
        ],
      };

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockModels),
        }),
      );

      const { fetchCerebrasModels } = await import("./cerebras");
      const models = await fetchCerebrasModels(5000);

      // Models should be deduplicated by display name
      const displayNames = models.map((m) => m.name);
      const uniqueNames = new Set(displayNames);
      expect(displayNames.length).toBe(uniqueNames.size);
    });

    it("should include context window when available", async () => {
      process.env.CEREBRAS_API_KEY = "valid-api-key";

      const mockModels = {
        data: [
          { id: "llama-3.3-70b", created: 1700000000, context_window: 128000 },
          { id: "zai-glm-4.7", created: 1700000001 }, // No context window
        ],
      };

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockModels),
        }),
      );

      const { fetchCerebrasModels } = await import("./cerebras");
      const models = await fetchCerebrasModels(5000);

      const llamaModel = models.find((m) => m.id.includes("llama"));
      const zaiModel = models.find((m) => m.id.includes("zai"));

      expect(llamaModel?.contextWindow).toBe(128000);
      expect(zaiModel?.contextWindow).toBeUndefined();
    });

    it("should call fetch with correct headers", async () => {
      process.env.CEREBRAS_API_KEY = "test-api-key-123";

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: [] }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { fetchCerebrasModels } = await import("./cerebras");
      await fetchCerebrasModels(5000);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.cerebras.ai/v1/models",
        expect.objectContaining({
          headers: {
            Authorization: "Bearer test-api-key-123",
            "Content-Type": "application/json",
          },
        }),
      );
    });
  });
});
