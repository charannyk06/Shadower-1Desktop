const OPENAI_DISPLAY_NAMES: Record<string, string> = {
  "gpt-4.1": "GPT-4.1",
  "gpt-4.1-mini": "GPT-4.1 Mini",
  "gpt-4.1-nano": "GPT-4.1 Nano",
  "gpt-4o": "GPT-4o",
  "gpt-4o-mini": "GPT-4o Mini",
  "gpt-4-turbo": "GPT-4 Turbo",
  "gpt-4": "GPT-4",
  o1: "O1 Reasoning",
  "o1-mini": "O1 Mini",
  "o1-preview": "O1 Preview",
  o3: "O3 Reasoning",
  "o3-mini": "O3 Mini",
  "o4-mini": "O4 Mini Reasoning",
};

export function formatOpenAIDisplayName(modelId: string): string {
  if (OPENAI_DISPLAY_NAMES[modelId]) {
    return OPENAI_DISPLAY_NAMES[modelId];
  }

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
    .replace(/-codex/g, " Codex")
    .replace(/-\d{4}-\d{2}-\d{2}/g, "");

  return name;
}

export function formatAnthropicDisplayName(
  modelId: string,
  displayName?: string,
): string {
  if (displayName) return displayName;

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

export function formatGoogleDisplayName(
  modelId: string,
  displayName?: string,
): string {
  if (displayName && !displayName.startsWith("models/")) return displayName;

  const name = modelId
    .replace("models/", "")
    .replace("gemini-", "Gemini ")
    .replace("-pro", " Pro")
    .replace("-flash", " Flash")
    .replace("-lite", " Lite")
    .replace("-thinking", " Thinking")
    .replace("-exp", " (Experimental)")
    .replace(/-\d{4}/g, "");

  return name.trim();
}

export function formatGroqDisplayName(modelId: string): string {
  let name = modelId;

  if (name.includes("/")) {
    name = name.split("/").pop() || name;
  }

  name = name
    .replace("llama-", "Llama ")
    .replace("mixtral-", "Mixtral ")
    .replace("gemma-", "Gemma ")
    .replace("qwen", "Qwen ")
    .replace("-versatile", "")
    .replace("-instant", " (Fast)")
    .replace("-specdec", " (Speculative)")
    // Match 1-4 digits followed by 'b' for model sizes (e.g., "7b", "70b")
    .replaceAll(/-(\d{1,4})b/gi, " $1B");

  return name.trim();
}

export function formatXAIDisplayName(modelId: string): string {
  // Handle dated model IDs like grok-4-0709
  const name = modelId
    .replace(/-\d{4}$/, "") // Remove date suffix like -0709
    .replace("grok-", "Grok ")
    .replace("-fast", " Fast")
    .replace("-mini", " Mini")
    .replace("-vision", " Vision")
    .replace("-beta", " (Beta)");

  return name.trim();
}

export function formatOpenRouterDisplayName(
  modelId: string,
  displayName?: string,
): string {
  if (displayName) return displayName;

  let name = modelId;

  if (name.includes("/")) {
    name = name.split("/").pop() || name;
  }

  return (
    name
      .replace(":free", " (Free)")
      .replace(":beta", " (Beta)")
      .replace("-instruct", "")
      .replace("llama-", "Llama ")
      .replace("gemma-", "Gemma ")
      .replace("qwen", "Qwen ")
      .replace("deepseek-", "DeepSeek ")
      .replace("gpt-oss-", "GPT OSS ")
      .replace("-it", "")
      // Match 1-4 digits followed by 'b' for model sizes (e.g., "7b", "70b")
      .replaceAll(/-(\d{1,4})b/gi, " $1B")
      .trim()
  );
}

export function formatOllamaDisplayName(modelId: string): string {
  const name = modelId
    .replace("llama", "Llama ")
    .replace("qwen", "Qwen ")
    .replace("gemma", "Gemma ")
    .replace("deepseek-r1", "DeepSeek R1")
    .replace("codellama", "Code Llama")
    .replace("mistral", "Mistral")
    .replace("mixtral", "Mixtral")
    .replace("phi", "Phi ")
    .replace(":latest", "")
    // Use possessive-style matching with atomic groups to prevent backtracking
    // Match 1-4 digits followed by 'b' for model sizes (e.g., "7b", "70b")
    .replaceAll(/(\d{1,4})b/gi, " $1B")
    // Match version numbers like "3.1", "2.5" - bounded to prevent ReDoS
    .replaceAll(/(\d{1,2}\.\d{1,2})/g, " $1");

  return name.trim();
}

export function formatCerebrasDisplayName(modelId: string): string {
  // Handle specific model names
  if (modelId.startsWith("zai-glm-")) {
    const version = modelId.replace("zai-glm-", "");
    return `GLM ${version}`;
  }
  if (modelId.startsWith("gpt-oss-")) {
    const size = modelId.replace("gpt-oss-", "").toUpperCase();
    return `GPT OSS ${size}`;
  }

  const name = modelId
    .replace("llama-", "Llama ")
    .replace("llama", "Llama ")
    .replace("qwen-", "Qwen ")
    .replaceAll("-a22b", "")
    .replaceAll("-instruct", "")
    .replaceAll("-2507", "")
    // Match 1-4 digits followed by 'b' for model sizes (e.g., "7b", "70b")
    .replaceAll(/-(\d{1,4})b/gi, " $1B")
    // Match version numbers like "3.1", "2.5" - bounded to prevent ReDoS
    .replaceAll(/(\d{1,2}\.\d{1,2})/g, " $1")
    .replaceAll("-", " ");

  return name.trim();
}

export function formatLMStudioDisplayName(modelId: string): string {
  let name = modelId;

  // Remove org/user prefix if present
  if (name.includes("/")) {
    name = name.split("/").pop() || name;
  }

  // Remove common suffixes
  name = name
    .replace(/-GGUF$/i, "")
    .replace(/-GPTQ$/i, "")
    .replace(/-AWQ$/i, "")
    .replace(/-fp16$/i, "")
    .replace(/-Q\d+_\w+$/i, "") // Remove quantization suffix like -Q4_K_M
    .replace(/-Instruct$/i, "")
    .replace(/-Chat$/i, "");

  // Format known model names
  name = name
    .replace(/^Meta-/i, "")
    .replace(/^TheBloke-/i, "")
    .replace(/^lmstudio-community-/i, "")
    .replace(/Llama-?(\d)/gi, "Llama $1")
    .replace(/Mistral-?(\d)/gi, "Mistral $1")
    .replace(/Mixtral/gi, "Mixtral")
    .replace(/Qwen-?(\d)/gi, "Qwen $1")
    .replace(/Gemma-?(\d)/gi, "Gemma $1")
    .replace(/Phi-?(\d)/gi, "Phi $1")
    .replace(/DeepSeek/gi, "DeepSeek")
    .replace(/CodeLlama/gi, "Code Llama")
    // Match version numbers like "3.1", "2.5"
    .replace(/-v?([\d.]+)/gi, " v$1")
    // Match model sizes like "7B", "70B"
    .replace(/-(\d{1,4})B/gi, " $1B");

  return name.trim().replace(/\s+/g, " ");
}
