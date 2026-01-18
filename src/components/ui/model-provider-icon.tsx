import { ClaudeIcon } from "./claude-icon";
import { GeminiIcon } from "./gemini-icon";
import { GrokIcon } from "./grok-icon";
import { GroqIcon } from "./groq-icon";
import { OllamaIcon } from "./ollama-icon";
import { OpenRouterIcon } from "./open-router-icon";
import { OpenAIIcon } from "./openai-icon";

const PROVIDER_ICONS: Record<string, React.FC<{ className?: string }>> = {
  openai: OpenAIIcon,
  xai: GrokIcon,
  anthropic: ClaudeIcon,
  google: GeminiIcon,
  ollama: OllamaIcon,
  openRouter: OpenRouterIcon,
  groq: GroqIcon,
};

export function ModelProviderIcon({
  provider,
  className,
}: { provider: string; className?: string }) {
  const IconComponent = PROVIDER_ICONS[provider];

  // Return null for unknown providers - no generic fallback icons
  if (!IconComponent) {
    return null;
  }

  return <IconComponent className={className} />;
}
