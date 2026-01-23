/**
 * Curated Local Models - FAST & TOOL-CAPABLE ONLY
 *
 * Only models that:
 * 1. Actually support tool/function calling in Ollama
 * 2. Run FAST on consumer hardware (fit in 8-16GB VRAM)
 * 3. Have been verified to work with agentic workflows
 *
 * NO SLOW MODELS! If it can't run fast, it's not here.
 * Updated January 2026 with verified working models.
 */

export interface CuratedModel {
  /** Ollama model name (e.g., "llama3.1:8b") */
  name: string;

  /** Human-readable display name */
  displayName: string;

  /** Short description of the model */
  description: string;

  /** Approximate download size */
  size: string;

  /** Size in bytes for sorting/filtering */
  sizeBytes: number;

  /** Maximum context window in tokens */
  contextWindow: number;

  /** Whether this model supports tool/function calling */
  toolCalling: boolean;

  /** Whether this is a recommended model for most users */
  recommended: boolean;

  /** Primary use cases for this model */
  useCases: string[];

  /** Model family (llama, qwen, mistral, etc.) */
  family: string;

  /** Minimum RAM recommended in GB */
  minRamGB: number;

  /** Whether this is a reasoning model (shows thinking process) */
  isReasoning?: boolean;

  /** Speed tier: "fast" | "medium" | "slow" */
  speedTier: "fast" | "medium" | "slow";

  /** Whether this is an SLM (Small Language Model < 4B params) - FASTEST */
  isSLM?: boolean;
}

/**
 * FAST LOCAL MODELS WITH VERIFIED TOOL CALLING
 *
 * These models have been tested and WORK for agentic tasks.
 * Prioritized by: Speed > Tool Support > Quality
 *
 * References:
 * - https://ollama.com/search?c=tools
 * - User feedback on working models
 * - 2026 SLM research (Qwen3-0.6B, Phi-4-mini, Gemma-3n)
 */
export const CURATED_LOCAL_MODELS: CuratedModel[] = [
  // ============================================
  // TIER 0: SPEED OPTIMIZED SLMs (Sub-4B - INSTANT responses)
  // These are 5-30x FASTER than 7B models with decent quality!
  // ============================================
  {
    name: "qwen3:0.6b",
    displayName: "Qwen 3 0.6B",
    description: "INSTANT responses! Best capability-to-size ratio. Strong tool use even at 600M params.",
    size: "0.5 GB",
    sizeBytes: 0.5 * 1024 * 1024 * 1024,
    contextWindow: 32768,
    toolCalling: true,
    recommended: true,
    useCases: ["Ultra-fast", "Tool calling", "Agents", "Mobile/Edge"],
    family: "qwen",
    minRamGB: 2,
    speedTier: "fast",
    isSLM: true,
  },
  {
    name: "qwen3:1.7b",
    displayName: "Qwen 3 1.7B",
    description: "Blazing fast with better reasoning. 150-300 tok/sec on laptops!",
    size: "1.4 GB",
    sizeBytes: 1.4 * 1024 * 1024 * 1024,
    contextWindow: 40960,
    toolCalling: true,
    recommended: true,
    useCases: ["Fast inference", "Tool calling", "Better reasoning"],
    family: "qwen",
    minRamGB: 2,
    speedTier: "fast",
    isSLM: true,
  },
  {
    name: "phi4-mini",
    displayName: "Phi-4 Mini 3.8B",
    description: "128K context! Microsoft's best SLM. Reasoning = 7-9B models. MIT license.",
    size: "2.5 GB",
    sizeBytes: 2.5 * 1024 * 1024 * 1024,
    contextWindow: 128000,
    toolCalling: true,
    recommended: true,
    useCases: ["Long context", "RAG", "Agents", "Structured outputs"],
    family: "phi",
    minRamGB: 4,
    speedTier: "fast",
    isSLM: true,
  },
  {
    name: "gemma3:2b",
    displayName: "Gemma 3 2B",
    description: "Google's ultra-fast multimodal SLM. Text + vision ready.",
    size: "1.6 GB",
    sizeBytes: 1.6 * 1024 * 1024 * 1024,
    contextWindow: 32768,
    toolCalling: true,
    recommended: true,
    useCases: ["Multimodal", "Vision", "Ultra-fast", "Tool calling"],
    family: "gemma",
    minRamGB: 4,
    speedTier: "fast",
    isSLM: true,
  },
  {
    name: "llama3.2:1b",
    displayName: "Llama 3.2 1B",
    description: "Meta's tiny powerhouse. Runs on anything with tool support.",
    size: "1.3 GB",
    sizeBytes: 1.3 * 1024 * 1024 * 1024,
    contextWindow: 128000,
    toolCalling: true,
    recommended: true,
    useCases: ["Minimal resources", "Simple tasks", "Tool calling"],
    family: "llama",
    minRamGB: 2,
    speedTier: "fast",
    isSLM: true,
  },
  {
    name: "llama3.2:3b",
    displayName: "Llama 3.2 3B",
    description: "Sweet spot SLM. 128K context with great tool support.",
    size: "2 GB",
    sizeBytes: 2 * 1024 * 1024 * 1024,
    contextWindow: 128000,
    toolCalling: true,
    recommended: true,
    useCases: ["Low-resource", "Quick responses", "Tool calling"],
    family: "llama",
    minRamGB: 4,
    speedTier: "fast",
    isSLM: true,
  },

  // ============================================
  // TIER 1: FAST 7-9B MODELS (Still fast, better quality)
  // ============================================
  {
    name: "qwen3:8b",
    displayName: "Qwen 3 8B",
    description: "Best balance of speed & quality. Excellent tools.",
    size: "5 GB",
    sizeBytes: 5 * 1024 * 1024 * 1024,
    contextWindow: 40960,
    toolCalling: true,
    recommended: true,
    useCases: ["Tool calling", "Fast inference", "Coding", "Agentic tasks"],
    family: "qwen",
    minRamGB: 8,
    speedTier: "fast",
  },
  {
    name: "llama3.1:8b",
    displayName: "Llama 3.1 8B",
    description: "Best balance of speed and quality. Excellent tool support.",
    size: "4.7 GB",
    sizeBytes: 4.7 * 1024 * 1024 * 1024,
    contextWindow: 128000,
    toolCalling: true,
    recommended: true,
    useCases: ["General assistance", "Tool calling", "Fast responses"],
    family: "llama",
    minRamGB: 8,
    speedTier: "fast",
  },
  {
    name: "llama3.2:3b",
    displayName: "Llama 3.2 3B",
    description: "Ultra-fast! Runs anywhere. Great for quick tool tasks.",
    size: "2 GB",
    sizeBytes: 2 * 1024 * 1024 * 1024,
    contextWindow: 128000,
    toolCalling: true,
    recommended: true,
    useCases: ["Low-resource", "Quick responses", "Tool calling"],
    family: "llama",
    minRamGB: 4,
    speedTier: "fast",
  },
  {
    name: "mistral:7b",
    displayName: "Mistral 7B",
    description: "Fast European model with solid tool calling.",
    size: "4.1 GB",
    sizeBytes: 4.1 * 1024 * 1024 * 1024,
    contextWindow: 32000,
    toolCalling: true,
    recommended: true,
    useCases: ["Fast inference", "Tool calling", "European languages"],
    family: "mistral",
    minRamGB: 8,
    speedTier: "fast",
  },
  {
    name: "qwen2.5:7b",
    displayName: "Qwen 2.5 7B",
    description: "Highly efficient with excellent multilingual tool support.",
    size: "4.7 GB",
    sizeBytes: 4.7 * 1024 * 1024 * 1024,
    contextWindow: 131072,
    toolCalling: true,
    recommended: true,
    useCases: ["Multilingual", "Tool calling", "Fast coding"],
    family: "qwen",
    minRamGB: 8,
    speedTier: "fast",
  },

  // ============================================
  // TIER 2: BALANCED (Good Speed + Better Quality)
  // ============================================
  {
    name: "glm4:9b",
    displayName: "GLM-4 9B",
    description: "Excellent reasoning + tool use. Fast on modest VRAM.",
    size: "5.5 GB",
    sizeBytes: 5.5 * 1024 * 1024 * 1024,
    contextWindow: 128000,
    toolCalling: true,
    recommended: true,
    useCases: ["Reasoning", "Tool calling", "Math", "Analysis"],
    family: "glm",
    minRamGB: 10,
    speedTier: "fast",
  },
  {
    name: "qwen3:14b",
    displayName: "Qwen 3 14B",
    description: "Great coding and reasoning. Still fast on 16GB VRAM.",
    size: "9 GB",
    sizeBytes: 9 * 1024 * 1024 * 1024,
    contextWindow: 40960,
    toolCalling: true,
    recommended: true,
    useCases: ["Coding", "Analysis", "Tool calling"],
    family: "qwen",
    minRamGB: 12,
    speedTier: "medium",
  },
  {
    name: "granite3.1-dense:8b",
    displayName: "Granite 3.1 8B",
    description: "IBM enterprise model. Strong reasoning and tools.",
    size: "4.9 GB",
    sizeBytes: 4.9 * 1024 * 1024 * 1024,
    contextWindow: 128000,
    toolCalling: true,
    recommended: false,
    useCases: ["Enterprise", "Reasoning", "Tool calling"],
    family: "granite",
    minRamGB: 8,
    speedTier: "fast",
  },
  {
    name: "hermes3:8b",
    displayName: "Hermes 3 8B",
    description: "NousResearch model. Excellent tool/function calling.",
    size: "4.7 GB",
    sizeBytes: 4.7 * 1024 * 1024 * 1024,
    contextWindow: 128000,
    toolCalling: true,
    recommended: false,
    useCases: ["Function calling", "Agents", "Tool use"],
    family: "hermes",
    minRamGB: 8,
    speedTier: "fast",
  },
  {
    name: "phi4:14b",
    displayName: "Phi-4 14B",
    description: "Microsoft's latest. Punches above its weight.",
    size: "9 GB",
    sizeBytes: 9 * 1024 * 1024 * 1024,
    contextWindow: 16000,
    toolCalling: true,
    recommended: false,
    useCases: ["Reasoning", "Tool calling", "Coding"],
    family: "phi",
    minRamGB: 12,
    speedTier: "medium",
  },

  // ============================================
  // TIER 3: CODING SPECIALISTS (Fast & Good at Code)
  // ============================================
  {
    name: "qwen2.5-coder:7b",
    displayName: "Qwen 2.5 Coder 7B",
    description: "Fast coding assistant with good tool support.",
    size: "4.7 GB",
    sizeBytes: 4.7 * 1024 * 1024 * 1024,
    contextWindow: 131072,
    toolCalling: true,
    recommended: true,
    useCases: ["Code completion", "Quick fixes", "Scripting"],
    family: "qwen",
    minRamGB: 8,
    speedTier: "fast",
  },
  {
    name: "codestral:22b",
    displayName: "Codestral 22B",
    description: "Mistral's dedicated code model. Great tools.",
    size: "13 GB",
    sizeBytes: 13 * 1024 * 1024 * 1024,
    contextWindow: 32000,
    toolCalling: true,
    recommended: false,
    useCases: ["Code generation", "Code review", "Tool calling"],
    family: "mistral",
    minRamGB: 16,
    speedTier: "medium",
  },
  {
    name: "devstral:24b",
    displayName: "Devstral 24B",
    description: "Mistral's developer-focused model. Strong tool use.",
    size: "14 GB",
    sizeBytes: 14 * 1024 * 1024 * 1024,
    contextWindow: 128000,
    toolCalling: true,
    recommended: false,
    useCases: ["Software development", "Agentic coding", "Tool orchestration"],
    family: "mistral",
    minRamGB: 18,
    speedTier: "medium",
  },

  // ============================================
  // TIER 4: COMPACT MODELS (Minimal Resources)
  // ============================================
  {
    name: "llama3.2:1b",
    displayName: "Llama 3.2 1B",
    description: "Tiny but capable. Ultra-fast on any hardware.",
    size: "1.3 GB",
    sizeBytes: 1.3 * 1024 * 1024 * 1024,
    contextWindow: 128000,
    toolCalling: true,
    recommended: false,
    useCases: ["Minimal resources", "Simple tasks", "Testing"],
    family: "llama",
    minRamGB: 2,
    speedTier: "fast",
  },
  {
    name: "qwen3:4b",
    displayName: "Qwen 3 4B",
    description: "Compact Qwen with full tool support.",
    size: "2.6 GB",
    sizeBytes: 2.6 * 1024 * 1024 * 1024,
    contextWindow: 40960,
    toolCalling: true,
    recommended: false,
    useCases: ["Quick tasks", "Low latency", "Tool calling"],
    family: "qwen",
    minRamGB: 4,
    speedTier: "fast",
  },
  {
    name: "qwen3:1.7b",
    displayName: "Qwen 3 1.7B",
    description: "Smallest Qwen with tool support. Very fast.",
    size: "1.4 GB",
    sizeBytes: 1.4 * 1024 * 1024 * 1024,
    contextWindow: 40960,
    toolCalling: true,
    recommended: false,
    useCases: ["Minimal resources", "Quick queries", "Testing"],
    family: "qwen",
    minRamGB: 2,
    speedTier: "fast",
  },
  {
    name: "gemma2:9b",
    displayName: "Gemma 2 9B",
    description: "Google's efficient model with tool support.",
    size: "5.4 GB",
    sizeBytes: 5.4 * 1024 * 1024 * 1024,
    contextWindow: 8192,
    toolCalling: true,
    recommended: false,
    useCases: ["General tasks", "Tool calling", "Efficient"],
    family: "gemma",
    minRamGB: 10,
    speedTier: "fast",
  },

  // ============================================
  // TIER 5: REASONING (Visible Thinking, Still Fast)
  // ============================================
  {
    name: "deepseek-r1:8b",
    displayName: "DeepSeek R1 8B",
    description: "Fast reasoning with visible thinking process.",
    size: "4.9 GB",
    sizeBytes: 4.9 * 1024 * 1024 * 1024,
    contextWindow: 64000,
    toolCalling: true,
    recommended: false,
    useCases: ["Reasoning", "Analysis", "Problem solving"],
    family: "deepseek",
    minRamGB: 8,
    isReasoning: true,
    speedTier: "fast",
  },
  {
    name: "deepseek-r1:14b",
    displayName: "DeepSeek R1 14B",
    description: "Better reasoning, still fits in 16GB VRAM.",
    size: "9 GB",
    sizeBytes: 9 * 1024 * 1024 * 1024,
    contextWindow: 64000,
    toolCalling: true,
    recommended: false,
    useCases: ["Deep analysis", "Step-by-step reasoning", "Research"],
    family: "deepseek",
    minRamGB: 12,
    isReasoning: true,
    speedTier: "medium",
  },
];

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get recommended models (fast + tool calling + fits in RAM)
 */
export function getRecommendedModels(availableRamGB: number): CuratedModel[] {
  return CURATED_LOCAL_MODELS.filter(
    (model) =>
      model.minRamGB <= availableRamGB &&
      model.recommended &&
      model.toolCalling &&
      model.speedTier === "fast"
  );
}

/**
 * Get all models that can run with available RAM
 */
export function getCompatibleModels(availableRamGB: number): CuratedModel[] {
  return CURATED_LOCAL_MODELS.filter((model) => model.minRamGB <= availableRamGB);
}

/**
 * Get FAST models only (what users actually want)
 */
export function getFastModels(): CuratedModel[] {
  return CURATED_LOCAL_MODELS.filter(
    (model) => model.speedTier === "fast" && model.toolCalling
  );
}

/**
 * Get models by family
 */
export function getModelsByFamily(family: string): CuratedModel[] {
  return CURATED_LOCAL_MODELS.filter(
    (model) => model.family.toLowerCase() === family.toLowerCase()
  );
}

/**
 * Get models that support reasoning/thinking
 */
export function getReasoningModels(): CuratedModel[] {
  return CURATED_LOCAL_MODELS.filter((model) => model.isReasoning);
}

/**
 * Get models with verified tool calling support
 */
export function getToolCallingModels(): CuratedModel[] {
  return CURATED_LOCAL_MODELS.filter((model) => model.toolCalling);
}

/**
 * Find a curated model by name
 */
export function findCuratedModel(modelName: string): CuratedModel | undefined {
  // Normalize the name (remove tags like :latest if present)
  const normalizedName = modelName.split(":")[0].toLowerCase();

  return CURATED_LOCAL_MODELS.find((model) => {
    const curatedNormalized = model.name.split(":")[0].toLowerCase();
    return (
      curatedNormalized === normalizedName ||
      model.name.toLowerCase() === modelName.toLowerCase()
    );
  });
}

/**
 * Check if a model name is in our curated list
 */
export function isCuratedModel(modelName: string): boolean {
  return findCuratedModel(modelName) !== undefined;
}

/**
 * Get the best recommended model for a given RAM amount
 * Prioritizes: FAST > Tool Calling > Size
 */
export function getBestModelForRam(
  availableRamGB: number
): CuratedModel | undefined {
  const compatible = getCompatibleModels(availableRamGB);

  // First priority: Fast + recommended + tool calling
  const fastRecommended = compatible.filter(
    (m) => m.recommended && m.toolCalling && m.speedTier === "fast"
  );
  if (fastRecommended.length > 0) {
    // Return the largest fast model that fits
    return fastRecommended.sort((a, b) => b.sizeBytes - a.sizeBytes)[0];
  }

  // Second priority: Fast + tool calling
  const fast = compatible.filter(
    (m) => m.toolCalling && m.speedTier === "fast"
  );
  if (fast.length > 0) {
    return fast.sort((a, b) => b.sizeBytes - a.sizeBytes)[0];
  }

  // Fallback: Any with tool calling
  const withTools = compatible.filter((m) => m.toolCalling);
  return withTools.sort((a, b) => b.sizeBytes - a.sizeBytes)[0];
}

/**
 * Get coding-focused models
 */
export function getCodingModels(): CuratedModel[] {
  return CURATED_LOCAL_MODELS.filter(
    (model) =>
      model.name.includes("coder") ||
      model.name.includes("codestral") ||
      model.name.includes("devstral") ||
      model.useCases.some((u) => u.toLowerCase().includes("code"))
  );
}

/**
 * Get the TOP 5 fastest models for quick selection
 * Now prioritizes SLMs (Small Language Models) first!
 */
export function getTopFastModels(): CuratedModel[] {
  // Prioritize SLMs first, then other fast models
  const slms = CURATED_LOCAL_MODELS.filter(
    (m) => m.isSLM && m.toolCalling && m.recommended
  );
  const otherFast = CURATED_LOCAL_MODELS.filter(
    (m) => !m.isSLM && m.speedTier === "fast" && m.toolCalling && m.recommended
  );
  return [...slms, ...otherFast].slice(0, 6);
}

/**
 * Get SLM (Small Language Model) speed monsters
 * These are < 4B params and run 5-30x faster than 7B models!
 */
export function getSLMModels(): CuratedModel[] {
  return CURATED_LOCAL_MODELS.filter((m) => m.isSLM && m.toolCalling);
}

/**
 * Get recommended SLMs for users with limited hardware
 */
export function getRecommendedSLMs(): CuratedModel[] {
  return CURATED_LOCAL_MODELS.filter(
    (m) => m.isSLM && m.toolCalling && m.recommended
  );
}
