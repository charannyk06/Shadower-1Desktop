import type { ACPAgentConfig } from "../../../src/types/acp";
import { claudeCodeConfig, claudeCodeNpxConfig } from "./claude-code";
import { codexConfig, codexNpxConfig } from "./codex";
import { geminiConfig, geminiNpxConfig } from "./gemini";

/**
 * All supported ACP agent configurations
 */
export const ACP_AGENT_CONFIGS: ACPAgentConfig[] = [
  claudeCodeConfig,
  codexConfig,
  geminiConfig,
];

/**
 * NPX fallback configurations for agents not globally installed
 */
export const ACP_AGENT_NPX_CONFIGS: Record<string, ACPAgentConfig> = {
  "claude-code": claudeCodeNpxConfig,
  codex: codexNpxConfig,
  gemini: geminiNpxConfig,
};

/**
 * Get agent config by ID
 */
export function getAgentConfig(agentId: string): ACPAgentConfig | undefined {
  return ACP_AGENT_CONFIGS.find((config) => config.id === agentId);
}

/**
 * Get NPX fallback config for an agent
 */
export function getAgentNpxConfig(agentId: string): ACPAgentConfig | undefined {
  return ACP_AGENT_NPX_CONFIGS[agentId];
}

/**
 * Display names for agents (used in model selector)
 */
export const AGENT_DISPLAY_NAMES: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  gemini: "Gemini CLI",
};

/**
 * Provider mapping for icons (maps to existing ModelProviderIcon)
 */
export const AGENT_ICON_PROVIDERS: Record<
  string,
  "anthropic" | "openai" | "google"
> = {
  "claude-code": "anthropic",
  codex: "openai",
  gemini: "google",
};

export {
  claudeCodeConfig,
  claudeCodeNpxConfig,
  codexConfig,
  codexNpxConfig,
  geminiConfig,
  geminiNpxConfig,
};
