import type { ACPAgentConfig } from "../../../src/types/acp";

/**
 * Configuration for OpenAI Codex CLI agent via ACP adapter
 *
 * Codex is OpenAI's coding assistant that runs in the terminal.
 * Uses the codex-acp adapter from @zed-industries/codex-acp for ACP protocol.
 *
 * Installation: npm install -g @zed-industries/codex-acp
 * Or: npx @zed-industries/codex-acp
 *
 * See: https://github.com/zed-industries/codex-acp
 */
export const codexConfig: ACPAgentConfig = {
  id: "codex",
  name: "Codex",
  command: "npx",
  args: ["-y", "@zed-industries/codex-acp"],
  env: {},
  authMethods: ["LOGIN", "API_KEY"],
  capabilities: ["filesystem", "terminal", "mcp"],
  iconProvider: "openai",
  // Detect if codex is installed (the adapter will use it)
  detectCommand: "codex",
  detectArgs: ["--version"],
  // Auth detection: Codex stores credentials in ~/.codex/auth.json
  authPaths: [".codex/auth.json"],
};

/**
 * Alternative config with environment variable for debugging
 */
export const codexNpxConfig: ACPAgentConfig = {
  ...codexConfig,
  env: { RUST_LOG: "info" },
};
