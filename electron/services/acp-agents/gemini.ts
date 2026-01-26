import type { ACPAgentConfig } from "../../../src/types/acp";

/**
 * Configuration for Google Gemini CLI agent
 *
 * Gemini CLI is Google's AI coding assistant that runs in the terminal.
 * It has native ACP support using the --experimental-acp flag.
 * Gemini was the first reference implementation for ACP.
 *
 * Installation:
 * - npm install -g @anthropic-ai/gemini (the CLI itself)
 * - Or: npx @anthropic-ai/gemini (runs via npx)
 *
 * See: https://zed.dev/acp/agent/gemini-cli
 *
 * Detection Strategy:
 * 1. Try `gemini --version` directly
 * 2. Check PATH with `which gemini`
 * 3. Check common global install paths
 * 4. Fall back to npm registry check for npx availability
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
  // Primary detection: check if gemini CLI is installed
  detectCommand: "gemini",
  detectArgs: ["--version"],
  // Auth detection: Gemini CLI stores OAuth credentials in multiple possible locations
  authPaths: [
    ".gemini/oauth_creds.json",
    ".gemini/google_accounts.json",
    ".gemini/credentials.json",
    ".config/gemini/oauth_creds.json",
  ],
};

/**
 * Alternative config using npx (if not globally installed)
 */
export const geminiNpxConfig: ACPAgentConfig = {
  ...geminiConfig,
  command: "npx",
  args: ["-y", "@google/gemini-cli", "--experimental-acp"],
};
