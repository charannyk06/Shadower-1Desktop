import { z } from "zod";

// Provider types for cloud and local providers
export type CloudProviderId =
  | "openai"
  | "anthropic"
  | "google"
  | "xai"
  | "groq"
  | "openRouter"
  | "cerebras"
  | "custom";

export type LocalProviderId = "ollama" | "lmstudio" | "custom-local";

export type ProviderId = CloudProviderId | LocalProviderId;

// Provider status
export type ProviderStatus =
  | "connected"
  | "disconnected"
  | "testing"
  | "error"
  | "disabled";

// Model status
export type ModelStatus =
  | "available"
  | "downloading"
  | "validating"
  | "error"
  | "disabled";

// Provider configuration stored in database
export interface ProviderConfig {
  id: string;
  name: string;
  providerId: ProviderId;
  type: "cloud" | "local";
  baseUrl?: string;
  authType: "api-key" | "oauth" | "none";
  enabled: boolean;
  status: ProviderStatus;
  lastTestedAt?: Date | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown>;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
}

// Local model metadata
export interface LocalModelConfig {
  id: string;
  name: string;
  displayName: string;
  providerId: LocalProviderId;
  providerConfigId?: string;
  path?: string; // File path for local models
  size?: number; // Size in bytes
  quantization?: string; // e.g., "Q4_K_M", "Q8_0"
  family?: string; // e.g., "llama", "mistral"
  status: ModelStatus;
  isVision: boolean;
  isToolCallSupported: boolean;
  downloadProgress?: number;
  errorMessage?: string | null;
  metadata?: Record<string, unknown>;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
}

// API Key storage (encrypted)
export interface ProviderApiKey {
  providerId: ProviderId;
  encryptedKey: string;
  lastValidatedAt?: Date;
  isValid: boolean;
}

// Provider info for UI display
export interface ProviderInfo {
  id: ProviderId;
  name: string;
  description: string;
  logo?: string;
  website?: string;
  type: "cloud" | "local";
  authType: "api-key" | "oauth" | "none";
  defaultBaseUrl?: string;
  supportedModels?: string[];
  features?: string[];
}

// Model info for UI display (extends DynamicModelInfo)
export interface ModelInfo {
  id: string;
  name: string;
  displayName: string;
  provider: ProviderId;
  providerName: string;
  type: "cloud" | "local";
  status: ModelStatus;
  isToolCallSupported: boolean;
  isImageInputSupported: boolean;
  isReasoningModel: boolean;
  reasoningEffort?: string[];
  thinkingLevel?: string[];
  workflowGenerationSupport: "full" | "limited" | "none";
  contextWindow?: number;
  maxOutputTokens?: number;
  size?: number;
  quantization?: string;
}

// Validation schemas
export const ProviderConfigZodSchema = z.object({
  name: z.string().min(1, "Name is required"),
  providerId: z.string().min(1, "Provider is required"),
  type: z.enum(["cloud", "local"]),
  baseUrl: z.string().url().optional().nullable(),
  authType: z.enum(["api-key", "oauth", "none"]),
  enabled: z.boolean().default(true),
});

export const ApiKeyZodSchema = z.object({
  providerId: z.string().min(1, "Provider is required"),
  apiKey: z.string().min(1, "API key is required"),
});

export const LocalModelZodSchema = z.object({
  name: z.string().min(1, "Model name is required"),
  providerId: z.enum(["ollama", "lmstudio", "custom-local"]),
  path: z.string().optional(),
});

// Provider registry with static info
export const PROVIDER_REGISTRY: Record<ProviderId, ProviderInfo> = {
  // Cloud providers
  openai: {
    id: "openai",
    name: "OpenAI",
    description: "GPT-4o, GPT-4.1, o3, o4 models",
    logo: "/providers/openai.svg",
    website: "https://platform.openai.com",
    type: "cloud",
    authType: "api-key",
    defaultBaseUrl: "https://api.openai.com/v1",
    features: ["Tool calling", "Vision", "Reasoning models", "Computer use"],
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    description: "Claude Sonnet, Claude Opus, Claude Haiku",
    logo: "/providers/anthropic.svg",
    website: "https://console.anthropic.com",
    type: "cloud",
    authType: "api-key",
    defaultBaseUrl: "https://api.anthropic.com",
    features: ["Tool calling", "Vision", "Extended thinking", "Artifacts"],
  },
  google: {
    id: "google",
    name: "Google",
    description: "Gemini 3 Pro, Gemini 3 Flash, Gemini 2.5",
    logo: "/providers/google.svg",
    website: "https://aistudio.google.com",
    type: "cloud",
    authType: "api-key",
    defaultBaseUrl: "https://generativelanguage.googleapis.com",
    features: ["Tool calling", "Vision", "Thinking modes", "Grounding"],
  },
  xai: {
    id: "xai",
    name: "xAI",
    description: "Grok 4, Grok 3 models",
    logo: "/providers/xai.svg",
    website: "https://console.x.ai",
    type: "cloud",
    authType: "api-key",
    features: ["Tool calling", "Vision", "Real-time data"],
  },
  groq: {
    id: "groq",
    name: "Groq",
    description: "Fast inference for Llama, Qwen, and other models",
    logo: "/providers/groq.svg",
    website: "https://console.groq.com",
    type: "cloud",
    authType: "api-key",
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    features: ["Ultra-fast inference", "Tool calling"],
  },
  openRouter: {
    id: "openRouter",
    name: "OpenRouter",
    description: "Access to multiple providers with free tier models",
    logo: "/providers/openrouter.svg",
    website: "https://openrouter.ai",
    type: "cloud",
    authType: "api-key",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    features: ["Multiple providers", "Free tier", "Fallback routing"],
  },
  cerebras: {
    id: "cerebras",
    name: "Cerebras",
    description: "High-speed inference for Llama and Qwen models",
    logo: "/providers/cerebras.svg",
    website: "https://inference.cerebras.ai",
    type: "cloud",
    authType: "api-key",
    features: ["Ultra-fast inference", "Tool calling"],
  },
  custom: {
    id: "custom",
    name: "Custom Provider",
    description: "OpenAI-compatible custom endpoint",
    type: "cloud",
    authType: "api-key",
    features: ["OpenAI-compatible API"],
  },

  // Local providers
  ollama: {
    id: "ollama",
    name: "Ollama",
    description: "Local model hosting and inference",
    logo: "/providers/ollama.svg",
    website: "https://ollama.ai",
    type: "local",
    authType: "none",
    defaultBaseUrl: "http://localhost:11434",
    features: ["Local inference", "Model library", "Easy setup"],
  },
  lmstudio: {
    id: "lmstudio",
    name: "LM Studio",
    description: "Local model hosting with GUI",
    logo: "/providers/lmstudio.svg",
    website: "https://lmstudio.ai",
    type: "local",
    authType: "none",
    defaultBaseUrl: "http://localhost:1234/v1",
    features: ["Local inference", "Model library", "GUI"],
  },
  "custom-local": {
    id: "custom-local",
    name: "Custom Local",
    description: "Custom local model endpoint",
    type: "local",
    authType: "none",
    features: ["OpenAI-compatible API"],
  },
};

// API key environment variable mapping
export const PROVIDER_ENV_KEYS: Record<CloudProviderId, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
  xai: "XAI_API_KEY",
  groq: "GROQ_API_KEY",
  openRouter: "OPENROUTER_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  custom: "CUSTOM_API_KEY",
};

// Repository interface
export interface ProviderConfigRepository {
  getAll: (userId: string) => Promise<ProviderConfig[]>;
  getById: (id: string) => Promise<ProviderConfig | null>;
  getByProviderId: (
    userId: string,
    providerId: ProviderId,
  ) => Promise<ProviderConfig | null>;
  create: (
    config: Omit<ProviderConfig, "id" | "createdAt" | "updatedAt">,
  ) => Promise<ProviderConfig>;
  update: (
    id: string,
    config: Partial<ProviderConfig>,
  ) => Promise<ProviderConfig>;
  delete: (id: string) => Promise<void>;
  updateStatus: (
    id: string,
    status: ProviderStatus,
    errorMessage?: string,
  ) => Promise<void>;
}

export interface LocalModelRepository {
  getAll: (userId: string) => Promise<LocalModelConfig[]>;
  getById: (id: string) => Promise<LocalModelConfig | null>;
  getByProviderId: (
    userId: string,
    providerId: LocalProviderId,
  ) => Promise<LocalModelConfig[]>;
  create: (
    model: Omit<LocalModelConfig, "id" | "createdAt" | "updatedAt">,
  ) => Promise<LocalModelConfig>;
  update: (
    id: string,
    model: Partial<LocalModelConfig>,
  ) => Promise<LocalModelConfig>;
  delete: (id: string) => Promise<void>;
  updateStatus: (
    id: string,
    status: ModelStatus,
    progress?: number,
    errorMessage?: string,
  ) => Promise<void>;
}
