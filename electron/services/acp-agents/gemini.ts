import type { ACPAgentConfig } from "../../../src/types/acp";

/**
 * Configuration for Google Gemini CLI agent
 *
 * Gemini CLI is Google's AI coding assistant that runs in the terminal.
 * It has native ACP support using the --experimental-acp flag.
 * Gemini was the first reference implementation for ACP.
 *
 * Installation: npm install -g @anthropic-ai/gemini
 * Or: npx @anthropic-ai/gemini
 *
 * See: https://zed.dev/acp/agent/gemini-cli
 */
export const geminiConfig: ACPAgentConfig = {
  id: "gemini",
  name: "Gemini CLI",
  command: "gemini",
  args: ["--experimental-acp"],
  env: {},
  authMethods: ["LOGIN", "API_KEY"],
  capabilities: ["filesystem", "terminal", "mcp"],
  iconProvider: "google",
  detectCommand: "gemini",
  detectArgs: ["--version"],
};

/**
 * Alternative config using npx (if not globally installed)
 */
export const geminiNpxConfig: ACPAgentConfig = {
  ...geminiConfig,
  command: "npx",
  args: ["-y", "@anthropic-ai/gemini", "--experimental-acp"],
  detectCommand: "which",
  detectArgs: ["gemini"],
};
