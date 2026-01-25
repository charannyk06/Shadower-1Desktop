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
  isSmallLocalModel,
  getModelRagLimits,
} from "../../src/lib/ai/providers/capabilities";
import {
  calculateContextUsageAsync,
  maybeCompactMessages,
  estimateTokens,
} from "../../src/lib/ai/context";
import { indexMessageForMemory, semanticMemorySearch } from "./memory";
import { EnhancedBrowserService } from "../services/browser-service";
import { setBrowserServiceInstance } from "../../src/lib/ai/tools/browser/local-browser-tools";

const execAsync = promisify(exec);

// Debug flag for RAG logging (set DEBUG_RAG=true in env for verbose RAG logs)
const DEBUG_RAG = process.env.DEBUG_RAG === "true";

// ============================================
// LOCAL MODEL ARGUMENT COERCION HELPERS
// These help fix common mistakes local models make when calling tools
// ============================================

/**
 * Coerce arguments based on JSON Schema types
 * Local models often output "true"/"false" as strings instead of booleans
 * Call this AFTER validation passes to fix type mismatches
 */
function coerceJsonSchemaArgs(args: any, schema: any): any {
  if (!args || typeof args !== 'object' || !schema?.properties) {
    return args;
  }

  const coerced: Record<string, any> = { ...args };

  for (const [key, value] of Object.entries(args)) {
    const propSchema = schema.properties[key];
    if (!propSchema || value === undefined || value === null) continue;

    const expectedType = (propSchema as any).type;

    // Coerce string booleans to actual booleans
    if (expectedType === 'boolean' && typeof value === 'string') {
      coerced[key] = value.toLowerCase() === 'true' || value === '1';
    }
    // Coerce string numbers to actual numbers
    else if (expectedType === 'number' && typeof value === 'string') {
      const parsed = parseFloat(value);
      if (!isNaN(parsed)) coerced[key] = parsed;
    }
    else if (expectedType === 'integer' && typeof value === 'string') {
      const parsed = parseInt(value, 10);
      if (!isNaN(parsed)) coerced[key] = parsed;
    }
    // Coerce string arrays to actual arrays
    else if (expectedType === 'array' && typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) coerced[key] = parsed;
      } catch { /* keep original */ }
    }
  }

  return coerced;
}

/**
 * Make JSON schema more permissive for local models
 * Converts strict types to accept strings as well (for boolean/number/integer)
 * This allows validation to pass, then we coerce in execute
 */
function makeSchemaPermissive(schema: any): any {
  if (!schema || typeof schema !== 'object') return schema;

  const result = { ...schema };

  if (result.properties) {
    result.properties = { ...result.properties };
    for (const [key, prop] of Object.entries(result.properties)) {
      const p = prop as any;
      // Convert boolean to accept string as well
      if (p.type === 'boolean') {
        result.properties[key] = { ...p, type: ['boolean', 'string'] };
      }
      // Convert number/integer to accept string as well
      else if (p.type === 'number' || p.type === 'integer') {
        result.properties[key] = { ...p, type: [p.type, 'string'] };
      }
    }
  }

  return result;
}

// ============================================
// PERMISSIVE ZOD TYPES FOR LOCAL MODELS
// Local models often output "true"/"false" as strings, "5" instead of 5, etc.
// These Zod types accept both correct types AND strings, then coerce them.
// ============================================

/**
 * Permissive boolean Zod type - accepts boolean or string, returns boolean
 * Handles: true, false, "true", "false", "1", "0"
 */
const permissiveBoolean = () =>
  z.union([
    z.boolean(),
    z.string().transform(v => v.toLowerCase() === 'true' || v === '1')
  ]);

/**
 * Permissive number Zod type - accepts number or string, returns number
 * Handles: 5, "5", "3.14"
 */
const permissiveNumber = () =>
  z.union([
    z.number(),
    z.string().transform(v => {
      const parsed = parseFloat(v);
      if (isNaN(parsed)) throw new Error(`Cannot convert "${v}" to number`);
      return parsed;
    })
  ]);

/**
 * Coerce tool arguments to match expected schema types
 * Local models often output malformed arguments like:
 * - {"pattern": {}} instead of {"pattern": "*.ts"}
 * - {"path": undefined} instead of {"path": "/some/path"}
 * - {"maxResults": "50"} instead of {"maxResults": 50}
 */
function coerceToolArguments(args: any, schema: z.ZodSchema<any>): any {
  if (!args || typeof args !== 'object') {
    return args;
  }

  // Get the schema shape if it's a ZodObject
  const shape = (schema as any)._def?.shape?.();
  if (!shape) {
    return args;
  }

  const coerced: Record<string, any> = {};

  for (const [key, value] of Object.entries(args)) {
    const fieldSchema = shape[key];
    if (!fieldSchema) {
      // Unknown field - pass through
      coerced[key] = value;
      continue;
    }

    // Get the underlying type (unwrap optionals)
    let innerSchema = fieldSchema;
    while (innerSchema._def?.innerType) {
      innerSchema = innerSchema._def.innerType;
    }
    const typeName = innerSchema._def?.typeName;

    // Coerce based on expected type
    if (typeName === 'ZodString') {
      // Expected string
      if (value === undefined || value === null) {
        // Skip undefined/null - let schema handle defaults
        continue;
      } else if (typeof value === 'object' && Object.keys(value).length === 0) {
        // Empty object {} -> empty string
        coerced[key] = '';
      } else if (typeof value === 'object') {
        // Non-empty object -> try to stringify meaningfully
        coerced[key] = JSON.stringify(value);
      } else if (typeof value !== 'string') {
        // Convert to string
        coerced[key] = String(value);
      } else {
        coerced[key] = value;
      }
    } else if (typeName === 'ZodNumber') {
      // Expected number
      if (value === undefined || value === null) {
        continue;
      } else if (typeof value === 'string') {
        const parsed = parseFloat(value);
        if (!isNaN(parsed)) {
          coerced[key] = parsed;
        }
      } else if (typeof value === 'number') {
        coerced[key] = value;
      }
    } else if (typeName === 'ZodBoolean') {
      // Expected boolean
      if (value === undefined || value === null) {
        continue;
      } else if (typeof value === 'string') {
        coerced[key] = value.toLowerCase() === 'true' || value === '1';
      } else if (typeof value === 'number') {
        coerced[key] = value !== 0;
      } else if (typeof value === 'boolean') {
        coerced[key] = value;
      }
    } else {
      // Other types - pass through
      coerced[key] = value;
    }
  }

  return coerced;
}

/**
 * Extract valid args and fill missing required fields with sensible defaults
 * Used when schema validation fails to salvage what we can
 */
function extractValidArgsWithDefaults(
  args: any,
  schema: z.ZodSchema<any>,
  toolName: string
): any {
  const shape = (schema as any)._def?.shape?.();
  if (!shape) {
    return args;
  }

  const result: Record<string, any> = {};

  for (const [key, fieldSchema] of Object.entries(shape)) {
    const value = args?.[key];

    // Check if field is optional
    const isOptional = (fieldSchema as any)._def?.typeName === 'ZodOptional';

    // Get inner type for optionals
    let innerSchema = fieldSchema as any;
    while (innerSchema._def?.innerType) {
      innerSchema = innerSchema._def.innerType;
    }
    const typeName = innerSchema._def?.typeName;

    if (value !== undefined && value !== null && typeof value !== 'object') {
      // Valid primitive value - use it
      result[key] = value;
    } else if (value !== undefined && typeof value === 'object' && Object.keys(value).length > 0) {
      // Non-empty object - try to use or stringify
      if (typeName === 'ZodString') {
        result[key] = JSON.stringify(value);
      } else if (typeName === 'ZodObject' || typeName === 'ZodArray') {
        result[key] = value;
      }
    } else if (!isOptional) {
      // Required field with bad/missing value - use sensible defaults
      if (typeName === 'ZodString') {
        // For path/directory fields, use current working directory or home
        if (key === 'path' || key === 'directory' || key === 'dir') {
          result[key] = os.homedir();
        } else if (key === 'pattern' || key === 'query') {
          result[key] = '*'; // Wildcard for search patterns
        } else if (key === 'command') {
          result[key] = 'echo "No command specified"';
        } else if (key === 'text' || key === 'content') {
          result[key] = '';
        } else if (key === 'url') {
          result[key] = 'https://example.com';
        } else {
          result[key] = '';
        }
        console.log(`[AI IPC] Using default value for ${toolName}.${key}: "${result[key]}"`);
      } else if (typeName === 'ZodNumber') {
        result[key] = 0;
      } else if (typeName === 'ZodBoolean') {
        result[key] = false;
      }
    }
    // Optional fields with bad values are simply omitted
  }

  return result;
}

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
  chatMode?: "regular" | "agent" | "rag";
  originalUIMessages?: UIMessage[]; // Store original UIMessages for follow-up calls
  workingDirectory?: { path: string; name: string }; // Working directory for file operations
  toolNameMapping?: Record<string, string>; // Map of renamed tool names to original names (for UI display)
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

// Track orphan cleanup timeouts for prepared streams that never start
// This prevents memory leaks when renderer crashes between prepare and start
const orphanCleanupTimeouts = new Map<string, NodeJS.Timeout>();
const ORPHAN_CLEANUP_DELAY_MS = 60000; // 1 minute (reduced from 2 for faster cleanup)

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

            // Store original schema for coercion in execute
            const originalSchema = { ...mcpInputSchema };

            try {
              // Use permissive schema to allow strings for booleans/numbers
              // Then coerce to correct types in execute before calling MCP
              const permissiveSchema = makeSchemaPermissive(mcpInputSchema);

              tools[toolId] = createTool({
                description:
                  toolInfo.description || `MCP tool: ${toolInfo.name}`,
                inputSchema: jsonSchema(permissiveSchema as any),
                execute: async (params) => {
                  console.log(
                    `[AI MCP] Calling tool ${toolInfo.name} on ${server.name}`,
                  );

                  // Coerce string→boolean/number before calling MCP tool
                  const coercedParams = coerceJsonSchemaArgs(params, originalSchema);

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
                      client.callTool(toolInfo.name, coercedParams),
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
  chatMode?: "regular" | "agent" | "rag";
  allowedAppDefaultToolkit?: string[];
  allowedMcpServers?: Record<string, any>;
  mentions?: any[];
  message: UIMessage;
  imageTool?: { model?: string };
  attachments?: any[];
  // Working directory for file operations
  workingDirectory?: {
    path: string;
    name: string;
  };
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
 * Maps toolkit names to their corresponding tool names
 * Used to filter tools based on user's allowedAppDefaultToolkit selection
 */
function getToolNamesForToolkits(toolkits: string[]): Set<string> {
  const toolNames = new Set<string>();

  for (const toolkit of toolkits) {
    switch (toolkit) {
      case "desktop":
        // Desktop toolkit - terminal, file ops, system tools
        // Include both prefixed and non-prefixed for MCP compatibility
        toolNames.add("terminal_execute");
        toolNames.add("file_read");
        toolNames.add("file_write");
        toolNames.add("file_list");
        toolNames.add("file_search");
        toolNames.add("local_file_read");
        toolNames.add("local_file_write");
        toolNames.add("local_file_list");
        toolNames.add("local_file_search");
        toolNames.add("desktop_screenshot");
        toolNames.add("browser_open");
        toolNames.add("clipboard_read");
        toolNames.add("clipboard_write");
        toolNames.add("system_info");
        break;

      case "webSearch":
        // Web search toolkit
        toolNames.add("web_search");
        toolNames.add("web_fetch");
        toolNames.add("local_web_search");
        toolNames.add("local_web_fetch");
        break;

      case "browser":
        // Browser automation toolkit (all browser_* tools)
        // Session management
        toolNames.add("browser_create_session");
        toolNames.add("browser_close_session");
        toolNames.add("browser_list_sessions");
        toolNames.add("browser_switch_session");
        // Navigation
        toolNames.add("browser_navigate");
        toolNames.add("browser_go_back");
        toolNames.add("browser_go_forward");
        toolNames.add("browser_reload");
        // Page understanding
        toolNames.add("browser_get_snapshot");
        toolNames.add("browser_get_context");
        toolNames.add("browser_analyze_forms");
        toolNames.add("browser_fill_form");
        // Element interaction
        toolNames.add("browser_click");
        toolNames.add("browser_fill");
        toolNames.add("browser_type");
        toolNames.add("browser_press_key");
        toolNames.add("browser_scroll");
        toolNames.add("browser_wait");
        toolNames.add("browser_hover");
        toolNames.add("browser_select");
        toolNames.add("browser_check");
        toolNames.add("browser_uncheck");
        // Page information
        toolNames.add("browser_screenshot");
        toolNames.add("browser_get_content");
        toolNames.add("browser_get_url");
        toolNames.add("browser_get_title");
        toolNames.add("browser_evaluate");
        // Multi-tab
        toolNames.add("browser_new_tab");
        toolNames.add("browser_new_window");
        toolNames.add("browser_switch_tab");
        toolNames.add("browser_close_tab");
        toolNames.add("browser_list_tabs");
        toolNames.add("browser_get_active_tab_index");
        break;

      case "memory":
        // Memory toolkit
        toolNames.add("memory_search");
        break;

      case "visualization":
        // Visualization toolkit (MCP tools, not in createElectronTools)
        toolNames.add("createPieChart");
        toolNames.add("createBarChart");
        toolNames.add("createLineChart");
        toolNames.add("createTable");
        break;

      case "dataAnalysis":
        // Data analysis toolkit (MCP tools)
        toolNames.add("profileData");
        toolNames.add("analyzeData");
        toolNames.add("createVisualization");
        break;

      case "documents":
        // Document generation toolkit (MCP tools)
        toolNames.add("createPresentation");
        toolNames.add("createDocument");
        toolNames.add("createSpreadsheet");
        toolNames.add("createMultiSheetWorkbook");
        toolNames.add("createPDF");
        break;

      case "research":
        // Research toolkit (MCP tools)
        toolNames.add("deepResearch");
        break;
    }
  }

  return toolNames;
}

/**
 * Build system prompt for agentic behavior
 * @param workingDirectory - Optional working directory context
 * @param isLocalModel - Whether this is a local model (Ollama, LM Studio)
 */
function buildAgentSystemPrompt(
  workingDirectory?: { path: string; name: string },
  isLocalModel: boolean = false
): string {
  // ============================================
  // LOCAL MODEL OPTIMIZATION: Minimal System Prompt
  // Local models perform MUCH better with concise prompts
  // Long prompts = more tokens to process = slower responses
  // ============================================
  if (isLocalModel) {
    const cwd = workingDirectory?.path || os.homedir();
    // MINIMAL but EFFECTIVE system prompt for local models
    // Key insight: Local models need EXPLICIT guidance on tool selection
    // Without this, they often confuse file_search with web_search with memory_search
    // NOTE: Tool names may have "local_" prefix when MCP is active
    return `You are Shadower, an autonomous AI assistant with access to tools.

IMPORTANT RULES:
1. USE YOUR TOOLS - do not just describe what you would do
2. After using a tool, briefly confirm what happened
3. Working directory: ${cwd}

TOOL SELECTION GUIDE (tools may have "local_" prefix):

1. memory_search: Search KNOWLEDGE BASES and documents the user uploaded.
   USE FOR: Questions about uploaded documents, resumes, notes, PDFs, or any indexed content.
   Example: "What does my resume say?" → memory_search

2. web_search / local_web_search: Search the INTERNET.
   USE FOR: General questions, finding people, facts, news, definitions, research.
   Example: "Who is Elon Musk?" → web_search

3. file_search / local_file_search: Find FILES by filename on disk.
   USE FOR: Only when user explicitly wants to locate a file by name.
   Example: "Find files named report.pdf" → file_search

4. terminal_execute: Run shell commands.

DECISION FLOWCHART:
- Is it about uploaded documents/knowledge base? → memory_search
- Is it a general question about information? → web_search
- Is it finding files by name on disk? → file_search

COMMON MISTAKE: Do NOT use file_search for content questions. Use memory_search for uploaded documents.`;
  }

  // Full prompt for cloud models (they handle context better)
  const workingDirSection = workingDirectory?.path
    ? `
## WORKING DIRECTORY
**Current Working Directory**: ${workingDirectory.path}
**Directory Name**: ${workingDirectory.name}

IMPORTANT: All file operations and terminal commands should use this working directory as the base path.
- When creating files, save them to: ${workingDirectory.path}
- When running terminal commands, use this as the current directory (cwd)
- When reading files, look in this directory first
- The user expects all work to happen within this directory
`
    : `
## WORKING DIRECTORY
**Current Working Directory**: ${os.homedir()} (default - user's home directory)
`;

  return `You are Shadower, an autonomous AI assistant running as a desktop application.

## CAPABILITIES
You have FULL ACCESS to the user's computer through tools:
- **Terminal**: Execute any shell command (bash, zsh, powershell)
- **File System**: Read, write, create, and delete files
- **Screenshots**: Take screenshots of the entire screen or specific windows
- **Desktop Automation**: Click, type, scroll, and interact with any application
- **Clipboard**: Read and write to clipboard
- **Browser**: Open URLs in the default browser
${workingDirSection}
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
- **ALWAYS use the working directory for file operations unless the user specifies otherwise**

## PLATFORM
Operating System: ${os.platform()} (${os.release()})
Architecture: ${os.arch()}
Home Directory: ${os.homedir()}
`;
}

/**
 * Create desktop tools that work in Electron main process
 * Note: event parameter is optional for sending screenshots to UI
 * @param threadId - Thread ID for the current conversation
 * @param event - IPC event for sending data to renderer
 * @param workingDirectory - Optional working directory for file/terminal operations
 */
function createElectronTools(
  threadId: string,
  event?: Electron.IpcMainInvokeEvent,
  workingDirectory?: { path: string; name: string },
) {
  // Default cwd is the working directory if set, otherwise home directory
  const defaultCwd = workingDirectory?.path || os.homedir();

  return {
    // Terminal command execution
    terminal_execute: createTool({
      description:
        `Execute a shell command in the terminal. Returns stdout, stderr, and exit code. Default working directory: ${defaultCwd}`,
      inputSchema: z
        .object({
          command: z.string().describe("The command to execute"),
          cwd: z
            .string()
            .optional()
            .describe(`Working directory (defaults to ${defaultCwd})`),
          timeout: z
            .number()
            .optional()
            .describe("Timeout in milliseconds (default 30000)"),
        })
        .describe("Terminal execution parameters"),
      execute: async ({ command, cwd, timeout = 30000 }) => {
        // console.log(`[AI Tools] Executing command: ${command} in ${cwd || defaultCwd}`);
        try {
          const { stdout, stderr } = await execAsync(command, {
            cwd: cwd || defaultCwd,
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

    // Write file - PRIMARY tool for creating code files!
    file_write: createTool({
      description:
        "PREFERRED: Write content to a file. Use this to create ANY file (code, HTML, scripts, etc). Creates parent directories automatically. Better than terminal echo for multi-line content.",
      inputSchema: z.object({
        path: z.string().describe(`File path (relative to ${defaultCwd} or absolute)`),
        content: z.string().describe("Full file content to write"),
        append: z
          .boolean()
          .optional()
          .describe("Append to existing file instead of overwrite"),
      }),
      execute: async ({ path: filePath, content, append = false }) => {
        try {
          // Handle relative paths - resolve against defaultCwd
          let resolvedPath = filePath;
          if (!path.isAbsolute(filePath)) {
            resolvedPath = path.join(defaultCwd, filePath);
          }
          
          console.log(`[AI Tools] Writing file: ${resolvedPath} (${content.length} bytes)`);
          
          // Create parent directory if needed
          const dir = path.dirname(resolvedPath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }

          if (append) {
            fs.appendFileSync(resolvedPath, content);
          } else {
            fs.writeFileSync(resolvedPath, content);
          }

          return {
            success: true,
            path: resolvedPath,
            bytesWritten: content.length,
            message: `File created: ${resolvedPath}`,
          };
        } catch (error: any) {
          console.error(`[AI Tools] Error writing file: ${error.message}`);
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
        recursive: permissiveBoolean()
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

    // Search files on local disk (NOT for web searches)
    file_search: createTool({
      description: "Search for FILES on the local computer disk by filename. Only use this when looking for actual files on disk, NOT for searching information on the internet. Use memory_search for knowledge base content.",
      inputSchema: z.object({
        directory: z.string().describe("Directory path to search in (e.g., /Users/name/Documents)"),
        pattern: z.string().describe("Filename pattern to search for (e.g., *.txt, report.pdf, John Smith)"),
        maxResults: z
          .number()
          .optional()
          .describe("Maximum results (default 50)"),
      }),
      execute: async ({ directory, pattern, maxResults = 50 }) => {
        console.log(`[AI Tools] ========== FILE SEARCH CALLED ==========`);
        console.log(`[AI Tools] File search directory: "${directory}"`);
        console.log(`[AI Tools] File search pattern: "${pattern}"`);
        console.log(`[AI Tools] Max results: ${maxResults}`);
        try {
          const isWindows = os.platform() === "win32";

          // Create multiple patterns to handle spaces vs underscores vs hyphens
          // "Charannyan Kannan" should match "Charannyan_Kannan", "Charannyan-Kannan", etc.
          const simplePattern = pattern.trim();
          const underscorePattern = pattern.replace(/\s+/g, '_');
          const hyphenPattern = pattern.replace(/\s+/g, '-');

          // Use find with -iname for case-insensitive search and combine multiple patterns
          let command: string;
          if (isWindows) {
            command = `dir /s /b "${directory}\\*${simplePattern}*" "${directory}\\*${underscorePattern}*" 2>nul`;
          } else {
            // Search with multiple patterns: original, underscored, and hyphenated versions
            // Use -iname for case-insensitive matching
            command = `(find "${directory}" -iname "*${simplePattern}*" -type f 2>/dev/null; find "${directory}" -iname "*${underscorePattern}*" -type f 2>/dev/null; find "${directory}" -iname "*${hyphenPattern}*" -type f 2>/dev/null) | sort -u | head -${maxResults}`;
          }

          console.log(`[AI Tools] File search command: ${command}`);
          const { stdout } = await execAsync(command, { timeout: 30000 });
          const files = stdout.split("\n").filter(Boolean).slice(0, maxResults);

          console.log(`[AI Tools] File search found ${files.length} files`);

          return {
            success: true,
            files,
            count: files.length,
            searchedPatterns: [simplePattern, underscorePattern, hyphenPattern],
            hint: files.length === 0
              ? "No files found. If searching for document content, use memory_search instead. If searching the web, use web_search."
              : undefined,
          };
        } catch (error: any) {
          console.error(`[AI Tools] File search error:`, error);
          return {
            success: false,
            error: error.message,
            files: [],
            hint: "If looking for document content in knowledge bases, use memory_search. If researching information online, use web_search.",
          };
        }
      },
    }),

    // Web search using DuckDuckGo (free, no API key needed)
    web_search: createTool({
      description:
        "Search the internet for information, news, people, companies, facts, or any topic. Use this for ANY research or information lookup. Returns search results with titles, URLs, and snippets.",
      inputSchema: z.object({
        query: z.string().describe("The search query - what you want to find on the internet"),
        numResults: z
          .number()
          .optional()
          .describe("Maximum number of results to return (default 5)"),
      }),
      execute: async ({ query, numResults = 5 }) => {
        console.log(`[AI Tools] ========== WEB SEARCH CALLED ==========`);
        console.log(`[AI Tools] Web search query: "${query}"`);
        console.log(`[AI Tools] Num results: ${numResults}`);
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

    // Memory search - search past conversations AND knowledge bases for relevant context
    // Uses LOCAL embeddings (transformers.js) - NO API KEY REQUIRED!
    memory_search: createTool({
      description:
        "Search past conversations, knowledge bases, and indexed documents for relevant context. Use this to recall information from previous conversations, find knowledge base content, remember user preferences, or find related discussions. Returns semantically similar content using LOCAL embeddings (works offline).",
      inputSchema: z.object({
        query: z
          .string()
          .describe("The search query to find relevant context from memory and knowledge bases"),
        limit: z
          .number()
          .optional()
          .describe("Maximum number of results to return (default 5)"),
        scoreThreshold: z
          .number()
          .optional()
          .describe("Minimum relevance score 0-1 (default 0.5)"),
        collections: z
          .array(z.enum(["messages", "documents", "knowledge"]))
          .optional()
          .describe("Which collections to search (default: all)"),
      }),
      execute: async ({ query, limit = 5, scoreThreshold = 0.5, collections }) => {
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

          // Use semanticMemorySearch which uses LOCAL embeddings (transformers.js)
          // This works offline without any API key!
          const results = await semanticMemorySearch(query, {
            limit,
            scoreThreshold,
            collections: collections || ["messages", "documents", "knowledge"],
            userId: "local-user", // Single-user desktop app
          });

          const elapsedMs = Math.round(performance.now() - start);

          console.log(
            `[AI Tools] Memory search (LOCAL): ${results.length} results in ${elapsedMs}ms`,
          );

          return {
            success: true,
            results: results.map((r) => ({
              id: r.id,
              content: r.content,
              score: r.score,
              source: r.source,
              role: r.role,
              threadId: r.threadId,
              createdAt: r.createdAt,
              knowledgeBaseId: r.knowledgeBaseId,
              knowledgeBaseName: r.knowledgeBaseName,
            })),
            count: results.length,
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

    // ============================================
    // Browser Automation Tools (using agent-browser)
    // ============================================
    //
    // BREAKING CHANGE (v2.0):
    // The browser tools now operate in CDP-ONLY mode. Previous headless mode
    // options (headless: true, stealth: true, etc.) are NO LONGER SUPPORTED.
    //
    // Why this change?
    // - CDP mode connects to the user's REAL Chrome browser
    // - This preserves cookies, sessions, and browsing history
    // - Completely avoids bot detection (no CAPTCHAs, no blocks)
    // - Works with sites that block headless browsers (Google, LinkedIn, etc.)
    //
    // Migration guide for code using the old API:
    // - Remove any `headless: true` options - this is now always the user's real browser
    // - Remove any `stealth: true` options - not needed with real browser
    // - Remove any `userAgent` options - uses real browser's user agent
    // - The `cdpPort` option (default: 9222) is the only required option
    //
    // If you need to run automation while Chrome is already open:
    // - Use `useSeparateProfile: true` in LaunchOptions
    // - Note: This creates a fresh profile without your main Chrome's cookies

    // Create a new browser session (CDP-ONLY MODE)
    // Connects to user's REAL Chrome browser to preserve cookies and avoid bot detection
    browser_create_session: createTool({
      description:
        "Create a new browser session by connecting to the USER'S REAL CHROME BROWSER via CDP. " +
        "This preserves cookies, sessions, and history - completely avoiding bot detection! " +
        "No CAPTCHAs, no blocks from Google/LinkedIn/etc. " +
        "Chrome will be launched automatically if not running. " +
        "If Chrome is already running without debugging, close ALL Chrome windows first. " +
        "NOTE: This is CDP-ONLY mode - headless mode is no longer supported.",
      inputSchema: z.object({
        cdpPort: z
          .number()
          .optional()
          .default(9222)
          .describe("CDP port for Chrome remote debugging (default: 9222)"),
      }),
      execute: async ({ cdpPort }) => {
        try {
          const service = EnhancedBrowserService.getInstance();
          const result = await service.createSession({ cdpPort });
          if (!result || !result.sessionId) {
            return { success: false, error: "Browser session creation returned empty result" };
          }
          return {
            success: true,
            sessionId: result.sessionId,
            url: result.url,
            title: result.title,
            userBrowser: result.userBrowser,
            cdpUrl: result.cdpUrl,
            message: `Connected to USER'S REAL CHROME BROWSER via CDP: ${result.sessionId}. Bot detection is impossible!`,
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            hint:
              "To fix this:\n" +
              "1. Close ALL Chrome windows\n" +
              "2. Wait a few seconds\n" +
              "3. Try again - Chrome will launch automatically with debugging enabled",
          };
        }
      },
    }),

    // Close a browser session
    browser_close_session: createTool({
      description: "Close a browser session",
      inputSchema: z.object({
        sessionId: z.string().optional().describe("Session ID to close (closes active session if not specified)"),
      }),
      execute: async ({ sessionId }) => {
        try {
          const service = EnhancedBrowserService.getInstance();
          await service.closeSession(sessionId);
          return { success: true, message: "Browser session closed" };
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      },
    }),

    // List all browser sessions
    browser_list_sessions: createTool({
      description: "List all active browser sessions",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const service = EnhancedBrowserService.getInstance();
          const sessions = service.listSessions();
          return { success: true, sessions };
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      },
    }),

    // Switch active session
    browser_switch_session: createTool({
      description: "Switch to a different browser session",
      inputSchema: z.object({
        sessionId: z.string().describe("Session ID to switch to"),
      }),
      execute: async ({ sessionId }) => {
        try {
          const service = EnhancedBrowserService.getInstance();
          service.switchSession(sessionId);
          return { success: true, message: `Switched to session: ${sessionId}` };
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      },
    }),

    // Navigate to a URL
    browser_navigate: createTool({
      description: "Navigate the browser to a URL",
      inputSchema: z.object({
        url: z.string().describe("URL to navigate to"),
        waitUntil: z
          .enum(["load", "domcontentloaded", "networkidle"])
          .optional()
          .describe("Wait condition (default: load)"),
        sessionId: z.string().optional().describe("Session ID"),
      }),
      execute: async ({ url, waitUntil, sessionId }) => {
        try {
          const service = EnhancedBrowserService.getInstance();
          const result = await service.navigate(url, { waitUntil, sessionId });
          return { success: true, url: result.url, title: result.title };
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      },
    }),

    // Get AI-optimized snapshot
    browser_get_snapshot: createTool({
      description:
        "Get an AI-optimized snapshot of the page with element refs. " +
        "Returns a text tree with refs like @e1, @e2 that can be used with click, fill, etc. " +
        "This is the PRIMARY tool for understanding page content.",
      inputSchema: z.object({
        interactive: permissiveBoolean().optional().describe("Only include interactive elements"),
        compact: permissiveBoolean().optional().describe("Remove structural elements without content"),
        selector: z.string().optional().describe("CSS selector to scope the snapshot"),
        sessionId: z.string().optional().describe("Session ID"),
      }),
      execute: async ({ interactive, compact, selector, sessionId }) => {
        try {
          const service = EnhancedBrowserService.getInstance();
          const result = await service.getSnapshot({ interactive, compact, selector, sessionId });
          return {
            success: true,
            tree: result.tree,
            stats: result.stats,
            usage: "Use refs like @e1, @e2 with click/fill tools",
          };
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      },
    }),

    // Click an element
    browser_click: createTool({
      description: "Click an element using a ref (@e1) or CSS selector",
      inputSchema: z.object({
        selector: z.string().describe("Element ref (e.g. @e1) or CSS selector"),
        sessionId: z.string().optional().describe("Session ID"),
      }),
      execute: async ({ selector, sessionId }) => {
        try {
          const service = EnhancedBrowserService.getInstance();
          await service.executeAction({ type: "click", selector }, { sessionId });
          return { success: true, message: `Clicked: ${selector}` };
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      },
    }),

    // Fill an input field
    browser_fill: createTool({
      description: "Fill an input field with text (clears existing content first)",
      inputSchema: z.object({
        selector: z.string().describe("Element ref or CSS selector"),
        value: z.string().describe("Text to fill"),
        sessionId: z.string().optional().describe("Session ID"),
      }),
      execute: async ({ selector, value, sessionId }) => {
        try {
          const service = EnhancedBrowserService.getInstance();
          await service.executeAction({ type: "fill", selector, value }, { sessionId });
          return { success: true, message: `Filled ${selector} with text` };
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      },
    }),

    // Type text character by character
    browser_type: createTool({
      description: "Type text character by character (useful for autocomplete fields)",
      inputSchema: z.object({
        selector: z.string().describe("Element ref or CSS selector"),
        text: z.string().describe("Text to type"),
        delay: permissiveNumber().optional().describe("Delay between keystrokes in ms"),
        sessionId: z.string().optional().describe("Session ID"),
      }),
      execute: async ({ selector, text, delay, sessionId }) => {
        try {
          const service = EnhancedBrowserService.getInstance();
          await service.executeAction({ type: "type", selector, text, delay }, { sessionId });
          return { success: true, message: `Typed text in ${selector}` };
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      },
    }),

    // Press a keyboard key
    browser_press_key: createTool({
      description: "Press a keyboard key (Enter, Tab, Escape, ArrowDown, etc.)",
      inputSchema: z.object({
        key: z.string().describe("Key to press (e.g. Enter, Tab, Escape)"),
        selector: z.string().optional().describe("Optional element to focus first"),
        sessionId: z.string().optional().describe("Session ID"),
      }),
      execute: async ({ key, selector, sessionId }) => {
        try {
          const service = EnhancedBrowserService.getInstance();
          await service.executeAction({ type: "press", key, selector }, { sessionId });
          return { success: true, message: `Pressed key: ${key}` };
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      },
    }),

    // Scroll the page
    browser_scroll: createTool({
      description: "Scroll the page or an element",
      inputSchema: z.object({
        direction: z.enum(["up", "down"]).optional().describe("Scroll direction"),
        amount: permissiveNumber().optional().describe("Scroll amount in pixels (default 500)"),
        selector: z.string().optional().describe("Element to scroll into view"),
        sessionId: z.string().optional().describe("Session ID"),
      }),
      execute: async ({ direction, amount, selector, sessionId }) => {
        try {
          const service = EnhancedBrowserService.getInstance();
          await service.executeAction({ type: "scroll", direction, amount, selector }, { sessionId });
          return { success: true, message: "Scrolled page" };
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      },
    }),

    // Take a screenshot
    browser_screenshot: createTool({
      description: "Take a screenshot of the page",
      inputSchema: z.object({
        fullPage: permissiveBoolean().optional().describe("Capture full page (default: viewport only)"),
        path: z.string().optional().describe("Path to save screenshot"),
        sessionId: z.string().optional().describe("Session ID"),
      }),
      execute: async ({ fullPage, path: screenshotPath, sessionId }) => {
        try {
          const service = EnhancedBrowserService.getInstance();
          const result = await service.executeAction(
            { type: "screenshot", fullPage, path: screenshotPath },
            { sessionId }
          );
          if (result.data && typeof result.data === "object" && "base64" in result.data) {
            return { success: true, base64: (result.data as any).base64 };
          }
          return { success: true, path: screenshotPath };
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      },
    }),

    // Wait for element or page state
    browser_wait: createTool({
      description: "Wait for an element to appear or a page load state",
      inputSchema: z.object({
        selector: z.string().optional().describe("CSS selector to wait for"),
        state: z.enum(["visible", "hidden", "attached", "detached"]).optional().describe("Element state to wait for"),
        loadState: z.enum(["load", "domcontentloaded", "networkidle"]).optional().describe("Page load state to wait for"),
        timeout: permissiveNumber().optional().describe("Timeout in milliseconds"),
        sessionId: z.string().optional().describe("Session ID"),
      }),
      execute: async ({ selector, state, loadState, timeout, sessionId }) => {
        try {
          const service = EnhancedBrowserService.getInstance();
          await service.wait({ selector, state, loadState, timeout, sessionId });
          return { success: true, message: "Wait completed" };
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      },
    }),

    // Get page URL
    browser_get_url: createTool({
      description: "Get the current page URL",
      inputSchema: z.object({
        sessionId: z.string().optional().describe("Session ID"),
      }),
      execute: async ({ sessionId }) => {
        try {
          const service = EnhancedBrowserService.getInstance();
          const url = await service.getUrl(sessionId);
          return { success: true, url };
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      },
    }),

    // Get page title
    browser_get_title: createTool({
      description: "Get the current page title",
      inputSchema: z.object({
        sessionId: z.string().optional().describe("Session ID"),
      }),
      execute: async ({ sessionId }) => {
        try {
          const service = EnhancedBrowserService.getInstance();
          const title = await service.getTitle(sessionId);
          return { success: true, title };
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      },
    }),

    // Get page HTML content
    browser_get_content: createTool({
      description: "Get the HTML content of the page or a specific element",
      inputSchema: z.object({
        selector: z.string().optional().describe("CSS selector to get content from"),
        sessionId: z.string().optional().describe("Session ID"),
      }),
      execute: async ({ selector, sessionId }) => {
        try {
          const service = EnhancedBrowserService.getInstance();
          const html = await service.getContent({ selector, sessionId });
          return { success: true, html: html.slice(0, 50000) };
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      },
    }),

    // Go back in history
    browser_go_back: createTool({
      description: "Go back in browser history",
      inputSchema: z.object({
        sessionId: z.string().optional().describe("Session ID"),
      }),
      execute: async ({ sessionId }) => {
        try {
          const service = EnhancedBrowserService.getInstance();
          const result = await service.goBack(sessionId);
          return { success: true, url: result.url };
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      },
    }),

    // Go forward in history
    browser_go_forward: createTool({
      description: "Go forward in browser history",
      inputSchema: z.object({
        sessionId: z.string().optional().describe("Session ID"),
      }),
      execute: async ({ sessionId }) => {
        try {
          const service = EnhancedBrowserService.getInstance();
          const result = await service.goForward(sessionId);
          return { success: true, url: result.url };
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      },
    }),

    // Reload page
    browser_reload: createTool({
      description: "Reload the current page",
      inputSchema: z.object({
        sessionId: z.string().optional().describe("Session ID"),
      }),
      execute: async ({ sessionId }) => {
        try {
          const service = EnhancedBrowserService.getInstance();
          const result = await service.reload(sessionId);
          return { success: true, url: result.url };
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      },
    }),

    // Evaluate JavaScript
    browser_evaluate: createTool({
      description: "Execute JavaScript in the browser page context",
      inputSchema: z.object({
        script: z.string().describe("JavaScript code to execute"),
        sessionId: z.string().optional().describe("Session ID"),
      }),
      execute: async ({ script, sessionId }) => {
        try {
          const service = EnhancedBrowserService.getInstance();
          const result = await service.evaluate(script, { sessionId });
          return { success: true, result };
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      },
    }),

    // ============================================
    // CONVENIENCE TOOL: browser_search
    // ============================================
    // One-shot web search using the user's real Chrome browser
    // This replaces the old Exa API webSearch tool with REAL browser search
    browser_search: createTool({
      description:
        "Search the web using the user's REAL Chrome browser. " +
        "This is the PRIMARY tool for web searching - connects to Chrome via CDP, " +
        "searches Google/DuckDuckGo, and returns results. " +
        "No API keys needed, no bot detection, preserves user's cookies/sessions. " +
        "Use this instead of any webSearch API!",
      inputSchema: z.object({
        query: z.string().describe("Search query"),
        engine: z
          .enum(["google", "duckduckgo", "bing"])
          .optional()
          .default("google")
          .describe("Search engine to use (default: google)"),
        maxResults: z
          .number()
          .optional()
          .default(10)
          .describe("Max results to return (default: 10)"),
      }),
      execute: async ({ query, engine = "google", maxResults: _maxResults = 10 }) => {
        const service = EnhancedBrowserService.getInstance();
        let sessionId: string | undefined;

        try {
          // Step 1: Create session
          console.log(`[browser_search] Starting search for: "${query}" on ${engine}`);
          const sessionResult = await service.createSession({ cdpPort: 9222 });
          if (!sessionResult?.sessionId) {
            return {
              success: false,
              error: "Failed to create browser session",
              hint: "Close all Chrome windows and try again"
            };
          }
          sessionId = sessionResult.sessionId;

          // Step 2: Build search URL
          const encodedQuery = encodeURIComponent(query);
          let searchUrl: string;
          switch (engine) {
            case "duckduckgo":
              searchUrl = `https://duckduckgo.com/?q=${encodedQuery}`;
              break;
            case "bing":
              searchUrl = `https://www.bing.com/search?q=${encodedQuery}`;
              break;
            case "google":
            default:
              searchUrl = `https://www.google.com/search?q=${encodedQuery}`;
          }

          // Step 3: Navigate to search
          console.log(`[browser_search] Navigating to: ${searchUrl}`);
          await service.navigate(searchUrl, { waitUntil: "load", sessionId });

          // Step 4: Get snapshot of results
          const snapshot = await service.getSnapshot({
            interactive: false,
            compact: true,
            sessionId
          });

          // Step 5: Close session
          await service.closeSession(sessionId);

          return {
            success: true,
            query,
            engine,
            searchUrl,
            results: snapshot.tree?.substring(0, 15000) || "No results found", // Limit size
            stats: snapshot.stats,
            message: `Searched "${query}" on ${engine} using user's real Chrome browser`,
          };
        } catch (error: any) {
          // Try to close session on error
          if (sessionId) {
            try { await service.closeSession(sessionId); } catch {}
          }
          return {
            success: false,
            error: error.message,
            query,
            engine,
            hint: "Close all Chrome windows, wait a few seconds, then try again",
          };
        }
      },
    }),
  };
}

export function registerAIHandlers() {
  // Initialize browser service for local-browser-tools (used by orchestrator agent)
  setBrowserServiceInstance(EnhancedBrowserService.getInstance());

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
      allowedAppDefaultToolkit,
      chatMode,
      workingDirectory,
    } = request;

    console.log(
      `[AI IPC] Stream PREPARE for thread: ${threadId}, model: ${chatModel?.provider}/${chatModel?.model}, mode: ${chatMode || "regular"}`,
    );
    if (allowedAppDefaultToolkit && allowedAppDefaultToolkit.length > 0) {
      console.log(`[AI IPC] Allowed toolkits: ${allowedAppDefaultToolkit.join(", ")}`);
    }
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

      // DEBUG: Send model info to renderer (visible in browser console)
      event.sender.send("ai:stream:chunk", {
        threadId,
        chunk: JSON.stringify({
          type: "data-debug-model-info",
          data: {
            provider: chatModel.provider,
            model: chatModel.model,
            modelType: model?.constructor?.name || "unknown",
            isWrapped: !!model?.middleware,
            timestamp: new Date().toISOString(),
          },
        }),
      });

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

      // Detect specific MCP browser automation tools that should be filtered out
      // We want to use LOCAL browser tools (CDP mode) which connect to user's REAL Chrome
      // MCP Puppeteer/Playwright launch SEPARATE browser instances (no cookies/sessions)
      const mcpPuppeteerPlaywrightTools = mcpToolNames.filter(
        (name) =>
          name.includes("puppeteer") ||
          name.includes("playwright"),
      );
      const hasMcpPuppeteerPlaywright = mcpPuppeteerPlaywrightTools.length > 0;

      // Create desktop tools for this thread
      const allDesktopTools = createElectronTools(threadId, event, workingDirectory);

      // IMPORTANT: Desktop tools should ALWAYS be available alongside MCP tools
      // Terminal/shell execution is fundamental and should never be filtered out
      // Let both coexist - the model can choose the best tool for the task
      const desktopTools: Record<string, any> = {};

      // Track tool name renames for UI display (renamed → original)
      const toolNameMapping: Record<string, string> = {};

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
          const renamedName = `local_${toolName}`;
          desktopTools[renamedName] = tool;
          toolNameMapping[renamedName] = toolName; // Track rename for UI
          console.log(
            `[AI IPC] Renamed ${toolName} to ${renamedName} - MCP also provides filesystem`,
          );
          continue;
        }

        // For web tools when MCP provides search, rename to avoid conflicts
        if (
          (toolName === "web_search" || toolName === "web_fetch") &&
          hasMcpSearch
        ) {
          const renamedName = `local_${toolName}`;
          desktopTools[renamedName] = tool;
          toolNameMapping[renamedName] = toolName; // Track rename for UI
          console.log(
            `[AI IPC] Renamed ${toolName} to ${renamedName} - MCP also provides search`,
          );
          continue;
        }

        // For browser_open when MCP provides browser, rename to avoid conflicts
        if (toolName === "browser_open" && hasMcpBrowser) {
          const renamedName = `local_${toolName}`;
          desktopTools[renamedName] = tool;
          toolNameMapping[renamedName] = toolName; // Track rename for UI
          console.log(
            `[AI IPC] Renamed ${toolName} to ${renamedName} - MCP also provides browser`,
          );
          continue;
        }

        // Include all other tools without modification
        desktopTools[toolName] = tool;
      }

      // Log tool name mapping if any renames occurred
      if (Object.keys(toolNameMapping).length > 0) {
        console.log(`[AI IPC] Tool name mapping: ${JSON.stringify(toolNameMapping)}`);
      }

      console.log(
        `[AI IPC] Desktop tools (after MCP filtering): ${Object.keys(desktopTools).join(", ")}`,
      );
      console.log(`[AI IPC] MCP tools: ${mcpToolNames.join(", ") || "none"}`);

      // Filter out MCP Puppeteer/Playwright tools - prefer local browser tools (CDP mode)
      // Local browser tools connect to user's REAL Chrome browser via CDP
      // This preserves cookies, sessions, and avoids bot detection entirely
      // MCP Puppeteer/Playwright launch SEPARATE browser instances which don't have user data
      let filteredMcpTools = mcpTools;
      if (hasMcpPuppeteerPlaywright) {
        filteredMcpTools = { ...mcpTools };
        for (const toolName of mcpPuppeteerPlaywrightTools) {
          if (filteredMcpTools[toolName]) {
            delete filteredMcpTools[toolName];
            console.log(
              `[AI IPC] Filtered out ${toolName} - using local browser tools (CDP) instead`,
            );
          }
        }
        console.log(
          `[AI IPC] Local browser tools active (CDP mode) - filtered ${mcpPuppeteerPlaywrightTools.length} MCP browser tools`,
        );
        console.log(
          `[AI IPC] Available local browser tools: browser_create_session, browser_navigate, browser_click, browser_get_snapshot, etc.`,
        );
      }

      // Merge all tools - filtered MCP tools + desktop tools
      let tools = { ...filteredMcpTools, ...desktopTools };

      // Filter tools based on user's allowedAppDefaultToolkit selection
      // If no toolkits specified, all tools are available (backwards compatible)
      if (allowedAppDefaultToolkit && allowedAppDefaultToolkit.length > 0) {
        const allowedToolNames = getToolNamesForToolkits(allowedAppDefaultToolkit);
        const filteredByToolkit: typeof tools = {};

        for (const [toolName, tool] of Object.entries(tools)) {
          // Check for exact match first
          if (allowedToolNames.has(toolName)) {
            filteredByToolkit[toolName] = tool;
            continue;
          }

          // For MCP tools (prefixed with server name), check if the base name matches
          // MCP tools are formatted as: mcp_servername_toolname or servername_toolname
          const toolBaseName = toolName.includes("_")
            ? toolName.split("_").pop() || toolName
            : toolName;
          if (allowedToolNames.has(toolBaseName)) {
            filteredByToolkit[toolName] = tool;
            continue;
          }

          // Check if any allowed tool name is a suffix of this tool name
          // This handles cases like "browser_navigate" matching when "navigate" is allowed
          for (const allowedName of allowedToolNames) {
            if (toolName.endsWith(`_${allowedName}`) || toolName === allowedName) {
              filteredByToolkit[toolName] = tool;
              break;
            }
          }
        }

        const removedCount = Object.keys(tools).length - Object.keys(filteredByToolkit).length;
        if (removedCount > 0) {
          console.log(`[AI IPC] Filtered ${removedCount} tools based on allowed toolkits: ${allowedAppDefaultToolkit.join(", ")}`);
        }
        console.log(`[AI IPC] Tools after toolkit filter: ${Object.keys(filteredByToolkit).join(", ") || "none"}`);
        tools = filteredByToolkit;
      }

      // Check model capabilities before passing tools
      const capabilities = getModelCapabilities(chatModel.model);
      const isLocal = isLocalProvider(chatModel.provider);

      // ============================================
      // TOOL AVAILABILITY LOGIC
      // Check if the model actually supports tool calling
      // Determine which tools to pass based on model capabilities
      // ============================================
      //
      // SMALL MODEL RAG WORKAROUND (Architecture Decision)
      // ===================================================
      // Small local models (3B-8B params like Llama 3.2, Phi-3, Qwen2.5-3B) cannot
      // reliably use tools via function calling. They frequently:
      // - Hallucinate tool parameters
      // - Call tools repeatedly in loops
      // - Fail to parse tool results correctly
      //
      // SOLUTION: Two-tier RAG architecture
      // 1. SMALL MODELS: Pre-fetch and inject context automatically (no tools)
      //    - Context is retrieved before streaming starts
      //    - Injected as a system message the model can directly reference
      //    - Uses stricter limits: 1000 chars, 5 results, 0.4 threshold
      //    - See: getModelRagLimits() in capabilities.ts
      //
      // 2. LARGER MODELS: Agentic RAG with memory_search tool
      //    - Model decides when/what to search
      //    - Can perform multi-step searches and refine queries
      //    - Standard limits: 4000 chars, 10 results, 0.3 threshold
      //
      // This workaround enables RAG functionality for users with modest hardware
      // while providing superior agentic RAG for users with capable models.
      // Related: isSmallLocalModel() in capabilities.ts
      // ============================================
      let toolsToUse: typeof tools | undefined;

      // RAG MODE - Different behavior based on model size (see workaround docs above)
      const isSmallLocalModelForRag = isLocal && isSmallLocalModel(chatModel.model);

      if (chatMode === "rag") {
        if (isSmallLocalModelForRag) {
          // SMALL LOCAL MODELS: No tools - they get automatic RAG context injection instead
          toolsToUse = undefined;
          console.log(`[AI IPC] RAG mode (small model ${chatModel.model}): No tools, using automatic context injection`);
        } else {
          // LARGER MODELS: Enable memory_search tool for agentic RAG
          const ragTools: typeof tools = {};
          if (tools["memory_search"]) {
            ragTools["memory_search"] = tools["memory_search"];
          }
          toolsToUse = Object.keys(ragTools).length > 0 ? ragTools : undefined;
          console.log(`[AI IPC] RAG mode (larger model): Agentic search with memory_search tool`);
        }
      } else if (Object.keys(tools).length === 0) {
        toolsToUse = undefined;
        console.log(`[AI IPC] No tools available to pass`);
      } else if (isLocal) {
        // LOCAL MODEL TOOLS - Minimal set for speed and reliability
        // Only terminal + headless search (like Claude Code)
        // Browser automation and MCP tools disabled for local models
        // NOTE: Include BOTH prefixed and non-prefixed names because:
        // - Without MCP: tools are named file_read, web_search, etc.
        // - With MCP: tools get renamed to local_file_read, local_web_search, etc.
        const localModelTools = [
          // Terminal (like Claude Code)
          "terminal_execute",
          // Headless web search (both with and without local_ prefix)
          "web_search", "local_web_search",
          "web_fetch", "local_web_fetch",
          // File operations (both with and without local_ prefix)
          "file_read", "local_file_read",
          "file_write", "local_file_write",
          "file_list", "local_file_list",
          "file_search", "local_file_search",
          // Memory for context (always same name)
          "memory_search",
        ];

        const filteredTools: typeof tools = {};
        for (const name of localModelTools) {
          if (tools[name]) filteredTools[name] = tools[name];
        }

        toolsToUse = Object.keys(filteredTools).length > 0 ? filteredTools : undefined;
        console.log(`[AI IPC] Local model: ${Object.keys(filteredTools).length} tools`);
        console.log(`[AI IPC] Local model tools available: ${Object.keys(filteredTools).join(', ')}`);
        // Verify web_search is included
        if (filteredTools['web_search']) {
          console.log(`[AI IPC] ✓ web_search tool IS available for local model`);
        } else if (filteredTools['local_web_search']) {
          console.log(`[AI IPC] ✓ local_web_search tool IS available for local model`);
        } else {
          console.warn(`[AI IPC] ⚠ NO web search tools available for local model!`);
        }

        // Log tool descriptions for debugging
        console.log(`[AI IPC] === LOCAL MODEL TOOL DESCRIPTIONS ===`);
        for (const [name, tool] of Object.entries(filteredTools)) {
          const desc = (tool as any)?.description || 'no description';
          console.log(`[AI IPC] ${name}: "${desc.slice(0, 80)}${desc.length > 80 ? '...' : ''}"`);
        }
        console.log(`[AI IPC] =====================================`);
      } else if (!capabilities.isToolCallSupported) {
        // Cloud model with conflicting tool requirements (built-in tools or Responses API)
        console.warn(
          `[AI IPC] Cloud model ${chatModel.provider}/${chatModel.model} has conflicting tool requirements, proceeding without tools`,
        );
        event.sender.send("ai:stream:warning", {
          threadId,
          message: `Model "${chatModel.model}" has built-in tools that conflict with custom tools. Running without tool capabilities.`,
          type: "tool-unsupported",
        });
        toolsToUse = undefined;
      } else {
        // Cloud model with standard tool support
        toolsToUse = tools;
        console.log(
          `[AI IPC] Cloud model (${chatModel.provider}/${chatModel.model}) - ${Object.keys(tools).length} tools enabled`,
        );
      }

      // Build system prompt with working directory context (pass isLocal for better guidance)
      const systemPrompt = buildAgentSystemPrompt(workingDirectory, isLocal);
      console.log(`[AI IPC] Working directory for thread ${threadId}: ${workingDirectory?.path || 'not set (using home)'}`);
      console.log(`[AI IPC] System prompt built for ${isLocal ? 'local' : 'cloud'} model`);

      // Store prepared context - DON'T start streaming yet!
      preparedStreams.set(threadId, {
        model,
        messages: modelMessages,
        tools: toolsToUse,
        abortController,
        systemPrompt,
        threadId,
        event,
        userMessage: message, // Store user message for saving
        chatModel,
        chatMode,
        originalUIMessages: allMessages, // Store original UIMessages for follow-up tool calls
        workingDirectory, // Store working directory for later use
        toolNameMapping, // Store tool name mapping for UI display
      });

      // CRITICAL: Set orphan cleanup timeout to prevent memory leaks
      // If renderer crashes between prepare and start, this will clean up
      const orphanTimeout = setTimeout(() => {
        if (preparedStreams.has(threadId)) {
          console.warn(`[AI IPC] Cleaning up orphaned prepared stream: ${threadId}`);
          preparedStreams.delete(threadId);
          streamBuffers.delete(threadId);
          activeStreams.delete(threadId);
          orphanCleanupTimeouts.delete(threadId);
        }
      }, ORPHAN_CLEANUP_DELAY_MS);
      orphanCleanupTimeouts.set(threadId, orphanTimeout);

      // console.log(`[AI IPC] Stream prepared for thread: ${threadId}, waiting for start signal`);

      // Return success - renderer should now set up listeners and call ai:stream:start
      // Include toolNameMapping so renderer can display original tool names in UI
      return {
        success: true,
        threadId,
        status: "prepared",
        toolNameMapping: Object.keys(toolNameMapping).length > 0 ? toolNameMapping : undefined,
      };
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

      // CRITICAL: Clear orphan cleanup timeout since stream is starting normally
      const orphanTimeout = orphanCleanupTimeouts.get(threadId);
      if (orphanTimeout) {
        clearTimeout(orphanTimeout);
        orphanCleanupTimeouts.delete(threadId);
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
        workingDirectory,
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

        // ============================================
        // RAG CONTEXT INJECTION
        // ============================================
        console.log(`\n[RAG] ========================================`);
        console.log(`[RAG] STARTING RAG CHECK`);
        console.log(`[RAG] Model: ${chatModel!.model}`);
        console.log(`[RAG] Provider: ${chatModel!.provider}`);
        console.log(`[RAG] Chat Mode: ${chatMode || "regular"}`);
        console.log(`[RAG] ========================================`);

        let messagesToUse = messages;
        const isLocalModel = isLocalProvider(chatModel!.provider);
        console.log(`[RAG] isLocalModel: ${isLocalModel}`);

        // Count user messages to determine if this is the first turn
        const userMessageCount = messages.filter((m: any) => m.role === "user").length;

        // RAG INJECTION LOGIC:
        // - RAG MODE: Inject on EVERY turn for ALL models (cloud + local)
        // - REGULAR/AGENT MODE: Inject on first 3 messages for better context
        // This ensures cloud models like Groq/X.AI get knowledge context in RAG mode
        const isSmallModelForRag = isLocalModel && isSmallLocalModel(chatModel!.model);

        // Decision matrix logging for debugging
        console.log(`[RAG] Decision matrix:`);
        console.log(`  - chatMode: ${chatMode || "regular"}`);
        console.log(`  - isLocalModel: ${isLocalModel}`);
        console.log(`  - isSmallModel: ${isSmallModelForRag}`);
        console.log(`  - userMessageCount: ${userMessageCount}`);

        // RAG mode = every turn for ALL models, regular mode = first 3 messages
        const shouldInjectRag =
          (chatMode === "rag") ||                                          // RAG mode = always inject (cloud + local)
          (userMessageCount <= 3);                                         // First 3 messages in any mode

        console.log(`  - shouldInjectRag: ${shouldInjectRag}`);

        // Log RAG decision
        if (shouldInjectRag) {
          const reason = (chatMode === "rag")
            ? "RAG mode (every turn)"
            : `regular mode (turn ${userMessageCount}/3)`;
          console.log(`[RAG] ✓ Will inject context for: ${reason}`);
        } else {
          console.log(`[RAG] Skipping injection (turn ${userMessageCount} > 3, mode: ${chatMode || "regular"})`);
        }

        // Get model-specific RAG limits (optimized for small models)
        const ragLimits = getModelRagLimits(chatModel!.model, isLocalModel);
        const isSmallModel = isSmallModelForRag; // Already computed above

        if (isSmallModel && DEBUG_RAG) {
          console.log(`[RAG] Small model detected (${chatModel!.model}) - using optimized limits: ${ragLimits.maxTotalChars} chars, ${ragLimits.maxResults} results`);
        }

        if (shouldInjectRag) {
          try {
            if (DEBUG_RAG) {
              console.log(`[RAG] ========== STARTING RAG INJECTION ==========`);
              console.log(`[RAG] Model: ${chatModel!.model}, Provider: ${chatModel!.provider}`);
              console.log(`[RAG] isSmallModel: ${isSmallModel}, isLocalModel: ${isLocalModel}`);
              console.log(`[RAG] Limits: maxResults=${ragLimits.maxResults}, threshold=${ragLimits.scoreThreshold}, maxChars=${ragLimits.maxTotalChars}`);
            }

            // Get userId for memory search
            const usersForRag = await db.select().from(schema.UserTable).limit(1);
            const userIdForRag = usersForRag[0]?.id || "local-user";
            if (DEBUG_RAG) console.log(`[RAG] UserId for search: ${userIdForRag}`);

            // Extract last user message for query
            const lastUserMessage = messages.filter((m: any) => m.role === "user").pop();
            if (lastUserMessage) {
              const query = typeof lastUserMessage.content === "string"
                ? lastUserMessage.content
                : Array.isArray(lastUserMessage.content)
                ? lastUserMessage.content.map((p: any) => p.type === "text" ? p.text : "").join(" ")
                : "";

              if (DEBUG_RAG) console.log(`[RAG] Query: "${query.slice(0, 100)}..."`);

              if (query && query.trim().length >= 3) {
                if (DEBUG_RAG) console.log(`[RAG] Calling semanticMemorySearch...`);
                const ragResults = await semanticMemorySearch(query, {
                  userId: userIdForRag,
                  limit: ragLimits.maxResults,
                  scoreThreshold: ragLimits.scoreThreshold,
                  collections: ["messages", "knowledge", "documents"],
                });

                // Always log result count, but details only if DEBUG
                console.log(`[RAG] Found ${ragResults.length} results`);
                if (ragResults.length === 0 && DEBUG_RAG) {
                  console.log(`[RAG] ⚠️ NO RESULTS FOUND - documents may not be indexed!`);
                }

                if (ragResults.length > 0) {
                  // Build RAG context with model-specific limits
                  let totalChars = 0;
                  const truncatedResults: string[] = [];

                  for (const r of ragResults) {
                    // Truncate individual content based on model size
                    const truncatedContent = r.content.length > ragLimits.maxContentPerItem
                      ? r.content.slice(0, ragLimits.maxContentPerItem) + "..."
                      : r.content;

                    const entry = `[${Math.round(r.score * 100)}%] ${truncatedContent}`;

                    // Check total limit (model-specific)
                    if (totalChars + entry.length > ragLimits.maxTotalChars) {
                      if (DEBUG_RAG) console.log(`[RAG] Stopping at ${truncatedResults.length} items (${isSmallModel ? "small model" : "total"} limit reached)`);
                      break;
                    }

                    truncatedResults.push(entry);
                    totalChars += entry.length;
                  }

                  if (truncatedResults.length > 0) {
                    // Use compact format for small models, full format for others
                    const ragContext = isSmallModel
                      ? truncatedResults.join("\n")  // Single newline for small models
                      : truncatedResults.join("\n\n");

                    // Create RAG system message (compact for small models)
                    const ragSystemMessage = {
                      role: "system" as const,
                      content: isSmallModel
                        ? `[Context]\n${ragContext}`  // Minimal header for small models
                        : `## Relevant Context from Memory\n\n${ragContext}\n\n---\nUse this context to inform your response if relevant.`,
                    };

                    // Inject after first system message (or at beginning)
                    const systemMsgIndex = messagesToUse.findIndex((m: any) => m.role === "system");
                    if (systemMsgIndex >= 0) {
                      messagesToUse = [
                        ...messagesToUse.slice(0, systemMsgIndex + 1),
                        ragSystemMessage,
                        ...messagesToUse.slice(systemMsgIndex + 1),
                      ];
                    } else {
                      messagesToUse = [ragSystemMessage, ...messagesToUse];
                    }

                    console.log(
                      `[RAG] Injected ${truncatedResults.length} items (${totalChars} chars) for ${isSmallModel ? "small" : isLocalModel ? "local" : "cloud"} model`,
                    );
                  }
                }
              }
            }
          } catch (ragError) {
            // Don't fail the request if RAG injection fails
            console.error("[RAG] Context injection failed:", ragError);
          }
        }

        // ============================================
        // RAG MODE INSTRUCTIONS (different for small vs large models)
        // ============================================
        if (chatMode === "rag") {
          // Small local models: Context was auto-injected, just answer from it
          // Larger models: Use memory_search tool agentically
          const ragModeContent = isSmallModel
            ? `[RAG] Answer using the context provided above. Be concise and direct.`
            : `[RAG MODE - AGENTIC SEARCH]
You have access to the memory_search tool to search the user's knowledge bases and conversation history.
This tool uses LOCAL embeddings (works offline without any API key).

IMPORTANT: This is AGENTIC RAG - you should:
1. ALWAYS use memory_search first to find relevant information
2. Search with multiple different queries if initial results are insufficient
3. Refine your search based on what you find
4. Synthesize comprehensive answers from multiple search results
5. If the search returns no results, try alternative phrasings
6. For document results, note the knowledgeBaseName field to cite sources

In RAG mode, you have access to: memory_search
For file operations, terminal, or browser automation, ask the user to switch to Agent mode.`;

          const ragModeSystemMessage = {
            role: "system" as const,
            content: ragModeContent,
          };

          // Inject RAG mode awareness
          const systemMsgIndex = messagesToUse.findIndex((m: any) => m.role === "system");
          if (systemMsgIndex >= 0) {
            messagesToUse = [
              ...messagesToUse.slice(0, systemMsgIndex + 1),
              ragModeSystemMessage,
              ...messagesToUse.slice(systemMsgIndex + 1),
            ];
          } else {
            messagesToUse = [ragModeSystemMessage, ...messagesToUse];
          }
          console.log(`[AI IPC] RAG mode instructions injected (${isSmallModel ? "small model - auto context" : "larger model - agentic"})`);
        }

        // Check if compression needed (at 98% threshold)

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

        // Track sub-agent events for persistence (used in agent mode)
        // These events need to be saved to the database so they persist across conversation switches
        const currentSubAgentEvents: any[] = [];

        // Local models now have full access to agent mode with all tools
        // No restrictions - local models can handle the orchestrator with proper tool-calling models
        const effectiveChatMode = chatMode;

        // WARNING: Large local models (20B+) are very slow, especially on CPU
        // Check model name for size indicators
        if (isLocal) {
          const modelName = chatModel?.model?.toLowerCase() || "";
          const isVeryLargeModel =
            modelName.includes(":32b") ||
            modelName.includes(":70b") ||
            modelName.includes(":72b") ||
            modelName.includes(":110b") ||
            modelName.includes(":405b") ||
            modelName.match(/\d{2,3}b/i); // Match patterns like "32b", "70b", etc.

          if (isVeryLargeModel) {
            console.warn(
              `[AI IPC] WARNING: Large model detected (${chatModel?.model}). Response times may be very slow.`,
            );
            event.sender.send("ai:stream:warning", {
              threadId,
              message: `Large model detected (${chatModel?.model}). This may be slow. For faster responses, try a smaller model like Qwen 2.5 7B or Llama 3.2 3B.`,
              type: "large-model-warning",
            });
          }
        }

        if (effectiveChatMode === "agent") {
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

                // PERSISTENCE FIX: Also accumulate sub-agent events for database storage
                // This ensures they persist when switching conversations
                if (data.type.startsWith("data-sub-agent-")) {
                  currentSubAgentEvents.push({
                    type: data.type,
                    data: {
                      ...data.data,
                      timestamp: data.data?.timestamp || Date.now(),
                    },
                  });
                }
              }
            },
          };

          // Create orchestrator config with dataStream for real-time events
          // LONG-RUNNING AGENT SUPPORT: Configurable step limits for hour-long tasks
          // Default: 1000 steps (~2-4 hours of autonomous work)
          const agentMaxSteps = 1000;
          console.log(`[AI IPC Agent] Using maxSteps: ${agentMaxSteps}`);

          // CRITICAL FIX: Disable continuous mode to respect plan completion
          // This ensures the agent stops when all tasks are marked complete
          // instead of looping infinitely with new plans
          const continuousMode = false;

          const orchestratorConfig = createStreamingAutonomousAgent({
            userId,
            threadId,
            chatModel,
            model, // CRITICAL: Pass pre-configured model with API keys for sub-agents
            availableTools: tools || {},
            mcpTools: {}, // MCP tools already merged into tools
            maxSteps: agentMaxSteps, // Configurable limit for long-running agent mode
            continuousMode, // Now disabled to respect plan completion
            dataStream: ipcDataStream as any, // Cast to any since we're only implementing write()
            workingDirectory, // Pass working directory for file operations
            messages: sanitizedMessages, // CRITICAL: Pass messages for plan reconstruction
          });

          // Verify model supports tool calling in agent mode
          if (!modelSupportsTools) {
            console.warn(
              `[AI IPC Agent] WARNING: Model ${chatModel?.model} may not fully support tool calling. Agent mode may not work correctly.`,
            );
          }

          // Verify createPlan tool is present (critical for agent mode)
          if (!orchestratorConfig.tools.createPlan) {
            console.error(`[AI IPC Agent] CRITICAL: createPlan tool is MISSING!`);
          }

          result = streamText({
            model,
            system: orchestratorConfig.system,
            messages: sanitizedMessages, // Use sanitized messages (large data stripped)
            tools: orchestratorConfig.tools,
            // KEY FIX: Use prepareStep for dynamic per-step tool control instead of static toolChoice
            // This enables the AI SDK 6 pattern of forcing createPlan on step 0
            prepareStep: orchestratorConfig.prepareStep,
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

          // STEP LIMIT: Same for all models - full agentic capabilities
          // No restrictions on local models - they get the same max steps as cloud models
          const regularMaxSteps = tools ? 200 : 1;

          console.log(`[AI IPC] ${isLocal ? 'Local' : 'Cloud'} model: maxSteps=${regularMaxSteps}, tools=${tools ? Object.keys(tools).length : 0}`);

          // Tool choice settings:
          // - Both local and cloud models use "auto" for automatic tool selection
          // - This enables full agentic capabilities for all models
          const useToolChoice = tools && Object.keys(tools).length > 0 ? "auto" : undefined;

          // ============================================
          // CRITICAL DEBUG: Log EXACTLY what we're passing to streamText
          // This helps diagnose why local models aren't using tools
          // ============================================
          const toolKeys = tools ? Object.keys(tools) : [];
          console.log(`[AI IPC] ===== STREAMTEXT CONFIGURATION =====`);
          console.log(`[AI IPC] Provider: ${chatModel?.provider}, Model: ${chatModel?.model}`);
          console.log(`[AI IPC] Is Local: ${isLocal}`);
          console.log(`[AI IPC] Tool Count: ${toolKeys.length}`);
          console.log(`[AI IPC] Tool Names: ${toolKeys.slice(0, 20).join(', ')}${toolKeys.length > 20 ? '...' : ''}`);
          console.log(`[AI IPC] Tool Choice: ${useToolChoice || 'undefined (provider default)'}`);
          console.log(`[AI IPC] Max Steps: ${regularMaxSteps}`);

          // Log first tool's structure to verify schema format
          if (toolKeys.length > 0) {
            const firstToolName = toolKeys[0];
            const firstTool = tools![firstToolName];
            console.log(`[AI IPC] Sample tool (${firstToolName}):`, {
              hasDescription: !!(firstTool as any)?.description,
              hasInputSchema: !!(firstTool as any)?.inputSchema,
              hasParameters: !!(firstTool as any)?.parameters,
              hasExecute: typeof (firstTool as any)?.execute === 'function',
            });
          }

          console.log(`[AI IPC] =====================================`);

          result = streamText({
            model,
            system: systemPrompt,
            messages: sanitizedMessages, // Use sanitized messages (large data stripped)
            tools,
            toolChoice: useToolChoice,
            maxSteps: regularMaxSteps, // Extended: 200 for tools, 1 for text-only
            abortSignal: abortController.signal,
            maxRetries: isLocal ? 3 : 2, // More retries for local models
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
        // PERFORMANCE: Remove messageMetadata callback - it floods with chunks per-token!
        // CRITICAL FIX: For local models, wrap in try-catch to handle undefined usage errors.
        // Local models often don't return proper usage data, causing
        // "Cannot read properties of undefined (reading 'inputTokens')" errors.
        let stream: AsyncIterable<any> & ReadableStream<any>;
        try {
          stream = result.toUIMessageStream({
            // NO messageMetadata - it generates a chunk per token!
          });
        } catch (streamError: any) {
          console.error(`[AI IPC] Error creating UI message stream:`, streamError?.message || streamError);
          // Send error to renderer and clean up
          event.sender.send("ai:stream:error", {
            threadId,
            error: `Stream creation failed: ${streamError?.message || 'Unknown error'}`,
          });
          event.sender.send("ai:stream:end", { threadId, finishReason: "error" });
          return;
        }

        // DEBUG: Send stream created notification to renderer
        event.sender.send("ai:stream:chunk", {
          threadId,
          chunk: JSON.stringify({
            type: "data-debug-stream-created",
            data: {
              message: "Stream created successfully, starting read loop...",
              timestamp: new Date().toISOString(),
            },
          }),
        });
        console.log(`[AI IPC] DEBUG: Stream created for thread ${threadId}, about to start reading...`);

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

        // ============================================
        // PERFORMANCE: CHUNK BATCHING (OPTIMIZED)
        // Text chunks flush IMMEDIATELY for real-time streaming
        // Only batch metadata/tool chunks to reduce IPC overhead
        // ============================================
        const BATCH_SIZE = 10;           // Max chunks per batch
        const BATCH_TIMEOUT_MS = 5;      // REDUCED from 30ms - much faster!
        let chunkBatch: any[] = [];
        let batchTimeout: NodeJS.Timeout | null = null;

        const flushBatch = () => {
          if (chunkBatch.length > 0) {
            try {
              // Send batch via dedicated channel for bulk processing
              event.sender.send("ai:stream:chunk:batch", {
                threadId,
                chunks: chunkBatch,
              });
            } catch {
              // Fallback: send individually if batch fails
              for (const chunk of chunkBatch) {
                try {
                  event.sender.send("ai:stream:chunk", { threadId, chunk: JSON.stringify(chunk) });
                } catch {}
              }
            }
            chunkBatch = [];
          }
          if (batchTimeout) {
            clearTimeout(batchTimeout);
            batchTimeout = null;
          }
        };

        // PERFORMANCE: Skip excessive message-metadata chunks
        // toUIMessageStream sends metadata after EVERY token - massive overhead
        let lastMetadataSent = 0;
        const METADATA_THROTTLE_MS = 500; // Only send metadata every 500ms

        const queueChunk = (chunk: any) => {
          // CRITICAL: Filter out excessive message-metadata chunks
          // These are sent after EVERY token by toUIMessageStream - causing 2x IPC traffic!
          if (chunk.type === "message-metadata") {
            const now = Date.now();
            if (now - lastMetadataSent < METADATA_THROTTLE_MS) {
              return; // Skip - too frequent
            }
            lastMetadataSent = now;
          }

          // FIX: Ensure finish/finish-step chunks have valid usage data
          // Local models often don't return usage info, causing "Cannot read properties of undefined (reading 'inputTokens')" errors
          if (chunk.type === "finish" || chunk.type === "finish-step") {
            if (!chunk.usage) {
              chunk.usage = {
                inputTokens: { total: 0 },
                outputTokens: { total: 0 },
              };
            } else {
              // Ensure nested structure for inputTokens
              if (chunk.usage.inputTokens === undefined || chunk.usage.inputTokens === null) {
                chunk.usage.inputTokens = { total: 0 };
              } else if (typeof chunk.usage.inputTokens === "number") {
                chunk.usage.inputTokens = { total: chunk.usage.inputTokens };
              } else if (typeof chunk.usage.inputTokens === "object" && !chunk.usage.inputTokens.total) {
                chunk.usage.inputTokens.total = 0;
              }
              // Ensure nested structure for outputTokens
              if (chunk.usage.outputTokens === undefined || chunk.usage.outputTokens === null) {
                chunk.usage.outputTokens = { total: 0 };
              } else if (typeof chunk.usage.outputTokens === "number") {
                chunk.usage.outputTokens = { total: chunk.usage.outputTokens };
              } else if (typeof chunk.usage.outputTokens === "object" && !chunk.usage.outputTokens.total) {
                chunk.usage.outputTokens.total = 0;
              }
            }
          }

          chunkBatch.push(chunk);
          
          // CRITICAL: Text chunks flush IMMEDIATELY for real-time streaming
          // Only batch metadata/tool setup chunks
          const immediateFlush = 
            chunk.type === "text-delta" ||     // TEXT MUST STREAM IMMEDIATELY!
            chunk.type === "reasoning-delta" || // Reasoning too
            chunk.type === "tool-call" || 
            chunk.type === "tool-result" || 
            chunk.type === "finish" || 
            chunk.type === "finish-step" ||
            chunk.type === "error";
          
          if (immediateFlush) {
            // Flush immediately - no batching delay for content!
            flushBatch();
          } else if (chunkBatch.length >= BATCH_SIZE) {
            flushBatch();
          } else if (!batchTimeout) {
            // Only batch non-content chunks (metadata, etc.)
            batchTimeout = setTimeout(flushBatch, BATCH_TIMEOUT_MS);
          }
        };

        // Heartbeat interval - reduced frequency for less IPC overhead
        const heartbeatInterval = setInterval(() => {
          const elapsed = Date.now() - startTime;
          const elapsedSec = Math.floor(elapsed / 1000);

          // Only send heartbeat if waiting a long time with few chunks
          if (elapsedSec >= 15 && _chunkCount <= 1) {
            let heartbeatMessage = isLocal
              ? `Local model loading... (${elapsedSec}s)`
              : `Waiting for model response... (${elapsedSec}s)`;

            if (isLocal && elapsedSec >= 60) {
              heartbeatMessage = `Local model loading (${elapsedSec}s). First response can be slow.`;
            }

            try {
              event.sender.send("ai:stream:chunk", {
                threadId,
                chunk: JSON.stringify({
                  type: "data-debug-heartbeat",
                  data: { elapsed, chunks: _chunkCount, message: heartbeatMessage, isLocal },
                }),
              });
            } catch {
              // Ignore
            }
          }
        }, 10000); // Reduced from 5s to 10s

        // ============================================
        // PERFORMANCE: REUSABLE TIMEOUT MECHANISM
        // Instead of creating new Promise per read, reuse timeout
        // ============================================
        const READ_TIMEOUT_MS = 600000; // 10 minutes for tool execution
        let readTimeoutId: NodeJS.Timeout | null = null;

        const clearReadTimeout = () => {
          if (readTimeoutId) {
            clearTimeout(readTimeoutId);
            readTimeoutId = null;
          }
        };

        const createReadTimeout = () => {
          return new Promise<never>((_, reject) => {
            readTimeoutId = setTimeout(() => {
              reject(new Error("Read timeout"));
            }, READ_TIMEOUT_MS);
          });
        };

        // CRITICAL: Register abort listener to immediately clean up pending timeouts
        // This ensures timeouts don't fire after the stream has been aborted
        const abortCleanupHandler = () => {
          clearReadTimeout();
          if (batchTimeout) {
            clearTimeout(batchTimeout);
            batchTimeout = null;
          }
          console.log(`[AI IPC] Abort cleanup triggered for thread: ${threadId}`);
        };
        abortController.signal.addEventListener("abort", abortCleanupHandler, { once: true });

        try {
          let lastChunkTime = Date.now();

          while (true) {
            const now = Date.now();
            
            // Check for initial timeout (no first chunk received)
            if (_chunkCount === 0 && now - startTime > TIMEOUT_MS) {
              const timeoutMsg = isLocal
                ? `Local model didn't respond in ${TIMEOUT_MS / 1000}s. The model may need to load or be too large.`
                : `Stream timeout after ${TIMEOUT_MS / 1000}s - no response from model`;
              throw new Error(timeoutMsg);
            }

            // Check for stall timeout (chunks were being received but stopped)
            const stallTimeoutMs = isLocal ? 120000 : 60000; // 2 min for local, 1 min for cloud
            if (_chunkCount > 0 && now - lastChunkTime > stallTimeoutMs) {
              const stallMsg = isLocal
                ? `Local model stopped responding after ${_chunkCount} chunks. Model may be overloaded.`
                : `Stream stalled after ${_chunkCount} chunks`;
              throw new Error(stallMsg);
            }

            const readPromise = reader.read();
            const timeoutPromise = createReadTimeout();

            let readResult;
            try {
              readResult = await Promise.race([readPromise, timeoutPromise]);
              clearReadTimeout();
            } catch (readError: any) {
              clearReadTimeout();
              // CRITICAL FIX: Handle "Cannot read properties of undefined (reading 'inputTokens')"
              // This error occurs when local models don't return proper usage data.
              // Instead of crashing, we gracefully end the stream.
              const errorMsg = readError?.message || String(readError);
              if (errorMsg.includes("inputTokens") || errorMsg.includes("outputTokens") || errorMsg.includes("usage")) {
                console.warn(`[AI IPC] Usage data error (continuing without it): ${errorMsg}`);
                // Send a synthetic finish chunk without usage to complete the stream
                queueChunk({
                  type: "finish",
                  finishReason: "stop",
                  usage: { inputTokens: { total: 0 }, outputTokens: { total: 0 } },
                });
                flushBatch();
                break; // End the stream gracefully
              }
              throw readError;
            }

            const { done, value } = readResult as { done: boolean; value: any };

            // CRITICAL: Check abort signal BEFORE processing chunk
            // This ensures we stop immediately when user cancels
            if (done || abortController.signal.aborted) {
              // Flush any remaining batched chunks
              flushBatch();
              break;
            }

            _chunkCount++;
            lastChunkTime = Date.now();

            // Send chunk via batching mechanism
            if (value) {
              // Queue chunk for batched sending (MUCH faster than individual IPC)
              queueChunk(value);

              // Accumulate content for persistence
              // Handle different chunk types
              // Note: AI SDK v6 uses 'delta' not 'textDelta' for text-delta chunks
              if (
                value.type === "text-delta" &&
                (value.delta || value.textDelta)
              ) {
                currentTextContent += value.delta || value.textDelta;
              } else if (value.type === "tool-call") {
                currentToolCalls.push({
                  type: "tool-call",
                  toolCallId: value.toolCallId,
                  toolName: value.toolName,
                  input: value.args,
                });
              } else if (value.type === "tool-result") {
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
                const toolCallId =
                  value.toolCallId ||
                  `synth-${Date.now()}-${randomUUID().slice(0, 8)}`;
                const toolName = value.toolName || "unknown";
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
          // TEXT-BASED TOOL CALL PARSER (FALLBACK)
          // For local models that output tool calls as plain text instead of events
          // Common formats: JSON objects, function notation, XML-style tags
          // ============================================
          if (
            currentTextContent.length > 0 &&
            accumulatedToolInputs.size === 0 &&
            currentToolCalls.length === 0 &&
            tools &&
            Object.keys(tools).length > 0
          ) {
            console.log(`[AI IPC] Checking text content for tool calls (${currentTextContent.length} chars)...`);

            // Available tool names for matching
            const availableToolNames = Object.keys(tools);

            // Pattern 1: JSON object with "name" or "tool" and "arguments" or "parameters"
            // e.g., {"name": "terminal_execute", "arguments": {"command": "ls"}}
            const jsonToolPatterns = [
              /\{[\s\S]*?"(?:name|tool|function)"[\s\S]*?:[\s\S]*?"([^"]+)"[\s\S]*?,[\s\S]*?"(?:arguments|parameters|params|input)"[\s\S]*?:[\s\S]*?(\{[^}]+\})/gi,
              /\{[\s\S]*?"(?:tool_name|toolName)"[\s\S]*?:[\s\S]*?"([^"]+)"[\s\S]*?,[\s\S]*?"(?:tool_input|toolInput|args)"[\s\S]*?:[\s\S]*?(\{[^}]+\})/gi,
            ];

            // Pattern 2: Function-style notation
            // e.g., terminal_execute({"command": "ls"})
            const functionPattern = new RegExp(
              `(${availableToolNames.join('|')})\\s*\\(\\s*(\\{[^}]+\\})\\s*\\)`,
              'gi'
            );

            // Pattern 3: XML-style tags
            // e.g., <tool>terminal_execute</tool><arguments>{"command": "ls"}</arguments>
            const xmlPattern = /<(?:tool|function|tool_call|function_call)>([^<]+)<\/(?:tool|function|tool_call|function_call)>[\s\S]*?<(?:arguments|parameters|params|input)>(\{[^<]+\})<\/(?:arguments|parameters|params|input)>/gi;

            // Try each pattern
            const matches: Array<{ toolName: string; argsJson: string }> = [];

            // Try JSON patterns
            for (const pattern of jsonToolPatterns) {
              let match;
              while ((match = pattern.exec(currentTextContent)) !== null) {
                const toolName = match[1];
                const argsJson = match[2];
                if (availableToolNames.some(t => t.toLowerCase() === toolName.toLowerCase())) {
                  matches.push({ toolName, argsJson });
                }
              }
            }

            // Try function pattern
            let funcMatch;
            while ((funcMatch = functionPattern.exec(currentTextContent)) !== null) {
              const toolName = funcMatch[1];
              const argsJson = funcMatch[2];
              matches.push({ toolName, argsJson });
            }

            // Try XML pattern
            let xmlMatch;
            while ((xmlMatch = xmlPattern.exec(currentTextContent)) !== null) {
              const toolName = xmlMatch[1].trim();
              const argsJson = xmlMatch[2];
              if (availableToolNames.some(t => t.toLowerCase() === toolName.toLowerCase())) {
                matches.push({ toolName, argsJson });
              }
            }

            // Pattern 4: Direct tool name followed by JSON (common in some models)
            // e.g., "I'll use terminal_execute: {"command": "ls -la"}"
            for (const toolName of availableToolNames) {
              const directPattern = new RegExp(
                `${toolName}[:\\s]+\\{([^}]+)\\}`,
                'gi'
              );
              let directMatch;
              while ((directMatch = directPattern.exec(currentTextContent)) !== null) {
                const argsJson = `{${directMatch[1]}}`;
                // Check if this tool wasn't already found
                if (!matches.some(m => m.toolName.toLowerCase() === toolName.toLowerCase())) {
                  matches.push({ toolName, argsJson });
                }
              }
            }

            // Add found matches to accumulated tool inputs
            if (matches.length > 0) {
              console.log(`[AI IPC] Found ${matches.length} text-based tool call(s):`, matches.map(m => m.toolName));
              for (const { toolName, argsJson } of matches) {
                // Find exact tool name (case-insensitive match)
                const exactToolName = availableToolNames.find(
                  t => t.toLowerCase() === toolName.toLowerCase()
                ) || toolName;

                const toolCallId = `text-parse-${Date.now()}-${randomUUID().slice(0, 8)}`;
                accumulatedToolInputs.set(toolCallId, {
                  toolCallId,
                  toolName: exactToolName,
                  argsJson,
                });
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
                } catch (_parseError) {
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
                  } catch (_recoveryError) {
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

              // ============================================
              // ARGUMENT VALIDATION & COERCION FOR LOCAL MODELS
              // Local models often output malformed arguments like:
              // - {"pattern": {}} instead of {"pattern": "*.ts"}
              // - {"path": undefined} instead of {"path": "/some/path"}
              // We need to coerce and validate before execution
              // ============================================

              // Get the tool's input schema for validation
              const toolSchema = (tool as any).inputSchema || (tool as any).parameters;
              let validatedArgs = args;

              if (toolSchema) {
                try {
                  // Step 1: Coerce common local model argument mistakes
                  const coercedArgs = coerceToolArguments(args, toolSchema);

                  // Step 2: Validate against schema using safeParse
                  const validationResult = toolSchema.safeParse(coercedArgs);

                  if (validationResult.success) {
                    validatedArgs = validationResult.data;
                    console.log(`[AI IPC] Schema validation passed for ${toolName}`);
                  } else {
                    // Validation failed - log details and try with defaults
                    console.warn(
                      `[AI IPC] Schema validation failed for ${toolName}:`,
                      validationResult.error.errors.map((e: any) => `${e.path.join('.')}: ${e.message}`).join(', ')
                    );

                    // Try to extract valid fields and fill with defaults
                    validatedArgs = extractValidArgsWithDefaults(coercedArgs, toolSchema, toolName);
                    console.log(`[AI IPC] Using coerced/default args for ${toolName}:`, JSON.stringify(validatedArgs).slice(0, 200));
                  }
                } catch (validationError: any) {
                  console.warn(
                    `[AI IPC] Argument validation error for ${toolName}, using original args:`,
                    validationError.message
                  );
                  // Fall through with original args
                }
              }

              // Send synthetic tool-call chunk to renderer (with validated args)
              const syntheticToolCall = {
                type: "tool-call",
                toolCallId,
                toolName,
                input: validatedArgs,
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
                  toolResult = await (tool as any).execute(validatedArgs);
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

              // If all retries failed, send error result with helpful guidance
              if (lastError) {
                const duration = Date.now() - toolStartTime;
                console.error(
                  `[AI IPC] Synthesized tool execution failed for ${toolName} after ${MAX_TOOL_RETRIES + 1} attempts (${duration}ms):`,
                  lastError,
                );

                // Build helpful error message for the model
                const errorMessage = lastError.message || "Tool execution failed";
                let guidance = "";

                // Detect common argument errors and provide specific guidance
                if (errorMessage.includes("received as a JSON object") ||
                    errorMessage.includes("should be a string")) {
                  guidance = " HINT: You passed an object {} where a string was expected. Use a string value like \"example\".";
                } else if (errorMessage.includes("undefined") ||
                           errorMessage.includes("required")) {
                  guidance = " HINT: A required parameter was missing or undefined. Check the tool parameters and provide all required values.";
                } else if (errorMessage.includes("ENOENT") ||
                           errorMessage.includes("no such file")) {
                  guidance = " HINT: The path does not exist. Try listing the directory first to see available files.";
                } else if (errorMessage.includes("EACCES") ||
                           errorMessage.includes("permission denied")) {
                  guidance = " HINT: Permission denied. Try a different path or check file permissions.";
                }

                // Send error result with guidance
                const errorResult = {
                  type: "tool-result",
                  toolCallId,
                  toolName, // Include toolName for ModelMessage format
                  output: {
                    success: false,
                    error: errorMessage + guidance,
                    suggestion: "Please check your arguments and try again with correct parameter types.",
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

              // Make follow-up call WITH tools to enable multi-step execution
              // Note: maxSteps is not available in AI SDK v6 streamText - tool execution is handled differently
              // For local models, we rely on the model's own iteration limits

              try {
                const followUpResult = streamText({
                  model,
                  system: systemPrompt,
                  messages: followUpModelMessages as any, // Type assertion needed due to complex ModelMessage types
                  tools, // Include tools to enable multi-step execution
                  toolChoice: tools && Object.keys(tools).length > 0 ? "auto" : undefined,
                  abortSignal: abortController.signal,
                  onStepFinish: ({ toolCalls: stepToolCalls, toolResults: stepToolResults }: any) => {
                    // Log follow-up step progress
                    if (stepToolCalls?.length) {
                      console.log(`[AI IPC Follow-up] Step tool calls:`, stepToolCalls.map((tc: any) => tc.toolName));
                    }
                    if (stepToolResults?.length) {
                      console.log(`[AI IPC Follow-up] Step tool results:`, stepToolResults.length);
                    }
                  },
                });

                // CRITICAL FIX: Wrap in try-catch for local models with undefined usage
                let followUpStream: AsyncIterable<any> & ReadableStream<any>;
                let followUpFailed = false;
                try {
                  followUpStream = followUpResult.toUIMessageStream();
                } catch (streamError: any) {
                  console.error(`[AI IPC Follow-up] Error creating UI message stream:`, streamError?.message || streamError);
                  // Skip follow-up on error - main response was already sent
                  followUpFailed = true;
                }
                if (followUpFailed || !followUpStream!) {
                  // Skip to the end of the try block (outer handler will deal with cleanup)
                  throw new Error("follow-up-stream-skip");
                }
                const followUpReader = followUpStream.getReader();

                // Read follow-up response
                while (true) {
                  const { done: fDone, value: fValue } =
                    await followUpReader.read();
                  if (fDone) break;

                  if (fValue) {
                    // FIX: Ensure finish/finish-step chunks have valid usage data
                    if (fValue.type === "finish" || fValue.type === "finish-step") {
                      const fv = fValue as any;
                      if (!fv.usage) {
                        fv.usage = { inputTokens: { total: 0 }, outputTokens: { total: 0 } };
                      } else {
                        if (!fv.usage.inputTokens) fv.usage.inputTokens = { total: 0 };
                        else if (typeof fv.usage.inputTokens === "number") fv.usage.inputTokens = { total: fv.usage.inputTokens };
                        if (!fv.usage.outputTokens) fv.usage.outputTokens = { total: 0 };
                        else if (typeof fv.usage.outputTokens === "number") fv.usage.outputTokens = { total: fv.usage.outputTokens };
                      }
                    }
                    // Send chunk to renderer
                    event.sender.send("ai:stream:chunk", {
                      threadId,
                      chunk: JSON.stringify(fValue),
                    });

                    // Accumulate text for persistence
                    // AI SDK v6 uses 'delta' for text-delta chunks
                    const fv = fValue as any; // Type assertion for dynamic chunk types
                    if (fv.type === "text-delta" && fv.delta) {
                      currentTextContent += fv.delta;
                    }

                    // Track tool calls/results from follow-up for persistence
                    // Note: Some stream implementations use tool-call/tool-result, others use different patterns
                    if (fv.type === "tool-call") {
                      currentToolCalls.push({
                        type: "tool-call",
                        toolCallId: fv.toolCallId,
                        toolName: fv.toolName,
                        input: fv.args,
                      });
                    } else if (fv.type === "tool-result") {
                      const correspondingCall = currentToolCalls.find(
                        (tc) => tc.toolCallId === fv.toolCallId
                      );
                      currentToolResults.push({
                        type: "tool-result",
                        toolCallId: fv.toolCallId,
                        toolName: fv.toolName || correspondingCall?.toolName || "unknown",
                        output: fv.result,
                      });
                    }
                  }
                }
              } catch (followUpError: any) {
                // Check if this is our intentional skip error
                if (followUpError?.message === "follow-up-stream-skip") {
                  console.log(`[AI IPC] Skipped follow-up due to stream creation error (usage data issue)`);
                } else {
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
                }
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

          // Add sub-agent events to assistant parts for persistence
          // These capture the full agent execution history (plan, sub-agents, tool calls)
          if (currentSubAgentEvents.length > 0) {
            console.log(
              `[AI IPC] Adding ${currentSubAgentEvents.length} sub-agent events to assistant message parts`,
            );
            for (const subAgentEvent of currentSubAgentEvents) {
              assistantParts.push(subAgentEvent);
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
          // Clean up ALL timers and maps
          clearInterval(heartbeatInterval);
          // CRITICAL: Also clear batchTimeout to prevent delayed chunk sends after abort
          if (batchTimeout) {
            clearTimeout(batchTimeout);
            batchTimeout = null;
          }
          // Clear read timeout as well
          clearReadTimeout();
          // Clean up all tracking maps
          activeStreams.delete(threadId);
          preparedStreams.delete(threadId);
          streamBuffers.delete(threadId);
        }

        return { success: true, threadId };
      } catch (error: any) {
        console.error("[AI IPC] Stream error:", error);
        console.error("[AI IPC] Stream error stack:", error.stack);

        // Provide better error messages for local models
        const isLocalError = isLocalProvider(chatModel!.provider);
        let errorMessage = error.message || "Stream failed";
        let errorTips: string[] = [];

        if (isLocalError) {
          // Add specific tips for local model errors
          if (error.message?.includes("timeout") || error.message?.includes("Timeout")) {
            errorMessage = `Local model timed out. The model may be too slow or overloaded.`;
            errorTips = [
              "Try a smaller model (e.g., Llama 3.2 3B instead of 70B)",
              "Ensure your computer has enough RAM for the model",
              "Check if Ollama/LM Studio is running and responsive",
            ];
          } else if (error.message?.includes("tool") || error.message?.includes("function")) {
            errorMessage = `Local model had trouble with tool calls.`;
            errorTips = [
              "Some local models have limited tool support",
              "Try a model known for good tool support: Llama 3.1/3.2, Qwen, or DeepSeek",
              "Try asking a simple question first to verify the model works",
            ];
          } else if (error.message?.includes("fetch") || error.message?.includes("network")) {
            errorMessage = `Could not connect to local model server.`;
            errorTips = [
              "Make sure Ollama or LM Studio is running",
              "Check that the model is loaded and ready",
              "Verify the server URL in settings",
            ];
          } else {
            errorMessage = `Local model error: ${error.message}`;
            errorTips = [
              "Check if the model is properly loaded",
              "Try a different model",
              "Restart Ollama/LM Studio and try again",
            ];
          }

          console.log(`[AI IPC] Local model error tips:`, errorTips);
        }

        // Send error to renderer with tips
        event.sender.send("ai:stream:error", {
          threadId,
          error: errorMessage,
          isLocalModel: isLocalError,
          tips: errorTips,
        });

        // Clean up ALL resources including orphan timeout
        const orphanTimeout = orphanCleanupTimeouts.get(threadId);
        if (orphanTimeout) {
          clearTimeout(orphanTimeout);
          orphanCleanupTimeouts.delete(threadId);
        }
        activeStreams.delete(threadId);
        preparedStreams.delete(threadId);
        streamBuffers.delete(threadId);

        return { error: errorMessage };
      }
    },
  );

  /**
   * Abort an active stream
   * CRITICAL: Must clean up ALL maps to prevent memory leaks and zombie streams
   */
  ipcMain.handle("ai:abort", async (_event, threadId: string) => {
    // Always clear orphan cleanup timeout when aborting
    const orphanTimeout = orphanCleanupTimeouts.get(threadId);
    if (orphanTimeout) {
      clearTimeout(orphanTimeout);
      orphanCleanupTimeouts.delete(threadId);
    }

    const controller = activeStreams.get(threadId);
    if (controller) {
      console.log(`[AI IPC] Aborting stream: ${threadId}`);
      controller.abort();
      // CRITICAL: Clean up ALL maps, not just activeStreams
      // This prevents memory leaks and ensures proper cleanup
      activeStreams.delete(threadId);
      preparedStreams.delete(threadId);
      streamBuffers.delete(threadId);
      return { success: true };
    }
    // Even if no active controller, clean up any orphaned entries
    preparedStreams.delete(threadId);
    streamBuffers.delete(threadId);
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
   * Used for AI-powered structured output generation
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

  /**
   * Generate text from prompt (for inline text enhancement)
   * Simple text generation without streaming
   */
  ipcMain.handle(
    "ai:generateText",
    async (
      _event,
      request: {
        chatModel: { provider: string; model: string };
        system: string;
        prompt: string;
        maxTokens?: number;
      },
    ) => {
      const { chatModel, system, prompt, maxTokens = 2000 } = request;

      console.log(
        `[AI IPC] Generate text request, model: ${chatModel?.provider}/${chatModel?.model}`,
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

        // Generate text using the AI SDK
        const { generateText } = await import("ai");
        const result = await generateText({
          model,
          messages: [
            {
              role: "system",
              content: system,
            },
            {
              role: "user",
              content: prompt,
            },
          ],
          maxTokens,
        } as Parameters<typeof generateText>[0]);

        return { success: true, text: result.text };
      } catch (error: any) {
        console.error("[AI IPC] Generate text error:", error);
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
        // ============================================
        // USE ai-sdk-ollama FOR RELIABLE TOOL CALLING
        // The ai-sdk-ollama package by jagreehal has:
        // - Enhanced response synthesis for GUARANTEED complete responses
        // - Automatic JSON repair for tool arguments
        // - Built-in reliability features
        // 
        // This solves the "tools execute but return incomplete responses" issue!
        // See: https://sdk.vercel.ai/providers/community-providers/ollama
        // ============================================
        const { ollama: ollamaProvider } = await import("ai-sdk-ollama");

        // Get base URL from provider config or use default
        const [providerConfig] = await db
          .select()
          .from(schema.ProviderConfigTable)
          .where(eq(schema.ProviderConfigTable.providerId, "ollama"))
          .limit(1);

        let baseUrl = providerConfig?.baseUrl || "http://localhost:11434";
        // Normalize base URL - remove trailing slash
        if (baseUrl.endsWith("/")) {
          baseUrl = baseUrl.slice(0, -1);
        }
        // Remove /v1 if present (OpenAI-style)
        if (baseUrl.endsWith("/v1")) {
          baseUrl = baseUrl.slice(0, -3);
        }
        // Remove /api if present
        if (baseUrl.endsWith("/api")) {
          baseUrl = baseUrl.slice(0, -4);
        }

        console.log(`[AI IPC] Creating Ollama model: ${model} at ${baseUrl}`);

        const modelLower = model.toLowerCase();
        
        // ============================================
        // THINKING MODEL DETECTION
        // Models that emit <think>...</think> blocks need reasoning middleware
        // ============================================
        const isThinkingModel =
          modelLower.includes("qwen3") ||
          modelLower.includes("qwen2.5") ||
          modelLower.includes("deepseek-r1") ||
          modelLower.includes("deepseek-reasoner") ||
          modelLower.includes("thinking") ||
          modelLower.includes("reason");

        // ============================================
        // ai-sdk-ollama with MINIMAL options
        // Let Ollama auto-detect and use model's FULL native context
        // No num_ctx or num_predict limits = faster startup + full context
        // ============================================
        const ollamaModel = ollamaProvider(model, {
          options: {
            // NO num_ctx - let Ollama use model's full native context (8K, 32K, 128K, etc.)
            // NO num_predict - let model output as much as needed
            repeat_penalty: 1.1,       // Avoid repetition
            temperature: 0.7,          // Balanced creativity
          },
        });

        // ============================================
        // THINKING MODEL: Apply reasoning middleware
        // Extracts <think>...</think> blocks as reasoning content
        // ============================================
        if (isThinkingModel) {
          console.log(`[AI IPC] Thinking model detected: ${model} - applying reasoning middleware`);
          const { wrapLanguageModel, extractReasoningMiddleware } = await import("ai");
          
          const wrappedModel = wrapLanguageModel({
            model: ollamaModel,
            middleware: extractReasoningMiddleware({
              tagName: "think",
            }),
          });
          
          return wrappedModel;
        }

        console.log(`[AI IPC] Ollama model ready: ${model}`);
        return ollamaModel;
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
        console.log(`[AI IPC] LM Studio model created via OpenAI-compatible API`);
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
