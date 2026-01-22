/**
 * AI Streaming IPC Handler with Full Agentic Capabilities
 *
 * This handles AI streaming in the Electron main process, enabling:
 * - Pure IPC streaming (no HTTP server needed)
 * - Works with cloud models (OpenAI, Anthropic, etc.)
 * - Works with local models (Ollama, LM Studio)
 * - Secure - no localhost ports exposed
 * - Fast - 2x faster than HTTP
 * - FULL TOOL SUPPORT - Desktop tools, terminal, file operations, MCP tools
 * - AGENTIC BEHAVIOR - Multi-step execution with autonomous decision making
 *
 * Architecture:
 * Renderer -> IPC -> Main Process -> AI Provider -> Stream back via IPC
 */

import {
  ipcMain,
  safeStorage,
  clipboard,
  shell,
  desktopCapturer,
} from "electron";
import {
  streamText,
  convertToModelMessages,
  UIMessage,
  tool as createTool,
  jsonSchema,
} from "ai";
import { getDatabase, schema } from "../services/database";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";
import { exec } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { z } from "zod";
import type { MCPServerConfig, AllowedMCPServer } from "../../src/types/mcp";
import { ensureClientConnected } from "../services/mcp-client-service";
import {
  getModelCapabilities,
  localModelSupportsTools,
} from "../../src/lib/ai/providers/capabilities";
import {
  calculateContextUsageAsync,
  maybeCompactMessages,
  estimateTokens,
} from "../../src/lib/ai/context";
import { getVectorStore } from "../services/vector-store";
import { indexMessageForMemory } from "./memory";

const execAsync = promisify(exec);

// Track active streams for abort functionality
const activeStreams = new Map<string, AbortController>();

/**
 * Auto-generate title for new threads after stream completion
 * This is called automatically when a stream completes to ensure titles are always generated
 */
async function maybeAutoGenerateTitle(
  threadId: string,
  chatModel: { provider: string; model: string } | undefined,
  firstUserMessage: string | undefined,
  firstAssistantText: string | undefined,
  event: Electron.IpcMainInvokeEvent,
): Promise<void> {
  try {
    const db = getDatabase();

    // Get the thread to check if it needs a title
    const [thread] = await db
      .select()
      .from(schema.ChatThreadTable)
      .where(eq(schema.ChatThreadTable.id, threadId));

    if (!thread) {
      console.log(`[AI IPC] Auto-title: Thread not found: ${threadId}`);
      return;
    }

    // Check if thread already has a meaningful title
    if (thread.title && thread.title !== "New Chat" && thread.title.trim() !== "") {
      console.log(`[AI IPC] Auto-title: Thread already has title: "${thread.title}"`);
      return;
    }

    // Count messages in the thread
    const messages = await db
      .select()
      .from(schema.ChatMessageTable)
      .where(eq(schema.ChatMessageTable.threadId, threadId));

    // Only generate title for new conversations (≤3 messages: system + user + assistant)
    if (messages.length > 3) {
      console.log(`[AI IPC] Auto-title: Too many messages (${messages.length}), skipping`);
      return;
    }

    // Build content for title generation
    let titleContent = "";
    if (firstUserMessage) {
      titleContent += `user: ${firstUserMessage.slice(0, 500)}`;
    }
    if (firstAssistantText) {
      titleContent += `\n\nassistant: ${firstAssistantText.slice(0, 500)}`;
    }

    if (!titleContent.trim()) {
      console.log(`[AI IPC] Auto-title: No content for title generation`);
      return;
    }

    console.log(`[AI IPC] Auto-title: Generating title for thread ${threadId}`);

    // Use the chat model to generate a title
    if (!chatModel) {
      // Fallback title from first few words
      const fallbackTitle = firstUserMessage?.slice(0, 50).trim() + (firstUserMessage && firstUserMessage.length > 50 ? "..." : "") || "New Chat";
      await db
        .update(schema.ChatThreadTable)
        .set({ title: fallbackTitle })
        .where(eq(schema.ChatThreadTable.id, threadId));
      event.sender.send("ai:title:generated", { threadId, title: fallbackTitle });
      console.log(`[AI IPC] Auto-title: Used fallback title: "${fallbackTitle}"`);
      return;
    }

    // Get the API key for this provider
    const apiKey = await getApiKeyForProvider(chatModel.provider);

    if (!apiKey && !isLocalProvider(chatModel.provider)) {
      // Use fallback title
      const fallbackTitle = firstUserMessage?.slice(0, 50).trim() + (firstUserMessage && firstUserMessage.length > 50 ? "..." : "") || "New Chat";
      await db
        .update(schema.ChatThreadTable)
        .set({ title: fallbackTitle })
        .where(eq(schema.ChatThreadTable.id, threadId));
      event.sender.send("ai:title:generated", { threadId, title: fallbackTitle });
      console.log(`[AI IPC] Auto-title: No API key, used fallback title: "${fallbackTitle}"`);
      return;
    }

    // Get the model instance
    const model = await getModelInstance(chatModel, apiKey);

    if (!model) {
      const fallbackTitle = firstUserMessage?.slice(0, 50).trim() + (firstUserMessage && firstUserMessage.length > 50 ? "..." : "") || "New Chat";
      await db
        .update(schema.ChatThreadTable)
        .set({ title: fallbackTitle })
        .where(eq(schema.ChatThreadTable.id, threadId));
      event.sender.send("ai:title:generated", { threadId, title: fallbackTitle });
      return;
    }

    // Generate title using the AI SDK
    const { generateText } = await import("ai");
    const result = await generateText({
      model,
      messages: [
        {
          role: "system",
          content:
            "Generate a short, concise title (max 6 words) for this conversation. Respond with ONLY the title, no quotes or extra text.",
        },
        {
          role: "user",
          content: titleContent,
        },
      ],
      maxTokens: 30,
    } as Parameters<typeof generateText>[0]);

    const title = result.text.trim().replace(/^["']|["']$/g, ""); // Remove quotes if any

    // Update thread title in database
    await db
      .update(schema.ChatThreadTable)
      .set({ title })
      .where(eq(schema.ChatThreadTable.id, threadId));

    // Send title to renderer
    console.log(`[AI IPC] Auto-title: SENDING IPC event - threadId: ${threadId}, title: "${title}"`);
    event.sender.send("ai:title:generated", {
      threadId,
      title,
    });
    console.log(`[AI IPC] Auto-title: IPC event SENT successfully`);
  } catch (error: any) {
    console.error(`[AI IPC] Auto-title error for ${threadId}:`, error.message);
    // Non-fatal - don't throw, just log
  }
}

// Track stream contexts for two-phase streaming (prepare + start)
interface StreamContext {
  model: any;
  messages: any[];
  tools: Record<string, any> | undefined;
  abortController: AbortController;
  systemPrompt: string;
  threadId: string;
  event: Electron.IpcMainInvokeEvent;
  userMessage?: UIMessage; // Store user message for persistence
  chatModel?: { provider: string; model: string };
  chatMode?: "regular" | "agent";
  originalUIMessages?: UIMessage[]; // Store original UIMessages for follow-up calls
}
const preparedStreams = new Map<string, StreamContext>();

// Buffer for chunks sent before listener is ready
interface StreamBuffer {
  chunks: any[];
  listenerReady: boolean;
  ended: boolean;
  error?: string;
}
const streamBuffers = new Map<string, StreamBuffer>();

// Maximum size for inline data (base64 strings, etc.) in tokens
// Anything larger will be replaced with a placeholder
const MAX_INLINE_DATA_CHARS = 10000; // ~2500 tokens

/**
 * Sanitize messages to prevent context overflow from large inline data
 * Strips large base64 images/data and replaces with descriptive placeholders
 * Works with ModelMessage[] format (content-based, not parts-based)
 */
function sanitizeMessagesForContext(messages: any[]): any[] {
  return messages.map((message) => {
    // Handle ModelMessage format (uses 'content' not 'parts')
    if (message.content !== undefined) {
      // If content is a string, sanitize it
      if (typeof message.content === "string") {
        return {
          ...message,
          content: sanitizeTextContent(message.content),
        };
      }

      // If content is an array (AssistantModelMessage or ToolModelMessage)
      if (Array.isArray(message.content)) {
        const sanitizedContent = message.content.map((part: any) => {
          // Handle tool results (ModelMessage uses 'output')
          if (part.type === "tool-result" && part.output !== undefined) {
            return {
              ...part,
              output: sanitizeObject(part.output),
            };
          }

          // Handle tool calls (ModelMessage uses 'input')
          if (part.type === "tool-call" && part.input !== undefined) {
            return {
              ...part,
              input: sanitizeObject(part.input),
            };
          }

          // Handle text parts
          if (part.type === "text" && part.text) {
            return {
              ...part,
              text: sanitizeTextContent(part.text),
            };
          }

          return part;
        });

        return {
          ...message,
          content: sanitizedContent,
        };
      }
    }

    // Fallback: Handle UIMessage format (uses 'parts') for backwards compatibility
    if (message.parts) {
      const sanitizedParts = message.parts.map((part: any) => {
        // Handle tool results with large data
        if (part.type === "tool-result" || part.type === "tool-invocation") {
          return sanitizeToolPart(part);
        }

        // Handle text parts that might contain base64
        if (part.type === "text" && part.text) {
          return {
            ...part,
            text: sanitizeTextContent(part.text),
          };
        }

        return part;
      });

      return {
        ...message,
        parts: sanitizedParts,
      };
    }

    return message;
  });
}

/**
 * Sanitize tool invocation/result parts
 */
function sanitizeToolPart(part: any): any {
  const sanitized = { ...part };

  // Sanitize tool result content
  if (sanitized.result) {
    sanitized.result = sanitizeObject(sanitized.result);
  }

  // Sanitize tool args (shouldn't have large data but just in case)
  if (sanitized.args) {
    sanitized.args = sanitizeObject(sanitized.args);
  }

  return sanitized;
}

/**
 * Recursively sanitize an object, replacing large strings
 */
function sanitizeObject(obj: any): any {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === "string") {
    return sanitizeTextContent(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item));
  }

  if (typeof obj === "object") {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      // Special handling for known large data fields
      if (
        key === "screenshot" ||
        key === "image" ||
        key === "base64" ||
        key === "data"
      ) {
        if (typeof value === "string" && value.length > MAX_INLINE_DATA_CHARS) {
          // Check if it's base64 image data
          if (
            value.startsWith("data:image") ||
            value.match(/^[A-Za-z0-9+/=]{1000,}$/)
          ) {
            sanitized[key] =
              `[Image data: ${Math.round(value.length / 1024)}KB - content stripped to save context]`;
            continue;
          }
        }
      }
      sanitized[key] = sanitizeObject(value);
    }
    return sanitized;
  }

  return obj;
}

/**
 * Sanitize text content, replacing large base64 strings
 */
function sanitizeTextContent(text: string): string {
  if (text.length <= MAX_INLINE_DATA_CHARS) return text;

  // Check for base64 image data URLs
  const dataUrlPattern = /data:image\/[^;]+;base64,[A-Za-z0-9+/=]{10000,}/g;
  let sanitized = text.replace(dataUrlPattern, (match) => {
    return `[Image data: ${Math.round(match.length / 1024)}KB - content stripped to save context]`;
  });

  // Check for raw base64 strings (very long alphanumeric with +/=)
  const base64Pattern = /[A-Za-z0-9+/=]{10000,}/g;
  sanitized = sanitized.replace(base64Pattern, (match) => {
    // Verify it looks like base64 (has padding or mixed chars)
    if (match.includes("+") || match.includes("/") || match.endsWith("=")) {
      return `[Base64 data: ${Math.round(match.length / 1024)}KB - content stripped to save context]`;
    }
    return match; // Not base64, keep it
  });

  return sanitized;
}

/**
 * Ensure a thread exists in the database, creating it if necessary
 * Returns true if a new thread was created, false if it already existed
 */
async function ensureThreadExists(threadId: string): Promise<boolean> {
  const db = getDatabase();
  const existing = await db
    .select()
    .from(schema.ChatThreadTable)
    .where(eq(schema.ChatThreadTable.id, threadId))
    .limit(1);

  if (existing.length === 0) {
    // Thread doesn't exist, create it
    // Get the user ID - try auth service first, then fall back to database
    let userId: string | undefined;

    try {
      // Import auth service to get currently authenticated user
      const { ElectronAuthService } = require("../services/auth");
      const authService = ElectronAuthService.getInstance();
      const currentUser = await authService.getCurrentUser();
      userId = currentUser?.id;
      console.log(
        `[AI IPC] ensureThreadExists - auth user id: ${userId || "null"}`,
      );
    } catch (err) {
      console.warn(
        "[AI IPC] ensureThreadExists - failed to get auth user:",
        err,
      );
    }

    // Fall back to first user in database if auth fails
    if (!userId) {
      const users = await db.select().from(schema.UserTable).limit(1);
      userId = users[0]?.id;
      console.log(
        `[AI IPC] ensureThreadExists - fallback db user id: ${userId || "null"}`,
      );
    }

    if (userId) {
      await db.insert(schema.ChatThreadTable).values({
        id: threadId,
        userId,
        title: "New Chat", // Default title, will be updated after first response
        createdAt: new Date(),
      });
      console.log(
        `[AI IPC] ensureThreadExists - created thread ${threadId} for user ${userId}`,
      );
      return true; // New thread was created
    } else {
      throw new Error(`Cannot create thread - no user found in database`);
    }
  }
  return false; // Thread already existed
}

/**
 * Save a message to the database
 * Returns true if a new thread was created, false otherwise
 */
async function saveMessageToDb(
  threadId: string,
  messageId: string,
  role: "user" | "assistant",
  parts: any[],
  metadata?: Record<string, any>,
): Promise<boolean> {
  try {
    const db = getDatabase();

    // Ensure thread exists before saving message
    const newThreadCreated = await ensureThreadExists(threadId);

    await db
      .insert(schema.ChatMessageTable)
      .values({
        id: messageId,
        threadId,
        role,
        parts: parts as any,
        metadata: metadata || null,
        createdAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.ChatMessageTable.id,
        set: {
          parts: parts as any,
          metadata: metadata || null,
        },
      });

    return newThreadCreated;
  } catch (error) {
    console.error(`[AI IPC] Failed to save ${role} message:`, error);
    throw error; // Re-throw so caller knows save failed
  }
}

/**
 * Load MCP tools from allowed servers
 */
async function loadMcpTools(
  allowedMcpServers: Record<string, AllowedMCPServer> | undefined,
): Promise<Record<string, any>> {
  if (!allowedMcpServers || Object.keys(allowedMcpServers).length === 0) {
    return {};
  }

  const db = getDatabase();
  const serverIds = Object.keys(allowedMcpServers);

  // Get server configs from database
  const servers = await db
    .select()
    .from(schema.McpServerTable)
    .where(inArray(schema.McpServerTable.id, serverIds));

  const tools: Record<string, any> = {};

  for (const server of servers) {
    const allowedTools = allowedMcpServers[server.id]?.tools || [];
    if (allowedTools.length === 0) continue;

    try {
      // Use shared MCP client service to ensure client is connected
      const client = await ensureClientConnected(
        server.id,
        server.name,
        server.config as MCPServerConfig,
      );

      // Check if client is connected and has tool info
      if (client.status === "connected" && client.toolInfo) {
        for (const toolInfo of client.toolInfo) {
          // Only include tools that are in the allowed list
          const toolId = `mcp_${server.name}_${toolInfo.name}`;
          if (
            allowedTools.includes(toolInfo.name) ||
            allowedTools.includes("*")
          ) {
            // Convert MCP tool's inputSchema to a proper JSON schema for the AI SDK
            // The tool's inputSchema should already be a valid JSON schema from the MCP server
            let mcpInputSchema = toolInfo.inputSchema || {
              type: "object",
              properties: {},
            };

            // Ensure the schema has a type field (required by Anthropic)
            if (!mcpInputSchema.type) {
              mcpInputSchema = { ...mcpInputSchema, type: "object" };
            }

            // Ensure properties exists and is an object
            if (!mcpInputSchema.properties) {
              mcpInputSchema = { ...mcpInputSchema, properties: {} };
            }

            // Validate that all property schemas have a type field
            if (
              mcpInputSchema.properties &&
              typeof mcpInputSchema.properties === "object"
            ) {
              for (const [_propName, propSchema] of Object.entries(
                mcpInputSchema.properties,
              )) {
                if (propSchema && typeof propSchema === "object") {
                  const prop = propSchema as any;
                  if (!prop.type) {
                    prop.type = "string";
                  }
                  // Also check nested schemas (for objects/arrays)
                  if (prop.type === "object" && prop.properties) {
                    for (const [
                      nestedPropName,
                      nestedPropSchema,
                    ] of Object.entries(prop.properties)) {
                      if (
                        nestedPropSchema &&
                        typeof nestedPropSchema === "object" &&
                        !("type" in nestedPropSchema)
                      ) {
                        (prop.properties as any)[nestedPropName] = {
                          ...nestedPropSchema,
                          type: "string",
                        };
                      }
                    }
                  }
                  if (
                    prop.type === "array" &&
                    prop.items &&
                    typeof prop.items === "object" &&
                    !("type" in prop.items)
                  ) {
                    prop.items = { ...prop.items, type: "string" };
                  }
                }
              }
            }

            // Recursively ensure all schemas have type fields
            function ensureSchemaTypes(schema: any): any {
              if (!schema || typeof schema !== "object") {
                return schema;
              }

              // If it's an array, process items
              if (Array.isArray(schema)) {
                return schema.map(ensureSchemaTypes);
              }

              // Ensure type exists
              if (!schema.type && schema.properties) {
                schema.type = "object";
              }

              // Process properties
              if (schema.properties) {
                for (const [key, value] of Object.entries(schema.properties)) {
                  if (value && typeof value === "object") {
                    schema.properties[key] = ensureSchemaTypes(value);
                    if (!schema.properties[key].type) {
                      schema.properties[key].type = "string";
                    }
                  }
                }
              }

              // Process items (for arrays)
              if (schema.items) {
                schema.items = ensureSchemaTypes(schema.items);
                if (!schema.items.type) {
                  schema.items.type = "string";
                }
              }

              return schema;
            }

            mcpInputSchema = ensureSchemaTypes(mcpInputSchema);

            try {
              tools[toolId] = createTool({
                description:
                  toolInfo.description || `MCP tool: ${toolInfo.name}`,
                inputSchema: jsonSchema(mcpInputSchema as any),
                execute: async (params) => {
                  console.log(
                    `[AI MCP] Calling tool ${toolInfo.name} on ${server.name}`,
                  );
                  try {
                    // Add 60-second timeout for tool execution
                    const timeoutPromise = new Promise((_, reject) =>
                      setTimeout(
                        () =>
                          reject(
                            new Error(
                              `Tool '${toolInfo.name}' timed out after 60s`,
                            ),
                          ),
                        60000,
                      ),
                    );

                    const result = await Promise.race([
                      client.callTool(toolInfo.name, params),
                      timeoutPromise,
                    ]);
                    return result;
                  } catch (error: any) {
                    console.error(`[AI MCP] Tool call failed:`, error);
                    return { error: error.message };
                  }
                },
              });
              // console.log(`[AI MCP] Loaded tool: ${toolId}`);
            } catch (toolError: any) {
              console.error(
                `[AI MCP] Failed to create tool ${toolId}:`,
                toolError.message,
              );
              // Skip this tool but continue with others
            }
          }
        }
      }
    } catch (error) {
      console.error(
        `[AI MCP] Failed to load tools from ${server.name}:`,
        error,
      );
    }
  }

  return tools;
}

// Type for stream request
interface StreamRequest {
  threadId: string;
  messages: UIMessage[];
  chatModel: {
    provider: string;
    model: string;
  };
  toolChoice?: string;
  chatMode?: "regular" | "agent";
  allowedAppDefaultToolkit?: string[];
  allowedMcpServers?: Record<string, any>;
  mentions?: any[];
  message: UIMessage;
  imageTool?: { model?: string };
  attachments?: any[];
}

// Decrypt API key using Electron's safeStorage
function decryptApiKey(encryptedKey: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    const buffer = Buffer.from(encryptedKey, "base64");
    return safeStorage.decryptString(buffer);
  }
  // Fallback: base64 decode
  return Buffer.from(encryptedKey, "base64").toString("utf-8");
}

/**
 * System prompt for agentic behavior
 */
const AGENT_SYSTEM_PROMPT = `You are Shadower, an autonomous AI assistant running as a desktop application.

## CAPABILITIES
You have FULL ACCESS to the user's computer through tools:
- **Terminal**: Execute any shell command (bash, zsh, powershell)
- **File System**: Read, write, create, and delete files
- **Screenshots**: Take screenshots of the entire screen or specific windows
- **Desktop Automation**: Click, type, scroll, and interact with any application
- **Clipboard**: Read and write to clipboard
- **Browser**: Open URLs in the default browser

## BEHAVIOR
1. **Be Proactive**: When given a task, break it down and execute it step by step
2. **Use Tools**: Don't just describe what you would do - actually DO it using tools
3. **Show Progress**: After each tool call, explain what you did and what's next
4. **Handle Errors**: If a tool fails, try alternative approaches
5. **Ask When Needed**: If you need clarification, ask - but prefer to make reasonable assumptions

## IMPORTANT
- You are running on the user's LOCAL machine - file paths and commands are LOCAL
- You can see and interact with the user's desktop
- You have permission to execute commands and modify files when asked
- Always confirm before making destructive changes (deleting files, etc.)

## PLATFORM
Operating System: ${os.platform()} (${os.release()})
Architecture: ${os.arch()}
Home Directory: ${os.homedir()}
`;

/**
 * Create desktop tools that work in Electron main process
 * Note: event parameter is optional for sending screenshots to UI
 */
function createElectronTools(
  threadId: string,
  event?: Electron.IpcMainInvokeEvent,
) {
  return {
    // Terminal command execution
    terminal_execute: createTool({
      description:
        "Execute a shell command in the terminal. Returns stdout, stderr, and exit code.",
      inputSchema: z
        .object({
          command: z.string().describe("The command to execute"),
          cwd: z
            .string()
            .optional()
            .describe("Working directory (defaults to home directory)"),
          timeout: z
            .number()
            .optional()
            .describe("Timeout in milliseconds (default 30000)"),
        })
        .describe("Terminal execution parameters"),
      execute: async ({ command, cwd, timeout = 30000 }) => {
        // console.log(`[AI Tools] Executing command: ${command}`);
        try {
          const { stdout, stderr } = await execAsync(command, {
            cwd: cwd || os.homedir(),
            timeout,
            maxBuffer: 10 * 1024 * 1024, // 10MB buffer
          });
          return {
            success: true,
            stdout: stdout.slice(0, 50000), // Limit output size
            stderr: stderr.slice(0, 10000),
            exitCode: 0,
          };
        } catch (error: any) {
          return {
            success: false,
            stdout: error.stdout?.slice(0, 50000) || "",
            stderr: error.stderr?.slice(0, 10000) || error.message,
            exitCode: error.code || 1,
            error: error.message,
          };
        }
      },
    }),

    // Read file
    file_read: createTool({
      description: "Read the contents of a file",
      inputSchema: z.object({
        path: z.string().describe("Absolute path to the file"),
        encoding: z
          .string()
          .optional()
          .describe("File encoding (default utf-8)"),
      }),
      execute: async ({ path: filePath, encoding = "utf-8" }) => {
        // console.log(`[AI Tools] Reading file: ${filePath}`);
        try {
          const content = fs.readFileSync(filePath, encoding as BufferEncoding);
          return {
            success: true,
            content: content.slice(0, 100000), // Limit content size
            size: content.length,
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
          };
        }
      },
    }),

    // Write file
    file_write: createTool({
      description:
        "Write content to a file (creates parent directories if needed)",
      inputSchema: z.object({
        path: z.string().describe("Absolute path to the file"),
        content: z.string().describe("Content to write"),
        append: z
          .boolean()
          .optional()
          .describe("Append to file instead of overwrite"),
      }),
      execute: async ({ path: filePath, content, append = false }) => {
        // console.log(`[AI Tools] Writing file: ${filePath}`);
        try {
          // Create parent directory if needed
          const dir = path.dirname(filePath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }

          if (append) {
            fs.appendFileSync(filePath, content);
          } else {
            fs.writeFileSync(filePath, content);
          }

          return {
            success: true,
            path: filePath,
            bytesWritten: content.length,
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
          };
        }
      },
    }),

    // List directory
    file_list: createTool({
      description: "List files and directories in a path",
      inputSchema: z.object({
        path: z.string().describe("Directory path to list"),
        recursive: z
          .boolean()
          .optional()
          .describe("List recursively (default false)"),
      }),
      execute: async ({ path: dirPath, recursive = false }) => {
        // console.log(`[AI Tools] Listing directory: ${dirPath}`);
        try {
          const items: string[] = [];

          function listDir(dir: string, prefix: string = "") {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
              const fullPath = path.join(dir, entry.name);
              const relativePath = prefix + entry.name;
              items.push(
                entry.isDirectory() ? relativePath + "/" : relativePath,
              );

              if (recursive && entry.isDirectory() && items.length < 1000) {
                try {
                  listDir(fullPath, relativePath + "/");
                } catch {
                  // Skip inaccessible directories
                }
              }
            }
          }

          listDir(dirPath);

          return {
            success: true,
            items: items.slice(0, 500), // Limit items
            totalCount: items.length,
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
          };
        }
      },
    }),

    // Take screenshot - sends image to UI, returns only metadata to AI
    desktop_screenshot: createTool({
      description:
        "Take a screenshot of the screen. The screenshot will be displayed in the chat UI. " +
        "You will receive metadata (dimensions, timestamp) but NOT the image data to save context. " +
        "Use this to show users what you're seeing, then describe what actions you'll take.",
      inputSchema: z.object({
        fullScreen: z
          .boolean()
          .optional()
          .describe("Capture full screen (default true)"),
        description: z
          .string()
          .optional()
          .describe("Brief description of why you're taking this screenshot"),
      }),
      execute: async ({ fullScreen = true, description }) => {
        // console.log(`[AI Tools] Taking screenshot`);
        try {
          const sources = await desktopCapturer.getSources({
            types: fullScreen ? ["screen"] : ["window"],
            thumbnailSize: { width: 1920, height: 1080 },
          });

          if (sources.length === 0) {
            return { success: false, error: "No screen sources found" };
          }

          const thumbnail = sources[0].thumbnail;
          const base64 = thumbnail.toDataURL();
          const width = thumbnail.getSize().width;
          const height = thumbnail.getSize().height;
          const timestamp = new Date().toISOString();
          const screenshotId = `screenshot-${Date.now()}`;

          // Send screenshot to UI via IPC event (user sees the image)
          // The AI only gets metadata to save tokens
          if (event?.sender) {
            event.sender.send("ai:stream:chunk", {
              threadId,
              chunk: JSON.stringify({
                type: "data-screenshot",
                data: {
                  id: screenshotId,
                  screenshot: base64, // Full image for UI display
                  width,
                  height,
                  timestamp,
                  description: description || "Screen capture",
                },
              }),
            });
          }

          // Return only metadata to AI - NO image data = huge token savings
          return {
            success: true,
            message: `Screenshot captured and displayed to user (${width}x${height}). The user can see the screenshot in the chat. You do NOT receive the image data to save context tokens.`,
            screenshotId,
            width,
            height,
            timestamp,
            description: description || "Screen capture",
            note: "Describe what you expect to see or what you plan to do next. If you need to analyze specific UI elements, use browser automation tools to extract text content.",
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
          };
        }
      },
    }),

    // Open URL in browser
    browser_open: createTool({
      description: "Open a URL in the default browser",
      inputSchema: z.object({
        url: z.string().describe("URL to open"),
      }),
      execute: async ({ url }) => {
        try {
          await shell.openExternal(url);
          return { success: true, url };
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      },
    }),

    // Clipboard operations
    clipboard_read: createTool({
      description: "Read text from the clipboard",
      inputSchema: z.object({}).describe("No parameters required"),
      execute: async () => {
        // console.log(`[AI Tools] Reading clipboard`);
        try {
          const text = clipboard.readText();
          return { success: true, content: text.slice(0, 50000) };
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      },
    }),

    clipboard_write: createTool({
      description: "Write text to the clipboard",
      inputSchema: z.object({
        text: z.string().describe("Text to write to clipboard"),
      }),
      execute: async ({ text }) => {
        try {
          clipboard.writeText(text);
          return { success: true, bytesWritten: text.length };
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      },
    }),

    // Get system info
    system_info: createTool({
      description: "Get system information (OS, memory, CPU, etc.)",
      inputSchema: z.object({}).describe("No parameters required"),
      execute: async () => {
        return {
          success: true,
          platform: os.platform(),
          release: os.release(),
          arch: os.arch(),
          hostname: os.hostname(),
          homedir: os.homedir(),
          tmpdir: os.tmpdir(),
          cpus: os.cpus().length,
          totalMemory: Math.round(os.totalmem() / 1024 / 1024 / 1024) + " GB",
          freeMemory: Math.round(os.freemem() / 1024 / 1024 / 1024) + " GB",
          uptime: Math.round(os.uptime() / 60) + " minutes",
        };
      },
    }),

    // Search files
    file_search: createTool({
      description: "Search for files matching a pattern",
      inputSchema: z.object({
        directory: z.string().describe("Directory to search in"),
        pattern: z.string().describe("Glob pattern or filename to search for"),
        maxResults: z
          .number()
          .optional()
          .describe("Maximum results (default 50)"),
      }),
      execute: async ({ directory, pattern, maxResults = 50 }) => {
        // console.log(`[AI Tools] Searching files: ${pattern} in ${directory}`);
        try {
          // Use find command on Unix, dir on Windows
          const isWindows = os.platform() === "win32";
          const command = isWindows
            ? `dir /s /b "${directory}\\*${pattern}*" 2>nul`
            : `find "${directory}" -name "*${pattern}*" -type f 2>/dev/null | head -${maxResults}`;

          const { stdout } = await execAsync(command, { timeout: 30000 });
          const files = stdout.split("\n").filter(Boolean).slice(0, maxResults);

          return {
            success: true,
            files,
            count: files.length,
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            files: [],
          };
        }
      },
    }),

    // Web search using DuckDuckGo (free, no API key needed)
    web_search: createTool({
      description:
        "Search the web for information using DuckDuckGo. Returns search results with titles, URLs, and snippets.",
      inputSchema: z.object({
        query: z.string().describe("The search query"),
        numResults: z
          .number()
          .optional()
          .describe("Maximum number of results to return (default 5)"),
      }),
      execute: async ({ query, numResults = 5 }) => {
        console.log(`[AI Tools] Web search: ${query}`);
        try {
          // Use DuckDuckGo HTML search and parse results
          const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
          const response = await fetch(searchUrl, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
          });

          if (!response.ok) {
            throw new Error(`Search failed: ${response.status}`);
          }

          const html = await response.text();

          // Parse search results from HTML
          const results: Array<{
            title: string;
            url: string;
            snippet: string;
          }> = [];
          const resultRegex =
            /<a class="result__a" href="([^"]+)"[^>]*>([^<]+)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

          let match;
          while (
            (match = resultRegex.exec(html)) !== null &&
            results.length < numResults
          ) {
            const url = match[1];
            const title = match[2].trim();
            const snippet = match[3].replace(/<[^>]+>/g, "").trim();

            // Skip DuckDuckGo internal links
            if (!url.startsWith("//duckduckgo.com")) {
              results.push({ title, url, snippet });
            }
          }

          // Fallback: Try DuckDuckGo instant answer API
          if (results.length === 0) {
            const instantUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`;
            const instantResponse = await fetch(instantUrl);
            const instantData = await instantResponse.json();

            if (instantData.AbstractText) {
              results.push({
                title: instantData.Heading || "DuckDuckGo Answer",
                url: instantData.AbstractURL || "",
                snippet: instantData.AbstractText,
              });
            }

            // Add related topics
            if (instantData.RelatedTopics) {
              for (const topic of instantData.RelatedTopics.slice(
                0,
                numResults - results.length,
              )) {
                if (topic.Text && topic.FirstURL) {
                  results.push({
                    title: topic.Text.split(" - ")[0] || "Related",
                    url: topic.FirstURL,
                    snippet: topic.Text,
                  });
                }
              }
            }
          }

          return {
            success: true,
            query,
            results,
            count: results.length,
          };
        } catch (error: any) {
          console.error("[AI Tools] Web search error:", error);
          return {
            success: false,
            error: error.message,
            results: [],
          };
        }
      },
    }),

    // Fetch URL content
    web_fetch: createTool({
      description:
        "Fetch the content of a web page and extract its text. Useful for reading articles, documentation, etc.",
      inputSchema: z.object({
        url: z.string().describe("The URL to fetch"),
        maxLength: z
          .number()
          .optional()
          .describe("Maximum content length to return (default 10000)"),
      }),
      execute: async ({ url, maxLength = 10000 }) => {
        // console.log(`[AI Tools] Web fetch: ${url}`);
        try {
          const response = await fetch(url, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
          });

          if (!response.ok) {
            throw new Error(`Fetch failed: ${response.status}`);
          }

          const html = await response.text();

          // Simple HTML to text conversion
          let text = html
            // Remove scripts and styles
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
            // Remove HTML tags
            .replace(/<[^>]+>/g, " ")
            // Decode HTML entities
            .replace(/&nbsp;/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            // Clean up whitespace
            .replace(/\s+/g, " ")
            .trim();

          // Truncate if too long
          if (text.length > maxLength) {
            text = text.slice(0, maxLength) + "... [truncated]";
          }

          return {
            success: true,
            url,
            content: text,
            length: text.length,
          };
        } catch (error: any) {
          console.error("[AI Tools] Web fetch error:", error);
          return {
            success: false,
            error: error.message,
          };
        }
      },
    }),

    // Memory search - search past conversations for relevant context
    memory_search: createTool({
      description:
        "Search past conversations and memory for relevant context. Use this to recall information from previous conversations, remember user preferences, or find related discussions. Returns semantically similar content from conversation history.",
      inputSchema: z.object({
        query: z
          .string()
          .describe("The search query to find relevant context from memory"),
        limit: z
          .number()
          .optional()
          .describe("Maximum number of results to return (default 5)"),
        scoreThreshold: z
          .number()
          .optional()
          .describe("Minimum relevance score 0-1 (default 0.5)"),
      }),
      execute: async ({ query, limit = 5, scoreThreshold = 0.5 }) => {
        const start = performance.now();

        try {
          if (!query || query.trim().length < 3) {
            return {
              success: false,
              error: "Query must be at least 3 characters long",
              results: [],
              count: 0,
            };
          }

          const vectorStore = getVectorStore();

          // Initialize if needed
          if (!vectorStore.isAvailable()) {
            await vectorStore.initialize();
          }

          if (!vectorStore.isAvailable()) {
            return {
              success: false,
              error: "Memory system not available",
              results: [],
              count: 0,
            };
          }

          // Get OpenAI API key for embeddings
          const apiKey = await getApiKeyForProvider("openai");
          if (!apiKey) {
            return {
              success: false,
              error:
                "OpenAI API key not configured. Memory search requires embeddings.",
              results: [],
              count: 0,
            };
          }

          // Generate query embedding
          const embeddingResponse = await fetch(
            "https://api.openai.com/v1/embeddings",
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: "text-embedding-3-small",
                input: query.replace(/\s+/g, " ").trim().slice(0, 8000),
                dimensions: 1536,
              }),
            },
          );

          if (!embeddingResponse.ok) {
            const errorText = await embeddingResponse.text();
            return {
              success: false,
              error: `Failed to generate embedding: ${errorText}`,
              results: [],
              count: 0,
            };
          }

          const embeddingData = await embeddingResponse.json();
          const queryEmbedding = embeddingData.data[0].embedding;

          // Search vector store
          const searchResults = await vectorStore.search(
            queryEmbedding,
            "messages",
            limit * 2, // Get more for filtering
          );

          // Extract keywords for hybrid boost
          const keywords = query
            .toLowerCase()
            .split(/\s+/)
            .filter((w) => w.length > 2);

          // Apply hybrid scoring
          const scoredResults = searchResults
            .map((result: any) => {
              const content = String(result.content || "").toLowerCase();

              // Keyword boost
              let keywordBoost = 0;
              for (const keyword of keywords) {
                if (content.includes(keyword)) {
                  keywordBoost += 0.15 / keywords.length;
                }
              }

              const finalScore = Math.min(
                1.0,
                (result.similarity || 0) + keywordBoost,
              );

              return {
                id: result.id,
                content: result.content,
                score: finalScore,
                role: result.role,
                threadId: result.thread_id,
                createdAt: result.created_at,
              };
            })
            .filter((r: any) => r.score >= scoreThreshold)
            .sort((a: any, b: any) => b.score - a.score)
            .slice(0, limit);

          const elapsedMs = Math.round(performance.now() - start);

          console.log(
            `[AI Tools] Memory search: ${scoredResults.length} results in ${elapsedMs}ms`,
          );

          return {
            success: true,
            results: scoredResults,
            count: scoredResults.length,
            query,
            elapsedMs,
          };
        } catch (error: any) {
          console.error("[AI Tools] Memory search error:", error);
          return {
            success: false,
            error: error.message || "Failed to search memory",
            results: [],
            count: 0,
          };
        }
      },
    }),
  };
}

export function registerAIHandlers() {
  // Also register the workflow generation handler
  registerWorkflowGenerationHandler();
  /**
   * Phase 1: Prepare the stream (setup model, tools, etc.)
   * Returns immediately so renderer can set up listeners
   * Actual streaming starts when renderer calls ai:stream:start
   */
  ipcMain.handle("ai:stream", async (event, request: StreamRequest) => {
    const {
      threadId,
      messages,
      chatModel,
      message,
      allowedMcpServers,
      chatMode,
    } = request;

    console.log(
      `[AI IPC] Stream PREPARE for thread: ${threadId}, model: ${chatModel?.provider}/${chatModel?.model}, mode: ${chatMode || "regular"}`,
    );
    // console.log(
    //   `[AI IPC] Allowed toolkits: ${allowedAppDefaultToolkit?.join(", ") || "all"}`,
    // );
    // console.log(
    //   `[AI IPC] Allowed MCP servers: ${allowedMcpServers ? Object.keys(allowedMcpServers).join(", ") : "none"}`,
    // );

    // Create abort controller for this stream
    const abortController = new AbortController();
    activeStreams.set(threadId, abortController);

    // Initialize buffer for this stream
    streamBuffers.set(threadId, {
      chunks: [],
      listenerReady: false,
      ended: false,
    });

    try {
      // Get the API key for this provider
      const apiKey = await getApiKeyForProvider(chatModel.provider);

      if (!apiKey && !isLocalProvider(chatModel.provider)) {
        const errorMsg = `No API key configured for ${chatModel.provider}. Please add an API key in Settings > Models.`;
        streamBuffers.get(threadId)!.error = errorMsg;
        return { error: errorMsg, threadId };
      }

      // Get the model instance
      let model;
      try {
        model = await getModelInstance(chatModel, apiKey);
      } catch (modelError: any) {
        const errorMsg = `Could not initialize model ${chatModel.provider}/${chatModel.model}: ${modelError?.message || modelError}`;
        console.error(`[AI IPC] Model initialization failed:`, modelError);
        streamBuffers.get(threadId)!.error = errorMsg;
        return { error: errorMsg, threadId };
      }

      if (!model) {
        const errorMsg = `Could not initialize model ${chatModel.provider}/${chatModel.model}. Check the main process logs for details.`;
        streamBuffers.get(threadId)!.error = errorMsg;
        return { error: errorMsg, threadId };
      }

      // Prepare messages for the model
      const allMessages = [...messages];
      if (message && allMessages[allMessages.length - 1]?.id !== message.id) {
        allMessages.push(message);
      }

      // Debug: Log input messages before conversion
      console.log(
        `[AI IPC] Converting ${allMessages.length} messages to model format`,
      );
      allMessages.forEach((msg: any, idx: number) => {
        console.log(
          `[AI IPC] Input message ${idx}: role=${msg.role}, id=${msg.id}`,
        );
        if (msg.parts) {
          msg.parts.forEach((part: any, pIdx: number) => {
            console.log(
              `[AI IPC]   Part ${pIdx}: type=${part.type}, state=${part.state || "N/A"}, toolName=${part.toolName || "N/A"}`,
            );
          });
        }
      });

      // Convert to model format
      let modelMessages;
      try {
        modelMessages = await convertToModelMessages(allMessages);
        console.log(
          `[AI IPC] Successfully converted to ${modelMessages.length} model messages`,
        );
      } catch (conversionError: any) {
        console.error(
          `[AI IPC] convertToModelMessages FAILED:`,
          conversionError.message,
        );
        console.error(`[AI IPC] Full error:`, conversionError);
        throw conversionError;
      }

      // Load MCP tools if allowed - THESE TAKE PRIORITY
      const mcpTools = await loadMcpTools(allowedMcpServers);
      const mcpToolNames = Object.keys(mcpTools);

      // Check what categories of MCP tools are available (for renaming conflicts, not filtering)
      const hasMcpFileSystem = mcpToolNames.some(
        (name) =>
          name.includes("filesystem") ||
          name.includes("file_") ||
          name.includes("read_file") ||
          name.includes("write_file"),
      );
      const hasMcpBrowser = mcpToolNames.some(
        (name) =>
          name.includes("browser") ||
          name.includes("playwright") ||
          name.includes("puppeteer"),
      );
      const hasMcpSearch = mcpToolNames.some(
        (name) =>
          name.includes("search") ||
          name.includes("brave") ||
          name.includes("exa"),
      );

      // Create desktop tools for this thread
      const allDesktopTools = createElectronTools(threadId, event);

      // IMPORTANT: Desktop tools should ALWAYS be available alongside MCP tools
      // Terminal/shell execution is fundamental and should never be filtered out
      // Let both coexist - the model can choose the best tool for the task
      const desktopTools: Record<string, any> = {};

      for (const [toolName, tool] of Object.entries(allDesktopTools)) {
        // ALWAYS include terminal_execute - it's fundamental for local execution
        // Even with GitHub MCP, users need terminal for npm, python, scripts, etc.

        // For file tools when MCP provides filesystem, rename to avoid conflicts
        // but KEEP them available (MCP might be sandboxed, local gives full access)
        if (
          (toolName === "file_read" ||
            toolName === "file_write" ||
            toolName === "file_list" ||
            toolName === "file_search") &&
          hasMcpFileSystem
        ) {
          // Rename to local_* to differentiate from MCP filesystem tools
          desktopTools[`local_${toolName}`] = tool;
          console.log(
            `[AI IPC] Renamed ${toolName} to local_${toolName} - MCP also provides filesystem`,
          );
          continue;
        }

        // For web tools when MCP provides search, rename to avoid conflicts
        if (
          (toolName === "web_search" || toolName === "web_fetch") &&
          hasMcpSearch
        ) {
          desktopTools[`local_${toolName}`] = tool;
          console.log(
            `[AI IPC] Renamed ${toolName} to local_${toolName} - MCP also provides search`,
          );
          continue;
        }

        // For browser_open when MCP provides browser, rename to avoid conflicts
        if (toolName === "browser_open" && hasMcpBrowser) {
          desktopTools[`local_${toolName}`] = tool;
          console.log(
            `[AI IPC] Renamed ${toolName} to local_${toolName} - MCP also provides browser`,
          );
          continue;
        }

        // Include all other tools without modification
        desktopTools[toolName] = tool;
      }

      console.log(
        `[AI IPC] Desktop tools (after MCP filtering): ${Object.keys(desktopTools).join(", ")}`,
      );
      console.log(`[AI IPC] MCP tools: ${mcpToolNames.join(", ") || "none"}`);

      // Merge all tools - MCP tools listed first for priority in model context
      const tools = { ...mcpTools, ...desktopTools };

      // Check model capabilities before passing tools
      const capabilities = getModelCapabilities(chatModel.model);
      const isLocal = isLocalProvider(chatModel.provider);

      // For local models, check if the model is in the known whitelist
      // But we now TRY tools anyway for unknown models - better to try and fail gracefully
      const isKnownToolSupport = isLocal
        ? localModelSupportsTools(chatModel.model)
        : true;

      const modelSupportsTools = capabilities.isToolCallSupported;

      // Handle empty tools or definitely unsupported models
      let toolsToUse: typeof tools | undefined;
      if (Object.keys(tools).length === 0) {
        toolsToUse = undefined;
      } else if (!modelSupportsTools) {
        // Model has built-in tools or requires Responses API - can't use our tools
        console.warn(
          `[AI IPC] Model ${chatModel.provider}/${chatModel.model} has conflicting tool requirements, proceeding without tools`,
        );
        event.sender.send("ai:stream:warning", {
          threadId,
          message: `Model "${chatModel.model}" has built-in tools that conflict with custom tools. Running without tool capabilities.`,
          type: "tool-unsupported",
        });
        toolsToUse = undefined;
      } else if (isLocal && !isKnownToolSupport) {
        // Local model not in whitelist - TRY ANYWAY with warning
        // Better UX to try and fail than to preemptively disable
        console.log(
          `[AI IPC] Local model ${chatModel.model} not in known tool-support whitelist, but trying tools anyway`,
        );
        event.sender.send("ai:stream:warning", {
          threadId,
          message: `Model "${chatModel.model}" may have limited tool support. If tools fail, consider using a model like Llama 3, Qwen, or DeepSeek.`,
          type: "tool-experimental",
        });
        toolsToUse = tools; // TRY ANYWAY!
      } else {
        toolsToUse = tools;
      }

      // Store prepared context - DON'T start streaming yet!
      preparedStreams.set(threadId, {
        model,
        messages: modelMessages,
        tools: toolsToUse,
        abortController,
        systemPrompt: AGENT_SYSTEM_PROMPT,
        threadId,
        event,
        userMessage: message, // Store user message for saving
        chatModel,
        chatMode,
        originalUIMessages: allMessages, // Store original UIMessages for follow-up tool calls
      });

      // console.log(`[AI IPC] Stream prepared for thread: ${threadId}, waiting for start signal`);

      // Return success - renderer should now set up listeners and call ai:stream:start
      return { success: true, threadId, status: "prepared" };
    } catch (error: any) {
      console.error("[AI IPC] Stream prepare error:", error);
      streamBuffers.get(threadId)!.error = error.message;
      activeStreams.delete(threadId);
      return { error: error.message, threadId };
    }
  });

  /**
   * Phase 2: Actually start streaming after listeners are ready
   * This is called by the renderer AFTER it has set up all IPC listeners
   */
  ipcMain.handle(
    "ai:stream:start",
    async (event, request: { threadId: string }) => {
      const { threadId } = request;

      console.log(`[AI IPC] Stream START received for thread: ${threadId}`);

      const context = preparedStreams.get(threadId);
      const buffer = streamBuffers.get(threadId);

      if (!context) {
        console.error(
          `[AI IPC] No prepared stream found for thread: ${threadId}`,
        );
        event.sender.send("ai:stream:error", {
          threadId,
          error: "Stream not prepared. Call ai:stream first.",
        });
        return { error: "Stream not prepared" };
      }

      // Check if there was an error during preparation
      if (buffer?.error) {
        event.sender.send("ai:stream:error", {
          threadId,
          error: buffer.error,
        });
        preparedStreams.delete(threadId);
        streamBuffers.delete(threadId);
        return { error: buffer.error };
      }

      // Mark listener as ready
      if (buffer) {
        buffer.listenerReady = true;
      }

      const {
        model,
        messages,
        tools,
        abortController,
        systemPrompt,
        userMessage,
        chatModel,
        chatMode,
      } = context;

      console.log(
        `[AI IPC] Stream start context - threadId: ${threadId}, hasUserMessage: ${!!userMessage}, chatModel: ${chatModel?.provider}/${chatModel?.model}`,
      );

      // Get database instance for agent mode
      const db = getDatabase();

      try {
        // SAVE USER MESSAGE to database before streaming (BLOCKING to ensure persistence)
        // Get userId for memory indexing
        const usersForIndexing = await db
          .select()
          .from(schema.UserTable)
          .limit(1);
        const userIdForIndexing = usersForIndexing[0]?.id || "local-user";

        if (userMessage) {
          try {
            console.log(
              `[AI IPC] Saving user message to database for thread: ${threadId}`,
            );
            const newThreadCreated = await saveMessageToDb(
              threadId,
              userMessage.id,
              "user",
              userMessage.parts || [
                {
                  type: "text",
                  text:
                    typeof (userMessage as any).content === "string"
                      ? (userMessage as any).content
                      : "",
                },
              ],
            );
            console.log(
              `[AI IPC] User message saved successfully, newThreadCreated: ${newThreadCreated}`,
            );

            // Emit thread created event if this is a new thread
            // This allows the sidebar to immediately refresh
            if (newThreadCreated) {
              console.log(
                `[AI IPC] New thread created: ${threadId}, emitting event`,
              );
              event.sender.send("ai:thread:created", {
                threadId,
                title: "New Chat",
              });
            }

            // INDEX USER MESSAGE for memory search (non-blocking)
            const userTextContent =
              typeof (userMessage as any).content === "string"
                ? (userMessage as any).content
                : (userMessage as any).parts?.find((p: any) => p.type === "text")
                    ?.text || "";
            if (userTextContent && userTextContent.length > 10) {
              indexMessageForMemory({
                id: userMessage.id,
                threadId,
                userId: userIdForIndexing,
                role: "user",
                content: userTextContent,
              }).catch((err) => {
                console.warn("[AI IPC] Failed to index user message:", err);
              });
            }
          } catch (err) {
            // Log error and notify renderer, but continue streaming
            console.error(`[AI IPC] Failed to save user message:`, err);
            event.sender.send("ai:stream:warning", {
              threadId,
              message:
                "Failed to save message to database. Your message may not persist.",
            });
          }
        }

        // ============================================
        // CONTEXT MANAGEMENT - Dynamic limits & auto-compression
        // ============================================

        // Calculate system prompt tokens for context calculation
        const systemPromptTokens = estimateTokens(systemPrompt);

        // Calculate initial context usage (DYNAMIC - fetched from provider APIs)
        const initialUsage = await calculateContextUsageAsync(
          messages,
          chatModel!.provider,
          chatModel!.model,
          systemPromptTokens,
        );

        console.log(
          `[AI IPC] Context usage: ${(initialUsage.percentage * 100).toFixed(1)}% ` +
            `(${initialUsage.usedTokens}/${initialUsage.limit} tokens, ` +
            `needsCompaction: ${initialUsage.needsCompaction})`,
        );

        // Send initial context usage to frontend (updates indicator)
        event.sender.send("ai:stream:chunk", {
          threadId,
          chunk: JSON.stringify({
            type: "data-context-usage-update",
            data: {
              usedTokens: initialUsage.usedTokens,
              limit: initialUsage.limit,
              percentage: initialUsage.percentage,
              remaining: initialUsage.remaining,
              provider: chatModel!.provider,
              model: chatModel!.model,
            },
          }),
        });

        // Check if compression needed (at 98% threshold)
        let messagesToUse = messages;

        if (initialUsage.needsCompaction) {
          console.log(
            `[AI IPC] Context compression triggered at ${(initialUsage.percentage * 100).toFixed(1)}%`,
          );

          // Send compression "in-progress" event (appears as tool block in chat)
          event.sender.send("ai:stream:chunk", {
            threadId,
            chunk: JSON.stringify({
              type: "data-context-compaction-start",
              data: {
                oldUsage: {
                  usedTokens: initialUsage.usedTokens,
                  percentage: initialUsage.percentage,
                },
              },
            }),
          });

          // Get user ID for persistence
          const users = await db.select().from(schema.UserTable).limit(1);
          const userId = users[0]?.id;

          // Perform compaction (USES DYNAMIC LIMITS from provider APIs)
          const {
            messages: compactedMessages,
            compactionResult,
            usage: newUsage,
          } = await maybeCompactMessages(
            messages,
            model,
            chatModel!.provider,
            chatModel!.model,
            systemPromptTokens,
            { threadId, userId, persistSummary: true },
          );

          if (compactionResult?.didCompact) {
            // Convert compacted messages back to model format
            messagesToUse = await convertToModelMessages(compactedMessages);

            console.log(
              `[AI IPC] Compression complete: ${compactionResult.compactedCount} messages, ` +
                `${compactionResult.tokensSaved} tokens saved, ` +
                `${(initialUsage.percentage * 100).toFixed(1)}% -> ${(newUsage.percentage * 100).toFixed(1)}%`,
            );

            // Send compression complete event (updates tool block to complete state)
            event.sender.send("ai:stream:chunk", {
              threadId,
              chunk: JSON.stringify({
                type: "data-context-compaction",
                data: {
                  compactedCount: compactionResult.compactedCount,
                  tokensSaved: compactionResult.tokensSaved,
                  oldUsage: {
                    usedTokens: initialUsage.usedTokens,
                    percentage: initialUsage.percentage,
                  },
                  newUsage: {
                    usedTokens: newUsage.usedTokens,
                    limit: newUsage.limit,
                    percentage: newUsage.percentage,
                    remaining: newUsage.remaining,
                  },
                },
              }),
            });
          }
        }

        // ============================================
        // SANITIZE MESSAGES - Strip large base64 data to prevent context overflow
        // ============================================
        const sanitizedMessages = sanitizeMessagesForContext(messagesToUse);

        // Log if significant data was stripped
        const originalSize = JSON.stringify(messagesToUse).length;
        const sanitizedSize = JSON.stringify(sanitizedMessages).length;
        if (originalSize - sanitizedSize > 10000) {
          console.log(
            `[AI IPC] Context sanitization: ${Math.round((originalSize - sanitizedSize) / 1024)}KB of large data stripped ` +
              `(${Math.round(originalSize / 1024)}KB -> ${Math.round(sanitizedSize / 1024)}KB)`,
          );
        }

        // ============================================
        // NOW actually start streaming - listeners are guaranteed ready
        // ============================================

        // Recalculate model capabilities for debug logging
        const capabilities = getModelCapabilities(chatModel!.model);
        const isLocal = isLocalProvider(chatModel!.provider);
        const modelSupportsTools = isLocal
          ? localModelSupportsTools(chatModel!.model) &&
            capabilities.isToolCallSupported
          : capabilities.isToolCallSupported;

        // Debug logging for tool configuration
        console.log(`[AI IPC] Tool configuration summary:`, {
          provider: chatModel?.provider,
          model: chatModel?.model,
          toolCount: tools ? Object.keys(tools).length : 0,
          toolNames: tools ? Object.keys(tools).slice(0, 10) : [],
          hasMoreTools: tools && Object.keys(tools).length > 10,
          modelSupportsTools,
          isLocalProvider: isLocal,
          chatMode: chatMode || "regular",
        });

        let result;

        if (chatMode === "agent") {
          // AGENT MODE: Use the orchestrator with planning and sub-agent capabilities
          console.log(
            `[AI IPC] Starting AGENT mode streaming for thread: ${threadId}`,
          );

          // Import orchestrator dynamically to avoid circular dependencies
          const { createStreamingAutonomousAgent } = await import(
            "../../src/lib/ai/agents/orchestrator-agent"
          );

          // Get user ID from database (needed for orchestrator)
          const users = await db.select().from(schema.UserTable).limit(1);
          const userId = users[0]?.id || "local-user";

          // Create an IPC-based dataStream that forwards events to renderer
          // This enables real-time plan progress updates in the UI
          const ipcDataStream = {
            write: (data: any) => {
              // Forward plan and task events via IPC as stream chunks
              // These will be handled by the onData handler in chat-bot.tsx
              if (
                data.type === "data-plan-created" ||
                data.type === "data-task-updated" ||
                data.type === "data-sub-agent-start" ||
                data.type === "data-sub-agent-complete" ||
                data.type === "data-sub-agent-text" ||
                data.type === "data-sub-agent-tool-call" ||
                data.type === "data-sub-agent-error"
              ) {
                event.sender.send("ai:stream:chunk", {
                  threadId,
                  chunk: JSON.stringify(data),
                });
              }
            },
          };

          // Create orchestrator config with dataStream for real-time events
          // LONG-RUNNING AGENT SUPPORT: Configurable step limits for hour-long tasks
          // Default: 1000 steps (~2-4 hours of autonomous work)
          const agentMaxSteps = 1000;
          console.log(`[AI IPC Agent] Using maxSteps: ${agentMaxSteps}`);

          // Enable continuous mode for truly long-running tasks
          // In continuous mode, agent doesn't stop on plan completion
          const continuousMode = true;

          const orchestratorConfig = createStreamingAutonomousAgent({
            userId,
            threadId,
            chatModel,
            model, // CRITICAL: Pass pre-configured model with API keys for sub-agents
            availableTools: tools || {},
            mcpTools: {}, // MCP tools already merged into tools
            maxSteps: agentMaxSteps, // Configurable limit for long-running agent mode
            continuousMode, // Allow agent to continue after plan completion
            dataStream: ipcDataStream as any, // Cast to any since we're only implementing write()
          });

          result = streamText({
            model,
            system: orchestratorConfig.system,
            messages: sanitizedMessages, // Use sanitized messages (large data stripped)
            tools: orchestratorConfig.tools,
            maxSteps: agentMaxSteps, // Configurable for long-running agent mode with planning
            stopWhen: orchestratorConfig.stopWhen, // CRITICAL: Pass stop conditions for proper loop control
            abortSignal: abortController.signal,
            maxRetries: 2,
            onStepFinish: ({ toolCalls, toolResults, ...stepInfo }: any) => {
              // Check for STOP/COMPLETED signals in tool results
              if (toolResults) {
                const hasStopSignal = toolResults.some((r: any) => {
                  const result = r.result;
                  return result?.STOP === true || result?.COMPLETED === true;
                });
                if (hasStopSignal) {
                  console.log(
                    `[AI IPC Agent] STOP signal detected in tool results - agent should stop`,
                  );
                }
              }
              // Send step event to renderer
              event.sender.send("ai:stream:step", {
                threadId,
                stepType: stepInfo.stepType,
                toolCallCount: toolCalls?.length || 0,
              });
            },
          } as Parameters<typeof streamText>[0]);
        } else {
          // REGULAR MODE: Standard streaming with basic tools
          console.log(
            `[AI IPC] Starting REGULAR mode streaming, tools count: ${tools ? Object.keys(tools).length : 0}`,
          );

          // Log sanitized messages structure for debugging
          console.log(
            `[AI IPC] Sanitized messages count: ${sanitizedMessages.length}`,
          );
          sanitizedMessages.forEach((msg: any, idx: number) => {
            const contentType = typeof msg.content;
            const contentPreview =
              contentType === "string"
                ? msg.content.substring(0, 100)
                : Array.isArray(msg.content)
                  ? `Array[${msg.content.length}]`
                  : "unknown";
            console.log(
              `[AI IPC] Message ${idx}: role=${msg.role}, contentType=${contentType}, content=${contentPreview}`,
            );
          });

          // Log detailed message structure for debugging schema validation errors
          console.log(
            `[AI IPC] About to call streamText with ${sanitizedMessages.length} messages`,
          );
          sanitizedMessages.forEach((msg: any, idx: number) => {
            console.log(`[AI IPC] StreamText Message ${idx}: role=${msg.role}`);
            if (Array.isArray(msg.content)) {
              msg.content.forEach((part: any, pIdx: number) => {
                if (part.type === "tool-call" || part.type === "tool-result") {
                  console.log(
                    `[AI IPC]   Content[${pIdx}]: type=${part.type}, toolName=${part.toolName}, toolCallId=${part.toolCallId}`,
                  );
                  if (part.type === "tool-result" && part.output) {
                    const outputType = part.output?.type;
                    console.log(
                      `[AI IPC]     output.type=${outputType}, hasValue=${part.output?.value !== undefined}`,
                    );
                  }
                } else {
                  console.log(`[AI IPC]   Content[${pIdx}]: type=${part.type}`);
                }
              });
            } else if (typeof msg.content === "string") {
              console.log(
                `[AI IPC]   Content: string (${msg.content.length} chars)`,
              );
            }
          });

          // EXTENDED STEP LIMIT: Allow 200 steps for regular mode with tools
          // This enables more complex multi-step workflows
          const regularMaxSteps = tools ? 200 : 1;

          result = streamText({
            model,
            system: systemPrompt,
            messages: sanitizedMessages, // Use sanitized messages (large data stripped)
            tools,
            maxSteps: regularMaxSteps, // Extended: 200 for tools, 1 for text-only
            abortSignal: abortController.signal,
            maxRetries: 2,
            onStepFinish: ({
              toolCalls,
              toolResults,
              finishReason,
              ...stepInfo
            }: any) => {
              console.log(
                `[AI IPC] Step finished: type=${stepInfo.stepType}, toolCalls=${toolCalls?.length || 0}, toolResults=${toolResults?.length || 0}, finishReason=${finishReason}`,
              );
              if (toolCalls?.length) {
                console.log(
                  `[AI IPC] Tool calls:`,
                  toolCalls.map((tc: any) => tc.toolName),
                );
              }
              if (toolResults?.length) {
                console.log(
                  `[AI IPC] Tool results received:`,
                  toolResults.length,
                );
              }
              // Send step event to renderer
              event.sender.send("ai:stream:step", {
                threadId,
                stepType: stepInfo.stepType,
                toolCallCount: toolCalls?.length || 0,
              });
            },
          } as Parameters<typeof streamText>[0]);
        }

        // console.log(`[AI IPC] streamText result created, converting to UI stream...`);

        // Convert to UI message stream for proper formatting
        const stream = result.toUIMessageStream({
          sendUsage: true,
          messageMetadata: () => ({}),
        });

        // console.log(`[AI IPC] UI stream created, getting reader...`);

        // Read the stream and send chunks to renderer
        const reader = stream.getReader();

        // console.log(`[AI IPC] Reader obtained, starting to read chunks...`);

        // Verify the stream is actually readable
        if (!reader) {
          throw new Error("Failed to get stream reader");
        }

        // console.log(`[AI IPC] Stream reader verified, beginning read loop...`);

        // Track assistant message parts for persistence
        const assistantMessageId = randomUUID();
        const assistantParts: any[] = [];
        let currentTextContent = "";
        const currentToolCalls: any[] = [];
        const currentToolResults: any[] = [];

        // ============================================
        // UNIVERSAL TOOL CALL SYNTHESIZER
        // Track tool inputs for ALL models - many models emit tool-input-start/delta
        // but never emit tool-call chunks. We accumulate and synthesize them.
        // ============================================
        interface AccumulatedToolInput {
          toolCallId: string;
          toolName: string;
          argsJson: string;
        }
        const accumulatedToolInputs: Map<string, AccumulatedToolInput> =
          new Map();

        // console.log(`[AI IPC] Starting to read stream for thread: ${threadId}`);
        let _chunkCount = 0;
        const startTime = Date.now();
        // EXTENDED TIMEOUT: 5 minutes for initial response (browser automation, complex reasoning)
        const TIMEOUT_MS = 300000; // 5 minute timeout

        // Add a heartbeat to detect if we're stuck (disabled to reduce noise)
        // const heartbeatInterval = setInterval(() => {
        //   const elapsed = Date.now() - startTime;
        //   console.log(`[AI IPC] Stream heartbeat - elapsed: ${elapsed}ms, chunks: ${chunkCount}`);
        // }, 5000);

        try {
          while (true) {
            // Check for timeout
            if (Date.now() - startTime > TIMEOUT_MS) {
              console.error(
                `[AI IPC] Stream timeout after ${TIMEOUT_MS}ms, no chunks received`,
              );
              throw new Error("Stream timeout - no chunks received");
            }

            const readPromise = reader.read();
            // EXTENDED TIMEOUT: 10 minutes for tool execution (browser automation, file operations)
            // Some tools like browser automation and long API calls need more time
            const READ_TIMEOUT_MS = 600000; // 10 minutes
            const timeoutPromise = new Promise((_, reject) =>
              setTimeout(() => reject(new Error("Read timeout")), READ_TIMEOUT_MS),
            );

            let readResult;
            try {
              readResult = await Promise.race([readPromise, timeoutPromise]);
            } catch (readError: any) {
              console.error(`[AI IPC] Error reading from stream:`, readError);
              throw readError;
            }

            const { done, value } = readResult as { done: boolean; value: any };

            if (done) {
              // console.log(`[AI IPC] Stream reader done, total chunks: ${chunkCount}`);
              break;
            }

            _chunkCount++;

            // Send each stream part to renderer
            if (value) {
              // Log important chunk types for debugging
              if (
                value.type === "tool-call" ||
                value.type === "tool-result" ||
                value.type === "tool-input-start" ||
                value.type === "finish-step" ||
                value.type === "finish"
              ) {
                console.log(
                  `[AI IPC] Stream chunk #${_chunkCount}: type=${value.type}`,
                  value.type === "tool-call"
                    ? `toolName=${value.toolName}`
                    : "",
                  value.type === "tool-result"
                    ? `toolCallId=${value.toolCallId}`
                    : "",
                  value.type === "finish"
                    ? `finishReason=${value.finishReason}`
                    : "",
                );
              }

              try {
                event.sender.send("ai:stream:chunk", {
                  threadId,
                  chunk: JSON.stringify(value),
                });
              } catch (sendError) {
                console.error(`[AI IPC] Error sending chunk:`, sendError);
              }

              // Accumulate content for persistence
              // Handle different chunk types
              // Note: AI SDK v6 uses 'delta' not 'textDelta' for text-delta chunks
              if (
                value.type === "text-delta" &&
                (value.delta || value.textDelta)
              ) {
                currentTextContent += value.delta || value.textDelta;
              } else if (value.type === "tool-call") {
                console.log(
                  `[AI IPC] Tool call detected: ${value.toolName}`,
                  value.args,
                );
                currentToolCalls.push({
                  type: "tool-call",
                  toolCallId: value.toolCallId,
                  toolName: value.toolName,
                  input: value.args,
                });
              } else if (value.type === "tool-result") {
                console.log(
                  `[AI IPC] Tool result received for: ${value.toolCallId}`,
                );
                // Find the corresponding tool call to get toolName
                const correspondingToolCall = currentToolCalls.find(
                  (tc) => tc.toolCallId === value.toolCallId,
                );
                currentToolResults.push({
                  type: "tool-result",
                  toolCallId: value.toolCallId,
                  toolName:
                    value.toolName ||
                    correspondingToolCall?.toolName ||
                    "unknown",
                  output: value.result,
                });
              } else if (value.type === "tool-input-start") {
                // UNIVERSAL TOOL SYNTHESIZER: Track tool input start
                // Many models emit this but never emit tool-call chunks
                const toolCallId =
                  value.toolCallId ||
                  `synth-${Date.now()}-${randomUUID().slice(0, 8)}`;
                const toolName = value.toolName || "unknown";
                console.log(
                  `[AI IPC] Tool input started for: ${toolName} (id: ${toolCallId})`,
                );
                accumulatedToolInputs.set(toolCallId, {
                  toolCallId,
                  toolName,
                  argsJson: "",
                });
              } else if (value.type === "tool-input-delta") {
                // UNIVERSAL TOOL SYNTHESIZER: Accumulate tool argument JSON
                const toolCallId = value.toolCallId;
                if (toolCallId && accumulatedToolInputs.has(toolCallId)) {
                  const entry = accumulatedToolInputs.get(toolCallId)!;
                  entry.argsJson += value.argsTextDelta || value.delta || "";
                } else if (accumulatedToolInputs.size === 1) {
                  // Fallback: if only one tool input, append to it
                  const entry = accumulatedToolInputs.values().next().value;
                  if (entry) {
                    entry.argsJson += value.argsTextDelta || value.delta || "";
                  }
                }
              }
            }
          }

          // ============================================
          // UNIVERSAL TOOL SYNTHESIZER: Execute accumulated tool calls
          // If we have accumulated tool inputs but no tool-call chunks were received,
          // synthesize and execute them manually, then let model respond
          // ============================================

          // Check if this provider typically needs synthesis (local models, some OpenRouter models)
          const providerLower = chatModel?.provider?.toLowerCase() || "";
          const isLocalModelProvider = [
            "ollama",
            "lmstudio",
            "llamacpp",
            "local",
          ].includes(providerLower);

          // Trigger synthesis when:
          // 1. We have accumulated tool inputs AND no native tool-call chunks were received
          // 2. OR for local models that might emit tool-input events but not tool-call events
          const shouldSynthesize =
            accumulatedToolInputs.size > 0 &&
            (currentToolCalls.length === 0 || isLocalModelProvider);

          if (shouldSynthesize) {
            console.log(
              `[AI IPC] Synthesizing ${accumulatedToolInputs.size} tool call(s) for model ${chatModel?.model} (provider: ${chatModel?.provider}, isLocal: ${isLocalModelProvider})`,
            );

            // Process each accumulated tool input
            for (const [toolCallId, input] of accumulatedToolInputs) {
              const { toolName, argsJson } = input;

              // Find the tool in our tools object (tools comes from context)
              const tool = tools?.[toolName];
              if (!tool) {
                console.warn(
                  `[AI IPC] Tool "${toolName}" not found in available tools. Available tools: ${tools ? Object.keys(tools).slice(0, 10).join(", ") : "none"}`,
                );
                continue;
              }

              // Parse the accumulated JSON arguments with robust error recovery
              let args: any = {};
              const trimmedJson = argsJson.trim();

              if (trimmedJson) {
                // Step 1: Try direct parsing
                try {
                  args = JSON.parse(trimmedJson);
                } catch (parseError) {
                  console.warn(
                    `[AI IPC] Initial JSON parse failed for ${toolName}, attempting recovery. JSON snippet: ${trimmedJson.slice(0, 100)}...`,
                  );

                  // Step 2: Try to fix common JSON issues
                  try {
                    let cleanedJson = trimmedJson
                      .replace(/,\s*([}\]])/g, "$1") // Remove trailing commas
                      .replace(/'/g, '"') // Replace single quotes with double
                      .replace(/(\r\n|\n|\r)/g, " ") // Remove newlines
                      .replace(/\t/g, " "); // Remove tabs

                    // Try to fix unquoted keys (common in some model outputs)
                    cleanedJson = cleanedJson.replace(
                      /([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g,
                      '$1"$2":',
                    );

                    args = JSON.parse(cleanedJson);
                    console.log(
                      `[AI IPC] JSON recovery successful for ${toolName}`,
                    );
                  } catch (recoveryError) {
                    // Step 3: Try to extract just the first complete JSON object
                    try {
                      const jsonMatch = trimmedJson.match(/\{[\s\S]*\}/);
                      if (jsonMatch) {
                        const extracted = jsonMatch[0]
                          .replace(/,\s*([}\]])/g, "$1")
                          .replace(/'/g, '"');
                        args = JSON.parse(extracted);
                        console.log(
                          `[AI IPC] JSON extraction successful for ${toolName}`,
                        );
                      } else {
                        console.error(
                          `[AI IPC] All JSON parsing attempts failed for ${toolName}, using empty args`,
                        );
                        args = {};
                      }
                    } catch {
                      console.error(
                        `[AI IPC] Final JSON recovery failed for ${toolName}, using empty args`,
                      );
                      args = {};
                    }
                  }
                }
              }

              const toolStartTime = Date.now();
              console.log(
                `[AI IPC] Executing synthesized tool call: ${toolName}`,
                { args: JSON.stringify(args).slice(0, 500), synthesized: true },
              );

              // Send synthetic tool-call chunk to renderer
              const syntheticToolCall = {
                type: "tool-call",
                toolCallId,
                toolName,
                input: args,
              };
              event.sender.send("ai:stream:chunk", {
                threadId,
                chunk: JSON.stringify(syntheticToolCall),
              });

              // Store for persistence
              currentToolCalls.push(syntheticToolCall);

              // Execute the tool with retry logic
              const MAX_TOOL_RETRIES = 2;
              let toolResult: any;
              let lastError: any;

              for (let attempt = 0; attempt <= MAX_TOOL_RETRIES; attempt++) {
                try {
                  toolResult = await (tool as any).execute(args);
                  const duration = Date.now() - toolStartTime;
                  console.log(
                    `[AI IPC] Tool ${toolName} completed in ${duration}ms`,
                    typeof toolResult === "object"
                      ? JSON.stringify(toolResult).slice(0, 200)
                      : toolResult,
                  );

                  // Send tool-result chunk to renderer
                  const syntheticToolResult = {
                    type: "tool-result",
                    toolCallId,
                    toolName, // Include toolName for ModelMessage format
                    output: toolResult,
                  };
                  event.sender.send("ai:stream:chunk", {
                    threadId,
                    chunk: JSON.stringify(syntheticToolResult),
                  });

                  // Store for persistence
                  currentToolResults.push(syntheticToolResult);
                  lastError = null;
                  break;
                } catch (toolError: any) {
                  lastError = toolError;
                  const duration = Date.now() - toolStartTime;
                  if (attempt < MAX_TOOL_RETRIES) {
                    console.warn(
                      `[AI IPC] Tool ${toolName} failed (attempt ${attempt + 1}/${MAX_TOOL_RETRIES + 1}, ${duration}ms), retrying...`,
                      toolError.message,
                    );
                    // Exponential backoff: 1s, 2s
                    await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
                  }
                }
              }

              // If all retries failed, send error result
              if (lastError) {
                const duration = Date.now() - toolStartTime;
                console.error(
                  `[AI IPC] Synthesized tool execution failed for ${toolName} after ${MAX_TOOL_RETRIES + 1} attempts (${duration}ms):`,
                  lastError,
                );

                // Send error result
                const errorResult = {
                  type: "tool-result",
                  toolCallId,
                  toolName, // Include toolName for ModelMessage format
                  output: {
                    error: lastError.message || "Tool execution failed",
                  },
                };
                event.sender.send("ai:stream:chunk", {
                  threadId,
                  chunk: JSON.stringify(errorResult),
                });
                currentToolResults.push(errorResult);
              }
            }

            // If we executed tools, we need to let the model respond to the results
            // Make a follow-up streamText call with the tool results
            if (currentToolCalls.length > 0 && currentToolResults.length > 0) {
              console.log(
                `[AI IPC] Making follow-up call to get model response to ${currentToolResults.length} tool result(s)`,
              );

              // Build ModelMessage directly for the follow-up call
              // This avoids UIMessage type issues and gives us full control over the format
              const originalUIMessages = context.originalUIMessages || [];

              // Build assistant message content array (tool calls in ModelMessage format)
              const assistantContent: any[] = [];

              // Add text part if there was any text before tools
              if (currentTextContent) {
                assistantContent.push({
                  type: "text",
                  text: currentTextContent,
                });
              }

              // Add tool call parts (ModelMessage uses 'input' not 'args')
              for (const tc of currentToolCalls) {
                assistantContent.push({
                  type: "tool-call",
                  toolCallId: tc.toolCallId,
                  toolName: tc.toolName,
                  input: tc.input,
                });
              }

              // Build tool result content array (ModelMessage format)
              // ToolResultPart.output must be { type: 'text' | 'json', value: ... }
              const toolResultContent: any[] = currentToolResults.map((tr) => {
                // Convert output to proper ToolResultOutput format
                // Schema requires: { type: 'text', value: string } | { type: 'json', value: any }
                let formattedOutput;
                if (typeof tr.output === "string") {
                  formattedOutput = { type: "text", value: tr.output };
                } else if (tr.output === undefined || tr.output === null) {
                  // Handle null/undefined - use JSON format with null value
                  formattedOutput = { type: "json", value: null };
                } else {
                  // For objects/arrays/numbers/booleans, use JSON format
                  formattedOutput = { type: "json", value: tr.output };
                }
                return {
                  type: "tool-result",
                  toolCallId: tr.toolCallId,
                  toolName: tr.toolName,
                  output: formattedOutput,
                };
              });

              // Create ModelMessage for assistant with tool calls
              const assistantWithTools = {
                role: "assistant" as const,
                content: assistantContent,
              };

              // Create ModelMessage for tool results
              const toolResultsMessage = {
                role: "tool" as const,
                content: toolResultContent,
              };

              // Convert original messages and append the new ones
              const baseModelMessages =
                await convertToModelMessages(originalUIMessages);
              const followUpModelMessages = [
                ...baseModelMessages,
                assistantWithTools,
                toolResultsMessage,
              ];

              // Log follow-up messages for debugging
              console.log(
                `[AI IPC] Follow-up messages count: ${followUpModelMessages.length}`,
              );
              followUpModelMessages.forEach((msg: any, idx: number) => {
                const contentType = typeof msg.content;
                const contentPreview =
                  contentType === "string"
                    ? msg.content.substring(0, 100)
                    : Array.isArray(msg.content)
                      ? `Array[${msg.content.length}] types: ${msg.content.map((p: any) => p.type).join(",")}`
                      : "unknown";
                console.log(
                  `[AI IPC] Follow-up msg ${idx}: role=${msg.role}, contentType=${contentType}, preview=${contentPreview}`,
                );
              });

              // Make follow-up call without tools (to prevent infinite loops)
              try {
                const followUpResult = streamText({
                  model,
                  system: systemPrompt,
                  messages: followUpModelMessages as any, // Type assertion needed due to complex ModelMessage types
                  abortSignal: abortController.signal,
                });

                const followUpStream = followUpResult.toUIMessageStream();
                const followUpReader = followUpStream.getReader();

                // Read follow-up response
                while (true) {
                  const { done: fDone, value: fValue } =
                    await followUpReader.read();
                  if (fDone) break;

                  if (fValue) {
                    // Send chunk to renderer
                    event.sender.send("ai:stream:chunk", {
                      threadId,
                      chunk: JSON.stringify(fValue),
                    });

                    // Accumulate text for persistence
                    if (fValue.type === "text-delta" && fValue.delta) {
                      currentTextContent += fValue.delta;
                    }
                  }
                }
              } catch (followUpError: any) {
                console.error(
                  `[AI IPC] Follow-up stream failed:`,
                  followUpError.message,
                );
                console.error(
                  `[AI IPC] Follow-up error details:`,
                  JSON.stringify(followUpError, null, 2),
                );
                // Log the messages that caused the error
                console.error(
                  `[AI IPC] Follow-up messages that failed:`,
                  JSON.stringify(followUpModelMessages.slice(-3), null, 2),
                );
                // Don't throw - we still have the tool results to show
              }
            }
          }

          // Build assistant message parts for saving in UIMessage format
          // AI SDK expects 'dynamic-tool' type with 'state' field, not separate tool-call/tool-result
          console.log(
            `[AI IPC] Stream complete. Text length: ${currentTextContent.length}, Tool calls: ${currentToolCalls.length}, Tool results: ${currentToolResults.length}`,
          );

          if (currentTextContent) {
            assistantParts.push({ type: "text", text: currentTextContent });
          }

          // Build a map of tool results by toolCallId for merging
          const toolResultsMap = new Map<string, any>();
          for (const result of currentToolResults) {
            toolResultsMap.set(result.toolCallId, result.output);
          }

          // Convert tool calls to UIMessage dynamic-tool format
          for (const toolCall of currentToolCalls) {
            const toolResult = toolResultsMap.get(toolCall.toolCallId);
            if (toolResult !== undefined) {
              // Tool has a result - use output-available state
              assistantParts.push({
                type: "dynamic-tool",
                toolName: toolCall.toolName,
                toolCallId: toolCall.toolCallId,
                state: "output-available",
                input: toolCall.input,
                output: toolResult,
              });
            } else {
              // Tool has no result yet - use input-available state
              assistantParts.push({
                type: "dynamic-tool",
                toolName: toolCall.toolName,
                toolCallId: toolCall.toolCallId,
                state: "input-available",
                input: toolCall.input,
              });
            }
          }

          // SAVE ASSISTANT MESSAGE to database
          if (assistantParts.length > 0) {
            try {
              await saveMessageToDb(
                threadId,
                assistantMessageId,
                "assistant",
                assistantParts,
                { chatModel },
              );
            } catch (saveError: any) {
              console.error(
                "[AI IPC] Failed to save assistant message:",
                saveError,
              );
              event.sender.send("ai:stream:warning", {
                threadId,
                message:
                  "Failed to save assistant response to database. Your conversation may not persist.",
              });
              // Don't throw - allow stream to complete, user can still see the response
            }

            // INDEX ASSISTANT MESSAGE for memory search (non-blocking)
            // Extract text content from assistant parts
            const assistantTextContent = assistantParts
              .filter((p: any) => p.type === "text")
              .map((p: any) => p.text)
              .join("\n")
              .trim();

            if (assistantTextContent && assistantTextContent.length > 10) {
              indexMessageForMemory({
                id: assistantMessageId,
                threadId,
                userId: userIdForIndexing,
                role: "assistant",
                content: assistantTextContent,
              }).catch((err) => {
                console.warn(
                  "[AI IPC] Failed to index assistant message:",
                  err,
                );
              });
            }
          }

          // Stream completed successfully
          event.sender.send("ai:stream:end", {
            threadId,
            finishReason: "stop",
          });

          // AUTO-GENERATE TITLE if needed (non-blocking)
          // Extract first user message text content
          const userMsgAny = userMessage as any;
          console.log("[AI IPC] Preparing auto-title - userMessage:", {
            hasUserMessage: !!userMessage,
            contentType: typeof userMsgAny?.content,
            contentLength: typeof userMsgAny?.content === "string" ? userMsgAny.content.length : 0,
            hasParts: !!userMsgAny?.parts,
            partsLength: userMsgAny?.parts?.length || 0,
          });

          const userMessageText =
            typeof userMsgAny?.content === "string"
              ? userMsgAny.content
              : userMsgAny?.parts
                  ?.filter((p: any) => p.type === "text")
                  .map((p: any) => p.text)
                  .join("\n") || "";

          console.log("[AI IPC] Auto-title content:", {
            userMessageTextLength: userMessageText.length,
            userMessageTextPreview: userMessageText.slice(0, 100),
            assistantTextLength: currentTextContent.length,
            assistantTextPreview: currentTextContent.slice(0, 100),
          });

          // assistantTextContent is already available from earlier
          maybeAutoGenerateTitle(
            threadId,
            chatModel,
            userMessageText,
            currentTextContent, // This is the accumulated assistant text
            event,
          ).catch((err) => {
            console.warn("[AI IPC] Auto-title generation failed:", err.message);
          });
        } catch (streamError: any) {
          console.error(`[AI IPC] Stream error:`, streamError.message);
          event.sender.send("ai:stream:error", {
            threadId,
            error: streamError.message || "Stream reading failed",
          });
          throw streamError;
        } finally {
          // Clean up
          // clearInterval(heartbeatInterval);
          activeStreams.delete(threadId);
          preparedStreams.delete(threadId);
          streamBuffers.delete(threadId);
        }

        return { success: true, threadId };
      } catch (error: any) {
        console.error("[AI IPC] Stream error:", error);
        console.error("[AI IPC] Stream error stack:", error.stack);

        // Send error to renderer
        event.sender.send("ai:stream:error", {
          threadId,
          error: error.message || "Stream failed",
        });

        // Clean up
        activeStreams.delete(threadId);
        preparedStreams.delete(threadId);
        streamBuffers.delete(threadId);

        return { error: error.message };
      }
    },
  );

  /**
   * Abort an active stream
   */
  ipcMain.handle("ai:abort", async (_event, threadId: string) => {
    const controller = activeStreams.get(threadId);
    if (controller) {
      console.log(`[AI IPC] Aborting stream: ${threadId}`);
      controller.abort();
      activeStreams.delete(threadId);
      return { success: true };
    }
    return { success: false, error: "No active stream" };
  });

  /**
   * Generate thread title
   * Streams title generation and updates thread in database
   */
  ipcMain.handle(
    "ai:generateTitle",
    async (
      event,
      request: {
        threadId: string;
        message: string;
        chatModel: { provider: string; model: string };
      },
    ) => {
      const { threadId, message, chatModel } = request;

      try {
        // Get the API key for this provider
        const apiKey = await getApiKeyForProvider(chatModel.provider);

        if (!apiKey && !isLocalProvider(chatModel.provider)) {
          return { error: `No API key configured for ${chatModel.provider}` };
        }

        // Get the model instance
        const model = await getModelInstance(chatModel, apiKey);

        if (!model) {
          return {
            error: `Could not initialize model ${chatModel.provider}/${chatModel.model}`,
          };
        }

        // Generate title using the AI SDK
        const { generateText } = await import("ai");
        const result = await generateText({
          model,
          messages: [
            {
              role: "system",
              content:
                "Generate a short, concise title (max 6 words) for this conversation. Respond with ONLY the title, no quotes or extra text.",
            },
            {
              role: "user",
              content: message,
            },
          ],
          maxTokens: 30,
        } as Parameters<typeof generateText>[0]);

        const title = result.text.trim().replace(/^["']|["']$/g, ""); // Remove quotes if any

        // Update thread title in database
        const db = getDatabase();
        await db
          .update(schema.ChatThreadTable)
          .set({ title })
          .where(eq(schema.ChatThreadTable.id, threadId));

        // Send title to renderer
        event.sender.send("ai:title:generated", {
          threadId,
          title,
        });

        return { success: true, title };
      } catch (error: any) {
        console.error("[AI IPC] Title generation error:", error.message);
        return { error: error.message };
      }
    },
  );

  /**
   * Generate structured object from prompt
   * Used for AI-powered input generation in workflows
   */
  ipcMain.handle(
    "ai:generateObject",
    async (
      _event,
      request: {
        chatModel: { provider: string; model: string };
        prompt: { system?: string; user?: string };
        schema: any; // JSON Schema
      },
    ) => {
      const { chatModel, prompt, schema } = request;

      console.log(
        `[AI IPC] Generate object request, model: ${chatModel?.provider}/${chatModel?.model}`,
      );

      try {
        // Get the API key for this provider
        const apiKey = await getApiKeyForProvider(chatModel.provider);

        if (!apiKey && !isLocalProvider(chatModel.provider)) {
          return { error: `No API key configured for ${chatModel.provider}` };
        }

        // Get the model instance
        const model = await getModelInstance(chatModel, apiKey);

        if (!model) {
          return {
            error: `Could not initialize model ${chatModel.provider}/${chatModel.model}`,
          };
        }

        // Generate object using the AI SDK
        const { generateObject } = await import("ai");

        // Convert JSON schema to Zod schema dynamically
        const { jsonSchemaToZod } = await import(
          "../../src/lib/json-schema-to-zod"
        );
        const zodSchema = jsonSchemaToZod(schema);

        const result = await generateObject({
          model,
          system: prompt.system,
          prompt: prompt.user || "",
          schema: zodSchema,
        });

        return { success: true, object: result.object };
      } catch (error: any) {
        console.error("[AI IPC] Generate object error:", error);
        return { error: error.message };
      }
    },
  );

  console.log("[IPC] AI handlers registered (with full tool support)");
}

/**
 * Get decrypted API key for a provider
 */
async function getApiKeyForProvider(
  providerId: string,
): Promise<string | null> {
  try {
    const db = getDatabase();

    console.log(`[AI IPC] Looking up API key for provider: "${providerId}"`);

    // Get the API key from database - try exact match first
    const [exactMatch] = await db
      .select()
      .from(schema.ApiKeyTable)
      .where(eq(schema.ApiKeyTable.providerId, providerId))
      .limit(1);

    let keyRecord: typeof exactMatch | undefined = exactMatch;

    // If not found, try case-insensitive match
    if (!keyRecord) {
      const allKeys = await db.select().from(schema.ApiKeyTable);
      console.log(
        `[AI IPC] Available provider IDs: ${allKeys.map((k) => k.providerId).join(", ")}`,
      );
      keyRecord = allKeys.find(
        (k) => k.providerId.toLowerCase() === providerId.toLowerCase(),
      );
      if (keyRecord) {
        console.log(
          `[AI IPC] Found key via case-insensitive match: "${keyRecord.providerId}"`,
        );
      }
    } else {
      console.log(`[AI IPC] Found key via exact match for: "${providerId}"`);
    }

    if (!keyRecord) {
      console.log(`[AI IPC] No API key found for provider: ${providerId}`);
      return null;
    }

    // Decrypt the API key
    const decrypted = decryptApiKey(keyRecord.encryptedKey);
    console.log(
      `[AI IPC] API key decrypted successfully (length: ${decrypted?.length || 0})`,
    );
    return decrypted;
  } catch (error) {
    console.error(`[AI IPC] Error getting API key for ${providerId}:`, error);
    return null;
  }
}

/**
 * Check if provider is a local model (no API key needed)
 */
function isLocalProvider(providerId: string): boolean {
  const localProviders = ["ollama", "lmstudio", "llamacpp", "local"];
  return localProviders.includes(providerId.toLowerCase());
}

/**
 * Get model instance for the provider
 */
async function getModelInstance(
  chatModel: { provider: string; model: string },
  apiKey: string | null,
): Promise<any> {
  const { provider, model } = chatModel;
  const db = getDatabase();

  console.log(
    `[AI IPC] getModelInstance: provider="${provider}", model="${model}", hasApiKey=${!!apiKey}`,
  );

  try {
    switch (provider.toLowerCase()) {
      case "openai": {
        const { createOpenAI } = await import("@ai-sdk/openai");
        const openai = createOpenAI({ apiKey: apiKey! });
        return openai(model);
      }

      case "anthropic": {
        const { createAnthropic } = await import("@ai-sdk/anthropic");
        const anthropic = createAnthropic({ apiKey: apiKey! });
        return anthropic(model);
      }

      case "google": {
        const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
        const google = createGoogleGenerativeAI({ apiKey: apiKey! });
        return google(model);
      }

      case "groq": {
        const { createGroq } = await import("@ai-sdk/groq");
        const groq = createGroq({ apiKey: apiKey! });
        return groq(model);
      }

      case "xai": {
        const { createXai } = await import("@ai-sdk/xai");
        const xai = createXai({ apiKey: apiKey! });
        return xai(model);
      }

      case "openrouter": {
        // Use dedicated OpenRouter provider for proper tool calling support
        console.log(`[AI IPC] Creating OpenRouter model: ${model}`);
        const { createOpenRouter } = await import(
          "@openrouter/ai-sdk-provider"
        );
        const openrouter = createOpenRouter({
          apiKey: apiKey!,
          headers: {
            "HTTP-Referer": "https://shadower.ai",
            "X-Title": "Shadower",
          },
        });
        const modelInstance = openrouter(model);
        console.log(`[AI IPC] OpenRouter model created successfully`);
        return modelInstance;
      }

      case "ollama": {
        const { createOllama } = await import("ollama-ai-provider-v2");
        // Get base URL from provider config or use default
        // NOTE: ollama-ai-provider-v2 handles /api endpoint internally, don't include it
        const [providerConfig] = await db
          .select()
          .from(schema.ProviderConfigTable)
          .where(eq(schema.ProviderConfigTable.providerId, "ollama"))
          .limit(1);

        let baseUrl = providerConfig?.baseUrl || "http://localhost:11434";
        // Remove trailing /api if user accidentally included it (backwards compatibility)
        if (baseUrl.endsWith("/api")) {
          baseUrl = baseUrl.slice(0, -4);
        }
        console.log(`[AI IPC] Creating Ollama model: ${model} at ${baseUrl}`);
        const ollama = createOllama({ baseURL: baseUrl });
        return ollama(model);
      }

      case "lmstudio": {
        // LM Studio uses OpenAI-compatible API
        const { createOpenAI } = await import("@ai-sdk/openai");
        const [providerConfig] = await db
          .select()
          .from(schema.ProviderConfigTable)
          .where(eq(schema.ProviderConfigTable.providerId, "lmstudio"))
          .limit(1);

        const baseUrl = providerConfig?.baseUrl || "http://localhost:1234/v1";
        const lmstudio = createOpenAI({
          baseURL: baseUrl,
          apiKey: "lm-studio", // LM Studio doesn't need a real key
        });
        return lmstudio(model);
      }

      case "cerebras": {
        // Cerebras cloud provider
        console.log(`[AI IPC] Creating Cerebras model: ${model}`);
        const { createCerebras } = await import("@ai-sdk/cerebras");
        const cerebras = createCerebras({ apiKey: apiKey! });
        const modelInstance = cerebras(model);
        console.log(`[AI IPC] Cerebras model created successfully`);
        return modelInstance;
      }

      default:
        console.warn(
          `[AI IPC] Unknown provider: ${provider}, trying OpenAI-compatible`,
        );
        // Try as OpenAI-compatible
        const { createOpenAI } = await import("@ai-sdk/openai");
        const [providerConfig] = await db
          .select()
          .from(schema.ProviderConfigTable)
          .where(eq(schema.ProviderConfigTable.providerId, provider))
          .limit(1);

        if (providerConfig?.baseUrl) {
          const compatible = createOpenAI({
            baseURL: providerConfig.baseUrl,
            apiKey: apiKey || "no-key",
          });
          return compatible(model);
        }

        return null;
    }
  } catch (error: any) {
    console.error(
      `[AI IPC] Error creating model instance for ${provider}/${model}:`,
      error?.message || error,
    );
    console.error(`[AI IPC] Stack trace:`, error?.stack);
    // Re-throw with more context so the caller can handle it
    throw new Error(
      `Failed to create ${provider} model "${model}": ${error?.message || error}`,
    );
  }
}

// ============================================================================
// WORKFLOW GENERATION - Full Agentic Workflow Builder
// ============================================================================

/**
 * System prompt for workflow generation
 * Explains the workflow structure and available node types
 */
function getWorkflowGenerationSystemPrompt(
  availableTools: any[],
  currentWorkflowState: { nodes: any[]; edges: any[] },
): string {
  const toolList =
    availableTools?.length > 0
      ? availableTools
          .map((t) => `- ${t.id}: ${t.description || "No description"}`)
          .join("\n")
      : "No MCP tools available. You can still create workflows using LLM, HTTP, Template, and Condition nodes.";

  const currentState =
    currentWorkflowState?.nodes?.length > 0
      ? `\n\nCURRENT WORKFLOW STATE:\nNodes: ${JSON.stringify(currentWorkflowState.nodes.map((n: any) => ({ id: n.id, name: n.data?.name, kind: n.data?.kind })))}\nEdges: ${JSON.stringify(currentWorkflowState.edges.map((e: any) => ({ source: e.source, target: e.target })))}`
      : "\n\nCURRENT WORKFLOW STATE: Empty (new workflow)";

  return `You are an expert workflow designer. Your job is to create and modify visual workflows using the update_workflow_graph tool.

## WORKFLOW NODE TYPES

1. **input** - Entry point that receives initial data. Every workflow needs exactly ONE input node.
   - outputSchema: Define what data the workflow expects (e.g., { type: "object", properties: { query: { type: "string" } } })

2. **output** - Exit point that produces final results. Every workflow needs exactly ONE output node.
   - outputData: Array of { key: string, source: { nodeId: string, path: string[] } } to map results

3. **llm** - Large Language Model node for AI processing
   - model: { provider: string, model: string } (e.g., { provider: "openai", model: "gpt-4o" })
   - messages: Array of { role: "system"|"user"|"assistant", content: TipTap JSON with mentions }
   - outputSchema: What the LLM should return

4. **tool** - Executes MCP tools or app tools
   - tool: { type: "mcp-tool", id: string, serverId: string, serverName: string } or { type: "app-tool", id: string }
   - model: For generating tool parameters from message
   - message: Optional TipTap JSON to describe what to do

5. **condition** - Conditional branching based on data
   - branches: { if: { conditions: [...], targetNodeId: string }, elseIf: [...], else: { targetNodeId: string } }

6. **http** - HTTP request node
   - url: string or { nodeId: string, path: string[] }
   - method: "GET"|"POST"|"PUT"|"DELETE"|"PATCH"
   - headers, query, body: Arrays or values with optional node references

7. **template** - Text template with variable substitution
   - template: { type: "tiptap", tiptap: TipTap JSON with mentions to other nodes }

8. **note** - Documentation/annotation (doesn't affect execution)

## TIPTAP MENTION FORMAT
To reference other nodes' outputs in messages/templates, use TipTap JSON:
{
  "type": "doc",
  "content": [
    {
      "type": "paragraph",
      "content": [
        { "type": "text", "text": "Process this: " },
        {
          "type": "mention",
          "attrs": {
            "id": "node-id-here",
            "label": "NodeName.outputField",
            "nodeId": "node-id-here",
            "path": ["outputField"]
          }
        }
      ]
    }
  ]
}

## WORKFLOW STRUCTURE
- Nodes must be connected via edges (source -> target)
- Data flows from Input through processing nodes to Output
- Each node has a unique id and position { x, y }
- Edges connect nodes: { id: string, source: string, target: string }

## AVAILABLE MCP TOOLS
${toolList}
${currentState}

## GUIDELINES
1. Always start with an "input" node and end with an "output" node
2. Use descriptive node names
3. Position nodes left-to-right (input x:0 -> processing x:300,600,... -> output x:rightmost)
4. Connect all nodes with edges
5. Use the action parameter: "replace" to replace entire workflow, "append" to add nodes, "update" to modify existing nodes
6. Generate proper outputSchema for each node based on what it produces

## RESPONSE
After creating the workflow with update_workflow_graph, briefly explain what the workflow does and how it works.`;
}

/**
 * Workflow generation IPC handler
 * Creates workflows using agentic tool calling with full MCP integration
 */
export function registerWorkflowGenerationHandler() {
  ipcMain.handle(
    "ai:workflow:generate",
    async (
      event,
      request: {
        messages: any[];
        availableTools: any[];
        currentWorkflowState: { nodes: any[]; edges: any[] };
        chatModel: { provider: string; model: string };
      },
    ) => {
      const { messages, availableTools, currentWorkflowState, chatModel } =
        request;

      console.log(
        `[AI Workflow] Generate request - model: ${chatModel?.provider}/${chatModel?.model}, tools: ${availableTools?.length || 0}`,
      );

      // Create a unique session ID for this generation
      const sessionId = `workflow-${Date.now()}-${randomUUID().slice(0, 8)}`;

      // Create abort controller
      const abortController = new AbortController();
      activeStreams.set(sessionId, abortController);

      try {
        // Get API key
        const apiKey = await getApiKeyForProvider(chatModel.provider);
        if (!apiKey && !isLocalProvider(chatModel.provider)) {
          const error = `No API key configured for ${chatModel.provider}`;
          event.sender.send("ai:workflow:error", { sessionId, error });
          return { error, sessionId };
        }

        // Get model instance
        const model = await getModelInstance(chatModel, apiKey);
        if (!model) {
          const error = `Could not initialize model ${chatModel.provider}/${chatModel.model}`;
          event.sender.send("ai:workflow:error", { sessionId, error });
          return { error, sessionId };
        }

        // Define the update_workflow_graph tool with full schema
        const updateWorkflowGraphTool = createTool({
          description: `Update the workflow graph with new or modified nodes and edges.
Use this tool to create, modify, or replace the workflow structure.
- action "replace": Replace the entire workflow with new nodes and edges
- action "append": Add new nodes and edges to existing workflow
- action "update": Update specific existing nodes`,
          inputSchema: z.object({
            action: z
              .enum(["replace", "append", "update"])
              .describe("How to apply the changes"),
            nodes: z
              .array(
                z.object({
                  id: z.string().describe("Unique node ID"),
                  type: z.string().default("default"),
                  position: z.object({
                    x: z.number(),
                    y: z.number(),
                  }),
                  data: z.object({
                    id: z.string(),
                    name: z.string().describe("Display name for the node"),
                    kind: z
                      .enum([
                        "input",
                        "output",
                        "llm",
                        "tool",
                        "condition",
                        "http",
                        "template",
                        "note",
                      ])
                      .describe("Node type"),
                    description: z.string().optional(),
                    outputSchema: z
                      .any()
                      .optional()
                      .describe("JSON Schema for node output"),
                    // LLM node specific
                    model: z
                      .object({
                        provider: z.string(),
                        model: z.string(),
                      })
                      .optional(),
                    messages: z.array(z.any()).optional(),
                    // Tool node specific
                    tool: z.any().optional(),
                    message: z.any().optional(),
                    // Condition node specific
                    branches: z.any().optional(),
                    // HTTP node specific
                    url: z.any().optional(),
                    method: z
                      .enum(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"])
                      .optional(),
                    headers: z.array(z.any()).optional(),
                    query: z.array(z.any()).optional(),
                    body: z.any().optional(),
                    // Template node specific
                    template: z.any().optional(),
                    // Output node specific
                    outputData: z.array(z.any()).optional(),
                  }),
                }),
              )
              .describe("Array of workflow nodes"),
            edges: z
              .array(
                z.object({
                  id: z.string().describe("Unique edge ID"),
                  source: z.string().describe("Source node ID"),
                  target: z.string().describe("Target node ID"),
                  sourceHandle: z.string().optional(),
                  targetHandle: z.string().optional(),
                }),
              )
              .describe("Array of edges connecting nodes"),
          }),
          execute: async (params) => {
            console.log(
              `[AI Workflow] update_workflow_graph called - action: ${params.action}, nodes: ${params.nodes.length}, edges: ${params.edges.length}`,
            );

            // Validate the workflow structure
            const validationWarnings: string[] = [];

            // Check for input node
            const inputNodes = params.nodes.filter(
              (n) => n.data.kind === "input",
            );
            if (inputNodes.length === 0) {
              validationWarnings.push(
                "Warning: No input node found. Workflows should have an input node.",
              );
            } else if (inputNodes.length > 1) {
              validationWarnings.push(
                "Warning: Multiple input nodes found. Workflows should have exactly one input node.",
              );
            }

            // Check for output node
            const outputNodes = params.nodes.filter(
              (n) => n.data.kind === "output",
            );
            if (outputNodes.length === 0) {
              validationWarnings.push(
                "Warning: No output node found. Workflows should have an output node.",
              );
            }

            // Check that all edge references exist
            const nodeIds = new Set(params.nodes.map((n) => n.id));
            for (const edge of params.edges) {
              if (!nodeIds.has(edge.source)) {
                validationWarnings.push(
                  `Warning: Edge references non-existent source node: ${edge.source}`,
                );
              }
              if (!nodeIds.has(edge.target)) {
                validationWarnings.push(
                  `Warning: Edge references non-existent target node: ${edge.target}`,
                );
              }
            }

            // Send the workflow update to the renderer
            const result = {
              success: true,
              action: params.action,
              nodes: params.nodes,
              edges: params.edges,
              message: `Workflow ${params.action}d with ${params.nodes.length} nodes and ${params.edges.length} edges`,
              validationWarnings:
                validationWarnings.length > 0 ? validationWarnings : undefined,
            };

            // Send as a data stream event for the UI to pick up
            event.sender.send("ai:workflow:chunk", {
              sessionId,
              chunk: JSON.stringify({
                type: "tool-result",
                toolCallId: `update-${Date.now()}`,
                toolName: "update_workflow_graph",
                result,
              }),
            });

            return result;
          },
        });

        // Prepare system prompt with available tools and current state
        const systemPrompt = getWorkflowGenerationSystemPrompt(
          availableTools,
          currentWorkflowState,
        );

        // Run streamText with the update_workflow_graph tool
        console.log(
          `[AI Workflow] Starting streamText for session: ${sessionId}`,
        );

        // Convert messages to proper format for streamText
        const formattedMessages = messages.map((m: any) => ({
          role: m.role as "user" | "assistant" | "system",
          content:
            typeof m.content === "string"
              ? m.content
              : m.parts
                  ?.map((p: any) => (p.type === "text" ? p.text : ""))
                  .join("") || "",
        }));

        const workflowTools = {
          update_workflow_graph: updateWorkflowGraphTool,
          // Also include web_search for research during workflow creation
          web_search: createTool({
            description:
              "Search the web to find information about APIs, services, or tools that could be used in the workflow",
            inputSchema: z.object({
              query: z.string().describe("Search query"),
            }),
            execute: async ({ query }) => {
              console.log(`[AI Workflow] Web search: ${query}`);
              try {
                const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
                const response = await fetch(searchUrl, {
                  headers: {
                    "User-Agent":
                      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                  },
                });
                const html = await response.text();
                const results: Array<{
                  title: string;
                  url: string;
                  snippet: string;
                }> = [];
                const resultRegex =
                  /<a class="result__a" href="([^"]+)"[^>]*>([^<]+)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
                let match;
                while (
                  (match = resultRegex.exec(html)) !== null &&
                  results.length < 5
                ) {
                  const url = match[1];
                  const title = match[2].trim();
                  const snippet = match[3].replace(/<[^>]+>/g, "").trim();
                  if (!url.startsWith("//duckduckgo.com")) {
                    results.push({ title, url, snippet });
                  }
                }
                return { success: true, results };
              } catch (error: any) {
                return { success: false, error: error.message };
              }
            },
          }),
        };

        // Use streamText with proper typing (cast to any to avoid SDK type issues)
        const result = streamText({
          model,
          system: systemPrompt,
          messages: formattedMessages as any,
          tools: workflowTools,
          maxSteps: 10, // Allow multiple tool calls for complex workflows
          abortSignal: abortController.signal,
          onStepFinish: (stepResult: any) => {
            const toolCalls = stepResult?.toolCalls;
            console.log(
              `[AI Workflow] Step finished, toolCalls: ${toolCalls?.length || 0}`,
            );
            event.sender.send("ai:workflow:step", {
              sessionId,
              stepType: "step",
              toolCallCount: toolCalls?.length || 0,
            });
          },
        } as any);

        // Stream the response
        const stream = result.toUIMessageStream();
        const reader = stream.getReader();

        let textContent = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          if (value) {
            // Forward chunk to renderer
            event.sender.send("ai:workflow:chunk", {
              sessionId,
              chunk: JSON.stringify(value),
            });

            // Accumulate text for logging
            if (value.type === "text-delta") {
              textContent += (value as any).delta || "";
            }
          }
        }

        console.log(
          `[AI Workflow] Generation complete for session: ${sessionId}, text length: ${textContent.length}`,
        );

        // Send end event
        event.sender.send("ai:workflow:end", {
          sessionId,
          finishReason: "stop",
        });

        return { success: true, sessionId };
      } catch (error: any) {
        console.error(`[AI Workflow] Generation error:`, error);
        event.sender.send("ai:workflow:error", {
          sessionId,
          error: error.message || "Workflow generation failed",
        });
        return { error: error.message, sessionId };
      } finally {
        activeStreams.delete(sessionId);
      }
    },
  );

  // Also register abort handler for workflow generation
  ipcMain.handle("ai:workflow:abort", async (_event, sessionId: string) => {
    const controller = activeStreams.get(sessionId);
    if (controller) {
      controller.abort();
      activeStreams.delete(sessionId);
      console.log(`[AI Workflow] Aborted session: ${sessionId}`);
      return { success: true };
    }
    return { success: false, error: "Session not found" };
  });

  console.log("[IPC] Workflow generation handler registered");
}
