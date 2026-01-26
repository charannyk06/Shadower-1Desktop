import type { ACPAgentConfig } from "../../../src/types/acp";

/**
 * Configuration for OpenAI Codex CLI agent via ACP adapter
 *
 * Codex is OpenAI's coding assistant that runs in the terminal.
 * Uses the codex-acp adapter from @zed-industries/codex-acp for ACP protocol.
 *
 * Installation:
 * - npm install -g @openai/codex (the CLI itself)
 * - Or: npx @zed-industries/codex-acp (runs via adapter)
 *
 * See: https://github.com/zed-industries/codex-acp
 *
 * Detection Strategy:
 * 1. Try `codex --version` directly
 * 2. Check PATH with `which codex`
 * 3. Check common global install paths
 * 4. Fall back to npm registry check for npx availability
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
  // Primary detection: check if codex CLI is installed
  detectCommand: "codex",
  detectArgs: ["--version"],
  // Auth detection: Codex stores credentials in multiple possible locations
  authPaths: [
    ".codex/auth.json",
    ".codex/credentials.json",
    ".openai/auth.json",
    ".config/codex/auth.json",
  ],
};

/**
 * Alternative config with environment variable for debugging
 */
export const codexNpxConfig: ACPAgentConfig = {
  ...codexConfig,
  env: { RUST_LOG: "info" },
};
