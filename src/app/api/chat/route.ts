import {
  Tool,
  UIMessage,
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  getToolName,
  smoothStream,
  stepCountIs,
  streamText,
} from "ai";

import { customModelProvider, isToolCallUnsupportedModel } from "lib/ai/models";

import { mcpClientsManager } from "lib/ai/mcp/mcp-manager";

import {
  ChatMention,
  ChatMetadata,
  chatApiSchemaRequestBodySchema,
} from "app-types/chat";
import {
  buildMcpServerCustomizationsSystemPrompt,
  buildToolCallUnsupportedModelSystemPrompt,
  buildUserSystemPrompt,
} from "lib/ai/prompts";
import { validateSession } from "lib/api/auth-helpers";
import {
  createLimitExceededResponse,
  validateImageLimit,
} from "lib/api/limit-helpers";
import {
  SERVICE_CREDIT_COSTS,
  getImageCredits,
  trackImageGeneration,
  trackLLMUsage,
  trackMcpToolCall,
  trackWebSearch,
} from "lib/billing";
import { checkTokenLimit } from "lib/billing";
import { getModelMultiplier } from "lib/billing/model-multipliers";
import {
  agentRepository,
  agentStateRepository,
  chatRepository,
  subscriptionRepository,
} from "lib/db/repository";
import globalLogger from "logger";

import { errorIf, safe } from "ts-safe";

import { buildCsvIngestionPreviewParts } from "@/lib/ai/ingest/csv-ingest";
import type { AgentStateUpdate } from "app-types/agent-state";
import { getSession } from "auth/server";
import { colorize } from "consola/utils";
import {
  SIMPLIFIED_ORCHESTRATOR_INSTRUCTIONS,
  createStreamingAutonomousAgent,
} from "lib/ai/agents";
import {
  estimateTokens,
  formatTokens,
  maybeCompactMessages,
} from "lib/ai/context";
import { ImageToolName } from "lib/ai/tools";
import { nanoBananaTool, openaiImageTool } from "lib/ai/tools/image";
import { serverFileStorage } from "lib/file-storage";
import { generateUUID } from "lib/utils";
import {
  rememberAgentAction,
  rememberMcpServerCustomizationsAction,
} from "./actions";
import {
  buildRAGContext,
  convertToSavePart,
  excludeToolExecutionExceptPlanning,
  extractInProgressToolPart,
  filterMcpServerCustomizations,
  handleError,
  loadAppDefaultTools,
  loadComposioTools,
  loadMcpTools,
  loadWorkFlowTools,
  manualToolExecuteByLastMessage,
  mergeSystemPrompt,
  truncateConversationHistory,
  truncateMessageToolOutputs,
} from "./shared.chat";

const logger = globalLogger.withDefaults({
  message: colorize("blackBright", `Chat API: `),
});

export async function POST(request: Request) {
  try {
    const json = await request.json();

    const auth = await validateSession();
    if (!auth.success) return auth.response;

    // Get full session for user object (needed for system prompt)
    const session = await getSession();

    const {
      id,
      message,
      chatModel,
      toolChoice,
      allowedAppDefaultToolkit,
      allowedMcpServers,
      imageTool,
      mentions = [],
      attachments = [],
    } = chatApiSchemaRequestBodySchema.parse(json);

    // Debug: Log incoming request parameters
    logger.info(
      `[Request] id: ${id}, toolChoice: ${toolChoice}, chatModel: ${chatModel?.provider}/${chatModel?.model}, mentions: ${mentions.length}, imageTool: ${imageTool?.model ?? "none"}`,
    );

    // Check billing limits before processing - pass model for multiplier calculation
    // Estimate minimum tokens for a typical request (input + expected output)
    // This prevents edge cases where user is exactly at limit from passing pre-check
    const estimatedMinTokens = 1000; // Reasonable minimum for a chat request
    const tokenLimitCheck = await checkTokenLimit(
      auth.userId,
      estimatedMinTokens,
      chatModel?.model,
      chatModel?.provider,
    );
    if (!tokenLimitCheck.allowed) {
      logger.warn(
        `[Billing] Token limit exceeded for user ${auth.userId}: ${tokenLimitCheck.usage}/${tokenLimitCheck.limit} (${tokenLimitCheck.multiplier}x multiplier)`,
      );
      return createLimitExceededResponse(tokenLimitCheck);
    }

    const model = customModelProvider.getModel(chatModel);

    let thread = await chatRepository.selectThreadDetails(id);

    if (!thread) {
      logger.info(`create chat thread: ${id}`);
      const newThread = await chatRepository.insertThread({
        id,
        title: "",
        userId: auth.userId,
      });
      thread = await chatRepository.selectThreadDetails(newThread.id);
    }

    if (thread!.userId !== auth.userId) {
      return new Response("Forbidden", { status: 403 });
    }

    // Load messages and immediately truncate large tool outputs to prevent token overflow
    // Also clean orphaned reasoning references to prevent stream errors
    const messages: UIMessage[] = (thread?.messages ?? []).map((m) => {
      const msg = {
        id: m.id,
        role: m.role,
        // Truncate tool outputs immediately on load to prevent context overflow
        parts: truncateMessageToolOutputs(m.parts),
        metadata: m.metadata,
      } as any;

      // CRITICAL: Clean up orphaned reasoning references to prevent ERR_INCOMPLETE_CHUNKED_ENCODING
      // Messages from database may have reasoningId references pointing to missing reasoning items
      // This causes errors when convertToModelMessages tries to resolve them
      if (msg.parts && Array.isArray(msg.parts)) {
        // Collect all valid reasoning IDs from parts
        const validReasoningIds = new Set<string>();
        msg.parts.forEach((p: any) => {
          if (p.type === "reasoning" && p.reasoningId) {
            validReasoningIds.add(p.reasoningId);
          }
        });

        // Remove reasoningId from message if it doesn't have a corresponding reasoning part
        if (msg.reasoningId && typeof msg.reasoningId === "string") {
          if (!validReasoningIds.has(msg.reasoningId)) {
            const { reasoningId, ...rest } = msg;
            return rest;
          }
        }

        // Clean up parts that reference non-existent reasoning items
        // This includes function_call, tool-call, and any other part types with reasoningId
        const cleanedParts = msg.parts.filter((p: any) => {
          // For reasoning parts, keep them if they have a valid reasoningId
          if (p.type === "reasoning") {
            return p.reasoningId && validReasoningIds.has(p.reasoningId);
          }

          // For all other parts (including function_call, tool-call, etc.),
          // check if they reference a reasoning ID that doesn't exist
          if (p.reasoningId && typeof p.reasoningId === "string") {
            // Only keep if the referenced reasoning exists
            return validReasoningIds.has(p.reasoningId);
          }

          // Keep parts without reasoningId references
          return true;
        });

        if (cleanedParts.length !== msg.parts.length) {
          msg.parts = cleanedParts;
        }
      }

      return msg;
    });

    // Log if we have large context
    const estimatedChars = JSON.stringify(messages).length;
    if (estimatedChars > 100000) {
      logger.warn(
        `[Context] Large conversation loaded: ~${Math.round(estimatedChars / 1000)}k chars (~${Math.round(estimatedChars / 4000)}k tokens) from ${messages.length} messages`,
      );
    }

    if (messages.at(-1)?.id == message.id) {
      messages.pop();
    }
    const ingestionPreviewParts = await buildCsvIngestionPreviewParts(
      attachments,
      (key) => serverFileStorage.download(key),
    );
    if (ingestionPreviewParts.length) {
      const baseParts = [...message.parts];
      let insertionIndex = -1;
      for (let i = baseParts.length - 1; i >= 0; i -= 1) {
        if (baseParts[i]?.type === "text") {
          insertionIndex = i;
          break;
        }
      }
      if (insertionIndex !== -1) {
        baseParts.splice(insertionIndex, 0, ...ingestionPreviewParts);
        message.parts = baseParts;
      } else {
        message.parts = [...baseParts, ...ingestionPreviewParts];
      }
    }

    if (attachments.length) {
      const firstTextIndex = message.parts.findIndex(
        (part: any) => part?.type === "text",
      );
      const attachmentParts: any[] = [];

      attachments.forEach((attachment) => {
        const exists = message.parts.some(
          (part: any) =>
            part?.type === attachment.type && part?.url === attachment.url,
        );
        if (exists) return;

        if (attachment.type === "file") {
          attachmentParts.push({
            type: "file",
            url: attachment.url,
            mediaType: attachment.mediaType,
            filename: attachment.filename,
          });
        } else if (attachment.type === "source-url") {
          attachmentParts.push({
            type: "source-url",
            url: attachment.url,
            mediaType: attachment.mediaType,
            title: attachment.filename,
          });
        }
      });

      if (attachmentParts.length) {
        if (firstTextIndex >= 0) {
          message.parts = [
            ...message.parts.slice(0, firstTextIndex),
            ...attachmentParts,
            ...message.parts.slice(firstTextIndex),
          ];
        } else {
          message.parts = [...message.parts, ...attachmentParts];
        }
      }
    }

    messages.push(message);

    const supportToolCall = !isToolCallUnsupportedModel(model);

    // Debug: Log tool support for model
    logger.info(
      `[Model Tools] Provider: ${chatModel?.provider}, Model: ${chatModel?.model}, supportToolCall: ${supportToolCall}`,
    );

    const agentId = (
      mentions.find((m) => m.type === "agent") as Extract<
        ChatMention,
        { type: "agent" }
      >
    )?.agentId;

    const agent = await rememberAgentAction(agentId, auth.userId);

    if (agent?.instructions?.mentions) {
      mentions.push(...agent.instructions.mentions);
    }

    const useImageTool = Boolean(imageTool?.model);

    // Check image limit if using image tool - pass model for credit calculation
    if (useImageTool) {
      const imageLimitError = await validateImageLimit(
        auth.userId,
        imageTool?.model,
      );
      if (imageLimitError) {
        logger.warn(
          `[Billing] Image limit exceeded for user ${auth.userId}: ${imageLimitError.usage}/${imageLimitError.limit}`,
        );
        return createLimitExceededResponse(imageLimitError);
      }
    }

    // ALWAYS allow tool calls if model supports it (unless explicitly disabled or using image tool)
    // This ensures agents can use tools autonomously
    const isToolCallAllowed =
      supportToolCall &&
      toolChoice != "none" && // Only block if explicitly set to "none"
      !useImageTool;

    // Debug: Log the conditions affecting agent behavior
    logger.info(
      `[Tool Conditions] supportToolCall: ${supportToolCall}, toolChoice: ${toolChoice}, mentions: ${mentions.length}, useImageTool: ${useImageTool} => isToolCallAllowed: ${isToolCallAllowed}`,
    );

    const metadata: ChatMetadata = {
      agentId: agent?.id,
      toolChoice: toolChoice,
      toolCount: 0,
      chatModel: chatModel,
    };

    // Track agent state ID for persistence across execute/onFinish callbacks
    let agentStateIdRef: string | undefined;

    const stream = createUIMessageStream({
      execute: async ({ writer: dataStream }) => {
        const mcpClients = await mcpClientsManager.getClients();
        const mcpTools = await mcpClientsManager.tools();
        logger.info(
          `mcp-server count: ${mcpClients.length}, mcp-tools count :${Object.keys(mcpTools).length}`,
        );
        const MCP_TOOLS = await safe()
          .map(errorIf(() => !isToolCallAllowed && "Not allowed"))
          .map(() =>
            loadMcpTools({
              mentions,
              allowedMcpServers,
            }),
          )
          .orElse({});

        const WORKFLOW_TOOLS = await safe()
          .map(errorIf(() => !isToolCallAllowed && "Not allowed"))
          .map(() =>
            loadWorkFlowTools({
              mentions,
              dataStream,
              userId: auth.userId, // Pass userId for Composio tool execution within workflows
            }),
          )
          .orElse({});

        // Validate thread context for sandbox file persistence
        if (thread?.id) {
          logger.info(
            `[Context] Thread context available: threadId=${thread.id}, userId=${auth.userId}`,
          );
        } else {
          logger.error(
            "[Context] CRITICAL: Thread ID is missing! Sandbox will be STATELESS - files will NOT persist between steps!",
          );
        }

        const APP_DEFAULT_TOOLS = await safe()
          .map(errorIf(() => !isToolCallAllowed && "Not allowed"))
          .map(() =>
            loadAppDefaultTools({
              mentions,
              allowedAppDefaultToolkit,
              // Pass thread context for file persistence in code execution tools
              // IMPORTANT: Include dataStream for fragment progress streaming
              codeExecutionContext: {
                threadId: thread?.id,
                userId: auth.userId,
                chatModel,
                dataStream, // Critical for fragment tool streaming
              },
            }),
          )
          .orElse({});

        const COMPOSIO_TOOLS = await safe()
          .map(errorIf(() => !isToolCallAllowed && "Not allowed"))
          .map(() =>
            loadComposioTools({
              mentions,
              userId: auth.userId,
            }),
          )
          .orElse({});

        const inProgressToolParts = extractInProgressToolPart(message);
        if (inProgressToolParts.length) {
          await Promise.all(
            inProgressToolParts.map(async (part) => {
              const output = await manualToolExecuteByLastMessage(
                part,
                {
                  ...MCP_TOOLS,
                  ...WORKFLOW_TOOLS,
                  ...APP_DEFAULT_TOOLS,
                  ...COMPOSIO_TOOLS,
                },
                request.signal,
              );
              part.output = output;

              dataStream.write({
                type: "tool-output-available",
                toolCallId: part.toolCallId,
                output,
              });
            }),
          );
        }

        const userPreferences = thread?.userPreferences || undefined;

        const mcpServerCustomizations = await safe()
          .map(() => {
            if (Object.keys(MCP_TOOLS ?? {}).length === 0)
              throw new Error("No tools found");
            return rememberMcpServerCustomizationsAction(auth.userId);
          })
          .map((v) => filterMcpServerCustomizations(MCP_TOOLS!, v))
          .orElse({});

        const systemPrompt = mergeSystemPrompt(
          buildUserSystemPrompt(session?.user, userPreferences, agent),
          buildMcpServerCustomizationsSystemPrompt(mcpServerCustomizations),
          !supportToolCall && buildToolCallUnsupportedModelSystemPrompt,
        );

        const IMAGE_TOOL: Record<string, Tool> = useImageTool
          ? {
              [ImageToolName]:
                imageTool?.model === "google"
                  ? nanoBananaTool
                  : openaiImageTool,
            }
          : {};
        // Create agent tools for autonomous orchestration with task tracking
        // State persistence enables true autonomous agent behavior across requests
        let orchestratorSystemPrompt: string | undefined;
        let agentStateId: string | undefined;

        // Check if ONLY workflow tools are mentioned (no MCP, no Composio, no app default tools)
        // In this case, skip the autonomous agent orchestrator - workflows execute directly
        const hasOnlyWorkflowMentions =
          mentions.length > 0 &&
          mentions.every((m) => m.type === "workflow") &&
          Object.keys(MCP_TOOLS ?? {}).length === 0 &&
          Object.keys(COMPOSIO_TOOLS ?? {}).length === 0;

        // Build agent configuration with tools and ToolLoopAgent
        const agentSetup = await (async () => {
          logger.debug(
            `[Agent] Building config, isToolCallAllowed=${isToolCallAllowed}, hasOnlyWorkflowMentions=${hasOnlyWorkflowMentions}`,
          );

          if (!isToolCallAllowed) {
            logger.debug(
              "[Agent] Tool calls not allowed - returning empty config",
            );
            return { tools: {}, agentConfig: null };
          }

          // Skip orchestrator when only workflow tools are mentioned
          // Workflows execute directly via workflowToVercelAITool, no planning needed
          if (hasOnlyWorkflowMentions) {
            logger.info(
              "[Agent] Skipping orchestrator - only workflow mentions detected, workflows execute directly",
            );
            return { tools: {}, agentConfig: null };
          }

          logger.debug("[Agent] Creating autonomous agent...");

          // Check for existing agent state for this thread (enables resume)
          const existingState = thread?.id
            ? await agentStateRepository.getByThreadId(thread.id)
            : null;

          // Create persistence callback to save state after each step with retry logic
          const onPersistState = async (update: AgentStateUpdate) => {
            if (!agentStateId) {
              logger.warn(
                "[Agent State] No state ID available - skipping persistence",
              );
              return;
            }

            // Retry with exponential backoff (3 attempts)
            const maxRetries = 3;
            for (let attempt = 0; attempt < maxRetries; attempt++) {
              try {
                await agentStateRepository.update(agentStateId, update);
                logger.info(
                  `[Agent State] Persisted: status=${update.status}, steps=${update.stepsExecuted}`,
                );
                return; // Success - exit retry loop
              } catch (err) {
                const isLastAttempt = attempt === maxRetries - 1;
                if (isLastAttempt) {
                  logger.error(
                    `[Agent State] Failed to persist after ${maxRetries} attempts:`,
                    err,
                  );
                } else {
                  const delayMs = Math.pow(2, attempt) * 100; // 100ms, 200ms, 400ms
                  logger.warn(
                    `[Agent State] Persist attempt ${attempt + 1} failed, retrying in ${delayMs}ms...`,
                  );
                  await new Promise((resolve) => setTimeout(resolve, delayMs));
                }
              }
            }
          };

          // Use the v6 autonomous agent with state persistence
          const agentConfig = createStreamingAutonomousAgent({
            userId: auth.userId,
            threadId: thread?.id,
            chatModel,
            availableTools: {
              ...APP_DEFAULT_TOOLS,
              ...COMPOSIO_TOOLS,
            },
            mcpTools: MCP_TOOLS ?? {},
            userAgent: agent,
            maxSteps: 50,
            // Restore existing state if resuming
            persistedState: existingState,
            // State persistence callback
            onPersistState,
            // Pass dataStream for sub-agent streaming events
            dataStream,
          });

          // Store the agent state ID for tracking and resume
          agentStateId = agentConfig.agentStateId;
          agentStateIdRef = agentStateId; // Store in outer scope for onFinish access

          // Initialize agent state in database if this is a new agent
          if (!existingState && agentStateId && thread?.id) {
            try {
              await agentStateRepository.create({
                userId: auth.userId,
                threadId: thread.id,
                status: "planning",
                maxSteps: 50,
              });
              logger.info(
                `[Agent State] Initialized new state: ${agentStateId}`,
              );
            } catch (err) {
              logger.error("[Agent State] Failed to initialize:", err);
            }
          }

          logger.debug(
            `[Agent] Created successfully, agent exists: ${!!agentConfig.agent}`,
          );

          // Extract tools AND system prompt for autonomous agent behavior
          const { tools, system } = agentConfig;
          orchestratorSystemPrompt = system;

          // Debug logging for agent tools
          const agentToolNames = Object.keys(tools);
          logger.info(
            `[Agent Tools] Loaded ${agentToolNames.length} tools: ${agentToolNames.join(", ")}`,
          );
          logger.debug(
            `[Agent Tools] Has orchestrator prompt: ${!!system}, prompt length: ${system?.length ?? 0}`,
          );

          return { tools, agentConfig };
        })();

        logger.debug("[Agent] Setup complete");

        // Extract the tools and agent config
        const AGENT_TOOLS = agentSetup.tools;
        const autonomousAgentConfig = agentSetup.agentConfig;

        logger.info(
          `[Agent Setup] isToolCallAllowed: ${isToolCallAllowed}, agentConfig: ${autonomousAgentConfig ? "YES" : "NULL"}, agent: ${autonomousAgentConfig?.agent ? "YES" : "NULL"}, stateId: ${autonomousAgentConfig?.agentStateId ?? "NONE"}`,
        );

        const vercelAITooles = safe({
          ...MCP_TOOLS,
          ...WORKFLOW_TOOLS,
          ...COMPOSIO_TOOLS,
          ...AGENT_TOOLS,
        })
          .map((t) => {
            const bindingTools =
              toolChoice === "manual" ||
              (message.metadata as ChatMetadata)?.toolChoice === "manual"
                ? excludeToolExecutionExceptPlanning(t) // Planning tools auto-execute even in manual mode
                : t;
            return {
              ...bindingTools,
              ...APP_DEFAULT_TOOLS, // APP_DEFAULT_TOOLS Not Supported Manual
              ...IMAGE_TOOL,
            };
          })
          .unwrap();
        metadata.toolCount = Object.keys(vercelAITooles).length;

        const allowedMcpTools = Object.values(allowedMcpServers ?? {})
          .map((t) => t.tools)
          .flat();

        logger.info(
          `${agent ? `agent: ${agent.name}, ` : ""}tool mode: ${toolChoice}, mentions: ${mentions.length}`,
        );

        logger.info(
          `allowedMcpTools: ${allowedMcpTools.length ?? 0}, allowedAppDefaultToolkit: ${allowedAppDefaultToolkit?.length ?? 0}`,
        );
        if (useImageTool) {
          logger.info(`binding tool count Image: ${imageTool?.model}`);
        } else {
          logger.info(
            `binding tool count APP_DEFAULT: ${Object.keys(APP_DEFAULT_TOOLS ?? {}).length}, MCP: ${Object.keys(MCP_TOOLS ?? {}).length}, Workflow: ${Object.keys(WORKFLOW_TOOLS ?? {}).length}`,
          );
        }
        logger.info(`model: ${chatModel?.provider}/${chatModel?.model}`);

        // === RAG CONTEXT RETRIEVAL ===
        // Retrieve relevant context from previous conversations to enhance responses
        // SKIP for follow-up messages in existing conversations to avoid context bloat
        const userMessageText = message.parts
          .filter((p: any) => p.type === "text")
          .map((p: any) => p.text)
          .join(" ")
          .trim();

        // Auto-invoke rememberContext tool to make it visible in UI
        let ragContext = "";

        // Log the conditions for debugging
        logger.info(`[RememberContext] Conditions check:`, {
          messageLength: userMessageText.length,
          hasQdrantUrl: !!process.env.QDRANT_URL,
          hasTool: !!vercelAITooles.rememberContext,
          willExecute:
            userMessageText.length >= 3 &&
            process.env.QDRANT_URL &&
            vercelAITooles.rememberContext,
        });

        if (
          userMessageText.length >= 3 &&
          process.env.QDRANT_URL &&
          vercelAITooles.rememberContext
        ) {
          try {
            // Create a wrapper tool that includes userId in the execution context
            console.log(
              `[RememberContext] Starting search:`,
              JSON.stringify({
                query: userMessageText,
                userId: auth.userId,
                threadId: thread?.id,
              }),
            );
            logger.info(`[RememberContext] Executing search for:`, {
              query: userMessageText,
              userId: auth.userId,
              threadId: thread?.id,
            });

            // Execute tool directly and create UI structure safely
            const toolInput = {
              query: userMessageText,
              limit: 5,
              scoreThreshold: 0.1, // Lower threshold for better recall in semantic search
              userId: auth.userId,
              ...(thread?.id ? { threadId: thread.id } : {}),
            };

            let rememberResult: any = null;

            try {
              // Execute tool first - MUST complete before proceeding
              const rememberContextTool = vercelAITooles.rememberContext;
              if (!rememberContextTool?.execute) {
                throw new Error("rememberContext tool not available");
              }
              const toolResult = await rememberContextTool.execute(
                toolInput as any,
                {
                  abortSignal: request.signal,
                  messages: [],
                  toolCallId: "remember-context-auto",
                },
              );
              rememberResult = toolResult;

              // Create UI structure with streamText - MUST complete before proceeding
              // This ensures the memory search is visible in UI before main response starts
              try {
                const rememberStream = streamText({
                  model: customModelProvider.getModel({
                    provider: "openai",
                    model: "gpt-4o-mini",
                  }),
                  system: `You must call the rememberContext tool.`,
                  messages: [
                    {
                      role: "user",
                      content: `Call rememberContext with query: "${userMessageText}"`,
                    },
                  ],
                  tools: {
                    rememberContext: {
                      ...vercelAITooles.rememberContext,
                      execute: async () => toolResult, // Return pre-executed result
                    },
                  },
                  toolChoice: {
                    type: "tool",
                    toolName: "rememberContext",
                  },
                });

                // CRITICAL: Wait for stream to complete before merging
                // This ensures memory search finishes before main response starts
                // Await the text to ensure the stream fully processes
                await rememberStream.text;

                // Now merge the completed stream
                const toolCallStream = rememberStream.toUIMessageStream({
                  messageMetadata: () => undefined,
                });
                dataStream.merge(toolCallStream);
              } catch (streamError) {
                // If streamText fails, that's ok - we still have the result for RAG
                logger.warn(
                  "[RememberContext] StreamText failed, using result for RAG only:",
                  streamError,
                );
              }
            } catch (error) {
              logger.error("[RememberContext] Tool execution failed:", error);
              // Continue without RAG context if tool fails
            }

            console.log(
              `[RememberContext] Tool result:`,
              JSON.stringify(
                {
                  hasResult: !!rememberResult,
                  resultType: typeof rememberResult,
                  resultKeys: rememberResult ? Object.keys(rememberResult) : [],
                  resultCount: rememberResult?.results?.length || 0,
                  isError: rememberResult?.isError,
                  error: rememberResult?.error,
                  firstResult: rememberResult?.results?.[0]
                    ? {
                        score: rememberResult.results[0].score,
                        content: String(
                          rememberResult.results[0].content || "",
                        ).slice(0, 100),
                      }
                    : null,
                },
                null,
                2,
              ),
            );
            logger.info(`[RememberContext] Tool result:`, {
              hasResult: !!rememberResult,
              resultCount: rememberResult?.results?.length || 0,
              isError: rememberResult?.isError,
            });

            // Build RAG context from results - LIMITED to prevent context bloat
            if (
              rememberResult &&
              !rememberResult.isError &&
              rememberResult.results
            ) {
              const contextMessages: string[] = [];
              let totalChars = 0;
              const maxContextChars = 1500; // Reduced from 3000 to prevent bloating

              for (const result of rememberResult.results) {
                const content = String(result.content || "").trim();
                const role = String(result.role || "user");
                const score = result.score.toFixed(2);

                if (content.length < 20) continue;

                // Shorter truncation to save tokens
                const truncatedContent =
                  content.length > 300
                    ? content.slice(0, 300) + "..."
                    : content;

                const entry = `[${role}] (${score}): ${truncatedContent}`;

                if (totalChars + entry.length > maxContextChars) {
                  break;
                }

                contextMessages.push(entry);
                totalChars += entry.length;
              }

              if (contextMessages.length > 0) {
                // More concise RAG context format
                ragContext = `\n\n## Relevant Context\n\n${contextMessages.join("\n\n")}\n\n`;
              }
            }
          } catch (error) {
            logger.warn("[RememberContext] Auto-invoke failed:", error);
            // Fallback to silent RAG if tool invocation fails
            ragContext = await buildRAGContext(
              userMessageText,
              auth.userId,
              thread?.id,
              {
                limit: 5,
                scoreThreshold: 0.7,
                maxContextChars: 3000,
              },
            );
          }
        } else {
          // Fallback to silent RAG if tool not available or message too short
          ragContext = await buildRAGContext(
            userMessageText,
            auth.userId,
            thread?.id,
            {
              limit: 5,
              scoreThreshold: 0.7,
              maxContextChars: 3000,
            },
          );
        }

        // Use orchestrator system prompt for autonomous agent behavior, fall back to regular prompt
        // The orchestrator prompt includes task planning, tracking, and context sharing instructions
        // RAG context is appended to provide relevant historical context
        const baseSystemPrompt = orchestratorSystemPrompt
          ? `${orchestratorSystemPrompt}\n\n---\n\n## USER PREFERENCES & CONTEXT\n${systemPrompt}`
          : systemPrompt;

        const effectiveSystemPrompt = ragContext
          ? `${baseSystemPrompt}${ragContext}`
          : baseSystemPrompt;

        // Debug: Log whether agent mode is active
        logger.info(
          `[Agent Mode] Active: ${!!orchestratorSystemPrompt}, tools with createPlan: ${!!vercelAITooles.createPlan}, isToolCallAllowed: ${isToolCallAllowed}, hasOnlyWorkflowMentions: ${hasOnlyWorkflowMentions}`,
        );

        // Debug: Log all tools being passed
        const toolNames = Object.keys(vercelAITooles);
        const planningTools = toolNames.filter((t) =>
          [
            "createPlan",
            "updateTaskStatus",
            "getNextTask",
            "getPlanStatus",
          ].includes(t),
        );
        logger.info(
          `[Agent Config] Total tools: ${toolNames.length}, Planning tools: ${planningTools.length} (${planningTools.join(", ")})`,
        );
        logger.info(
          `[Agent Config] System prompt length: ${effectiveSystemPrompt?.length ?? 0}, Has orchestrator: ${effectiveSystemPrompt?.includes("autonomous AI orchestrator") ?? false}`,
        );

        // === CONTEXT COMPACTION ===
        // Check if conversation context needs compaction (auto-summarize older messages)
        // This enables endless conversations without token limit errors
        // NOTE: RAG context is excluded from compaction calculations as it's dynamically added
        const systemPromptTokens = estimateTokens(baseSystemPrompt || ""); // Use base prompt, not RAG-enhanced
        let processedMessages = messages;

        // Initialize context usage tracking
        let currentContextUsage: {
          usedTokens: number;
          limit: number;
          percentage: number;
          remaining: number;
          provider?: string;
          model?: string;
        };

        try {
          // Show compaction progress BEFORE compaction starts
          logger.info(
            `[Context] Checking compaction: ${messages.length} messages, ` +
              `system prompt: ${systemPromptTokens} tokens`,
          );

          const compactionResult = await maybeCompactMessages(
            messages,
            model,
            chatModel?.provider || "unknown",
            chatModel?.model || "unknown",
            systemPromptTokens,
            {
              threadId: thread?.id,
              userId: auth.userId, // Enable database persistence of summaries
              preserveCount: 8, // Keep last 8 messages intact
              persistSummary: true, // Store summaries for long-term memory
            },
          );

          if (compactionResult.compactionResult?.didCompact) {
            const compactedCount =
              compactionResult.compactionResult.compactedCount;
            const tokensSaved = compactionResult.compactionResult.tokensSaved;
            const oldUsage = compactionResult.usage.usedTokens + tokensSaved;

            // Emit compaction event to UI FIRST (before any response)
            // This ensures the compaction status is visible in chat
            dataStream.write({
              type: "data-context-compaction",
              data: {
                compactedCount,
                tokensSaved,
                oldUsage: {
                  usedTokens: oldUsage,
                  percentage: oldUsage / compactionResult.usage.limit,
                },
                newUsage: {
                  usedTokens: compactionResult.usage.usedTokens,
                  limit: compactionResult.usage.limit,
                  percentage: compactionResult.usage.percentage,
                  remaining: compactionResult.usage.remaining,
                },
              },
            });

            // Also emit a context usage update to ensure UI refreshes immediately
            dataStream.write({
              type: "data-context-usage-update",
              data: {
                usedTokens: compactionResult.usage.usedTokens,
                limit: compactionResult.usage.limit,
                percentage: compactionResult.usage.percentage,
                remaining: compactionResult.usage.remaining,
                provider: chatModel?.provider,
                model: chatModel?.model,
              },
            });

            logger.info(
              `[Context] Compacted ${compactedCount} messages, ` +
                `saved ~${formatTokens(tokensSaved)} tokens, ` +
                `usage: ${(compactionResult.usage.percentage * 100).toFixed(1)}% (was ${((oldUsage / compactionResult.usage.limit) * 100).toFixed(1)}%)`,
            );
          }

          processedMessages = compactionResult.messages;

          // Store initial context usage for real-time tracking with model info
          currentContextUsage = {
            usedTokens: compactionResult.usage.usedTokens,
            limit: compactionResult.usage.limit,
            percentage: compactionResult.usage.percentage,
            remaining: compactionResult.usage.remaining,
            provider: chatModel?.provider,
            model: chatModel?.model,
          };
        } catch (compactionError) {
          logger.warn(
            "[Context] Compaction failed, continuing with original messages:",
            compactionError,
          );
          // Calculate context usage without compaction (using dynamic limits)
          const { calculateContextUsageAsync } = await import("lib/ai/context");
          const usage = await calculateContextUsageAsync(
            processedMessages,
            chatModel?.provider || "unknown",
            chatModel?.model || "unknown",
            systemPromptTokens,
          );
          currentContextUsage = {
            usedTokens: usage.usedTokens,
            limit: usage.limit,
            percentage: usage.percentage,
            remaining: usage.remaining,
            provider: chatModel?.provider,
            model: chatModel?.model,
          };
        }

        // Store the BASE input tokens - this is FIXED for this request and won't change
        // This is the key fix: we track output tokens separately and always add to this base
        const baseInputTokens = currentContextUsage.usedTokens;
        const contextLimit = currentContextUsage.limit;

        // Track tool call tokens as they're progressively added
        let toolCallTokens = 0;

        // Emit initial context usage update to UI with model info
        logger.info(
          `[Context] Initial usage: ${baseInputTokens}/${contextLimit} tokens ` +
            `(${(currentContextUsage.percentage * 100).toFixed(1)}%) ` +
            `for model ${chatModel?.provider}/${chatModel?.model}`,
        );
        dataStream.write({
          type: "data-context-usage-update",
          data: currentContextUsage,
        });

        // Helper function to estimate tokens for a tool call part
        const estimateToolCallTokens = (part: any): number => {
          if (!part || !part.type) return 0;
          // Check if it's a tool-related part
          if (
            part.type.startsWith("tool-") ||
            part.type === "tool-call" ||
            part.type === "tool-result"
          ) {
            // Estimate tokens for tool call: name, args, and output
            let tokens = 0;
            if (part.toolCallId) tokens += estimateTokens(part.toolCallId);
            if (part.input)
              tokens += estimateTokens(JSON.stringify(part.input));
            if (part.output)
              tokens += estimateTokens(JSON.stringify(part.output));
            // Add overhead for tool call structure
            tokens += 20; // Overhead for tool call formatting
            return tokens;
          }
          return 0;
        };

        // Helper function to emit context usage updates
        // CRITICAL: Always calculate from baseInputTokens + toolCallTokens + totalOutputTokensSoFar
        // This prevents double-counting and includes progressively added tool calls
        const emitContextUsageUpdate = (totalOutputTokensSoFar: number = 0) => {
          // Calculate total used tokens: base + tool calls + output
          const newUsedTokens =
            baseInputTokens + toolCallTokens + totalOutputTokensSoFar;
          const newPercentage = Math.min(1, newUsedTokens / contextLimit);
          const newRemaining = Math.max(0, contextLimit - newUsedTokens);

          // Update current state (for final callbacks that need it)
          currentContextUsage = {
            usedTokens: newUsedTokens,
            limit: contextLimit,
            percentage: newPercentage,
            remaining: newRemaining,
            provider: currentContextUsage.provider,
            model: currentContextUsage.model,
          };

          // Emit update to frontend
          try {
            logger.info(
              `[Context] Emitting update: ${newUsedTokens}/${contextLimit} ` +
                `(${(newPercentage * 100).toFixed(1)}%) ` +
                `base=${baseInputTokens} + toolCalls=${toolCallTokens} + output=${totalOutputTokensSoFar}`,
            );
            dataStream.write({
              type: "data-context-usage-update",
              data: currentContextUsage,
            });
          } catch (error) {
            logger.warn("[Context] Failed to emit usage update:", error);
          }
        };

        // Helper function to track tool call tokens when they're added
        const trackToolCallTokens = (part: any) => {
          const tokens = estimateToolCallTokens(part);
          if (tokens > 0) {
            toolCallTokens += tokens;
            logger.info(
              `[Context] Tool call added: +${tokens} tokens (total tool calls: ${toolCallTokens})`,
            );
            // Emit update immediately when tool calls are added
            emitContextUsageUpdate(0);
          }
        };

        // Truncate conversation history to prevent token limit errors
        // This handles cases where tool outputs (like Gmail emails) are huge
        // Pass provider to use provider-specific context limits (e.g., Cerebras has 131k limit)
        const truncatedMessages = truncateConversationHistory(
          processedMessages,
          chatModel?.provider,
        );

        // CRITICAL: Clean orphaned reasoning references before conversion to prevent stream errors
        // This prevents ERR_INCOMPLETE_CHUNKED_ENCODING when convertToModelMessages processes messages
        const cleanedMessages = truncatedMessages.map((msg: any) => {
          if (msg.parts && Array.isArray(msg.parts)) {
            // Collect all valid reasoning IDs from parts
            const validReasoningIds = new Set<string>();
            msg.parts.forEach((p: any) => {
              if (p.type === "reasoning" && p.reasoningId) {
                validReasoningIds.add(p.reasoningId);
              }
            });

            // Remove reasoningId from message if it doesn't have a corresponding reasoning part
            let cleanedMsg = { ...msg };
            if (
              cleanedMsg.reasoningId &&
              typeof cleanedMsg.reasoningId === "string"
            ) {
              if (!validReasoningIds.has(cleanedMsg.reasoningId)) {
                const { reasoningId, ...rest } = cleanedMsg;
                cleanedMsg = rest;
              }
            }

            // Clean up parts that reference non-existent reasoning items
            const cleanedParts = cleanedMsg.parts.filter((p: any) => {
              if (p.type === "reasoning") {
                return p.reasoningId && validReasoningIds.has(p.reasoningId);
              }
              if (p.reasoningId && typeof p.reasoningId === "string") {
                return validReasoningIds.has(p.reasoningId);
              }
              return true;
            });

            if (cleanedParts.length !== cleanedMsg.parts.length) {
              cleanedMsg = { ...cleanedMsg, parts: cleanedParts };
            }

            return cleanedMsg;
          }
          return msg;
        });

        // Convert messages for model consumption
        const modelMessages = await convertToModelMessages(cleanedMessages);

        // Use ToolLoopAgent for autonomous agent execution when available
        // This provides proper step-by-step state persistence and plan completion detection
        // BUT: Don't use autonomous agent when toolChoice is "manual" - user wants to approve each tool
        const agentInstance = autonomousAgentConfig?.agent;
        const isManualMode =
          toolChoice === "manual" ||
          (message.metadata as ChatMetadata)?.toolChoice === "manual";

        // PROVIDER CAPABILITY DETECTION
        // These providers reliably follow complex orchestration prompts
        // and work well with ToolLoopAgent for autonomous agent behavior.
        //
        // All major providers are now included since SIMPLIFIED_ORCHESTRATOR_INSTRUCTIONS
        // now also requires planning (just with simpler language).
        const TOOLLOOP_CAPABLE_PROVIDERS = new Set([
          "anthropic", // Claude models follow complex prompts well
          "openai", // GPT-4 follows complex prompts well
          "azure", // Azure OpenAI (same as OpenAI)
          "google", // Gemini models are highly capable
          "google-vertex", // Vertex AI Gemini
          "deepseek", // DeepSeek follows instructions well
          "groq", // Groq-hosted models (Llama, Mixtral)
          "together", // Together AI hosted models
          "fireworks", // Fireworks AI
          "perplexity", // Perplexity models
          "mistral", // Mistral AI
          "cohere", // Cohere Command models
          "xai", // xAI Grok models
        ]);

        const provider = chatModel?.provider ?? "";
        const supportsToolLoopAgent = TOOLLOOP_CAPABLE_PROVIDERS.has(provider);

        // Use streamText for providers that don't reliably follow complex orchestration
        // This prevents infinite loops, hallucinations, and other issues
        const useStreamTextProvider = !supportsToolLoopAgent;

        logger.info(
          `[Execution] agentInstance: ${agentInstance ? "YES" : "NO"}, toolChoice: ${toolChoice}, isManualMode: ${isManualMode}, provider: ${provider}, supportsToolLoopAgent: ${supportsToolLoopAgent}, decision: ${agentInstance && !isManualMode && supportsToolLoopAgent ? "ToolLoopAgent" : "streamText"}`,
        );

        if (agentInstance && !isManualMode && !useStreamTextProvider) {
          logger.info(
            `[ToolLoopAgent] Using autonomous agent execution with ${toolNames.length} tools`,
          );

          // Extract the user's last message text as the prompt for the agent
          const lastUserMessage = messages.findLast((m) => m.role === "user");
          const userPrompt =
            lastUserMessage?.parts
              ?.filter(
                (p): p is { type: "text"; text: string } => p.type === "text",
              )
              .map((p) => p.text)
              .join("\n") || "";

          logger.info(
            `[ToolLoopAgent] Prompt length: ${userPrompt.length}, Messages in history: ${modelMessages.length}`,
          );

          // Build a context-aware prompt that includes relevant conversation history
          // The ToolLoopAgent doesn't accept messages array, so we embed context in prompt
          const contextPrompt =
            modelMessages.length > 1
              ? `## Previous conversation context:\n${modelMessages
                  .slice(0, -1) // Exclude the current message (already in userPrompt)
                  .map(
                    (m) =>
                      `${m.role}: ${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`,
                  )
                  .join("\n")}\n\n## Current request:\n${userPrompt}`
              : userPrompt;

          // Track output tokens during agent streaming for real-time updates
          let totalOutputTokens = 0;
          let lastUpdateTime = Date.now();
          const UPDATE_INTERVAL_MS = 200; // Emit updates every 200ms for smooth updates

          // Use the agent's stream method for true autonomous execution
          // The ToolLoopAgent has onStepFinish/onFinish callbacks for state persistence
          const agentResult = await agentInstance.stream({
            prompt: contextPrompt,
            abortSignal: request.signal,
          });

          // Get the UI message stream with metadata on finish
          const agentStream = agentResult.toUIMessageStream({
            messageMetadata: ({ part }) => {
              if (part.type === "finish") {
                return metadata;
              }
            },
          });

          // Create a transform stream that intercepts chunks for token counting
          // UI message stream sends chunks as UIMessageStreamPart objects
          const tokenTrackingTransform = new TransformStream({
            transform(chunk, controller) {
              // Pass through the chunk unchanged
              controller.enqueue(chunk);

              // Debug: Log first few chunks to understand format
              if (totalOutputTokens === 0) {
                logger.info(
                  `[Context] First chunk type: ${typeof chunk}, value: ${JSON.stringify(chunk).slice(0, 200)}`,
                );
              }

              // Try to extract text content and tool calls for token counting
              try {
                // Chunks can be UIMessageStreamPart objects or serialized strings
                let chunkObj = chunk;
                if (typeof chunk === "string") {
                  // Try parsing - AI SDK might send JSON strings
                  try {
                    chunkObj = JSON.parse(chunk);
                  } catch {
                    // Not JSON, might be raw text
                    const chunkTokens = estimateTokens(chunk);
                    if (chunkTokens > 0) {
                      totalOutputTokens += chunkTokens;
                    }
                    return;
                  }
                }

                // Check for tool call parts first
                if (chunkObj && typeof chunkObj === "object") {
                  const obj = chunkObj as Record<string, unknown>;

                  // Check for tool call parts in various formats
                  if (
                    obj.type &&
                    typeof obj.type === "string" &&
                    (obj.type.startsWith("tool-") ||
                      obj.type === "tool-call" ||
                      obj.type === "tool-result")
                  ) {
                    trackToolCallTokens(obj);
                  }
                  // Also check nested parts
                  if (obj.parts && Array.isArray(obj.parts)) {
                    for (const part of obj.parts) {
                      trackToolCallTokens(part);
                    }
                  }
                  // Check for tool calls in value field
                  if (obj.value && typeof obj.value === "object") {
                    const valueObj = obj.value as Record<string, unknown>;
                    if (
                      valueObj.type &&
                      typeof valueObj.type === "string" &&
                      valueObj.type.startsWith("tool-")
                    ) {
                      trackToolCallTokens(valueObj);
                    }
                  }
                }

                // Check for text content in various AI SDK stream formats
                // Format: { type: "0", value: "text" } for text deltas
                // Format: { type: "text-delta", text: "text" }
                let textContent = "";
                if (chunkObj && typeof chunkObj === "object") {
                  const obj = chunkObj as Record<string, unknown>;
                  if (obj.type === "0" || obj.type === 0) {
                    // AI SDK UI stream text delta format
                    textContent = String(obj.value || "");
                  } else if (obj.type === "text-delta") {
                    textContent = String(obj.text || obj.textDelta || "");
                  }
                }

                if (textContent && textContent.length > 0) {
                  const chunkTokens = estimateTokens(textContent);
                  totalOutputTokens += chunkTokens;

                  const now = Date.now();
                  const timeSinceLastUpdate = now - lastUpdateTime;

                  // Emit update every UPDATE_INTERVAL_MS for smooth real-time updates
                  if (timeSinceLastUpdate >= UPDATE_INTERVAL_MS) {
                    logger.info(
                      `[Context] Agent streaming update: ${totalOutputTokens} output tokens`,
                    );
                    emitContextUsageUpdate(totalOutputTokens);
                    lastUpdateTime = now;
                  }
                }
              } catch (error) {
                // Ignore errors in token tracking, don't break the stream
                logger.debug("[Context] Error tracking tokens:", error);
              }
            },
            flush() {
              // Emit final update when stream ends
              logger.info(
                `[Context] Agent final update: ${totalOutputTokens} total output tokens`,
              );
              emitContextUsageUpdate(totalOutputTokens);
            },
          });

          // Pipe the agent stream through token tracking transform
          const trackedStream = agentStream.pipeThrough(tokenTrackingTransform);

          dataStream.merge(trackedStream);
        } else {
          // Fallback to streamText for non-agent mode (image generation, etc.)
          // OR for providers that don't work well with ToolLoopAgent
          const reason = !agentInstance
            ? "no agent instance"
            : isManualMode
              ? "manual mode"
              : `provider ${provider} not in ToolLoopAgent whitelist`;
          logger.info(
            `[StreamText] Using standard streamText (reason: ${reason})`,
          );

          // Only pass tools/toolChoice if there are tools and model supports them
          const hasTools = Object.keys(vercelAITooles).length > 0;
          const willPassTools = hasTools && supportToolCall;
          logger.info(
            `[StreamText Config] hasTools: ${hasTools}, supportToolCall: ${supportToolCall}, willPassTools: ${willPassTools}, toolCount: ${Object.keys(vercelAITooles).length}, toolNames: ${Object.keys(vercelAITooles).slice(0, 10).join(", ")}${Object.keys(vercelAITooles).length > 10 ? "..." : ""}`,
          );

          // For providers that don't support ToolLoopAgent well, use simplified instructions
          // This prevents infinite loops and complex orchestration issues
          // The simplified prompt focuses on direct tool usage without mandatory planning
          const streamTextSystemPrompt =
            useStreamTextProvider && hasTools
              ? `${SIMPLIFIED_ORCHESTRATOR_INSTRUCTIONS}\n\n---\n\n## USER PREFERENCES & CONTEXT\n${systemPrompt}`
              : effectiveSystemPrompt;

          logger.info(
            `[StreamText] Using ${useStreamTextProvider && hasTools ? "SIMPLIFIED" : "full"} orchestrator instructions`,
          );

          // Track output tokens during streaming for real-time updates
          let totalOutputTokens = 0;
          let lastUpdateTime = Date.now();
          const UPDATE_INTERVAL_MS = 200; // Emit updates every 200ms for smooth updates

          const result = streamText({
            model,
            system: streamTextSystemPrompt,
            messages: modelMessages,
            experimental_transform: smoothStream({ chunking: "word" }),
            maxRetries: 2,
            ...(hasTools && supportToolCall
              ? {
                  tools: vercelAITooles,
                  toolChoice:
                    toolChoice === "none"
                      ? "auto"
                      : (toolChoice as "auto" | "required" | "none"),
                }
              : {}),
            stopWhen: stepCountIs(50),
            abortSignal: request.signal,
            // onChunk fires for EVERY chunk - use this for real-time token tracking
            onChunk: ({ chunk }) => {
              if (chunk.type === "text-delta" && chunk.text) {
                const chunkTokens = estimateTokens(chunk.text);
                totalOutputTokens += chunkTokens;

                const now = Date.now();
                const timeSinceLastUpdate = now - lastUpdateTime;

                // Emit update every UPDATE_INTERVAL_MS (200ms) for smooth real-time updates
                if (timeSinceLastUpdate >= UPDATE_INTERVAL_MS) {
                  logger.info(
                    `[Context] Streaming update: ${totalOutputTokens} output tokens`,
                  );
                  emitContextUsageUpdate(totalOutputTokens);
                  lastUpdateTime = now;
                }
              }
            },
            onFinish: ({ usage }) => {
              // Tool calls are already tracked in the transform stream above
              // Emit final update with actual usage from the model
              // Note: usage may be undefined for some providers
              logger.info(
                `[Context] Final update: ${totalOutputTokens} output tokens (model reported: ${usage?.outputTokens ?? "N/A"})`,
              );
              emitContextUsageUpdate(totalOutputTokens);
              if (usage) {
                metadata.usage = usage;
              }
            },
          });
          result.consumeStream();

          const uiStream = result.toUIMessageStream({
            messageMetadata: ({ part }) => {
              if (part.type === "finish") {
                return metadata;
              }
            },
          });

          dataStream.merge(uiStream);
        }
      },

      generateId: generateUUID,
      onFinish: async ({ responseMessage }) => {
        try {
          // Convert parts before saving - this fixes tool name length and input validation
          const convertedUserParts = message.parts.map(convertToSavePart);
          const convertedResponseParts =
            responseMessage.parts.map(convertToSavePart);

          if (responseMessage.id == message.id) {
            await chatRepository.upsertMessage({
              threadId: thread!.id,
              ...responseMessage,
              parts: convertedResponseParts,
              metadata,
            });
          } else {
            await chatRepository.upsertMessage({
              threadId: thread!.id,
              role: message.role,
              parts: convertedUserParts,
              id: message.id,
            });
            await chatRepository.upsertMessage({
              threadId: thread!.id,
              role: responseMessage.role,
              id: responseMessage.id,
              parts: convertedResponseParts,
              metadata,
            });
          }
        } catch (saveError: any) {
          logger.error("[Chat] Failed to save message:", {
            error: saveError?.message || String(saveError),
            threadId: thread?.id,
            messageId: message.id,
            responseId: responseMessage.id,
            // Log tool names to help debug
            userParts: message.parts
              .filter((p: any) => p.type?.startsWith("tool-"))
              .map((p: any) => ({
                type: p.type,
                toolName: getToolName(p as any),
              })),
            responseParts: responseMessage.parts
              .filter((p: any) => p.type?.startsWith("tool-"))
              .map((p: any) => ({
                type: p.type,
                toolName: getToolName(p as any),
              })),
          });
          throw saveError;
        }

        if (agent) {
          agentRepository.updateAgent(agent.id, auth.userId, {
            updatedAt: new Date(),
          } as any);
        }

        // Update agent state on completion
        // Mark as paused (can resume) unless explicitly completed/failed
        if (agentStateIdRef) {
          try {
            await agentStateRepository.update(agentStateIdRef, {
              status: "paused", // Paused means can resume on next message
            });
            logger.info(`[Agent State] Marked as paused: ${agentStateIdRef}`);
          } catch (err) {
            logger.error("[Agent State] Failed to update on finish:", err);
          }
        }

        // Track usage for billing with model multiplier
        if (chatModel) {
          const usage = (metadata.usage || {}) as {
            inputTokens?: number;
            outputTokens?: number;
            totalTokens?: number;
          };
          const inputTokens = usage.inputTokens || 0;
          const outputTokens = usage.outputTokens || 0;
          // Estimate tokens if not provided (rough estimate: 4 chars = 1 token)
          const estimatedTokens = responseMessage.parts
            .filter((p) => p.type === "text")
            .reduce(
              (acc, p: any) => acc + Math.ceil((p.text?.length || 0) / 4),
              0,
            );
          const actualTokens =
            usage.totalTokens ||
            inputTokens + outputTokens ||
            estimatedTokens ||
            100;

          // Get multiplier for credit calculation
          // Uses subscription tier - free models are 0x for Pro/Ultra users!
          const multiplier = getModelMultiplier(
            chatModel.model,
            chatModel.provider,
            tokenLimitCheck.tier, // Pass subscription tier from earlier check
          );
          const creditsConsumed = Math.ceil(actualTokens * multiplier);

          logger.info(
            `[Billing] Recording ${creditsConsumed} credits (${actualTokens} tokens * ${multiplier}x) for user ${auth.userId}`,
          );

          // Track in OpenMeter - pass actual tokens, openmeter will calculate credits
          trackLLMUsage({
            userId: auth.userId,
            model: chatModel.model,
            provider: chatModel.provider,
            inputTokens,
            outputTokens,
            totalTokens: actualTokens,
            tier: tokenLimitCheck.tier, // Pass tier for free model detection
          }).catch((err) => logger.error("Failed to track LLM usage:", err));

          // Record the usage event for history/auditing with credits
          subscriptionRepository
            .recordUsageEvent({
              userId: auth.userId,
              eventType: "llm_tokens",
              amount: String(actualTokens),
              metadata: {
                model: chatModel.model,
                provider: chatModel.provider,
                actualTokens,
                multiplier,
                creditsConsumed,
                inputTokens,
                outputTokens,
              },
            })
            .then(() => logger.info(`[Billing] Usage recorded successfully`))
            .catch((err) => logger.error("Failed to record usage event:", err));

          // Consume credits from purchased pool first, then subscription
          subscriptionRepository
            .consumeTokens(auth.userId, creditsConsumed)
            .then((result) => {
              if (result.fromPurchased > 0) {
                logger.info(
                  `[Billing] Consumed ${result.fromPurchased} from purchased tokens, ${result.fromSubscription} from subscription. Purchased remaining: ${result.purchasedRemaining}`,
                );
              }
            })
            .catch((err) => logger.error("Failed to consume tokens:", err));
        }

        // Track tool usage (MCP tools, image generation)
        // Log all parts for debugging
        logger.info(
          `[DEBUG] Response message parts: ${JSON.stringify(
            responseMessage.parts.map((p) => ({
              type: p.type,
              toolName: (p as any).toolName,
              state: (p as any).state,
              hasOutput: !!(p as any).output,
            })),
          )}`,
        );

        // AI SDK uses "tool-invocation" type with different states:
        // - "call" or "partial-call" for pending tool calls
        // - "output-available" or states starting with "output" for completed results
        const toolParts = responseMessage.parts.filter((p) => {
          const part = p as any;
          // Check for completed tool results (tool-invocation with output state)
          const hasOutput =
            part.type === "tool-invocation" &&
            part.state?.startsWith("output") &&
            part.output;
          if (hasOutput) {
            logger.info(
              `[DEBUG] Found tool part: ${part.toolName}, state: ${part.state}`,
            );
          }
          return hasOutput;
        });
        logger.info(`[DEBUG] Found ${toolParts.length} completed tool parts`);

        for (const part of toolParts) {
          const toolPart = part as any;
          const toolName = toolPart.toolName || "";
          // AI SDK wraps tool output in a 'value' property
          const toolOutput = toolPart.output?.value || toolPart.output;
          const toolInput = toolPart.args;

          logger.info(
            `[DEBUG] Processing tool: ${toolName}, hasValue: ${!!toolPart.output?.value}, output keys: ${toolOutput ? Object.keys(toolOutput).join(",") : "null"}`,
          );

          if (toolName === ImageToolName) {
            const imageCount = toolOutput?.images?.length || 1;
            // Use model from tool output (actual model used) or fall back to request config
            const imageModel =
              toolOutput?.model || imageTool?.model || "unknown";
            // Get resolution from first image for 4K detection (Nano Banana)
            const firstImage = toolOutput?.images?.[0];
            const imageResolution = firstImage?.size || undefined;

            logger.info(
              `[DEBUG] Image tool detected: ${imageCount} images, model: ${imageModel}, resolution: ${imageResolution}`,
            );

            trackImageGeneration({
              userId: auth.userId,
              model: imageModel,
              provider: "image",
              imageCount,
              imageResolution,
            }).catch((err) => logger.error("[Billing] Tracking failed:", err));

            // Calculate credits for this image generation
            const imageCredits =
              getImageCredits(imageModel, imageResolution) * imageCount;

            subscriptionRepository
              .recordUsageEvent({
                userId: auth.userId,
                eventType: "image_generation",
                amount: String(imageCount),
                metadata: {
                  toolName,
                  model: imageModel,
                  imageResolution,
                  creditsConsumed: imageCredits,
                },
              })
              .catch((err) => logger.error("[Billing] Tracking failed:", err));

            logger.info(
              `[Billing] Image generation tracked: ${imageCount} images, ${imageCredits} credits for user ${auth.userId}`,
            );
          } else if (toolName.includes("_")) {
            trackMcpToolCall({
              userId: auth.userId,
              toolName,
            }).catch((err) => logger.error("[Billing] Tracking failed:", err));

            subscriptionRepository
              .recordUsageEvent({
                userId: auth.userId,
                eventType: "mcp_tool_call",
                amount: "1",
                metadata: {
                  toolName,
                  creditsConsumed: SERVICE_CREDIT_COSTS.mcpPerCall,
                },
              })
              .catch((err) => logger.error("[Billing] Tracking failed:", err));
          } else if (toolName === "webSearch" || toolName === "webContent") {
            // Track web search (Exa API) usage for billing
            const searchQuery = toolInput?.query || toolInput?.url || "";

            trackWebSearch({
              userId: auth.userId,
              query: searchQuery,
              toolName,
            }).catch((err) => logger.error("[Billing] Tracking failed:", err));

            subscriptionRepository
              .recordUsageEvent({
                userId: auth.userId,
                eventType: "web_search",
                amount: "1",
                metadata: {
                  toolName,
                  query: searchQuery,
                  creditsConsumed: SERVICE_CREDIT_COSTS.webSearchPerQuery,
                },
              })
              .catch((err) => logger.error("[Billing] Tracking failed:", err));

            logger.info(
              `[Billing] Web search tracked: ${toolName} for user ${auth.userId}`,
            );
          }
        }
      },
      onError: handleError,
      originalMessages: messages,
    });

    return createUIMessageStreamResponse({
      stream,
    });
  } catch (error: any) {
    logger.error(error);
    return Response.json({ message: error.message }, { status: 500 });
  }
}
