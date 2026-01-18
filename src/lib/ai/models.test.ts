import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  ANTHROPIC_FILE_MIME_TYPES,
  OPENAI_FILE_MIME_TYPES,
} from "./file-support";

vi.mock("server-only", () => ({}));

let modelsModule: typeof import("./models");

beforeAll(async () => {
  modelsModule = await import("./models");
});

describe("customModelProvider", () => {
  it("returns correct file support for OpenAI gpt-4.1", () => {
    const { customModelProvider, getFilePartSupportedMimeTypes } = modelsModule;
    const model = customModelProvider.getModel({
      provider: "openai",
      model: "gpt-4.1",
    });
    expect(getFilePartSupportedMimeTypes(model)).toEqual(
      Array.from(OPENAI_FILE_MIME_TYPES),
    );
  });

  it("returns correct file support for anthropic claude-sonnet-4-5-20250929", () => {
    const { customModelProvider, getFilePartSupportedMimeTypes } = modelsModule;
    const model = customModelProvider.getModel({
      provider: "anthropic",
      model: "claude-sonnet-4-5-20250929",
    });
    expect(getFilePartSupportedMimeTypes(model)).toEqual(
      Array.from(ANTHROPIC_FILE_MIME_TYPES),
    );
  });

  it("returns correct provider for model name", () => {
    const { customModelProvider } = modelsModule;
    // Exact matches
    expect(customModelProvider.getProviderForModel("gpt-4.1")).toBe("openai");
    expect(customModelProvider.getProviderForModel("gemini-2.5-pro")).toBe(
      "google",
    );
    expect(customModelProvider.getProviderForModel("unknown-model")).toBe(
      "unknown",
    );
  });

  it("returns correct provider for pattern-matched model names", () => {
    const { customModelProvider } = modelsModule;
    // OpenRouter models (have :free suffix)
    expect(
      customModelProvider.getProviderForModel("z-ai/glm-4.5-air:free"),
    ).toBe("openRouter");
    expect(
      customModelProvider.getProviderForModel("deepseek/deepseek-r1-0528:free"),
    ).toBe("openRouter");

    // Groq models with full path
    expect(customModelProvider.getProviderForModel("openai/gpt-oss-120b")).toBe(
      "groq",
    );

    // Gemini models
    expect(
      customModelProvider.getProviderForModel("gemini-3-flash-preview"),
    ).toBe("google");

    // Claude models
    expect(
      customModelProvider.getProviderForModel("claude-sonnet-4-5-20250929"),
    ).toBe("anthropic");
  });
});
