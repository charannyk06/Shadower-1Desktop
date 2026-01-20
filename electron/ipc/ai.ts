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
  screen,
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
import { exec, spawn } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { z } from "zod";
import {
  createMCPClient,
  MCPClient,
} from "../../src/lib/ai/mcp/create-mcp-client";
import type { MCPServerConfig, AllowedMCPServer } from "../../src/types/mcp";

const execAsync = promisify(exec);

// Track active streams for abort functionality
const activeStreams = new Map<string, AbortController>();

// Track active MCP clients
const mcpClients = new Map<string, MCPClient>();

// Track stream contexts for two-phase streaming (prepare + start)
interface StreamContext {
  model: any;
  messages: any[];
  tools: Record<string, any>;
  abortController: AbortController;
  systemPrompt: string;
  threadId: string;
  event: Electron.IpcMainInvokeEvent;
  userMessage?: UIMessage; // Store user message for persistence
  chatModel?: { provider: string; model: string };
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

/**
 * Ensure a thread exists in the database, creating it if necessary
 */
async function ensureThreadExists(threadId: string): Promise<void> {
  const db = getDatabase();
  const existing = await db
    .select()
    .from(schema.ChatThreadTable)
    .where(eq(schema.ChatThreadTable.id, threadId))
    .limit(1);

  if (existing.length === 0) {
    // Thread doesn't exist, create it
    // Get the default user ID (for desktop, there's a local user)
    const users = await db.select().from(schema.UserTable).limit(1);
    const userId = users[0]?.id;

    if (userId) {
      await db.insert(schema.ChatThreadTable).values({
        id: threadId,
        userId,
        title: "New Chat", // Default title, will be updated after first response
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } else {
      console.error(`[AI IPC] Cannot create thread - no user found`);
    }
  }
}

/**
 * Save a message to the database
 */
async function saveMessageToDb(
  threadId: string,
  messageId: string,
  role: "user" | "assistant",
  parts: any[],
  metadata?: Record<string, any>,
) {
  try {
    const db = getDatabase();

    // Ensure thread exists before saving message
    await ensureThreadExists(threadId);

    await db
      .insert(schema.ChatMessageTable)
      .values({
        id: messageId,
        threadId,
        role,
        parts: JSON.stringify(parts),
        metadata: metadata ? JSON.stringify(metadata) : null,
        createdAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.ChatMessageTable.id,
        set: {
          parts: JSON.stringify(parts),
          metadata: metadata ? JSON.stringify(metadata) : null,
        },
      });
  } catch (error) {
    console.error(`[AI IPC] Failed to save ${role} message:`, error);
  }
}

/**
 * Get or create an MCP client for a server
 */
async function getMcpClient(
  serverId: string,
  serverName: string,
  config: MCPServerConfig,
): Promise<MCPClient> {
  let client = mcpClients.get(serverId);
  if (!client) {
    client = createMCPClient(serverId, serverName, config, {
      autoDisconnectSeconds: 60 * 30, // 30 minutes
    });
    mcpClients.set(serverId, client);
  }

  // Connect if not connected
  if (client.status !== "connected" && client.status !== "loading") {
    await client.connect();

    // Wait for toolInfo to be populated (max 5 seconds)
    let attempts = 0;
    while (
      (!client.toolInfo || client.toolInfo.length === 0) &&
      attempts < 50
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      attempts++;
    }
  }

  return client;
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
      const client = await getMcpClient(
        server.id,
        server.name,
        server.config as MCPServerConfig,
      );

      // Wait for client to be connected and have tool info
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
 */
function createElectronTools(_threadId: string) {
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

    // Take screenshot
    desktop_screenshot: createTool({
      description: "Take a screenshot of the screen",
      inputSchema: z.object({
        fullScreen: z
          .boolean()
          .optional()
          .describe("Capture full screen (default true)"),
      }),
      execute: async ({ fullScreen = true }) => {
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

          return {
            success: true,
            screenshot: base64,
            width: thumbnail.getSize().width,
            height: thumbnail.getSize().height,
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
  };
}

export function registerAIHandlers() {
  /**
   * Phase 1: Prepare the stream (setup model, tools, etc.)
   * Returns immediately so renderer can set up listeners
   * Actual streaming starts when renderer calls ai:stream:start
   */
  ipcMain.handle("ai:stream", async (event, request: StreamRequest) => {
    const { threadId, messages, chatModel, message, allowedMcpServers } =
      request;

    console.log(
      `[AI IPC] Stream PREPARE for thread: ${threadId}, model: ${chatModel?.provider}/${chatModel?.model}`,
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
      const model = await getModelInstance(chatModel, apiKey);

      if (!model) {
        const errorMsg = `Could not initialize model ${chatModel.provider}/${chatModel.model}`;
        streamBuffers.get(threadId)!.error = errorMsg;
        return { error: errorMsg, threadId };
      }

      // Prepare messages for the model
      const allMessages = [...messages];
      if (message && allMessages[allMessages.length - 1]?.id !== message.id) {
        allMessages.push(message);
      }

      // Convert to model format
      const modelMessages = await convertToModelMessages(allMessages);

      // Create desktop tools for this thread
      const desktopTools = createElectronTools(threadId);
      // console.log(
      //   `[AI IPC] Desktop tools loaded: ${Object.keys(desktopTools).join(", ")}`,
      // );

      // Load MCP tools if allowed
      const mcpTools = await loadMcpTools(allowedMcpServers);
      // console.log(
      //   `[AI IPC] MCP tools loaded: ${Object.keys(mcpTools).join(", ") || "none"}`,
      // );

      // Merge all tools
      const tools = { ...desktopTools, ...mcpTools };

      // Handle empty tools - pass undefined instead of {} for text-only streaming
      const toolsToUse = Object.keys(tools).length > 0 ? tools : undefined;

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
      } = context;

      try {
        // SAVE USER MESSAGE to database before streaming (non-blocking)
        if (userMessage) {
          saveMessageToDb(
            threadId,
            userMessage.id,
            "user",
            userMessage.parts || [
              {
                type: "text",
                text:
                  typeof userMessage.content === "string"
                    ? userMessage.content
                    : "",
              },
            ],
          ).catch((err) => {
            // Log but don't block streaming if message save fails
            console.error(
              `[AI IPC] Failed to save user message (non-blocking):`,
              err,
            );
          });
        }

        // NOW actually start streaming - listeners are guaranteed ready
        const result = streamText({
          model,
          system: systemPrompt,
          messages,
          tools,
          maxSteps: tools ? 50 : 1, // Single step for text-only, 50 for agentic tasks
          abortSignal: abortController.signal,
          maxRetries: 2,
          onStepFinish: ({ stepType, toolCalls }) => {
            // Send step event to renderer
            event.sender.send("ai:stream:step", {
              threadId,
              stepType,
              toolCallCount: toolCalls?.length || 0,
            });
          },
        });

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

        // console.log(`[AI IPC] Starting to read stream for thread: ${threadId}`);
        let _chunkCount = 0;
        const startTime = Date.now();
        const TIMEOUT_MS = 60000; // 60 second timeout

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
            const timeoutPromise = new Promise((_, reject) =>
              setTimeout(() => reject(new Error("Read timeout")), 10000),
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
                currentToolCalls.push({
                  type: "tool-call",
                  toolCallId: value.toolCallId,
                  toolName: value.toolName,
                  args: value.args,
                });
              } else if (value.type === "tool-result") {
                currentToolResults.push({
                  type: "tool-result",
                  toolCallId: value.toolCallId,
                  result: value.result,
                });
              }
            }
          }

          // Build assistant message parts for saving
          if (currentTextContent) {
            assistantParts.push({ type: "text", text: currentTextContent });
          }
          assistantParts.push(...currentToolCalls);
          assistantParts.push(...currentToolResults);

          // SAVE ASSISTANT MESSAGE to database
          if (assistantParts.length > 0) {
            await saveMessageToDb(
              threadId,
              assistantMessageId,
              "assistant",
              assistantParts,
              { chatModel },
            );
          }

          // Stream completed successfully
          event.sender.send("ai:stream:end", {
            threadId,
            finishReason: "stop",
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
        });

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
          "../../src/lib/ai/json-schema-to-zod"
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

    // Get the API key from database
    const [keyRecord] = await db
      .select()
      .from(schema.ApiKeyTable)
      .where(eq(schema.ApiKeyTable.providerId, providerId))
      .limit(1);

    if (!keyRecord) {
      return null;
    }

    // Decrypt the API key
    return decryptApiKey(keyRecord.encryptedKey);
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

      case "ollama": {
        const { createOllama } = await import("ollama-ai-provider-v2");
        // Get base URL from provider config or use default
        const [providerConfig] = await db
          .select()
          .from(schema.ProviderConfigTable)
          .where(eq(schema.ProviderConfigTable.providerId, "ollama"))
          .limit(1);

        const baseUrl = providerConfig?.baseUrl || "http://localhost:11434/api";
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
  } catch (error) {
    console.error(
      `[AI IPC] Error creating model instance for ${provider}/${model}:`,
      error,
    );
    return null;
  }
}
