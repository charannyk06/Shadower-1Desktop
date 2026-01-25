import { DeepSeekIcon } from "./deepseek-icon";
import { GeminiIcon } from "./gemini-icon";
import { IBMIcon } from "./ibm-icon";
import { MetaIcon } from "./meta-icon";
import { MicrosoftIcon } from "./microsoft-icon";
import { MistralIcon } from "./mistral-icon";
import { NousResearchIcon } from "./nousresearch-icon";
import { OpenAIIcon } from "./openai-icon";
import { QwenIcon } from "./qwen-icon";
import { ZhipuIcon } from "./zhipu-icon";

/**
 * Maps model family names to their provider icons
 */
const MODEL_FAMILY_ICONS: Record<string, React.FC<{ className?: string }>> = {
  // Qwen models -> Qwen (Alibaba)
  qwen: QwenIcon,

  // Llama models -> Meta
  llama: MetaIcon,

  // Phi models -> Microsoft
  phi: MicrosoftIcon,

  // Gemma models -> Google
  gemma: GeminiIcon,

  // Mistral models -> Mistral AI
  mistral: MistralIcon,

  // GLM models -> Zhipu AI
  glm: ZhipuIcon,

  // Granite models -> IBM
  granite: IBMIcon,

  // Hermes models -> Nous Research
  hermes: NousResearchIcon,

  // DeepSeek models -> DeepSeek
  deepseek: DeepSeekIcon,

  // GPT-OSS models -> OpenAI
  "gpt-oss": OpenAIIcon,
};

export function ModelFamilyIcon({
  family,
  className,
}: { family: string; className?: string }) {
  const normalizedFamily = family.toLowerCase();
  const IconComponent = MODEL_FAMILY_ICONS[normalizedFamily];

  if (!IconComponent) {
    return null;
  }

  return <IconComponent className={className} />;
}

/**
 * Get the display name for a model family's provider
 */
export function getModelFamilyProviderName(family: string): string {
  const providers: Record<string, string> = {
    qwen: "Alibaba",
    llama: "Meta",
    phi: "Microsoft",
    gemma: "Google",
    mistral: "Mistral AI",
    glm: "Zhipu AI",
    granite: "IBM",
    hermes: "Nous Research",
    deepseek: "DeepSeek",
    "gpt-oss": "OpenAI",
  };

  return providers[family.toLowerCase()] || family;
}
