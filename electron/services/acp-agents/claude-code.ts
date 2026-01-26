import type { ACPAgentConfig } from "../../../src/types/acp";

/**
 * Configuration for Claude Code agent via ACP adapter
 *
 * Claude Code is Anthropic's AI coding assistant that runs in the terminal.
 * It requires the @zed-industries/claude-code-acp adapter for ACP protocol support.
 *
 * Installation: npm install -g @zed-industries/claude-code-acp
 * Or: npx @zed-industries/claude-code-acp
 *
 * The adapter wraps the Claude Code SDK and exposes it via ACP.
 * See: https://github.com/zed-industries/claude-code-acp
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
  // Detect if claude is installed (the adapter will use it)
  detectCommand: "claude",
  detectArgs: ["--version"],
  // Auth detection: Claude Code stores credentials in ~/.claude/.anthropic/
  authPaths: [".claude/.anthropic", ".claude/settings.json"],
};

/**
 * Alternative config with permission mode set
 */
export const claudeCodeNpxConfig: ACPAgentConfig = {
  ...claudeCodeConfig,
  args: ["-y", "@zed-industries/claude-code-acp", "--permission-mode", "default"],
};
