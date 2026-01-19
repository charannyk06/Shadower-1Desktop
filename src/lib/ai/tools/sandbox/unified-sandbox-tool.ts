/**
 * Unified Sandbox Tool Stub - E2B cloud services removed for local-first architecture
 *
 * This file provides stub exports for compatibility with existing code.
 * Local code execution is handled by child_process in Electron.
 */

import { tool as createTool, Tool } from "ai";
import { z } from "zod";
import type { UIMessageStreamWriter } from "ai";
import type { ChatModel } from "app-types/chat";
import logger from "logger";

export interface SandboxExecutionContext {
  threadId?: string;
  userId: string;
  dataStream?: UIMessageStreamWriter;
  chatModel?: ChatModel;
}

/**
 * Creates a stub sandbox tool that returns an error message
 * E2B cloud services have been removed for local-first architecture
 */
export function createUnifiedSandboxTool(
  _context?: SandboxExecutionContext,
): Tool {
  return createTool({
    description: `Code execution sandbox (LOCAL-FIRST MODE - E2B removed).

This tool is temporarily unavailable as E2B cloud services have been removed for local-first architecture.
Local code execution via child_process is coming soon.

For now, you can:
- Use browser automation tools (local Chrome DevTools)
- Use desktop tools (local terminal)
- Create fragments for web apps (will show preview when ready)`,
    inputSchema: z.object({
      action: z
        .enum([
          "execute_code",
          "run_command",
          "write_file",
          "read_file",
          "list_files",
          "get_status",
        ])
        .describe("The action to perform"),
      code: z
        .string()
        .optional()
        .describe("Code to execute (for execute_code)"),
      language: z
        .enum(["python", "javascript", "typescript", "bash"])
        .optional()
        .describe("Programming language for code execution"),
      command: z
        .string()
        .optional()
        .describe("Shell command (for run_command)"),
      path: z.string().optional().describe("File path (for file operations)"),
      content: z.string().optional().describe("File content (for write_file)"),
    }),
    execute: async (params) => {
      logger.warn(
        "[Sandbox] Sandbox tool called but E2B services removed",
        params,
      );
      return {
        success: false,
        error:
          "Sandbox code execution is temporarily unavailable. E2B cloud services have been removed for local-first architecture. Local execution coming soon.",
        suggestion:
          "Try using browser automation, desktop tools, or fragment creation instead.",
      };
    },
  });
}

// Default instance for static toolkit
export const unifiedSandboxTool = createUnifiedSandboxTool();
