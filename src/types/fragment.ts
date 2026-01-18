import { z } from "zod";

/**
 * Fragment Types - For micro-app and document generation
 * Cherry-picked from E2B Fragments repository
 */

// Fragment template types
export type FragmentTemplateType = "web-app" | "code-interpreter";

export type FragmentTemplateId =
  | "code-interpreter-v1"
  | "nextjs-developer"
  | "vue-developer"
  | "streamlit-developer"
  | "gradio-developer";

export type FragmentStatus =
  | "draft"
  | "generating"
  | "ready"
  | "deployed"
  | "failed";

// Fragment schema for AI generation
export const fragmentSchema = z.object({
  template: z.enum([
    "code-interpreter-v1",
    "nextjs-developer",
    "vue-developer",
    "streamlit-developer",
    "gradio-developer",
  ]),
  title: z.string().max(100).describe("Short, descriptive title"),
  description: z.string().max(200).describe("One sentence description"),
  code: z.string().describe("Complete, runnable code"),
  file_path: z.string().describe("Relative file path"),
  port: z
    .number()
    .nullable()
    .describe("Port for web apps, null for code interpreter"),
  additional_dependencies: z
    .array(z.string())
    .describe("Extra packages needed"),
  install_command: z
    .string()
    .optional()
    .describe("Command to install dependencies"),
  commentary: z.string().optional().describe("AI's reasoning about the code"),
});

export type FragmentSchema = z.infer<typeof fragmentSchema>;

// Fragment result after execution
export interface FragmentResult {
  fragmentId: string;
  previewUrl?: string; // For web apps
  output?: string; // For code interpreter
  sandboxId: string;
  template: string;
  title: string;
  code: string;
}

// Fragment database model
export interface Fragment {
  id: string;
  thread_id: string;
  user_id: string;

  template: FragmentTemplateId;
  title: string;
  description: string;
  code: string;
  file_path: string;

  sandbox_id?: string;
  port?: number;
  preview_url?: string;
  deployment_url?: string;

  status: FragmentStatus;
  error_message?: string;

  created_at: Date;
  updated_at: Date;
}

// Morph edit schema for surgical code editing
export const morphEditSchema = z.object({
  instruction: z.string().describe("What to change"),
  edit: z
    .string()
    .describe("Surgical edit with // ... existing code ... markers"),
  commentary: z.string().describe("Explanation of the edit"),
  file_path: z.string().describe("Path to file being edited"),
});

export type MorphEditSchema = z.infer<typeof morphEditSchema>;

// Operation types for granular logging
export type FragmentOperationType =
  | "bash" // Shell command execution
  | "file-write" // Writing a file
  | "file-read" // Reading a file
  | "install" // Installing dependencies
  | "ai-call" // AI model invocation
  | "sandbox" // Sandbox operation
  | "tool-call" // External tool invocation (MCP, system tools)
  | "info"; // General info

// Individual operation log entry
export interface FragmentOperation {
  type: FragmentOperationType;
  command?: string; // For bash commands
  filePath?: string; // For file operations
  content?: string; // For file content (workspace files)
  output?: string; // Command output or result
  status: "running" | "success" | "error";
  timestamp: number;
  durationMs?: number;
  // For tool calls
  toolName?: string;
  toolArgs?: Record<string, any>;
  toolResult?: any;
}

// Workspace file for real-time display
export interface WorkspaceFile {
  path: string;
  content: string;
  language?: string;
}

// Progress events streamed to UI
export interface FragmentProgressEvent {
  // Tool call ID for UI correlation - matches the tool invocation in the message
  toolCallId?: string;
  stage:
    | "analyzing"
    | "template-selected"
    | "generating"
    | "installing"
    | "executing"
    | "editing"
    | "deploying"
    | "complete"
    | "error";
  message: string;
  template?: string;
  fragmentId?: string;
  previewUrl?: string;
  error?: string;
  codeChunk?: string; // For streaming code generation
  codeLength?: number; // Current code length
  generatedCode?: string; // Accumulated generated code for real-time preview
  // Granular operation logging
  operation?: FragmentOperation; // Current operation
  operations?: FragmentOperation[]; // All operations history
  // Workspace files for real-time display
  workspaceFiles?: WorkspaceFile[];
}
