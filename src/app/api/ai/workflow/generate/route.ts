import {
  type UIMessage,
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  pruneMessages,
  streamText,
} from "ai";
import { getSession } from "auth/server";
import { colorize } from "consola/utils";
import { customModelProvider } from "lib/ai/models";
import {
  getModelCapabilities,
  getSuggestedWorkflowModels,
  supportsWorkflowGeneration,
} from "lib/ai/providers/capabilities";
import {
  convertHttpKeyValueArray,
  convertStringToHttpValue,
  convertTextToTiptapWithMentions,
} from "lib/ai/workflow/convert-tiptap-mentions";
import { logWorkflowError } from "lib/ai/workflow/workflow-error-handler";
import { checkTokenLimit } from "lib/billing";
import {
  createLimitExceededResponse,
  createUsageTrackingCallback,
  getDefaultModelConfig,
} from "lib/billing/usage-tracking";
import globalLogger from "lib/logger";
import { generateUUID } from "lib/utils";
import { z } from "zod";
import { ChatModel } from "app-types/chat";

const logger = globalLogger.withDefaults({
  message: colorize("blackBright", `Workflow Generate API: `),
});

// Type definitions for workflow tools
interface WorkflowTool {
  id: string;
  name?: string;
  type: "mcp-tool" | "app-tool";
  description?: string;
  serverId?: string;
  serverName?: string;
  parameterSchema?: unknown;
}

interface CompactTool {
  id: string;
  type: string;
  desc: string;
}

const NodeKindEnum = z.enum([
  "input",
  "output",
  "llm",
  "tool",
  "condition",
  "http",
  "template",
]);

// More detailed schema with better descriptions
// Helper to map API kinds to React Flow node types
function getReactFlowNodeType(kind: string): string {
  // We have registered these types in workflow.tsx creating aliases to DefaultNode
  if (
    [
      "input",
      "output",
      "tool",
      "llm",
      "condition",
      "http",
      "template",
    ].includes(kind)
  ) {
    return kind;
  }
  return "default";
}

const WorkflowNodeSchema = z.object({
  id: z.string(),
  // Accept any string but default to "default" - AI may provide node types like "input", "llm", etc.
  // We'll map them to "default" in getReactFlowNodeType anyway
  type: z
    .string()
    .default("default")
    .transform(() => "default"),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
  data: z.object({
    id: z.string(),
    kind: NodeKindEnum,
    name: z.string(),
    description: z.string().optional(),

    // INPUT NODE - outputSchema with properties
    outputSchema: z
      .object({
        type: z.literal("object").default("object"),
        properties: z.record(
          z.string(),
          z.object({
            type: z.enum(["string", "number", "boolean", "object", "array"]),
            description: z.string().optional(),
          }),
        ),
      })
      .optional(),

    // OUTPUT NODE - outputData array
    outputData: z
      .array(
        z.object({
          key: z.string(),
          source: z
            .object({
              nodeId: z.string(),
              path: z.array(z.string()),
            })
            .optional(),
        }),
      )
      .optional(),

    // LLM NODE
    model: z.string().default("gemini-3-flash-preview"),
    messages: z
      .array(
        z.object({
          role: z.enum(["user", "assistant", "system"]),
          content: z.string().min(1),
        }),
      )
      .min(1)
      .optional(),

    // TOOL NODE
    tool: z
      .object({
        id: z.string(),
        type: z.enum(["mcp-tool", "app-tool"]),
        description: z.string().optional(),
        serverId: z.string().optional(),
        serverName: z.string().optional(),
        parameterSchema: z.any().optional(),
      })
      .optional(),
    message: z.string().min(1).optional(),

    // CONDITION NODE
    branches: z
      .object({
        if: z.object({
          id: z.string(),
          type: z.literal("if"),
          logicalOperator: z.enum(["AND", "OR"]),
          conditions: z.array(
            z.object({
              source: z.object({
                nodeId: z.string(),
                path: z.array(z.string()),
              }),
              operator: z.enum([
                "equals",
                "not_equals",
                "contains",
                "not_contains",
                "starts_with",
                "ends_with",
                "is_empty",
                "is_not_empty",
                "greater_than",
                "less_than",
                "greater_than_or_equal",
                "less_than_or_equal",
                "is_true",
                "is_false",
              ]),
              value: z.union([z.string(), z.number(), z.boolean()]).optional(),
            }),
          ),
        }),
        elseIf: z
          .array(
            z.object({
              id: z.string(),
              type: z.literal("elseIf"),
              logicalOperator: z.enum(["AND", "OR"]),
              conditions: z.array(z.any()),
            }),
          )
          .optional(),
        else: z.object({
          id: z.string(),
          type: z.literal("else"),
          logicalOperator: z.enum(["AND", "OR"]),
          conditions: z.array(z.any()).optional(),
        }),
      })
      .optional(),

    // HTTP NODE
    url: z.string().optional(),
    method: z
      .enum(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"])
      .optional(),
    headers: z
      .array(z.object({ key: z.string(), value: z.string() }))
      .optional(),
    query: z.array(z.object({ key: z.string(), value: z.string() })).optional(),
    body: z.string().optional(),
    timeout: z.number().optional(),

    // TEMPLATE NODE
    template: z.string().optional(),
  }),
});

const WorkflowEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
});

const updateWorkflowParams = z.object({
  nodes: z.array(WorkflowNodeSchema),
  edges: z.array(WorkflowEdgeSchema),
  action: z.enum(["replace", "append", "update"]),
});

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return new Response("Unauthorized", { status: 401 });
    }

    const body = await req.json();
    const { messages, availableTools, currentWorkflowState, chatModel } = body;

    // Ensure we have a valid chatModel with default fallback to Gemini 3 Flash
    const validChatModel: ChatModel =
      chatModel?.provider && chatModel?.model
        ? chatModel
        : { model: "gemini-3-flash-preview", provider: "google" };

    // Log the model being used for debugging
    logger.info(
      `[Workflow Generation] Request received - Model: ${validChatModel.provider}/${validChatModel.model}, Messages: ${messages?.length ?? 0}`,
    );

    const modelConfig = getDefaultModelConfig(validChatModel);

    // Unified model capability check using centralized capability system
    // This replaces the previous dual validation (pattern matching + isToolCallUnsupportedModel)
    const modelId = validChatModel.model || "";
    const capabilities = getModelCapabilities(modelId);

    logger.info(
      `[Model Check] Model: ${validChatModel.provider}/${modelId} - ` +
        `workflow support: ${capabilities.workflowGenerationSupport}, ` +
        `reasoning: ${capabilities.isReasoningModel}, ` +
        `tools: ${capabilities.isToolCallSupported}`,
    );

    // Check if model supports workflow generation
    if (!supportsWorkflowGeneration(modelId)) {
      const suggestedModels = getSuggestedWorkflowModels();

      logger.warn(
        `[Model Check] Model ${modelId} does not support workflow generation - ` +
          `reason: ${capabilities.toolCallUnsupportedReason}`,
      );

      // Build user-friendly message based on reason
      let userMessage: string;
      switch (capabilities.toolCallUnsupportedReason) {
        case "built-in-tools":
          userMessage = `The model "${modelId}" has built-in tools that conflict with workflow generation. Please use a different model.`;
          break;
        case "responses-api-only":
          userMessage = `The model "${modelId}" requires a special API that isn't compatible with workflow generation. Please use a different model.`;
          break;
        default:
          userMessage = `The model "${modelId}" is not compatible with workflow generation. Please use a model that supports tool calling.`;
      }

      return new Response(
        JSON.stringify({
          code: "MODEL_UNSUPPORTED",
          error: "Model not supported for workflow generation",
          message: userMessage,
          reason: capabilities.toolCallUnsupportedReason,
          suggestedModels,
          modelCapabilities: {
            isReasoningModel: capabilities.isReasoningModel,
            isToolCallSupported: capabilities.isToolCallSupported,
            reasoningEffort: capabilities.reasoningEffort,
            thinkingLevel: capabilities.thinkingLevel,
          },
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Check token limit with model multiplier
    // Use reasonable minimum estimate to prevent edge cases at exact limit
    const estimatedMinTokens = 1000; // Workflow generation typically uses more tokens
    const tokenLimitCheck = await checkTokenLimit(
      session.user.id,
      estimatedMinTokens,
      modelConfig.model,
      modelConfig.provider,
    );
    if (!tokenLimitCheck.allowed) {
      return createLimitExceededResponse(tokenLimitCheck);
    }

    // Validate we have messages
    if (!messages || messages.length === 0) {
      return new Response(JSON.stringify({ error: "No messages provided" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Limit messages to keep context small for faster responses
    // We must be careful to not break tool call sequences
    // Start from the most recent user message and include everything after
    const MAX_MESSAGES = 12;
    let recentMessages = messages;

    if (messages.length > MAX_MESSAGES) {
      // Find a safe cut point - start from a user message
      let cutIndex = messages.length - MAX_MESSAGES;

      // Walk forward to find the first user message (safe starting point)
      while (cutIndex < messages.length - 1) {
        const msg = messages[cutIndex];
        if (msg.role === "user") {
          break;
        }
        cutIndex++;
      }

      recentMessages = messages.slice(cutIndex);
    }

    // Ensure first message is from user (required by most models)
    if (recentMessages.length > 0 && recentMessages[0].role !== "user") {
      const firstUserIdx = recentMessages.findIndex(
        (m: any) => m.role === "user",
      );
      if (firstUserIdx > 0) {
        recentMessages = recentMessages.slice(firstUserIdx);
      }
    }

    // CRITICAL: Clean up orphaned reasoning references before conversion
    // Messages loaded from localStorage may have reasoning references pointing to missing reasoning items
    // This causes errors when convertToModelMessages tries to resolve them
    // Also clean messages coming from the client to prevent errors during stream processing
    // Handles both message-level reasoningId and function_call/tool-call parts with reasoningId
    const cleanedMessages = recentMessages.map((msg: any) => {
      // First, collect all valid reasoning IDs from parts
      const validReasoningIds = new Set<string>();
      if (msg.parts && Array.isArray(msg.parts)) {
        msg.parts.forEach((p: any) => {
          if (p.type === "reasoning" && p.reasoningId) {
            validReasoningIds.add(p.reasoningId);
          }
        });
      }

      // Remove reasoningId from message if it doesn't have a corresponding reasoning part
      let cleanedMsg = { ...msg };
      if (
        cleanedMsg.reasoningId &&
        typeof cleanedMsg.reasoningId === "string"
      ) {
        if (!validReasoningIds.has(cleanedMsg.reasoningId)) {
          // Remove orphaned reasoning reference
          const { reasoningId, ...rest } = cleanedMsg;
          cleanedMsg = rest;
          logger.debug(
            `[Workflow Generation] Removed orphaned reasoningId ${msg.reasoningId} from message ${msg.id}`,
          );
        }
      }

      // Clean up parts that reference non-existent reasoning items
      // This includes function_call, tool-call, and any other part types with reasoningId
      if (cleanedMsg.parts && Array.isArray(cleanedMsg.parts)) {
        const cleanedParts = cleanedMsg.parts.filter((p: any) => {
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

        if (cleanedParts.length !== cleanedMsg.parts.length) {
          logger.debug(
            `[Workflow Generation] Removed ${cleanedMsg.parts.length - cleanedParts.length} parts with orphaned reasoning from message ${msg.id} (including function_call/tool-call parts)`,
          );
          cleanedMsg = { ...cleanedMsg, parts: cleanedParts };
        }
      }

      return cleanedMsg;
    });

    // Format tools with ALL required information for the AI
    const toolsDescription: WorkflowTool[] =
      (availableTools as WorkflowTool[] | undefined)
        ?.filter(
          (t): t is WorkflowTool =>
            t.type === "mcp-tool" || t.type === "app-tool",
        )
        .map((t) => ({
          name: t.name || t.id,
          id: t.id,
          type: t.type, // CRITICAL: must be exact - mcp-tool or app-tool
          description: t.description || "No description available",
          serverId: t.serverId || "",
          serverName: t.serverName || "",
          parameterSchema: t.parameterSchema,
        })) || [];

    // Build detailed tool list with exact names - AI MUST use these exact IDs
    // Limit to 50 most relevant tools to keep prompt size manageable
    const MAX_TOOLS = 50;
    const compactTools: CompactTool[] = toolsDescription
      .slice(0, MAX_TOOLS)
      .map((t) => ({
        id: t.id,
        type: t.type,
        desc: t.description?.substring(0, 80) || "",
      }));

    // Log tool counts for debugging
    const mcpToolCount = compactTools.filter(
      (t) => t.type === "mcp-tool",
    ).length;
    logger.info(
      `[Workflow Generation] Tools available: ${compactTools.length} total (${mcpToolCount} mcp)`,
    );

    // Create formatted tool documentation for the prompt
    // Group tools by type and app for better AI understanding
    const toolsByType: Record<string, CompactTool[]> = {};
    compactTools.forEach((t) => {
      const key = t.type || "other";
      if (!toolsByType[key]) toolsByType[key] = [];
      toolsByType[key].push(t);
    });

    // Build detailed tool documentation
    let toolDocumentation = "";

    // MCP tools
    if (toolsByType["mcp-tool"]?.length) {
      toolDocumentation += "\n### MCP TOOLS (type: mcp-tool):\n";
      toolsByType["mcp-tool"].forEach((t) => {
        toolDocumentation += `- ID: "${t.id}" | ${t.desc}\n`;
      });
    }

    // App tools
    if (toolsByType["app-tool"]?.length) {
      toolDocumentation += "\n### APP TOOLS (type: app-tool):\n";
      toolsByType["app-tool"].forEach((t) => {
        toolDocumentation += `- ID: "${t.id}" | ${t.desc}\n`;
      });
    }

    const systemPrompt = `You are a Workflow Builder. Your job is to create workflows using the update_workflow_graph tool.

## RESPONSE FORMAT (FOLLOW THIS EXACTLY)
1. First, briefly explain what workflow you'll build (1-2 sentences max)
2. Then ALWAYS call update_workflow_graph with the complete workflow - THIS IS REQUIRED

## NODE RULES
- IDs: "input-1", "llm-1", "tool-1", "output-1" (node.id AND node.data.id MUST match)
- input: outputSchema.properties defines inputs (e.g., { query: { type: "string" } })
- llm: messages array with {{nodeId.output.answer}} references. OUTPUT PATH IS ALWAYS ["answer"]
- tool: MUST include tool object with id and type. OUTPUT PATH IS ALWAYS ["tool_result"]
  - For MCP tools: { tool: { id: "EXACT_ID_FROM_LIST", type: "mcp-tool" }, message: "..." }
  - For App tools: { tool: { id: "EXACT_ID_FROM_LIST", type: "app-tool" }, message: "..." }
  - CRITICAL: tool.id MUST be the EXACT ID from AVAILABLE TOOLS list below!
- template: text template. OUTPUT PATH IS ALWAYS ["template"]
- http: HTTP request. OUTPUT PATH IS ["response", "body"] for response body
- output: outputData maps { key, source: { nodeId, path: [...] } }
  - For llm source: path: ["answer"]
  - For tool source: path: ["tool_result"]
  - For input source: path: ["propertyName"] matching outputSchema.properties key
  - For template source: path: ["template"]
  - For http source: path: ["response", "body"]
- ALWAYS create edges connecting nodes (source → target)
- Positions: x=100, 450, 800... y=200

## WHEN TO USE TOOL NODES (CRITICAL!)
- If user wants to FETCH data from external services (Gmail, Slack, GitHub, etc.) → USE A TOOL NODE
- If user mentions "email", "gmail", "inbox", "messages" and Gmail tools are available → USE GMAIL TOOL
- If user mentions "slack", "channel", "messages" and Slack tools are available → USE SLACK TOOL
- If user mentions any app that has tools below → USE THAT APP'S TOOL
- ONLY use input nodes for truly manual/user-provided data (e.g., "a text field for query")
- PREFER tool nodes over input nodes when fetching external data!

## AVAILABLE TOOLS - CRITICAL: USE EXACT IDs ONLY!
⚠️ When creating tool nodes, you MUST use the EXACT tool ID from the list below.
⚠️ DO NOT invent or guess tool names. Only use IDs explicitly listed here.
⚠️ If no tools are listed, you cannot create tool nodes.
${toolDocumentation || "\nNo tools available - cannot create tool nodes."}

${
  currentWorkflowState?.nodes?.length > 0
    ? `
## CURRENT WORKFLOW (User may ask to modify this)
The canvas already has ${currentWorkflowState.nodes.length} nodes:
${currentWorkflowState.nodes.map((n: any, i: number) => `${i + 1}. id="${n.id}" name="${n.data?.name || "unnamed"}" kind="${n.data?.kind || "unknown"}"`).join("\n")}

⚠️ CRITICAL - When user asks to UPDATE or MODIFY existing nodes:
- Use action: "update"
- You MUST use the EXACT node IDs listed above (the UUID format like "550e8400-e29b-...")
- Set BOTH node.id AND node.data.id to the EXACT existing ID for nodes being updated
- Only change the data properties the user mentions, keep everything else
- For NEW nodes (not in the list above), use sequential IDs like "input-1", "llm-1"

🚫 CRITICAL - DO NOT CREATE DUPLICATE INPUT NODES:
- If an input node already exists (kind="input"), you MUST update it, NOT create a new one
- Check the current workflow list above - if you see a node with kind="input", use its EXACT ID
- NEVER create a new input node if one already exists - always update the existing one
- When updating the input node, use its UUID from the list above for BOTH node.id and node.data.id
`
    : ""
}

Remember: After your brief explanation, you MUST call update_workflow_graph to create the workflow.`;

    // Convert UIMessage format (from useChat) to model messages (for streamText)
    // Use cleaned messages to avoid orphaned reasoning reference errors
    const rawModelMessages = await convertToModelMessages(
      cleanedMessages as UIMessage[],
    );

    // Prune reasoning tokens from messages - required for reasoning models like gpt-5.1-codex-mini
    // The OpenAI API rejects requests with orphaned reasoning tokens in message history
    // NOTE: We only prune from history, not from the current stream (which is handled by sendReasoning: true)
    const modelMessages = pruneMessages({
      messages: rawModelMessages,
      reasoning: "all", // Remove all reasoning content from previous messages only
    });

    // Get the model instance for execution
    const model = customModelProvider.getModel(validChatModel);

    // Use createUIMessageStream to properly handle tool results
    logger.info(
      `[Workflow Generation] Starting workflow generation with ${modelMessages.length} messages`,
    );
    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        const result = streamText({
          model,
          system: systemPrompt,
          messages: modelMessages,
          tools: {
            update_workflow_graph: {
              description:
                "Creates or updates the workflow with nodes and edges. YOU MUST CALL THIS TOOL with properly structured nodes and edges.",
              inputSchema: updateWorkflowParams,
              execute: async ({
                nodes,
                edges,
                action,
              }: z.infer<typeof updateWorkflowParams>) => {
                logger.info(
                  `[Workflow Generation] ⚡ TOOL EXECUTE CALLED with ${nodes?.length || 0} nodes, ${edges?.length || 0} edges, action: ${action}`,
                );
                console.log(
                  "[Workflow Generation] Tool execute called:",
                  JSON.stringify(
                    {
                      nodesCount: nodes?.length,
                      edgesCount: edges?.length,
                      action,
                    },
                    null,
                    2,
                  ),
                );
                try {
                  // Early validation: Check for empty workflows
                  if (!nodes || nodes.length === 0) {
                    logger.warn(
                      "[Workflow Generation] Tool called but no nodes provided",
                    );
                    const errorResult = {
                      success: false,
                      action,
                      nodes: [],
                      edges: [],
                      message:
                        "No nodes were generated. Please try rephrasing your request or ensure the model supports tool calling.",
                      error: "Empty workflow: no nodes generated",
                    };
                    console.log(
                      "[Workflow Generation] Returning error result:",
                      errorResult,
                    );
                    return errorResult;
                  }

                  logger.info(
                    `[Workflow Generation] Processing ${nodes.length} nodes, ${edges?.length || 0} edges, action: ${action}`,
                  );

                  // Create ID mapping from AI-generated IDs to proper UUIDs
                  // Map BOTH node.id AND node.data.id to handle AI inconsistencies
                  // For "update" action, preserve existing UUIDs if AI provides them
                  const idMapping: Record<string, string> = {};

                  // Build a set of existing node IDs from the current workflow for quick lookup
                  const existingNodeIds = new Set<string>();
                  const existingNodesByKind = new Map<string, any[]>();
                  if (currentWorkflowState?.nodes) {
                    currentWorkflowState.nodes.forEach((n: any) => {
                      if (n.id) {
                        existingNodeIds.add(n.id);
                        const kind = n.data?.kind || "unknown";
                        if (!existingNodesByKind.has(kind)) {
                          existingNodesByKind.set(kind, []);
                        }
                        existingNodesByKind.get(kind)!.push(n);
                      }
                    });
                  }

                  // CRITICAL: For "update" action, prevent duplicate input nodes
                  // If an input node already exists and AI tries to create a new one, map it to the existing one
                  const inputNodes = existingNodesByKind.get("input");
                  const hasExistingInputNode = (inputNodes?.length ?? 0) > 0;
                  const existingInputNode = hasExistingInputNode
                    ? inputNodes![0]
                    : null;
                  const existingInputId = existingInputNode?.id;

                  // Pre-map common input node identifiers to existing input node if it exists
                  if (action === "update" && existingInputId) {
                    idMapping["input-1"] = existingInputId;
                    idMapping["input"] = existingInputId;
                    idMapping["INPUT"] = existingInputId;
                    logger.info(
                      `[Workflow Generation] Pre-mapped input node identifiers to existing input: ${existingInputId}`,
                    );
                  }

                  nodes.forEach((node) => {
                    const nodeId = node.id || node.data.id;
                    const kind = node.data.kind;

                    // CRITICAL: If this is an input node and one already exists, use the existing one's ID
                    if (
                      action === "update" &&
                      kind === "input" &&
                      existingInputId
                    ) {
                      logger.info(
                        `[Workflow Generation] Mapping new input node to existing input node: ${nodeId} -> ${existingInputId}`,
                      );

                      // Map the AI's input node ID to the existing input node ID
                      if (node.id) {
                        idMapping[node.id] = existingInputId;
                      }
                      if (node.data.id) {
                        idMapping[node.data.id] = existingInputId;
                      }
                      // Also map by name
                      if (node.data.name) {
                        const nameKey = node.data.name
                          .toLowerCase()
                          .replace(/\s+/g, "-");
                        idMapping[nameKey] = existingInputId;
                      }
                      return; // Skip UUID generation for this node - use existing ID
                    }

                    // Check if this is an existing node ID (UUID format from current workflow)
                    // If so, preserve it instead of generating a new UUID
                    const isExistingNode = existingNodeIds.has(nodeId);
                    const finalId = isExistingNode ? nodeId : generateUUID();

                    if (isExistingNode) {
                      logger.debug(
                        `[Workflow Generation] Preserving existing node ID: ${nodeId}`,
                      );
                    }

                    // Map both possible ID sources to the same UUID
                    if (node.id) {
                      idMapping[node.id] = finalId;
                    }
                    if (node.data.id && node.data.id !== node.id) {
                      idMapping[node.data.id] = finalId;
                    }
                    // Also map by name for fallback (AI might reference by name)
                    if (node.data.name) {
                      const nameKey = node.data.name
                        .toLowerCase()
                        .replace(/\s+/g, "-");
                      if (!idMapping[nameKey]) {
                        idMapping[nameKey] = finalId;
                      }
                    }
                  });

                  logger.debug(
                    `[Workflow Generation] Created ID mapping for ${Object.keys(idMapping).length} node references`,
                  );

                  // Build nodeKinds map for path correction in mentions
                  // Maps original AI node IDs to their kinds (llm, tool, template, etc.)
                  const nodeKinds: Record<string, string> = {};
                  nodes.forEach((node) => {
                    const kind = node.data.kind;
                    if (node.id) {
                      nodeKinds[node.id] = kind;
                    }
                    if (node.data.id && node.data.id !== node.id) {
                      nodeKinds[node.data.id] = kind;
                    }
                  });

                  // Process each node with COMPLETE field initialization
                  // CRITICAL: Filter out duplicate input nodes if one was mapped to existing
                  // Track which input node we've processed to avoid duplicates
                  let inputNodeProcessed = false;
                  const nodesToProcess = nodes.filter((node) => {
                    // If this is an input node and we already have an existing one, only process the first one
                    if (
                      action === "update" &&
                      node.data.kind === "input" &&
                      existingInputId
                    ) {
                      if (inputNodeProcessed) {
                        logger.info(
                          `[Workflow Generation] Filtering out duplicate input node: ${node.id || node.data.id}`,
                        );
                        return false; // Skip duplicate input nodes
                      }
                      inputNodeProcessed = true;
                    }
                    return true;
                  });

                  const processedNodes = nodesToProcess.map((node) => {
                    const oldId = node.id || node.data.id;
                    // Get the UUID - try both possible ID sources
                    const nodeId =
                      idMapping[node.id] ||
                      idMapping[node.data.id] ||
                      idMapping[oldId] ||
                      generateUUID(); // Fallback if mapping failed
                    const kind = node.data.kind;

                    // Start with base required fields for ALL nodes
                    const baseData: any = {
                      id: nodeId,
                      kind: kind,
                      name: node.data.name || `${kind} Node`,
                      description: node.data.description || "",
                      runtime: { isNew: true },
                    };

                    // Input node
                    if (kind === "input") {
                      baseData.outputSchema = node.data.outputSchema || {
                        type: "object",
                        properties: {},
                      };
                      // Ensure properties is an object
                      if (!baseData.outputSchema.properties) {
                        baseData.outputSchema.properties = {};
                      }
                    }

                    // Output node
                    else if (kind === "output") {
                      baseData.outputSchema = node.data.outputSchema || {
                        type: "object",
                        properties: {},
                      };

                      // Process outputData - map AI node IDs to UUIDs and FIX PATHS
                      const rawOutputData = node.data.outputData || [];
                      baseData.outputData = rawOutputData.map((item: any) => {
                        const mappedItem: any = {
                          key: item.key || "result",
                        };

                        if (item.source) {
                          const sourceNodeId = item.source.nodeId;
                          let sourcePath = item.source.path;

                          // Ensure path is always an array
                          if (!Array.isArray(sourcePath)) {
                            sourcePath = sourcePath ? [sourcePath] : [];
                          }

                          // Map the nodeId to UUID
                          const mappedNodeId =
                            idMapping[sourceNodeId] || sourceNodeId;

                          // Find the source node to determine correct path
                          const sourceNode = nodes.find(
                            (n) =>
                              n.id === sourceNodeId ||
                              n.data.id === sourceNodeId,
                          );

                          // Intelligently fix paths based on source node type
                          if (sourceNode) {
                            const sourceKind = sourceNode.data.kind;

                            // Fix common AI mistakes with output paths
                            if (sourceKind === "llm") {
                              // LLM outputs are always at ["answer"]
                              if (
                                sourcePath.length === 0 ||
                                sourcePath[0] === "response" ||
                                sourcePath[0] === "output" ||
                                sourcePath[0] === "result" ||
                                sourcePath[0] === "text"
                              ) {
                                sourcePath = ["answer"];
                              }
                            } else if (sourceKind === "tool") {
                              // Tool outputs are always at ["tool_result"]
                              if (
                                sourcePath.length === 0 ||
                                sourcePath[0] === "response" ||
                                sourcePath[0] === "output" ||
                                sourcePath[0] === "result"
                              ) {
                                sourcePath = ["tool_result"];
                              }
                            } else if (sourceKind === "template") {
                              // Template outputs are at ["template"]
                              if (
                                sourcePath.length === 0 ||
                                sourcePath[0] === "response" ||
                                sourcePath[0] === "output" ||
                                sourcePath[0] === "result" ||
                                sourcePath[0] === "text"
                              ) {
                                sourcePath = ["template"];
                              }
                            } else if (sourceKind === "http") {
                              // HTTP outputs - if path is wrong, default to response.body
                              if (
                                sourcePath.length === 0 ||
                                (sourcePath[0] !== "response" &&
                                  sourcePath[0] !== "request")
                              ) {
                                sourcePath = ["response", "body"];
                              }
                            } else if (sourceKind === "input") {
                              // Input node - use first property from outputSchema if path is wrong
                              if (
                                sourcePath.length === 0 ||
                                sourcePath[0] === "response" ||
                                sourcePath[0] === "output"
                              ) {
                                const inputProps = Object.keys(
                                  sourceNode.data.outputSchema?.properties ||
                                    {},
                                );
                                if (inputProps.length > 0) {
                                  sourcePath = [inputProps[0]];
                                }
                              }
                            }
                          }

                          if (mappedNodeId) {
                            mappedItem.source = {
                              nodeId: mappedNodeId,
                              path: sourcePath,
                            };
                          }
                        }

                        return mappedItem;
                      });

                      if (baseData.outputData.length === 0) {
                        baseData.outputData = [];
                      }
                    }

                    // LLM node
                    else if (kind === "llm") {
                      baseData.model =
                        node.data.model || "gemini-3-flash-preview";

                      // Process messages - convert string content to TipTap with mentions
                      const rawMessages = node.data.messages || [];

                      // Build messages, filtering out empty ones
                      const processedMessages: any[] = [];

                      for (const msg of rawMessages) {
                        const processedMsg: any = {
                          role: msg.role || "user",
                        };

                        if (
                          typeof msg.content === "string" &&
                          msg.content.trim()
                        ) {
                          processedMsg.content =
                            convertTextToTiptapWithMentions(
                              msg.content,
                              idMapping,
                              nodeKinds,
                            );
                          processedMessages.push(processedMsg);
                        } else if (
                          msg.content &&
                          typeof msg.content === "object"
                        ) {
                          // Check if TipTap doc has content
                          const tiptapContent = msg.content as {
                            type?: string;
                            content?: Array<{ content?: any[] }>;
                          };
                          const hasContent =
                            tiptapContent.content &&
                            tiptapContent.content.length > 0 &&
                            tiptapContent.content.some(
                              (p) => p.content && p.content.length > 0,
                            );
                          if (hasContent) {
                            processedMsg.content = msg.content;
                            processedMessages.push(processedMsg);
                          }
                        }
                        // Skip messages with empty or missing content
                      }

                      // If no valid messages, create a default based on the node's purpose
                      // Try to infer what the LLM should do from the node name/description
                      if (processedMessages.length === 0) {
                        // Find incoming edges to determine what data is available
                        const incomingEdges = edges.filter(
                          (e) =>
                            idMapping[e.target] === nodeId ||
                            e.target === oldId,
                        );
                        const sourceNodeIds = incomingEdges.map(
                          (e) => idMapping[e.source] || e.source,
                        );

                        // Build a reference to the first available source node's output
                        let dataReference = "";
                        if (sourceNodeIds.length > 0) {
                          // Find the original ID for the source node
                          const sourceOldId = Object.entries(idMapping).find(
                            ([_, uuid]) => uuid === sourceNodeIds[0],
                          )?.[0];
                          if (sourceOldId) {
                            // Determine the output path based on node type
                            const sourceNode = nodes.find(
                              (n) =>
                                n.id === sourceOldId ||
                                n.data.id === sourceOldId,
                            );
                            if (sourceNode) {
                              if (sourceNode.data.kind === "tool") {
                                dataReference = `{{${sourceOldId}.output.tool_result}}`;
                              } else if (sourceNode.data.kind === "input") {
                                // Get first property from outputSchema
                                const firstProp = Object.keys(
                                  sourceNode.data.outputSchema?.properties ||
                                    {},
                                )[0];
                                dataReference = firstProp
                                  ? `{{${sourceOldId}.output.${firstProp}}}`
                                  : `{{${sourceOldId}.output}}`;
                              } else if (sourceNode.data.kind === "llm") {
                                dataReference = `{{${sourceOldId}.output.answer}}`;
                              } else {
                                dataReference = `{{${sourceOldId}.output}}`;
                              }
                            }
                          }
                        }

                        // Use node name and description to create a more meaningful default message
                        const nodeDesc =
                          node.data.description ||
                          node.data.name ||
                          "AI Processing";
                        const defaultContent = dataReference
                          ? `${nodeDesc}\n\nProcess the following data:\n${dataReference}`
                          : `${nodeDesc}\n\nProvide a helpful response based on the workflow context.`;

                        processedMessages.push({
                          role: "user",
                          content: convertTextToTiptapWithMentions(
                            defaultContent,
                            idMapping,
                            nodeKinds,
                          ),
                        });
                      }

                      baseData.messages = processedMessages;

                      baseData.outputSchema = node.data.outputSchema || {
                        type: "object",
                        properties: {
                          answer: { type: "string" },
                          totalTokens: { type: "number" },
                        },
                      };
                    }

                    // Tool node
                    else if (kind === "tool") {
                      baseData.model =
                        node.data.model || "gemini-3-flash-preview";

                      // Tool configuration - HYDRATE FROM AVAILABLE TOOLS
                      // The AI provides the ID, but we must use the authoritative definition from the system
                      if (node.data.tool && node.data.tool.id) {
                        const toolId = node.data.tool.id;
                        // Find matching tool
                        const originalTool = availableTools?.find(
                          (t: any) => t.id === toolId || t.name === toolId,
                        );

                        if (originalTool) {
                          baseData.tool = {
                            id: originalTool.id, // Use official ID
                            type: originalTool.type, // Use official type (CRITICAL)
                            serverId: originalTool.serverId || "",
                            serverName: originalTool.serverName || "",
                            description:
                              originalTool.description ||
                              node.data.tool.description ||
                              "",
                            parameterSchema:
                              originalTool.parameterSchema ||
                              node.data.tool.parameterSchema,
                          };
                        } else {
                          // Tool not found - AI hallucinated a tool name
                          // Get list of available tool IDs for error message
                          const availableToolIds = (availableTools || [])
                            .map((t: any) => t.id)
                            .slice(0, 20);
                          const toolErrorMsg = `Tool "${toolId}" not found. Available tools: ${availableToolIds.join(", ")}${availableToolIds.length >= 20 ? "..." : ""}`;
                          logger.warn(`[Workflow Generation] ${toolErrorMsg}`);

                          // Still set the tool but mark it as potentially invalid
                          // This allows the workflow to be created but validation will catch it
                          baseData.tool = {
                            id: node.data.tool.id,
                            type: node.data.tool.type || "mcp-tool",
                            serverId: node.data.tool.serverId || "",
                            serverName: node.data.tool.serverName || "",
                            description: `⚠️ INVALID TOOL: ${node.data.tool.description || node.data.tool.id}`,
                            parameterSchema:
                              node.data.tool.parameterSchema || undefined,
                          };
                        }
                      }

                      // Message - convert to TipTap with mentions
                      let messageText = node.data.message || "";

                      // If no message provided, create a default based on incoming data
                      if (!messageText.trim()) {
                        logger.debug(
                          `[Workflow Generation] Tool node "${node.data.name || nodeId}" has no message, generating default`,
                        );

                        // Find incoming edges to determine what data is available
                        const incomingEdges = edges.filter(
                          (e) =>
                            idMapping[e.target] === nodeId ||
                            e.target === oldId,
                        );

                        if (incomingEdges.length > 0) {
                          const sourceOldId =
                            Object.entries(idMapping).find(
                              ([_, uuid]) =>
                                uuid ===
                                (idMapping[incomingEdges[0].source] ||
                                  incomingEdges[0].source),
                            )?.[0] || incomingEdges[0].source;

                          const sourceNode = nodes.find(
                            (n) =>
                              n.id === sourceOldId || n.data.id === sourceOldId,
                          );

                          if (sourceNode) {
                            if (sourceNode.data.kind === "input") {
                              const props = Object.keys(
                                sourceNode.data.outputSchema?.properties || {},
                              );
                              messageText = props
                                .map((p) => `{{${sourceOldId}.output.${p}}}`)
                                .join("\n");
                            } else if (sourceNode.data.kind === "tool") {
                              messageText = `{{${sourceOldId}.output.tool_result}}`;
                            } else if (sourceNode.data.kind === "llm") {
                              messageText = `{{${sourceOldId}.output.answer}}`;
                            }
                          }
                        }

                        // Final fallback - use node description for context
                        if (!messageText) {
                          const toolDesc =
                            node.data.description ||
                            node.data.name ||
                            "Execute tool";
                          messageText = `${toolDesc}\n\nExecute the ${baseData.tool?.id || "tool"} with appropriate parameters.`;
                        }

                        logger.debug(
                          `[Workflow Generation] Generated default message for tool node: ${messageText.slice(0, 50)}...`,
                        );
                      }

                      baseData.message = convertTextToTiptapWithMentions(
                        messageText,
                        idMapping,
                        nodeKinds,
                      );

                      baseData.outputSchema = node.data.outputSchema || {
                        type: "object",
                        properties: {
                          tool_result: { type: "object" },
                        },
                      };
                    }

                    // Condition node
                    else if (kind === "condition") {
                      // Process branches with proper ID mapping
                      const rawBranches = node.data.branches;

                      if (rawBranches) {
                        // Process if branch
                        const ifBranch = {
                          id: rawBranches.if?.id || generateUUID(),
                          type: "if" as const,
                          logicalOperator:
                            rawBranches.if?.logicalOperator || "AND",
                          conditions: (rawBranches.if?.conditions || []).map(
                            (cond: any) => ({
                              source: {
                                nodeId: cond.source?.nodeId
                                  ? idMapping[cond.source.nodeId] ||
                                    cond.source.nodeId
                                  : "",
                                path: Array.isArray(cond.source?.path)
                                  ? cond.source.path
                                  : [],
                              },
                              operator: cond.operator || "equals",
                              value: cond.value,
                            }),
                          ),
                        };

                        // Process elseIf branches
                        const elseIfBranches = (rawBranches.elseIf || []).map(
                          (branch: any) => ({
                            id: branch.id || generateUUID(),
                            type: "elseIf" as const,
                            logicalOperator: branch.logicalOperator || "AND",
                            conditions: (branch.conditions || []).map(
                              (cond: any) => ({
                                source: {
                                  nodeId: cond.source?.nodeId
                                    ? idMapping[cond.source.nodeId] ||
                                      cond.source.nodeId
                                    : "",
                                  path: Array.isArray(cond.source?.path)
                                    ? cond.source.path
                                    : [],
                                },
                                operator: cond.operator || "equals",
                                value: cond.value,
                              }),
                            ),
                          }),
                        );

                        // Process else branch
                        const elseBranch = {
                          id: rawBranches.else?.id || generateUUID(),
                          type: "else" as const,
                          logicalOperator:
                            rawBranches.else?.logicalOperator || "AND",
                          conditions: [],
                        };

                        baseData.branches = {
                          if: ifBranch,
                          elseIf: elseIfBranches,
                          else: elseBranch,
                        };
                      } else {
                        // Default branches structure
                        baseData.branches = {
                          if: {
                            id: generateUUID(),
                            type: "if",
                            logicalOperator: "AND",
                            conditions: [],
                          },
                          elseIf: [],
                          else: {
                            id: generateUUID(),
                            type: "else",
                            logicalOperator: "AND",
                            conditions: [],
                          },
                        };
                      }

                      baseData.outputSchema = node.data.outputSchema || {
                        type: "object",
                        properties: {
                          branch: { type: "string" },
                        },
                      };
                    }

                    // HTTP node
                    else if (kind === "http") {
                      // Convert URL - may be a variable reference like {{input-1.output.webhookUrl}}
                      baseData.url =
                        convertStringToHttpValue(
                          node.data.url as string,
                          idMapping,
                        ) || "";
                      baseData.method = node.data.method || "GET";

                      // Convert headers - each value may be a variable reference
                      baseData.headers = convertHttpKeyValueArray(
                        node.data.headers as Array<{
                          key: string;
                          value?: string;
                        }>,
                        idMapping,
                      );

                      // Convert query params - each value may be a variable reference
                      baseData.query = convertHttpKeyValueArray(
                        node.data.query as Array<{
                          key: string;
                          value?: string;
                        }>,
                        idMapping,
                      );

                      // Convert body - may be a variable reference
                      baseData.body = convertStringToHttpValue(
                        node.data.body as string,
                        idMapping,
                      );

                      baseData.timeout = node.data.timeout || 30000;

                      baseData.outputSchema = node.data.outputSchema || {
                        type: "object",
                        properties: {
                          response: {
                            type: "object",
                            properties: {
                              status: { type: "number" },
                              statusText: { type: "string" },
                              ok: { type: "boolean" },
                              headers: { type: "object" },
                              body: { type: "string" },
                            },
                          },
                        },
                      };
                    }

                    // Template node
                    else if (kind === "template") {
                      const templateData = node.data.template as any;
                      if (typeof templateData === "string") {
                        baseData.template = {
                          type: "tiptap",
                          tiptap: convertTextToTiptapWithMentions(
                            templateData,
                            idMapping,
                            nodeKinds,
                          ),
                        };
                      } else if (templateData?.tiptap) {
                        baseData.template = templateData;
                      } else {
                        baseData.template = {
                          type: "tiptap",
                          tiptap: { type: "doc", content: [] },
                        };
                      }

                      baseData.outputSchema = node.data.outputSchema || {
                        type: "object",
                        properties: {
                          template: { type: "string" },
                        },
                      };
                    }

                    // Note node (for documentation)
                    else if (kind === "note") {
                      baseData.outputSchema = {
                        type: "object",
                        properties: {},
                      };
                    }

                    // Unknown node type (fallback)
                    else {
                      baseData.outputSchema = node.data.outputSchema || {
                        type: "object",
                        properties: {},
                      };
                    }

                    return {
                      id: nodeId,
                      type: getReactFlowNodeType(kind),
                      position: node.position || { x: 100, y: 200 },
                      data: baseData,
                    };
                  });

                  // Build a reverse mapping from node kind+index to UUID for fallback edge resolution
                  const nodeKindCounts: Record<string, number> = {};
                  const nodeKindIndexMap: Record<string, string> = {}; // "input-1" -> uuid

                  // First pass: map all original node IDs (handles AI using arbitrary IDs like "llm-3")
                  nodes.forEach((node) => {
                    const nodeUuid =
                      idMapping[node.id] || idMapping[node.data.id];
                    if (nodeUuid) {
                      // Map the original AI-generated ID directly
                      if (node.id) {
                        nodeKindIndexMap[node.id] = nodeUuid;
                        nodeKindIndexMap[node.id.toLowerCase()] = nodeUuid;
                      }
                      if (node.data.id && node.data.id !== node.id) {
                        nodeKindIndexMap[node.data.id] = nodeUuid;
                        nodeKindIndexMap[node.data.id.toLowerCase()] = nodeUuid;
                      }
                    }
                  });

                  // Second pass: also add sequential kind-based indices
                  processedNodes.forEach((node, idx) => {
                    const kind = node.data.kind;
                    nodeKindCounts[kind] = (nodeKindCounts[kind] || 0) + 1;
                    const kindIndex = `${kind}-${nodeKindCounts[kind]}`;
                    nodeKindIndexMap[kindIndex] = node.id;
                    // Also map by just the index
                    nodeKindIndexMap[`node-${idx + 1}`] = node.id;
                  });

                  // Process edges - map IDs and handle condition sourceHandles
                  logger.debug(
                    `[Workflow Generation] Processing ${edges.length} edges`,
                  );

                  // Build a comprehensive mapping that includes existing nodes
                  const allNodeIdMapping = { ...idMapping };
                  if (currentWorkflowState?.nodes) {
                    currentWorkflowState.nodes.forEach((n: any) => {
                      if (n.id) {
                        // Map existing node ID to itself
                        allNodeIdMapping[n.id] = n.id;
                        // Also map by name if available
                        if (n.data?.name) {
                          const nameKey = n.data.name
                            .toLowerCase()
                            .replace(/\s+/g, "-");
                          if (!allNodeIdMapping[nameKey]) {
                            allNodeIdMapping[nameKey] = n.id;
                          }
                        }
                      }
                    });
                  }

                  // Build a set of all valid node IDs from processedNodes BEFORE processing edges
                  const validNodeIds = new Set(processedNodes.map((n) => n.id));

                  const processedEdges = edges
                    .map((edge) => {
                      // Try multiple strategies to resolve source/target IDs
                      let sourceId = allNodeIdMapping[edge.source];
                      let targetId = allNodeIdMapping[edge.target];

                      // Fallback: try node kind+index mapping (e.g., "input-1", "llm-1")
                      if (!sourceId) {
                        const mappedId =
                          nodeKindIndexMap[edge.source] ||
                          nodeKindIndexMap[edge.source.toLowerCase()];
                        // Only use mapped ID if it exists in processedNodes
                        if (mappedId && validNodeIds.has(mappedId)) {
                          sourceId = mappedId;
                        }
                      }
                      if (!targetId) {
                        const mappedId =
                          nodeKindIndexMap[edge.target] ||
                          nodeKindIndexMap[edge.target.toLowerCase()];
                        // Only use mapped ID if it exists in processedNodes
                        if (mappedId && validNodeIds.has(mappedId)) {
                          targetId = mappedId;
                        }
                      }

                      // Additional fallback: check if it's an existing node ID directly
                      if (
                        !sourceId &&
                        existingNodeIds.has(edge.source) &&
                        validNodeIds.has(edge.source)
                      ) {
                        sourceId = edge.source;
                      }
                      if (
                        !targetId &&
                        existingNodeIds.has(edge.target) &&
                        validNodeIds.has(edge.target)
                      ) {
                        targetId = edge.target;
                      }

                      // CRITICAL: Only use IDs that exist in processedNodes
                      // Skip edges with invalid IDs - they'll be filtered out later
                      if (!sourceId || !validNodeIds.has(sourceId)) {
                        logger.warn(
                          `[Workflow Generation] Edge source "${edge.source}" could not be resolved to a valid node ID`,
                        );
                        return null; // Mark for filtering
                      }
                      if (!targetId || !validNodeIds.has(targetId)) {
                        logger.warn(
                          `[Workflow Generation] Edge target "${edge.target}" could not be resolved to a valid node ID`,
                        );
                        return null; // Mark for filtering
                      }

                      // Find the source node to check if it's a condition node
                      const sourceNode = processedNodes.find(
                        (n) => n.id === sourceId,
                      );
                      let sourceHandle = edge.sourceHandle || null;

                      // If source is condition node and has sourceHandle, map branch IDs
                      if (
                        sourceNode?.data?.kind === "condition" &&
                        edge.sourceHandle
                      ) {
                        const branches = sourceNode.data.branches;
                        // Check if sourceHandle matches a branch id and map it
                        if (
                          branches?.if?.id === edge.sourceHandle ||
                          edge.sourceHandle === "if" ||
                          edge.sourceHandle === "if-branch"
                        ) {
                          sourceHandle = branches.if.id;
                        } else if (
                          branches?.else?.id === edge.sourceHandle ||
                          edge.sourceHandle === "else" ||
                          edge.sourceHandle === "else-branch"
                        ) {
                          sourceHandle = branches.else.id;
                        } else {
                          // Check elseIf branches
                          const elseIfBranch = branches?.elseIf?.find(
                            (b: any) => b.id === edge.sourceHandle,
                          );
                          if (elseIfBranch) {
                            sourceHandle = elseIfBranch.id;
                          }
                        }
                      } else if (sourceNode?.data?.kind !== "output") {
                        // For non-condition (and non-output) nodes, default to "right" handle if not specified
                        // This is CRITICAL for DefaultNode which defines id="right"
                        sourceHandle = sourceHandle || "right";
                      }

                      return {
                        id: generateUUID(),
                        source: sourceId,
                        target: targetId,
                        sourceHandle: sourceHandle,
                        targetHandle: edge.targetHandle || "left",
                      };
                    })
                    .filter(
                      (edge): edge is NonNullable<typeof edge> => edge !== null,
                    );

                  // Verify all edge source/target IDs exist in nodes
                  // CRITICAL: Filter out edges with invalid IDs to prevent database errors
                  const nodeIds = new Set(processedNodes.map((n) => n.id));
                  const edgeErrors: string[] = [];
                  const validEdges: typeof processedEdges = [];

                  processedEdges.forEach((edge, i) => {
                    const hasValidSource = nodeIds.has(edge.source);
                    const hasValidTarget = nodeIds.has(edge.target);

                    if (!hasValidSource) {
                      const errorMsg = `Edge ${i} has invalid source: ${edge.source} (not a valid UUID - AI may have referenced non-existent node)`;
                      edgeErrors.push(errorMsg);
                      logger.warn(`[Workflow Generation] ${errorMsg}`);
                    }
                    if (!hasValidTarget) {
                      const errorMsg = `Edge ${i} has invalid target: ${edge.target} (not a valid UUID - AI may have referenced non-existent node)`;
                      edgeErrors.push(errorMsg);
                      logger.warn(`[Workflow Generation] ${errorMsg}`);
                    }

                    // Only include edges with valid source AND target
                    if (hasValidSource && hasValidTarget) {
                      validEdges.push(edge);
                    }
                  });

                  logger.debug(
                    `[Workflow Generation] Edge validation: ${validEdges.length}/${processedEdges.length} edges valid`,
                  );

                  // Replace processedEdges with only valid edges
                  const finalEdges = validEdges;

                  // Validate that all nodes have required fields
                  const validationErrors: string[] = [];
                  logger.debug(
                    `[Workflow Generation] Validating ${processedNodes.length} nodes`,
                  );

                  for (const node of processedNodes) {
                    const kind = node.data.kind;
                    const nodeName = node.data.name || node.id;

                    // Validate LLM nodes
                    if (kind === "llm") {
                      if (
                        !node.data.messages ||
                        node.data.messages.length === 0
                      ) {
                        validationErrors.push(
                          `LLM node "${nodeName}" has no messages`,
                        );
                      } else {
                        // Check each message has content
                        let hasValidMessage = false;
                        for (const msg of node.data.messages) {
                          if (msg.content) {
                            // Check if TipTap doc has actual content
                            const tiptap = msg.content as any;
                            if (
                              tiptap?.content &&
                              Array.isArray(tiptap.content)
                            ) {
                              for (const para of tiptap.content) {
                                if (para?.content && para.content.length > 0) {
                                  hasValidMessage = true;
                                  break;
                                }
                              }
                            }
                          }
                          if (hasValidMessage) break;
                        }
                        if (!hasValidMessage) {
                          const errorMsg = `LLM node "${nodeName}" has empty message content - this will cause execution failure!`;
                          validationErrors.push(errorMsg);
                          logger.warn(`[Workflow Generation] ${errorMsg}`);
                        }
                      }
                    }

                    // Validate Tool nodes
                    if (kind === "tool") {
                      if (!node.data.tool) {
                        const errorMsg = `Tool node "${nodeName}" has no tool configured`;
                        validationErrors.push(errorMsg);
                        logger.warn(`[Workflow Generation] ${errorMsg}`);
                      } else if (
                        node.data.tool.description?.includes("⚠️ INVALID TOOL")
                      ) {
                        const errorMsg = `Tool node "${nodeName}" references invalid tool: ${node.data.tool.id}`;
                        validationErrors.push(errorMsg);
                        logger.warn(`[Workflow Generation] ${errorMsg}`);
                      }
                      if (!node.data.message) {
                        const errorMsg = `Tool node "${nodeName}" has no message - this may cause execution issues`;
                        validationErrors.push(errorMsg);
                        logger.warn(`[Workflow Generation] ${errorMsg}`);
                      } else {
                        // Check if TipTap doc has actual content
                        const tiptap = node.data.message as any;
                        let hasContent = false;
                        if (tiptap?.content && Array.isArray(tiptap.content)) {
                          for (const para of tiptap.content) {
                            if (para?.content && para.content.length > 0) {
                              hasContent = true;
                              break;
                            }
                          }
                        }
                        if (!hasContent) {
                          const errorMsg = `Tool node "${nodeName}" has empty message content`;
                          validationErrors.push(errorMsg);
                          logger.warn(`[Workflow Generation] ${errorMsg}`);
                        }
                      }
                    }

                    // Validate Output nodes
                    if (kind === "output") {
                      if (
                        !node.data.outputData ||
                        node.data.outputData.length === 0
                      ) {
                        const errorMsg = `Output node "${nodeName}" has no outputData configured`;
                        validationErrors.push(errorMsg);
                        logger.warn(`[Workflow Generation] ${errorMsg}`);
                      } else {
                        for (const item of node.data.outputData) {
                          if (!item.source || !item.source.nodeId) {
                            const errorMsg = `Output node "${nodeName}" has item "${item.key}" with no source`;
                            validationErrors.push(errorMsg);
                            logger.warn(`[Workflow Generation] ${errorMsg}`);
                          }
                        }
                      }
                    }

                    // Validate HTTP nodes
                    if (kind === "http") {
                      if (!node.data.url) {
                        const errorMsg = `HTTP node "${nodeName}" has no URL`;
                        validationErrors.push(errorMsg);
                        logger.warn(`[Workflow Generation] ${errorMsg}`);
                      }
                    }
                  }

                  // Validate variable references match schemas
                  const nodeMap = new Map(processedNodes.map((n) => [n.id, n]));

                  // Helper to extract mentions from TipTap content
                  const extractMentions = (
                    tiptap: any,
                  ): Array<{ nodeId: string; path: string[] }> => {
                    const mentions: Array<{ nodeId: string; path: string[] }> =
                      [];
                    if (!tiptap?.content) return mentions;

                    const traverse = (node: any) => {
                      if (node.type === "mention" && node.attrs?.label) {
                        try {
                          const parsed = JSON.parse(node.attrs.label);
                          if (parsed.nodeId) {
                            mentions.push({
                              nodeId: parsed.nodeId,
                              path: parsed.path || [],
                            });
                          }
                        } catch {
                          /* ignore invalid JSON */
                        }
                      }
                      if (Array.isArray(node.content)) {
                        node.content.forEach(traverse);
                      }
                    };
                    traverse(tiptap);
                    return mentions;
                  };

                  // Helper to check if path exists in schema
                  const pathExistsInSchema = (
                    schema: any,
                    path: string[],
                  ): boolean => {
                    if (!schema?.properties || path.length === 0) return true; // Empty path = entire output
                    const [first, ...rest] = path;
                    if (!schema.properties[first]) return false;
                    if (rest.length === 0) return true;
                    return pathExistsInSchema(schema.properties[first], rest);
                  };

                  // Validate mentions in each node
                  for (const node of processedNodes) {
                    const nodeName = node.data.name || node.id;
                    let tiptapContents: any[] = [];

                    // Collect TipTap content from node
                    if (node.data.kind === "llm" && node.data.messages) {
                      tiptapContents = node.data.messages
                        .map((m: any) => m.content)
                        .filter(Boolean);
                    } else if (node.data.kind === "tool" && node.data.message) {
                      tiptapContents = [node.data.message];
                    } else if (
                      node.data.kind === "template" &&
                      node.data.template?.tiptap
                    ) {
                      tiptapContents = [node.data.template.tiptap];
                    }

                    // Extract and validate mentions
                    for (const tiptap of tiptapContents) {
                      const mentions = extractMentions(tiptap);
                      for (const mention of mentions) {
                        // Try to resolve the mention nodeId using the same mapping logic as edges
                        let resolvedNodeId = mention.nodeId;

                        // Check if it's already a valid node ID
                        if (!nodeMap.has(resolvedNodeId)) {
                          // Try to resolve using idMapping
                          resolvedNodeId =
                            idMapping[mention.nodeId] ||
                            idMapping[mention.nodeId.toLowerCase()] ||
                            mention.nodeId;

                          // Try nodeKindIndexMap
                          if (!nodeMap.has(resolvedNodeId)) {
                            resolvedNodeId =
                              nodeKindIndexMap[mention.nodeId] ||
                              nodeKindIndexMap[mention.nodeId.toLowerCase()] ||
                              resolvedNodeId;
                          }
                        }

                        const sourceNode = nodeMap.get(resolvedNodeId);
                        if (!sourceNode) {
                          validationErrors.push(
                            `Node "${nodeName}" references unknown node ID: ${mention.nodeId} (could not resolve to valid node)`,
                          );
                          continue;
                        }

                        // Update the mention to use the resolved node ID if different
                        if (resolvedNodeId !== mention.nodeId) {
                          mention.nodeId = resolvedNodeId;
                        }

                        const sourceSchema = sourceNode.data.outputSchema;
                        if (!pathExistsInSchema(sourceSchema, mention.path)) {
                          const pathStr =
                            mention.path.length > 0
                              ? mention.path.join(".")
                              : "(entire output)";
                          const availablePaths = sourceSchema?.properties
                            ? Object.keys(sourceSchema.properties).join(", ")
                            : "none defined";
                          validationErrors.push(
                            `Node "${nodeName}" references invalid path "${pathStr}" in "${sourceNode.data.name}". Available: [${availablePaths}]`,
                          );
                        }
                      }
                    }
                  }

                  // Combine all validation errors
                  const allErrors = [...edgeErrors, ...validationErrors];

                  // Final validation: Ensure we have at least one valid node
                  if (processedNodes.length === 0) {
                    logger.error(
                      "[Workflow Generation] All nodes were filtered out during processing",
                    );
                    return {
                      success: false,
                      action,
                      nodes: [],
                      edges: [],
                      message:
                        "Failed to process workflow nodes. All nodes were invalid or missing required fields.",
                      error: "No valid nodes after processing",
                      validationWarnings:
                        allErrors.length > 0 ? allErrors : undefined,
                    };
                  }

                  // Log validation results
                  if (allErrors.length > 0) {
                    logger.warn(
                      `[Workflow Generation] Completed with ${allErrors.length} validation warnings:`,
                      allErrors.slice(0, 5), // Log first 5 errors
                    );
                  } else {
                    logger.info(
                      `[Workflow Generation] Successfully processed workflow: ${processedNodes.length} nodes, ${finalEdges.length} edges`,
                    );
                  }

                  const result = {
                    success: true,
                    action,
                    nodes: processedNodes,
                    edges: finalEdges, // Use filtered edges with valid UUIDs only
                    message:
                      allErrors.length > 0
                        ? `Workflow ${action}d with ${processedNodes.length} nodes and ${finalEdges.length} edges. ⚠️ ${allErrors.length} validation warning(s) found.`
                        : `Workflow ${action}d with ${processedNodes.length} nodes and ${finalEdges.length} edges.`,
                    validationWarnings:
                      allErrors.length > 0 ? allErrors : undefined,
                  };

                  logger.info(
                    `[Workflow Generation] ✅ Returning success result: ${processedNodes.length} nodes, ${finalEdges.length} edges`,
                  );
                  console.log(
                    "[Workflow Generation] Success result:",
                    JSON.stringify(
                      {
                        success: result.success,
                        nodesCount: result.nodes.length,
                        edgesCount: result.edges.length,
                        validationWarningsCount:
                          result.validationWarnings?.length || 0,
                      },
                      null,
                      2,
                    ),
                  );

                  return result;
                } catch (executeError) {
                  // Log the error for debugging
                  logger.error(
                    "[Workflow Generation] Error processing workflow:",
                    executeError,
                  );
                  if (executeError instanceof Error) {
                    logger.error(
                      "[Workflow Generation] Error stack:",
                      executeError.stack,
                    );
                  }

                  // Return an error result instead of throwing
                  return {
                    success: false,
                    action,
                    nodes: [],
                    edges: [],
                    message: `Failed to build workflow: ${executeError instanceof Error ? executeError.message : String(executeError)}`,
                    error: String(executeError),
                    validationWarnings: [
                      `Processing error: ${executeError instanceof Error ? executeError.message : String(executeError)}`,
                    ],
                  };
                }
              },
            },
          },
          toolChoice: "auto", // Use "auto" to allow model to generate thinking text before tool call
          // Following Sim's pattern: Pass reasoning effort for reasoning-capable models
          // This allows models to THINK and REASON while also calling tools
          providerOptions: capabilities.isReasoningModel
            ? {
                openai: {
                  reasoningEffort:
                    (capabilities.reasoningEffort?.[2] as string) || "medium", // Use medium or model's default
                },
              }
            : undefined,
          onStepFinish: ({ toolCalls }) => {
            if (toolCalls && toolCalls.length > 0) {
              logger.info(
                `[Workflow Generation] 🔧 Tool calls in step: ${toolCalls.map((tc) => tc.toolName).join(", ")}`,
              );
              console.log(
                "[Workflow Generation] Tool calls:",
                toolCalls.map((tc) => ({
                  toolName: tc.toolName,
                  toolCallId: tc.toolCallId,
                  args: "args" in tc ? tc.args : undefined,
                })),
              );
            }
          },
          onFinish: createUsageTrackingCallback(
            {
              userId: session.user.id,
              model: modelConfig.model,
              provider: modelConfig.provider,
              tier: tokenLimitCheck.tier,
              source: "workflow_generation",
              logger,
            },
            () =>
              modelMessages
                .map((m) =>
                  typeof m.content === "string"
                    ? m.content
                    : JSON.stringify(m.content),
                )
                .join(" "),
          ),
        });

        // CRITICAL: Order matters - consumeStream first, then merge
        // This matches the main chat route pattern
        result.consumeStream();

        // CRITICAL: Transform messages to clean orphaned reasoning references before they're sent to client
        // Handles both message-level reasoningId and function_call/tool-call parts with reasoningId
        const reasoningCleanupTransform = new TransformStream({
          transform(chunk, controller) {
            // Clean any messages in the chunk that have orphaned reasoning references
            if (
              chunk &&
              typeof chunk === "object" &&
              "type" in chunk &&
              chunk.type === "message" &&
              "message" in chunk
            ) {
              const msg = (chunk as any).message;
              const validReasoningIds = new Set<string>();
              if (msg.parts && Array.isArray(msg.parts)) {
                msg.parts.forEach((p: any) => {
                  if (p.type === "reasoning" && p.reasoningId) {
                    validReasoningIds.add(p.reasoningId);
                  }
                });
              }

              // Remove orphaned reasoningId from message
              if (
                msg.reasoningId &&
                typeof msg.reasoningId === "string" &&
                !validReasoningIds.has(msg.reasoningId)
              ) {
                const { reasoningId, ...rest } = msg;
                (chunk as any).message = rest;
              }

              // Clean parts with orphaned reasoning references
              // This includes function_call, tool-call, and any other part types with reasoningId
              if (msg.parts && Array.isArray(msg.parts)) {
                const cleanedParts = msg.parts.filter((p: any) => {
                  // For reasoning parts, keep them if they have a valid reasoningId
                  if (p.type === "reasoning") {
                    return (
                      p.reasoningId && validReasoningIds.has(p.reasoningId)
                    );
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
                  (chunk as any).message = { ...msg, parts: cleanedParts };
                }
              }
            }
            controller.enqueue(chunk);
          },
        });

        writer.merge(
          result
            .toUIMessageStream({
              messageMetadata: () => undefined,
              // Following Sim's pattern: Enable reasoning for reasoning-capable models
              // Reasoning models CAN use tools alongside reasoning
              sendReasoning: capabilities.isReasoningModel,
            })
            .pipeThrough(reasoningCleanupTransform),
        );
      },
      generateId: generateUUID,
      onError: (error) => {
        // Use shared error handling utility
        logWorkflowError(error, {
          model: chatModel?.model,
          isReasoningModel: capabilities.isReasoningModel,
          prefix: "[Workflow Generation]",
        });
        return String(error);
      },
    });

    return createUIMessageStreamResponse({ stream });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: "Internal Server Error",
        details: String(error),
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
