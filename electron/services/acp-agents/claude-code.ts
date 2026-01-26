import type { ACPAgentConfig } from "../../../src/types/acp";

/**
 * Configuration for Claude Code agent via ACP adapter
 *
 * Claude Code is Anthropic's AI coding assistant that runs in the terminal.
 * It requires the @zed-industries/claude-code-acp adapter for ACP protocol support.
 *
 * Installation:
 * - npm install -g @anthropic-ai/claude-code (the CLI itself)
 * - Or: npx @zed-industries/claude-code-acp (runs via adapter)
 *
 * The adapter wraps the Claude Code SDK and exposes it via ACP.
 * See: https://github.com/zed-industries/claude-code-acp
 *
 * Detection Strategy:
 * 1. Try `claude --version` directly
 * 2. Check PATH with `which claude`
 * 3. Check common global install paths
 * 4. Fall back to npm registry check for npx availability
 */
export const claudeCodeConfig: ACPAgentConfig = {
  id: "claude-code",
  name: "Claude Code",
  command: "npx",
  args: ["-y", "@zed-industries/claude-code-acp"],
  env: {},
  authMethods: ["LOGIN", "API_KEY"],
  capabilities: ["filesystem", "terminal", "mcp"],
  iconProvider: "anthropic",
  // Primary detection: check if claude CLI is installed
  detectCommand: "claude",
  detectArgs: ["--version"],
  // Auth detection: Claude Code stores credentials in multiple possible locations
  authPaths: [
    ".claude/.anthropic",
    ".claude/settings.json",
    ".claude/credentials.json",
    ".anthropic/credentials",
  ],
};

/**
 * Alternative config with permission mode set
 */
export const claudeCodeNpxConfig: ACPAgentConfig = {
  ...claudeCodeConfig,
  args: ["-y", "@zed-industries/claude-code-acp", "--permission-mode", "default"],
};
