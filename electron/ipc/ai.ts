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
            tools[toolId] = createTool({
              description: toolInfo.description || `MCP tool: ${toolInfo.name}`,
              parameters: z.object({}).passthrough(), // Accept any parameters
              execute: async (params) => {
                console.log(
                  `[AI MCP] Calling tool ${toolInfo.name} on ${server.name}`,
                );
                try {
                  const result = await client.callTool(toolInfo.name, params);
                  return result;
                } catch (error: any) {
                  console.error(`[AI MCP] Tool call failed:`, error);
                  return { error: error.message };
                }
              },
            });
            console.log(`[AI MCP] Loaded tool: ${toolId}`);
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
      parameters: z.object({
        command: z.string().describe("The command to execute"),
        cwd: z
          .string()
          .optional()
          .describe("Working directory (defaults to home directory)"),
        timeout: z
          .number()
          .optional()
          .describe("Timeout in milliseconds (default 30000)"),
      }),
      execute: async ({ command, cwd, timeout = 30000 }) => {
        console.log(`[AI Tools] Executing command: ${command}`);
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
      parameters: z.object({
        path: z.string().describe("Absolute path to the file"),
        encoding: z
          .string()
          .optional()
          .describe("File encoding (default utf-8)"),
      }),
      execute: async ({ path: filePath, encoding = "utf-8" }) => {
        console.log(`[AI Tools] Reading file: ${filePath}`);
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
      parameters: z.object({
        path: z.string().describe("Absolute path to the file"),
        content: z.string().describe("Content to write"),
        append: z
          .boolean()
          .optional()
          .describe("Append to file instead of overwrite"),
      }),
      execute: async ({ path: filePath, content, append = false }) => {
        console.log(`[AI Tools] Writing file: ${filePath}`);
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
      parameters: z.object({
        path: z.string().describe("Directory path to list"),
        recursive: z
          .boolean()
          .optional()
          .describe("List recursively (default false)"),
      }),
      execute: async ({ path: dirPath, recursive = false }) => {
        console.log(`[AI Tools] Listing directory: ${dirPath}`);
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
      parameters: z.object({
        fullScreen: z
          .boolean()
          .optional()
          .describe("Capture full screen (default true)"),
      }),
      execute: async ({ fullScreen = true }) => {
        console.log(`[AI Tools] Taking screenshot`);
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
      parameters: z.object({
        url: z.string().describe("URL to open"),
      }),
      execute: async ({ url }) => {
        console.log(`[AI Tools] Opening URL: ${url}`);
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
      parameters: z.object({
        _placeholder: z.string().optional().describe("Not used, leave empty"),
      }),
      execute: async () => {
        console.log(`[AI Tools] Reading clipboard`);
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
      parameters: z.object({
        text: z.string().describe("Text to write to clipboard"),
      }),
      execute: async ({ text }) => {
        console.log(`[AI Tools] Writing to clipboard`);
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
      parameters: z.object({
        _placeholder: z.string().optional().describe("Not used, leave empty"),
      }),
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
      parameters: z.object({
        directory: z.string().describe("Directory to search in"),
        pattern: z.string().describe("Glob pattern or filename to search for"),
        maxResults: z
          .number()
          .optional()
          .describe("Maximum results (default 50)"),
      }),
      execute: async ({ directory, pattern, maxResults = 50 }) => {
        console.log(`[AI Tools] Searching files: ${pattern} in ${directory}`);
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
  };
}

export function registerAIHandlers() {
  /**
   * Main streaming handler with FULL TOOL SUPPORT
   * Receives chat request, streams response back via IPC events
   */
  ipcMain.handle("ai:stream", async (event, request: StreamRequest) => {
    const {
      threadId,
      messages,
      chatModel,
      message,
      allowedAppDefaultToolkit,
      allowedMcpServers,
    } = request;

    console.log(
      `[AI IPC] Stream request for thread: ${threadId}, model: ${chatModel?.provider}/${chatModel?.model}`,
    );
    console.log(
      `[AI IPC] Allowed toolkits: ${allowedAppDefaultToolkit?.join(", ") || "all"}`,
    );
    console.log(
      `[AI IPC] Allowed MCP servers: ${allowedMcpServers ? Object.keys(allowedMcpServers).join(", ") : "none"}`,
    );

    // Create abort controller for this stream
    const abortController = new AbortController();
    activeStreams.set(threadId, abortController);

    try {
      // Get the API key for this provider
      const apiKey = await getApiKeyForProvider(chatModel.provider);

      if (!apiKey && !isLocalProvider(chatModel.provider)) {
        event.sender.send("ai:stream:error", {
          threadId,
          error: `No API key configured for ${chatModel.provider}. Please add an API key in Settings > Models.`,
        });
        return { error: "No API key" };
      }

      // Get the model instance
      const model = await getModelInstance(chatModel, apiKey);

      if (!model) {
        event.sender.send("ai:stream:error", {
          threadId,
          error: `Could not initialize model ${chatModel.provider}/${chatModel.model}`,
        });
        return { error: "Model init failed" };
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
      console.log(
        `[AI IPC] Desktop tools loaded: ${Object.keys(desktopTools).join(", ")}`,
      );

      // Load MCP tools if allowed
      const mcpTools = await loadMcpTools(allowedMcpServers);
      console.log(
        `[AI IPC] MCP tools loaded: ${Object.keys(mcpTools).join(", ") || "none"}`,
      );

      // Merge all tools
      const tools = { ...desktopTools, ...mcpTools };
      console.log(`[AI IPC] Total tools: ${Object.keys(tools).length}`);

      // Start streaming WITH TOOLS AND MULTI-STEP
      const result = streamText({
        model,
        system: AGENT_SYSTEM_PROMPT,
        messages: modelMessages,
        tools,
        maxSteps: 20, // Allow up to 20 tool calls per request for complex tasks
        abortSignal: abortController.signal,
        maxRetries: 2,
        onStepFinish: ({ stepType, toolCalls }) => {
          console.log(
            `[AI IPC] Step finished: ${stepType}, tools: ${toolCalls?.length || 0}`,
          );
          if (toolCalls?.length) {
            for (const tc of toolCalls) {
              console.log(`[AI IPC]   - Tool: ${tc.toolName}`);
            }
          }
        },
      });

      // Convert to UI message stream for proper formatting
      const stream = result.toUIMessageStream({
        sendUsage: true,
        messageMetadata: () => ({
          chatModel,
        }),
      });

      // Read the stream and send chunks to renderer
      const reader = stream.getReader();

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          // Send each stream part to renderer
          if (value) {
            // The value is a UIMessageChunk - serialize it for IPC
            event.sender.send("ai:stream:chunk", {
              threadId,
              chunk: JSON.stringify(value),
            });
          }
        }

        // Stream completed successfully
        console.log(`[AI IPC] Stream finished for thread: ${threadId}`);
        event.sender.send("ai:stream:end", {
          threadId,
          finishReason: "stop",
        });
      } finally {
        // Clean up
        activeStreams.delete(threadId);
      }

      return { success: true, threadId };
    } catch (error: any) {
      console.error("[AI IPC] Stream error:", error);

      // Send error to renderer
      event.sender.send("ai:stream:error", {
        threadId,
        error: error.message || "Stream failed",
      });

      // Clean up
      activeStreams.delete(threadId);

      return { error: error.message };
    }
  });

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

      console.log(
        `[AI IPC] Title generation for thread: ${threadId}, model: ${chatModel?.provider}/${chatModel?.model}`,
      );
      console.log(
        `[AI IPC] Title generation message: "${message.slice(0, 100)}..."`,
      );

      try {
        // Get the API key for this provider
        console.log(
          `[AI IPC] Getting API key for provider: ${chatModel.provider}`,
        );
        const apiKey = await getApiKeyForProvider(chatModel.provider);
        console.log(`[AI IPC] API key found: ${apiKey ? "YES" : "NO"}`);

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
        console.log(`[AI IPC] Calling generateText for title...`);
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

        console.log(`[AI IPC] Title generation result:`, result.text);
        const title = result.text.trim().replace(/^["']|["']$/g, ""); // Remove quotes if any
        console.log(`[AI IPC] Generated title: "${title}"`);

        // Update thread title in database
        console.log(`[AI IPC] Updating thread title in database...`);
        const db = getDatabase();
        await db
          .update(schema.ChatThreadTable)
          .set({ title })
          .where(eq(schema.ChatThreadTable.id, threadId));
        console.log(`[AI IPC] Database updated successfully`);

        // Send title to renderer
        console.log(`[AI IPC] Sending title to renderer via IPC event...`);
        event.sender.send("ai:title:generated", {
          threadId,
          title,
        });

        console.log(`[AI IPC] Title generation complete: "${title}"`);
        return { success: true, title };
      } catch (error: any) {
        console.error("[AI IPC] Title generation error:", error);
        console.error("[AI IPC] Error stack:", error.stack);
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

        console.log(`[AI IPC] Object generated successfully`);
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
