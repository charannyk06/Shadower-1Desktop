import "server-only";
import {
  LoadAPIKeyError,
  Tool,
  ToolUIPart,
  UIMessage,
  UIMessagePart,
  UIMessageStreamWriter,
  tool as createTool,
  getToolName,
  isToolUIPart,
  jsonSchema,
} from "ai";
import {
  ChatMention,
  ChatMetadata,
  ManualToolConfirmTag,
} from "app-types/chat";
import {
  AllowedMCPServer,
  McpServerCustomizationsPrompt,
  VercelAIMcpTool,
  VercelAIMcpToolTag,
} from "app-types/mcp";
import { MANUAL_REJECT_RESPONSE_PROMPT } from "lib/ai/prompts";
import { errorToString, exclude, objectFlow } from "lib/utils";
import logger from "logger";

import { ObjectJsonSchema7 } from "app-types/util";
import { workflowRepository } from "lib/db/repository";
import { safe } from "ts-safe";

import {
  VercelAIWorkflowTool,
  VercelAIWorkflowToolStreaming,
  VercelAIWorkflowToolStreamingResultTag,
  VercelAIWorkflowToolTag,
} from "app-types/workflow";
import {
  getSystemAgent,
  getSystemAgentRequirements,
  isSystemAgent,
} from "lib/ai/agents/system-agents";
import { mcpClientsManager } from "lib/ai/mcp/mcp-manager";
import { AppDefaultToolkit } from "lib/ai/tools";
import {
  APP_DEFAULT_TOOL_KIT,
  CodeExecutionContext,
  createAppDefaultToolKit,
} from "lib/ai/tools/tool-kit";
import { createWorkflowExecutor } from "lib/ai/workflow/executor/workflow-executor";
import { NodeKind } from "lib/ai/workflow/workflow.interface";

export function filterMCPToolsByMentions(
  tools: Record<string, VercelAIMcpTool>,
  mentions: ChatMention[],
) {
  if (mentions.length === 0) {
    return tools;
  }
  const toolMentions = mentions.filter(
    (mention) => mention.type == "mcpTool" || mention.type == "mcpServer",
  ) as Extract<ChatMention, { type: "mcpTool" | "mcpServer" }>[];

  const metionsByServer = toolMentions.reduce(
    (acc, mention) => {
      if (mention.type == "mcpServer") {
        return {
          ...acc,
          [mention.serverId]: Object.values(tools).map(
            (tool) => tool._originToolName,
          ),
        };
      }
      return {
        ...acc,
        [mention.serverId]: [...(acc[mention.serverId] ?? []), mention.name],
      };
    },
    {} as Record<string, string[]>,
  );

  return objectFlow(tools).filter((_tool) => {
    if (!metionsByServer[_tool._mcpServerId]) return false;
    return metionsByServer[_tool._mcpServerId].includes(_tool._originToolName);
  });
}

export function filterMCPToolsByAllowedMCPServers(
  tools: Record<string, VercelAIMcpTool>,
  allowedMcpServers?: Record<string, AllowedMCPServer>,
): Record<string, VercelAIMcpTool> {
  if (!allowedMcpServers || Object.keys(allowedMcpServers).length === 0) {
    return {};
  }
  return objectFlow(tools).filter((_tool) => {
    if (!allowedMcpServers[_tool._mcpServerId]?.tools) return false;
    return allowedMcpServers[_tool._mcpServerId].tools.includes(
      _tool._originToolName,
    );
  });
}

export function excludeToolExecution(
  tool: Record<string, Tool>,
): Record<string, Tool> {
  return objectFlow(tool).map((value) => {
    return createTool({
      inputSchema: value.inputSchema,
      description: value.description,
    });
  });
}

// Planning/orchestration tools that should ALWAYS auto-execute even in manual mode
// These are internal agent tools for task management, not external API calls
const ALWAYS_AUTO_EXECUTE_TOOLS = new Set([
  "createPlan",
  "updateTaskStatus",
  "getNextTask",
  "getPlanStatus",
  "setContext",
  "getContext",
  "getAllContext",
  "spawnAgent",
  "spawnParallelAgents",
  "executeWorkflow",
]);

/**
 * Exclude tool execution EXCEPT for planning/orchestration tools
 * Planning tools always auto-execute even in manual mode because:
 * 1. They are internal agent tools, not external API calls
 * 2. Requiring manual approval for each plan step defeats the purpose
 * 3. Users still have control over external tools (web search, MCP, etc.)
 */
export function excludeToolExecutionExceptPlanning(
  tools: Record<string, Tool>,
): Record<string, Tool> {
  return objectFlow(tools).map((value, key) => {
    // Keep execute function for planning/orchestration tools
    if (ALWAYS_AUTO_EXECUTE_TOOLS.has(key)) {
      return value;
    }
    // Strip execute function for external tools (require manual confirmation)
    return createTool({
      inputSchema: value.inputSchema,
      description: value.description,
    });
  });
}

export function mergeSystemPrompt(
  ...prompts: (string | undefined | false)[]
): string {
  const filteredPrompts = prompts
    .map((prompt) => (prompt ? prompt.trim() : ""))
    .filter(Boolean);
  return filteredPrompts.join("\n\n");
}

export function manualToolExecuteByLastMessage(
  part: ToolUIPart,
  tools: Record<string, VercelAIMcpTool | VercelAIWorkflowTool | Tool>,
  abortSignal?: AbortSignal,
) {
  const { input } = part;

  const toolName = getToolName(part);

  const tool = tools[toolName];
  return safe(() => {
    if (!tool) throw new Error(`tool not found: ${toolName}`);
    if (!ManualToolConfirmTag.isMaybe(part.output))
      throw new Error("manual tool confirm not found");
    return part.output;
  })
    .map(({ confirm }) => {
      if (!confirm) return MANUAL_REJECT_RESPONSE_PROMPT;
      if (VercelAIWorkflowToolTag.isMaybe(tool)) {
        return tool.execute!(input, {
          toolCallId: part.toolCallId,
          abortSignal: abortSignal ?? new AbortController().signal,
          messages: [],
        });
      } else if (VercelAIMcpToolTag.isMaybe(tool)) {
        return mcpClientsManager.toolCall(
          tool._mcpServerId,
          tool._originToolName,
          input,
        );
      }
      return tool.execute!(input, {
        toolCallId: part.toolCallId,
        abortSignal: abortSignal ?? new AbortController().signal,
        messages: [],
      });
    })
    .ifFail((error) => ({
      isError: true,
      statusMessage: `tool call fail: ${toolName}`,
      error: errorToString(error),
    }))
    .unwrap();
}

export function handleError(error: any) {
  if (LoadAPIKeyError.isInstance(error)) {
    return error.message;
  }
  logger.error(error);
  logger.error(`Route Error: ${error.name}`);
  return errorToString(error.message);
}

export function extractInProgressToolPart(message: UIMessage): ToolUIPart[] {
  if (message.role != "assistant") return [];
  if ((message.metadata as ChatMetadata)?.toolChoice != "manual") return [];
  return message.parts.filter(
    (part) =>
      isToolUIPart(part) &&
      part.state == "output-available" &&
      ManualToolConfirmTag.isMaybe(part.output),
  ) as ToolUIPart[];
}

export function filterMcpServerCustomizations(
  tools: Record<string, VercelAIMcpTool>,
  mcpServerCustomization: Record<string, McpServerCustomizationsPrompt>,
): Record<string, McpServerCustomizationsPrompt> {
  const toolNamesByServerId = Object.values(tools).reduce(
    (acc, tool) => {
      if (!acc[tool._mcpServerId]) acc[tool._mcpServerId] = [];
      acc[tool._mcpServerId].push(tool._originToolName);
      return acc;
    },
    {} as Record<string, string[]>,
  );

  return Object.entries(mcpServerCustomization).reduce(
    (acc, [serverId, mcpServerCustomization]) => {
      if (!(serverId in toolNamesByServerId)) return acc;

      if (
        !mcpServerCustomization.prompt &&
        !Object.keys(mcpServerCustomization.tools ?? {}).length
      )
        return acc;

      const prompts: McpServerCustomizationsPrompt = {
        id: serverId,
        name: mcpServerCustomization.name,
        prompt: mcpServerCustomization.prompt,
        tools: mcpServerCustomization.tools
          ? objectFlow(mcpServerCustomization.tools).filter((_, key) => {
              return toolNamesByServerId[serverId].includes(key as string);
            })
          : {},
      };

      acc[serverId] = prompts;

      return acc;
    },
    {} as Record<string, McpServerCustomizationsPrompt>,
  );
}

export const workflowToVercelAITool = ({
  id,
  description,
  schema,
  dataStream,
  name,
  userId,
}: {
  id: string;
  name: string;
  description?: string;
  schema: ObjectJsonSchema7;
  dataStream: UIMessageStreamWriter;
  userId?: string;
}): VercelAIWorkflowTool => {
  const toolName = name
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toUpperCase();

  const tool = createTool({
    description: `${name} ${description?.trim().slice(0, 50)}`,
    inputSchema: jsonSchema(schema),
    execute(query, { toolCallId, abortSignal }) {
      const history: VercelAIWorkflowToolStreaming[] = [];
      const toolResult = VercelAIWorkflowToolStreamingResultTag.create({
        toolCallId,
        workflowName: name,

        startedAt: Date.now(),
        endedAt: Date.now(),
        history,
        result: undefined,
        status: "running",
      });
      return safe(id)
        .map((id) =>
          workflowRepository.selectStructureById(id, {
            ignoreNote: true,
          }),
        )
        .map((workflow) => {
          if (!workflow) throw new Error("Not Found Workflow");
          const executor = createWorkflowExecutor({
            nodes: workflow.nodes,
            edges: workflow.edges,
            userId, // Pass userId for Composio tool execution within workflows
          });
          toolResult.workflowIcon = workflow.icon;

          abortSignal?.addEventListener("abort", () => executor.exit());
          executor.subscribe((e) => {
            if (
              e.eventType == "WORKFLOW_START" ||
              e.eventType == "WORKFLOW_END"
            )
              return;
            if (e.node.name == "SKIP") return;
            if (e.eventType == "NODE_START") {
              const node = workflow.nodes.find(
                (node) => node.id == e.node.name,
              )!;
              if (!node) return;
              history.push({
                id: e.nodeExecutionId,
                name: node.name,
                status: "running",
                startedAt: e.startedAt,
                kind: node.kind as NodeKind,
              });
            } else if (e.eventType == "NODE_END") {
              const result = history.find((r) => r.id == e.nodeExecutionId);
              if (result) {
                if (e.isOk) {
                  result.status = "success";
                  result.result = {
                    input: e.node.output.getInput(e.node.name),
                    output: e.node.output.getOutput({
                      nodeId: e.node.name,
                      path: [],
                    }),
                  };
                } else {
                  result.status = "fail";
                  result.error = {
                    name: e.error?.name || "ERROR",
                    message: errorToString(e.error),
                  };
                }
                result.endedAt = e.endedAt;
              }
            }

            dataStream.write({
              type: "tool-output-available",
              toolCallId,
              output: toolResult,
            });
          });
          return executor.run(
            {
              query: query ?? ({} as any),
            },
            {
              disableHistory: true,
            },
          );
        })
        .map((result) => {
          toolResult.endedAt = Date.now();
          toolResult.status = result.isOk ? "success" : "fail";
          toolResult.error = result.error
            ? {
                name: result.error.name || "ERROR",
                message: errorToString(result.error) || "Unknown Error",
              }
            : undefined;
          const outputNodeResults = history
            .filter((h) => h.kind == NodeKind.Output)
            .map((v) => v.result?.output)
            .filter(Boolean);
          toolResult.history = history.map((h) => ({
            ...h,
            result: undefined, // save tokens.
          }));
          toolResult.result =
            outputNodeResults.length == 1
              ? outputNodeResults[0]
              : outputNodeResults;
          return toolResult;
        })
        .ifFail((err) => {
          return {
            error: {
              name: err?.name || "ERROR",
              message: errorToString(err),
              history,
            },
          };
        })
        .unwrap();
    },
  }) as VercelAIWorkflowTool;

  tool._workflowId = id;
  tool._originToolName = name;
  tool._toolName = toolName;

  return VercelAIWorkflowToolTag.create(tool);
};

export const workflowToVercelAITools = (
  workflows: {
    id: string;
    name: string;
    description?: string;
    schema: ObjectJsonSchema7;
  }[],
  dataStream: UIMessageStreamWriter,
  userId?: string,
) => {
  return workflows
    .map((v) =>
      workflowToVercelAITool({
        ...v,
        dataStream,
        userId,
      }),
    )
    .reduce(
      (prev, cur) => {
        prev[cur._toolName] = cur;
        return prev;
      },
      {} as Record<string, VercelAIWorkflowTool>,
    );
};

/**
 * MCP tools that conflict with the sandbox tool and should be filtered out.
 * These tools operate on the SERVER filesystem, not the sandbox workspace.
 * When these are available, models (especially non-Anthropic ones) often use them
 * instead of the sandbox tool, causing files to not appear in the Workspace.
 */
const CONFLICTING_MCP_FILE_TOOLS = new Set([
  // Common filesystem MCP server tools
  "writeFile",
  "readFile",
  "write_file",
  "read_file",
  "createFile",
  "create_file",
  "deleteFile",
  "delete_file",
  "listDirectory",
  "list_directory",
  "listDir",
  "list_dir",
  "mkdir",
  "mkdirp",
  "rmdir",
  "rename",
  "copy",
  "move",
  // Additional filesystem tools that might cause confusion
  "appendFile",
  "append_file",
  "editFile",
  "edit_file",
  "updateFile",
  "update_file",
]);

/**
 * Filters out MCP tools that conflict with the sandbox tool.
 * This prevents models from using MCP filesystem tools instead of sandbox.
 */
export function filterConflictingMcpTools(
  tools: Record<string, VercelAIMcpTool>,
): Record<string, VercelAIMcpTool> {
  return objectFlow(tools).filter((tool) => {
    const isConflicting = CONFLICTING_MCP_FILE_TOOLS.has(tool._originToolName);
    if (isConflicting) {
      logger.info(
        `[Tools] Filtering out conflicting MCP tool: ${tool._originToolName} from ${tool._mcpServerName}`,
      );
    }
    return !isConflicting;
  });
}

export const loadMcpTools = (opt?: {
  mentions?: ChatMention[];
  allowedMcpServers?: Record<string, AllowedMCPServer>;
}) =>
  safe(() => mcpClientsManager.tools())
    .map((tools) => {
      let filteredTools: Record<string, VercelAIMcpTool>;
      if (opt?.mentions?.length) {
        filteredTools = filterMCPToolsByMentions(tools, opt.mentions);
      } else {
        filteredTools = filterMCPToolsByAllowedMCPServers(
          tools,
          opt?.allowedMcpServers,
        );
      }
      // Always filter out conflicting file tools to prevent sandbox confusion
      return filterConflictingMcpTools(filteredTools);
    })
    .orElse({} as Record<string, VercelAIMcpTool>);

export const loadWorkFlowTools = (opt: {
  mentions?: ChatMention[];
  dataStream: UIMessageStreamWriter;
  userId?: string;
}) =>
  safe(() =>
    opt?.mentions?.length
      ? workflowRepository.selectToolByIds(
          opt?.mentions
            ?.filter((m) => m.type == "workflow")
            .map(
              (v) =>
                (v as Extract<ChatMention, { type: "workflow" }>).workflowId,
            ),
        )
      : [],
  )
    .map((tools) => workflowToVercelAITools(tools, opt.dataStream, opt.userId))
    .orElse({} as Record<string, VercelAIWorkflowTool>);

export const loadAppDefaultTools = (opt?: {
  mentions?: ChatMention[];
  allowedAppDefaultToolkit?: string[];
  /** Thread context for file persistence in code execution tools */
  codeExecutionContext?: CodeExecutionContext;
}) => {
  // Log context for debugging sandbox persistence issues
  logger.info(
    `[Tools] Loading app default tools with context: threadId=${opt?.codeExecutionContext?.threadId}, userId=${opt?.codeExecutionContext?.userId}`,
  );

  // Create tool kit with context-aware code tools if context is provided
  const toolKit = opt?.codeExecutionContext
    ? createAppDefaultToolKit(opt.codeExecutionContext)
    : APP_DEFAULT_TOOL_KIT;

  return safe(toolKit)
    .map((tools) => {
      // Check for system agent mentions and get required toolkits
      const systemAgentToolkits: string[] = [];
      if (opt?.mentions?.length) {
        const agentMentions = opt.mentions.filter(
          (m) => m.type === "agent",
        ) as Extract<ChatMention, { type: "agent" }>[];

        for (const mention of agentMentions) {
          if (isSystemAgent(mention.agentId)) {
            const requirements = getSystemAgentRequirements(mention.agentId);
            const agentDef = getSystemAgent(mention.agentId);
            logger.info(
              `[Tools] System agent ${mention.agentId} (category: ${agentDef?.category}) requirements: browserbase=${requirements.browserbase}, e2bDesktop=${requirements.e2bDesktop}, e2bCodeInterpreter=${requirements.e2bCodeInterpreter}`,
            );

            // Add required toolkits based on agent requirements
            if (requirements.browserbase) {
              systemAgentToolkits.push(AppDefaultToolkit.Browser);
              systemAgentToolkits.push(AppDefaultToolkit.WebSearch);
            }
            if (requirements.e2bDesktop) {
              systemAgentToolkits.push(AppDefaultToolkit.Desktop);
            }
            if (requirements.e2bCodeInterpreter) {
              systemAgentToolkits.push(AppDefaultToolkit.Sandbox);
              systemAgentToolkits.push(AppDefaultToolkit.Visualization);
              systemAgentToolkits.push(AppDefaultToolkit.DataAnalysis);
            }

            // Add toolkits based on agent category
            if (agentDef?.category === "research") {
              systemAgentToolkits.push(AppDefaultToolkit.Research);
            }
            if (agentDef?.category === "documents") {
              systemAgentToolkits.push(AppDefaultToolkit.Documents);
            }
          }
        }
      }

      // If there are specific default tool mentions, filter to just those
      if (opt?.mentions?.length) {
        const defaultToolMentions = opt.mentions.filter(
          (m) => m.type == "defaultTool",
        );
        if (defaultToolMentions.length > 0) {
          return Array.from(Object.values(tools)).reduce((acc, t) => {
            const allowed = objectFlow(t).filter((_, k) => {
              return defaultToolMentions.some((m) => m.name == k);
            });
            return { ...acc, ...allowed };
          }, {});
        }
      }

      // Determine which toolkits to load
      let allowedToolkits: string[];

      if (systemAgentToolkits.length > 0) {
        // System agent detected - use its required toolkits
        // Also include some base toolkits that all agents need
        allowedToolkits = [
          ...new Set([
            ...systemAgentToolkits,
            AppDefaultToolkit.Http, // All agents may need HTTP
          ]),
        ];
        logger.info(
          `[Tools] Loading toolkits for system agent: ${allowedToolkits.join(", ")}`,
        );
      } else if (
        opt?.allowedAppDefaultToolkit &&
        opt.allowedAppDefaultToolkit.length > 0
      ) {
        // Client specified allowed toolkits
        allowedToolkits = opt.allowedAppDefaultToolkit;
      } else {
        // Default to all toolkits
        allowedToolkits = Object.values(AppDefaultToolkit);
      }

      return (
        allowedToolkits.reduce(
          (acc, key) => {
            return { ...acc, ...tools[key] };
          },
          {} as Record<string, Tool>,
        ) || {}
      );
    })
    .ifFail((e) => {
      console.error(e);
      throw e;
    })
    .orElse({} as Record<string, Tool>);
};

export const loadComposioTools = async (opt?: {
  mentions?: ChatMention[];
  userId?: string;
  allowedApps?: string[];
}) => {
  const { isComposioEnabled, getComposioClientForUser } = await import(
    "lib/ai/composio"
  );

  if (!isComposioEnabled()) {
    return {};
  }

  if (!opt?.userId) {
    return {};
  }

  return safe(async () => {
    const client = getComposioClientForUser(opt.userId!);
    if (!client) return {};

    const composioMentions = opt?.mentions?.filter(
      (m) => m.type === "composioTool" || m.type === "composioApp",
    ) as Extract<ChatMention, { type: "composioTool" | "composioApp" }>[];

    if (composioMentions?.length) {
      const appNames = [
        ...new Set(
          composioMentions.map((m) =>
            m.type === "composioApp" ? m.name : m.appName,
          ),
        ),
      ];
      return client.getVercelAITools(appNames);
    }

    if (opt?.allowedApps?.length) {
      return client.getVercelAITools(opt.allowedApps);
    }

    // Don't load ALL Composio tools by default - only when explicitly mentioned or allowed
    // Loading all tools causes the agent orchestrator to activate even for simple workflow executions
    return {};
  })
    .map((v) => v)
    .orElse({});
};

export const convertToSavePart = <T extends UIMessagePart<any, any>>(
  part: T,
) => {
  return safe(
    exclude(part as any, ["providerMetadata", "callProviderMetadata"]) as T,
  )
    .map((v) => {
      // Ensure tool parts have valid input (must be object/dictionary, not string)
      if (isToolUIPart(v)) {
        // Fix: Ensure input is always an object, not a string or other type
        if (v.input && typeof v.input !== "object") {
          try {
            // Try to parse if it's a JSON string
            v.input = typeof v.input === "string" ? JSON.parse(v.input) : {};
          } catch {
            // If parsing fails, wrap in object
            v.input = { value: v.input };
          }
        }
        // Ensure input is at least an empty object if undefined/null
        if (!v.input || typeof v.input !== "object" || Array.isArray(v.input)) {
          v.input = {};
        }

        // Fix: Truncate tool name if too long (max 200 chars for validation)
        // Tool name is stored in type field as "tool-{toolName}" in AI SDK v5
        if (
          v.type &&
          typeof v.type === "string" &&
          v.type.startsWith("tool-")
        ) {
          const toolName = v.type.substring(5); // Remove "tool-" prefix
          if (toolName.length > 200) {
            // Truncate tool name and rebuild type field
            const truncatedName = toolName.substring(0, 197) + "...";
            v.type = `tool-${truncatedName}`;
          }
        }

        // Also check for any name field that might exist
        const toolName = getToolName(v);
        if (toolName && toolName.length > 200) {
          const truncatedName = toolName.substring(0, 197) + "...";
          // Update type field if it contains the tool name
          if (v.type && v.type.startsWith("tool-")) {
            v.type = `tool-${truncatedName}`;
          }
          // Update any name field
          if ((v as any).toolName) {
            (v as any).toolName = truncatedName;
          }
          if ((v as any).name) {
            (v as any).name = truncatedName;
          }
        }
      }

      // Handle tool-call parts that might have long names (legacy format)
      if ((v as any).type === "tool-call" || (v as any).type === "tool_use") {
        const toolName = (v as any).toolName || (v as any).name;
        if (toolName && typeof toolName === "string" && toolName.length > 200) {
          const truncatedName = toolName.substring(0, 197) + "...";
          (v as any).toolName = truncatedName;
          if ((v as any).name) {
            (v as any).name = truncatedName;
          }
        }
      }

      if (isToolUIPart(v) && v.state.startsWith("output")) {
        if (VercelAIWorkflowToolStreamingResultTag.isMaybe(v.output)) {
          return {
            ...v,
            output: {
              ...v.output,
              history: v.output.history.map((h: any) => {
                return {
                  ...h,
                  result: undefined,
                };
              }),
            },
          };
        }
      }
      return v;
    })
    .unwrap();
};

/**
 * Rough token estimation (4 chars ≈ 1 token)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Maximum characters for a single tool output to prevent massive context
 * 10k chars ≈ 2.5k tokens per tool result - prevents Gmail/API floods
 */
const MAX_TOOL_OUTPUT_CHARS = 10000;

/**
 * Default maximum context tokens before truncation kicks in
 * Using a conservative default that works for most providers
 */
const DEFAULT_MAX_CONTEXT_TOKENS = 100000;

/**
 * Provider-specific context limits (in tokens)
 * Some providers have smaller context windows than others
 */
const PROVIDER_CONTEXT_LIMITS: Record<string, number> = {
  cerebras: 120000, // Cerebras models have 131k limit, use 120k for safety margin
  groq: 120000, // Groq has varying limits, use conservative default
  ollama: 32000, // Local models often have smaller context
  openRouter: 100000, // Varies by model
  openai: 128000, // GPT-4.1 has 128k
  anthropic: 180000, // Claude has 200k, leave room for response
  google: 900000, // Gemini has 1M+ but use conservative limit
  xai: 120000, // Grok has 128k-256k
};

/**
 * Get the max context tokens for a given provider
 */
function getMaxContextTokens(provider?: string): number {
  if (!provider) return DEFAULT_MAX_CONTEXT_TOKENS;
  return PROVIDER_CONTEXT_LIMITS[provider] ?? DEFAULT_MAX_CONTEXT_TOKENS;
}

/**
 * Truncate a string to fit within a character limit, adding an indicator
 */
function truncateOutput(output: any, maxChars: number): any {
  if (output === null || output === undefined) return output;

  // Convert to string for length check
  const asString = typeof output === "string" ? output : JSON.stringify(output);

  if (asString.length <= maxChars) {
    return output;
  }

  // If it's a string, truncate directly
  if (typeof output === "string") {
    return (
      asString.slice(0, maxChars) +
      `\n\n[... truncated ${asString.length - maxChars} characters to fit context limit]`
    );
  }

  // If it's an object/array, try to truncate intelligently
  if (Array.isArray(output)) {
    // For arrays, keep first items that fit
    let accumulated = "[\n";
    const items: any[] = [];
    for (const item of output) {
      const itemStr = JSON.stringify(item);
      if (accumulated.length + itemStr.length + 10 > maxChars) {
        items.push({
          _truncated: `... ${output.length - items.length} more items truncated`,
        });
        break;
      }
      items.push(item);
      accumulated += itemStr + ",\n";
    }
    return items;
  }

  // For objects, stringify and truncate
  return {
    _truncated: true,
    _originalLength: asString.length,
    preview: asString.slice(0, maxChars),
    message: `Output truncated from ${asString.length} to ${maxChars} characters`,
  };
}

/**
 * Truncate tool outputs in message parts to prevent context overflow
 */
export function truncateMessageToolOutputs(parts: any[]): any[] {
  return parts.map((part) => {
    if (part.type === "tool-invocation" && part.output) {
      const outputStr =
        typeof part.output === "string"
          ? part.output
          : JSON.stringify(part.output);

      if (outputStr.length > MAX_TOOL_OUTPUT_CHARS) {
        logger.warn(
          `[Context] Truncating tool output for ${part.toolName}: ${outputStr.length} -> ${MAX_TOOL_OUTPUT_CHARS} chars`,
        );
        return {
          ...part,
          output: truncateOutput(part.output, MAX_TOOL_OUTPUT_CHARS),
        };
      }
    }
    return part;
  });
}

/**
 * Truncate conversation history to fit within token limits
 * Keeps the most recent messages and truncates tool outputs
 * @param messages - The conversation messages to truncate
 * @param provider - Optional provider name to use provider-specific limits
 * @param maxTokens - Optional override for max tokens (defaults to provider limit)
 */
export function truncateConversationHistory(
  messages: UIMessage[],
  provider?: string,
  maxTokens?: number,
): UIMessage[] {
  // Use provided maxTokens, or get provider-specific limit
  const effectiveMaxTokens = maxTokens ?? getMaxContextTokens(provider);
  // First, truncate all tool outputs
  const truncatedMessages = messages.map((msg) => ({
    ...msg,
    parts: truncateMessageToolOutputs(msg.parts),
  }));

  // Estimate total tokens
  let totalTokens = 0;
  const messageTokens: number[] = [];

  for (const msg of truncatedMessages) {
    const msgStr = JSON.stringify(msg.parts);
    const tokens = estimateTokens(msgStr);
    messageTokens.push(tokens);
    totalTokens += tokens;
  }

  // If within limit, return as-is
  if (totalTokens <= effectiveMaxTokens) {
    return truncatedMessages;
  }

  logger.warn(
    `[Context] Total tokens ${totalTokens} exceeds limit ${effectiveMaxTokens} (provider: ${provider ?? "default"}), truncating history`,
  );

  // Keep removing oldest messages (except the first user message for context)
  // until we're under the limit
  const result = [...truncatedMessages];
  let currentTokens = totalTokens;
  let removedCount = 0;

  // Always keep at least the last 5 messages
  while (currentTokens > effectiveMaxTokens && result.length > 5) {
    // Remove the second message (keep first for initial context)
    result.splice(1, 1);
    const removedTokens = messageTokens[1 + removedCount];
    currentTokens -= removedTokens;
    removedCount++;
  }

  if (removedCount > 0) {
    logger.warn(
      `[Context] Removed ${removedCount} messages, now at ~${currentTokens} tokens`,
    );

    // Add a system note about truncation
    if (result.length > 1) {
      result.splice(1, 0, {
        id: "context-truncation-notice",
        role: "assistant" as const,
        parts: [
          {
            type: "text" as const,
            text: `[Note: ${removedCount} earlier messages were removed to fit context limit]`,
          },
        ],
      } as UIMessage);
    }
  }

  return result;
}

/**
 * Build RAG context from semantic search results
 * Retrieves relevant previous messages to enhance LLM responses
 */
export async function buildRAGContext(
  userMessageText: string,
  userId: string,
  threadId?: string,
  options: {
    limit?: number;
    scoreThreshold?: number;
    maxContextChars?: number;
  } = {},
): Promise<string> {
  const { limit = 5, scoreThreshold = 0.7, maxContextChars = 3000 } = options;

  // Skip if message is too short or Qdrant not configured
  // API key is optional (only needed for cloud, not local Qdrant)
  if (userMessageText.length < 15 || !process.env.QDRANT_URL) {
    return "";
  }

  try {
    // Dynamic import to avoid issues when Qdrant is not configured
    const { semanticSearch } = await import(
      "lib/vector-search/vector-search-service"
    );

    const start = performance.now();

    // Search for relevant previous messages
    const relevantMessages = await semanticSearch(userMessageText, "messages", {
      limit,
      scoreThreshold,
      filters: {
        userId,
        // Include threadId filter to prioritize current thread context
        // but also search across threads for broader knowledge
        ...(threadId ? { threadId } : {}),
      },
    });

    const elapsed = Math.round(performance.now() - start);

    if (relevantMessages.length === 0) {
      logger.debug(`[RAG] No relevant context found (${elapsed}ms)`);
      return "";
    }

    // Build context string with truncation to stay within limits
    let totalChars = 0;
    const contextMessages: string[] = [];

    for (const result of relevantMessages) {
      const content = String(result.payload.content || "").trim();
      const role = String(result.payload.role || "user");
      const score = result.score.toFixed(2);

      // Skip empty or very short content
      if (content.length < 20) continue;

      // Truncate individual messages if needed
      const truncatedContent =
        content.length > 500 ? content.slice(0, 500) + "..." : content;

      const entry = `[${role}] (relevance: ${score}): ${truncatedContent}`;

      if (totalChars + entry.length > maxContextChars) {
        break;
      }

      contextMessages.push(entry);
      totalChars += entry.length;
    }

    if (contextMessages.length === 0) {
      return "";
    }

    logger.info(
      `[RAG] Retrieved ${contextMessages.length} relevant messages (${elapsed}ms, ${totalChars} chars)`,
    );

    return `\n\n## Relevant Context from Previous Conversations\n\nThe following messages from previous conversations may be relevant to the current request. Use this context to provide more accurate and personalized responses:\n\n${contextMessages.join("\n\n")}\n\n---\n`;
  } catch (error) {
    logger.warn("[RAG] Context retrieval failed:", error);
    return "";
  }
}
