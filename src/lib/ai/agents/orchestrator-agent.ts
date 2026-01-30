import {
  type StepResult,
  type Tool,
  ToolLoopAgent,
  type ToolLoopAgentSettings,
  type UIMessageStreamWriter,
  type PrepareStepFunction,
  type ToolSet,
  tool as createTool,
  generateText,
  stepCountIs,
  streamText,
} from "ai";
import type { AgentState, AgentStateUpdate } from "app-types/agent-state";
import { colorize } from "consola/utils";
import { JSONSchema7 } from "json-schema";
import {
  agentRepository,
  agentStateRepository,
} from "lib/db/repository";
import { jsonSchemaToZod } from "lib/json-schema-to-zod";
import { z } from "zod";
import globalLogger from "logger";
import { customModelProvider } from "../models";
import { createBrowserToolsWithContext } from "../tools/browser/local-browser-tools";
import {
  type AgentContextManager,
  type TaskDefinition,
  createAgentContext,
  gatherContextForSubAgent,
} from "./agent-state";
import {
  getSystemAgent,
  getSystemAgentInstructions,
  getSystemAgentRequirements,
  isSystemAgent,
} from "./system-agents";
import type { OrchestratorConfig } from "./types";

// JSON Schema definitions for agent context tools
// NOTE: createPlan uses a direct Zod schema for better reliability

const updateTaskStatusSchema: JSONSchema7 = {
  type: "object",
  properties: {
    taskId: { type: "string", description: "ID of the task to update" },
    taskDescription: {
      type: "string",
      description:
        "Human-readable description of the task (ALWAYS include this for better UX)",
    },
    status: {
      type: "string",
      enum: ["in-progress", "completed", "failed", "blocked"],
      description: "New status for the task",
    },
    result: {
      description:
        "Result data for completed tasks, or error message for failed tasks",
    },
  },
  required: ["taskId", "status"],
};

const emptySchema: JSONSchema7 = {
  type: "object",
  properties: {},
};

const setContextSchema: JSONSchema7 = {
  type: "object",
  properties: {
    key: {
      type: "string",
      description: "Unique key to identify this context data",
    },
    value: { description: "The data to store" },
  },
  required: ["key", "value"],
};

const getContextSchema: JSONSchema7 = {
  type: "object",
  properties: {
    key: { type: "string", description: "Key of the context to retrieve" },
  },
  required: ["key"],
};

// JSON Schema definitions for sub-agent tools
const spawnAgentSchema: JSONSchema7 = {
  type: "object",
  properties: {
    agentId: {
      type: "string",
      description: "ID of the user-created agent to spawn",
    },
    task: {
      type: "string",
      description: "Clear task description for the agent to complete",
    },
    contextKeys: {
      type: "array",
      items: { type: "string" },
      description: "Keys of context data to pass to the sub-agent",
    },
  },
  required: ["agentId", "task"],
};

const spawnParallelAgentsSchema: JSONSchema7 = {
  type: "object",
  properties: {
    tasks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          agentId: { type: "string", description: "ID of the agent to use" },
          task: {
            type: "string",
            description: "Task description for this agent",
          },
          contextKeys: {
            type: "array",
            items: { type: "string" },
            description: "Context keys to pass to this agent",
          },
        },
        required: ["agentId", "task"],
      },
      description: "Array of parallel tasks to execute",
    },
  },
  required: ["tasks"],
};

// JSON Schema for spawning system agents
const spawnSystemAgentSchema: JSONSchema7 = {
  type: "object",
  properties: {
    agentType: {
      type: "string",
      enum: [
        "deep-research",
        "data-analysis",
        "coding",
        "computer-use",
        "web-automation",
        "documents",
      ],
      description:
        "Type of system agent to spawn: deep-research (web research with citations), data-analysis (analyze data and create visualizations), coding (build applications), computer-use (desktop automation), web-automation (browser automation), documents (create presentations/documents)",
    },
    task: {
      type: "string",
      description: "Clear task description for the agent to complete",
    },
    contextKeys: {
      type: "array",
      items: { type: "string" },
      description: "Keys of context data to pass to the agent",
    },
  },
  required: ["agentType", "task"],
};

const logger = globalLogger.withDefaults({
  message: colorize("magenta", "[Agent Orchestrator] "),
});

/**
 * Reconstructs plan state from message history
 * This is crucial for handling auto-continue after tool calls complete
 * Without this, a new request would create a fresh context and start a new plan
 *
 * @param messages - Array of model messages with tool-call and tool-result content
 * @returns Reconstructed plan state if found, null otherwise
 */
type ModelMessage = {
  role: string;
  content: string | Array<{
    type: string;
    toolName?: string;
    args?: Record<string, any>;
    toolCallId?: string;
    result?: any;
    text?: string;
  }>;
};

export function reconstructPlanFromMessages(
  messages: ModelMessage[],
): { plan: import("./agent-state").AgentPlan | null; isCompleted: boolean } {
  let plan: import("./agent-state").AgentPlan | null = null;
  const taskStatuses = new Map<string, import("./agent-state").AgentTask["status"]>();
  const taskResults = new Map<string, any>();

  for (const msg of messages) {
    // Only process assistant messages with structured content
    if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;

    for (const part of msg.content) {
      if (part.type === "tool-call") {
        // Handle createPlan tool call
        if (part.toolName === "createPlan" && part.args) {
          const args = part.args as {
            request?: string;
            tasks?: Array<{ description: string; assignedAgent?: string }>;
          };

          if (args.tasks && Array.isArray(args.tasks)) {
            const now = new Date().toISOString();
            const planId = `plan-reconstructed-${Date.now()}`;

            plan = {
              id: planId,
              request: args.request || "Reconstructed plan",
              tasks: args.tasks.map((t, i) => ({
                id: `${planId}-task-${i}`,
                description: t.description,
                status: "pending" as const,
                assignedAgent: t.assignedAgent,
                createdAt: now,
                updatedAt: now,
              })),
              status: "planning" as const,
              progress: 0,
              createdAt: now,
              updatedAt: now,
            };

            logger.info(
              `[reconstructPlanFromMessages] Found createPlan with ${args.tasks.length} tasks`,
            );
          }
        }

        // Handle updateTaskStatus tool call
        if (part.toolName === "updateTaskStatus" && part.args) {
          const args = part.args as {
            taskId?: string;
            status?: import("./agent-state").AgentTask["status"];
            result?: any;
          };

          if (args.taskId && args.status) {
            taskStatuses.set(args.taskId, args.status);
            if (args.result !== undefined) {
              taskResults.set(args.taskId, args.result);
            }
          }
        }
      }
    }
  }

  // Apply accumulated status updates to the reconstructed plan
  if (plan) {
    for (const task of plan.tasks) {
      const status = taskStatuses.get(task.id);
      if (status) {
        task.status = status;
        task.updatedAt = new Date().toISOString();
      }
      const result = taskResults.get(task.id);
      if (result !== undefined) {
        task.result = result;
      }
    }

    // Recalculate plan state
    const allCompleted = plan.tasks.every((t) => t.status === "completed");
    const anyFailed = plan.tasks.some((t) => t.status === "failed");
    const anyInProgress = plan.tasks.some((t) => t.status === "in-progress");
    const completedCount = plan.tasks.filter((t) => t.status === "completed").length;

    plan.progress = Math.round((completedCount / plan.tasks.length) * 100);

    if (allCompleted) {
      plan.status = "completed";
    } else if (anyFailed && !anyInProgress) {
      plan.status = "failed";
    } else if (anyInProgress) {
      plan.status = "executing";
    }

    logger.info(
      `[reconstructPlanFromMessages] Reconstructed plan: status=${plan.status}, progress=${plan.progress}%`,
    );
  }

  return { plan, isCompleted: plan?.status === "completed" };
}

/**
 * Wraps tools with call tracking to prevent infinite loops
 * Returns a blocked result if a tool is called too many times
 */
function wrapToolsWithCallTracking(
  tools: Record<string, Tool>,
  ctx: AgentContextManager,
): Record<string, Tool> {
  const wrappedTools: Record<string, Tool> = {};

  for (const [name, tool] of Object.entries(tools)) {
    // Skip tools that don't have execute (definition-only tools)
    if (!tool.execute) {
      wrappedTools[name] = tool;
      continue;
    }

    const originalExecute = tool.execute;
    wrappedTools[name] = {
      ...tool,
      execute: async (args: any, options: any) => {
        const { allowed, count, limit } = ctx.trackToolCall(name);

        if (!allowed) {
          logger.warn(
            `Tool ${name} blocked - called ${count} times (limit: ${limit})`,
          );
          return {
            STOP: true,
            error: `Tool "${name}" has been called ${count} times which exceeds the limit of ${limit}. This indicates a potential infinite loop.`,
            instruction:
              "Stop calling this tool and either move to the next task or provide a response to the user.",
            toolCallCounts: ctx.getToolCallCounts(),
          };
        }

        // Call the original execute
        return originalExecute(args, options);
      },
    } as Tool;
  }

  return wrappedTools;
}

/**
 * Enhanced orchestrator instructions with v6 capabilities
 * Implements autonomous task planning, execution, and tracking
 *
 * NOTE: These instructions are designed to work with the ToolLoopAgent
 * for providers that reliably follow complex prompts (e.g., Anthropic, OpenAI).
 * For other providers, use SIMPLIFIED_ORCHESTRATOR_INSTRUCTIONS instead.
 */
export const AGENT_ORCHESTRATOR_INSTRUCTIONS = `You are an autonomous AI orchestrator for Shadower.

## CRITICAL: YOU HAVE TOOLS - USE THEM!
**IMPORTANT**: You have access to callable tools/functions. When the instructions say to "call" something like \`createPlan\`, you MUST invoke the actual tool function - do NOT output the call as text or JSON in your response. The tools will execute automatically when you invoke them.

## MANDATORY FIRST ACTION: INVOKE THE createPlan TOOL
For EVERY user request, your FIRST action must be to INVOKE the \`createPlan\` tool (not output text!):
1. INVOKE \`createPlan\` tool to create a structured plan with tasks
2. THEN execute tasks one by one using \`updateTaskStatus\` tool
3. NEVER skip planning - even simple tasks need a plan for tracking

The \`createPlan\` tool takes two REQUIRED parameters:
- **request**: A string describing the user's request in your own words
- **tasks**: An array of task objects, each with a "description" field

Example of what the tool expects:
- request: "Research and summarize topic X"
- tasks: [{ description: "Search for information" }, { description: "Compile findings" }]

**DO NOT** output this as JSON text - INVOKE the createPlan tool!

## CORE CAPABILITIES
1. **PLANNING**: Break ALL requests into discrete, trackable tasks
2. **EXECUTION**: Use tools autonomously to complete tasks step-by-step
3. **DELEGATION**: Spawn sub-agents for specialized or parallel work
4. **TRACKING**: Monitor progress and modify plans dynamically
5. **CONTEXT SHARING**: Share relevant data between steps and sub-agents

## MANDATORY WORKFLOW (FOLLOW THIS EXACTLY)
1. **STEP 1 - CREATE PLAN**: Call \`createPlan\` with the user's request and task breakdown
   - Even simple requests should have at least 2-3 tasks (research, synthesize, respond)
   - Example for "tell me about X": tasks = ["Research X", "Gather key facts", "Synthesize findings"]
2. **STEP 2 - START FIRST TASK**: Call \`updateTaskStatus\` with status "in-progress" for task 1
   - **CRITICAL**: ALWAYS include \`taskDescription\` with the human-readable task name (e.g., "Research X online")
3. **STEP 3 - EXECUTE TASK**:
   - **For research tasks**: Use \`spawnSystemAgent\` with agentType "deep-research" OR use browser tools directly
   - **For other specialized tasks**: Use appropriate \`spawnSystemAgent\` or tools
   - **For simple web searches**: Use browser tools directly (browser_create_session → browser_navigate → browser_get_snapshot)
4. **STEP 4 - COMPLETE TASK**: Call \`updateTaskStatus\` with status "completed", \`taskDescription\`, and results
   - **CRITICAL**: ALWAYS include \`taskDescription\` with the human-readable task name
5. **STEP 5 - REPEAT**: Continue until all tasks are done
6. **STEP 6 - FINAL SUMMARY**: Provide comprehensive results to the user

## TASK BREAKDOWN EXAMPLES
- "Tell me about X" → ["Research X online", "Identify key facts", "Compile summary"]
  - For "Research X online": Use spawnSystemAgent with agentType="deep-research" and task="Research X"
- "Compare A vs B" → ["Research A", "Research B", "Create comparison", "Provide recommendation"]
  - For "Research A": Use spawnSystemAgent with agentType="deep-research" and task="Research A"
  - For "Research B": Use spawnSystemAgent with agentType="deep-research" and task="Research B"
- "Help me with Y" → ["Understand requirements", "Research solutions", "Implement/explain solution"]
  - For "Research solutions": Use spawnSystemAgent with agentType="deep-research" and task="Research solutions for Y"

## DELEGATION RULES - CRITICAL: USE SUB-AGENTS OR BROWSER FOR SPECIALIZED TASKS
**MANDATORY**: For tasks requiring specialized capabilities:
- **Research tasks** → Use \`spawnSystemAgent\` with agentType "deep-research" OR use browser tools directly
- **Quick web search** → Use browser tools directly: browser_create_session → browser_navigate to Google → browser_get_snapshot
- **Data analysis** → Use \`spawnSystemAgent\` with agentType "data-analysis"
- **Code generation** → Use \`spawnSystemAgent\` with agentType "coding"
- **Document creation** → Use \`spawnSystemAgent\` with agentType "documents"
- **Browser automation** → Use \`spawnSystemAgent\` with agentType "web-automation"
- **Desktop automation** → Use \`spawnSystemAgent\` with agentType "computer-use"
- **Independent tasks** → Use \`spawnParallelAgents\` for efficiency
- **Sequential tasks** → Execute one-by-one with status updates

**IMPORTANT**: This is a LOCAL desktop app - use BROWSER TOOLS for web searching! Browser tools connect to the user's REAL Chrome browser via CDP, preserving cookies and sessions. NO bot detection!

## SYSTEM AGENTS (Always Available)
Use \`spawnSystemAgent\` with agentType to delegate to specialized system agents:
- **deep-research**: Multi-step web research with source citations. Uses local Chrome DevTools for browsing.
- **data-analysis**: Analyze datasets and create interactive Plotly visualizations. Uses local code execution.
- **coding**: Build full applications from descriptions. Uses local terminal.
- **computer-use**: Desktop automation using visual understanding. Uses local terminal.
- **web-automation**: Browser automation with AI. Uses local Chrome DevTools Protocol.
- **documents**: Create presentations, documents, and spreadsheets with professional styling.

## USER-DEFINED AGENTS
Use \`spawnAgent\` for user-created agents stored in the database.

## CONTEXT SHARING
Use \`setContext\`/\`getContext\` to share information between steps.
Sub-agents receive relevant context automatically via contextKeys.

## COMPLETION
When ALL tasks are complete:
- The final \`updateTaskStatus\` with "completed" will mark the plan as done
- Provide a comprehensive summary of what was accomplished
- The system will automatically detect completion

## CRITICAL: COMPLETING THE FINAL TASK
**IMPORTANT**: Before providing your final response to the user:
1. ALWAYS call \`updateTaskStatus\` with status "completed" for the LAST task
2. The plan will NOT be marked complete until ALL tasks are explicitly completed
3. Even if you're about to provide the final answer, mark the task complete FIRST
4. Example: After synthesizing information, call \`updateTaskStatus(lastTaskId, "completed", summaryOfWork)\`

NEVER end your response without completing all tasks - the user relies on task completion to track your progress.

## CRITICAL FILE OPERATION RULES
When creating files (documents, presentations, images, code files, etc.):
1. **Use the terminal** via "desktop_command" tool to save files
2. Use shell commands or programming languages to write files directly
3. Files are saved to the local filesystem and accessible immediately
4. The user's workspace is the local machine
5. Generate content and use terminal commands to save it
6. **IMPORTANT**: ALWAYS save files to the user's WORKING DIRECTORY unless they specify otherwise
7. The working directory path is provided in the system context - use it as the base for all file operations

## CRITICAL: TEXT OUTPUT TIMING
**DO NOT output explanatory text while tools or sub-agents are executing.**
- When you call a tool (especially spawnSystemAgent), WAIT for the result before outputting text
- Do NOT say "I'll help you..." or "Let me..." before the tool completes
- Your text responses should come AFTER tool/sub-agent results are received
- The user sees tool execution in real-time - they don't need you narrating what you're about to do
- Only provide your summary/response AFTER all tool calls in a step have completed

## TASK COMPLETION AND CONTINUATION
**When all planned tasks are complete** (tool returns \`allTasksComplete: true\`):
- **ASSESS** if the user's original request is fully satisfied
- **CONTINUE** working if more tasks are needed beyond the original plan
- **PROVIDE a comprehensive response** summarizing what was accomplished when truly done
- Tasks being complete does NOT mean the user's request is complete - always verify

**When a tool is blocked** (returns explicit \`STOP: true\` with error about exceeding call limit):
- This indicates a potential infinite loop
- **STOP calling that specific tool** and move to the next task
- **DO NOT** retry the blocked tool repeatedly
- If blocked multiple times, provide your response to the user

## LOOP PREVENTION
- Do not call the same tool more than 8 times consecutively
- Do not try to re-activate completed tasks (mark as in-progress again)
- If stuck in a loop, summarize progress and ask the user for guidance

## REMEMBER
- **ALWAYS** call createPlan as your FIRST action
- **ALWAYS** update task status before and after each task
- **Use** desktop_command for terminal operations and file management
- **FOR WEB SEARCHING**: Use browser tools directly OR \`spawnSystemAgent\` with agentType "deep-research"
- **BROWSER SEARCH WORKFLOW**: browser_create_session → browser_navigate to Google → browser_get_snapshot
- **NEVER** output text explanations while waiting for tool/sub-agent results
- **COMPLETE the user's request** - task completion is a checkpoint, not the end goal
- This ensures proper tracking and user visibility into your work`;

/**
 * Simplified orchestrator instructions for models that don't follow complex prompts well.
 * This version STILL requires planning but uses clearer, more direct language.
 *
 * Key differences from full orchestrator:
 * - Simpler language and structure
 * - Same planning requirement but explained more clearly
 * - Less verbose task breakdown examples
 */
export const SIMPLIFIED_ORCHESTRATOR_INSTRUCTIONS = `You are an autonomous AI agent for Shadower. You MUST plan before acting.

## MANDATORY: ALWAYS CREATE A PLAN FIRST
For EVERY user request, you MUST follow these steps IN ORDER:

**Step 1: Create a Plan**
- Call \`createPlan\` FIRST before doing anything else
- Break the request into 2-5 simple tasks
- Example: "Search for X" → tasks: ["Search online for X", "Summarize findings"]

**Step 2: Execute Each Task**
- Call \`updateTaskStatus\` with "in-progress" before starting a task
- **For research tasks**: Use \`spawnSystemAgent\` with agentType "deep-research" OR browser tools directly
- **For quick web searches**: Use browser tools: browser_create_session → browser_navigate → browser_get_snapshot
- **For other tasks**: Use appropriate tools (desktop_command, spawnSystemAgent, etc.)
- Call \`updateTaskStatus\` with "completed" when done

**Step 3: Complete All Tasks**
- Continue until every task is marked "completed"
- Provide a final summary to the user

## EXAMPLE WORKFLOW
User asks: "Find information about React hooks"
1. Call createPlan with tasks: ["Search for React hooks info", "Compile key points"]
2. Call updateTaskStatus(taskId=task1, taskDescription="Search for React hooks info", status="in-progress")
3. Call browser_create_session to connect to Chrome
4. Call browser_navigate with url "https://www.google.com/search?q=React+hooks"
5. Call browser_get_snapshot to see search results
6. Call browser_click to visit relevant pages
7. Call browser_get_snapshot to read content
8. Call browser_close_session when done
9. Call updateTaskStatus(taskId=task1, taskDescription="Search for React hooks info", status="completed", result=searchResults)
10. Call updateTaskStatus(taskId=task2, taskDescription="Compile key points", status="in-progress")
11. Summarize the findings
12. Call updateTaskStatus(taskId=task2, taskDescription="Compile key points", status="completed", result=summary)
13. Respond to user with the summary

**IMPORTANT**: ALWAYS include \`taskDescription\` in every updateTaskStatus call for proper UI display!

## AVAILABLE TOOLS
- **createPlan**: Create your task plan (ALWAYS call this first!)
- **updateTaskStatus**: Mark tasks as in-progress/completed
- **browser_search**: ONE-SHOT web search using real Chrome (RECOMMENDED for quick searches!)
- **browser_create_session**: Connect to user's real Chrome browser (for multi-step browsing)
- **browser_navigate**: Navigate to any URL (Google, websites, etc.)
- **browser_get_snapshot**: Read page content with clickable refs
- **browser_click**: Click on elements
- **browser_close_session**: Close browser when done
- **desktop_command**: Execute terminal commands and manage files
- **spawnSystemAgent**: Delegate to specialized agents (deep-research, web-automation, computer-use, etc.)
- **setContext/getContext**: Store and retrieve information

## WEB SEARCH - USE BROWSER TOOLS!
This is a LOCAL desktop app. For web searches, you have TWO options:

**Option 1: browser_search (RECOMMENDED for quick searches)**
Just call browser_search with your query - it handles everything automatically!
\`\`\`
browser_search({ query: "charannyan kannan", engine: "google" })
\`\`\`

**Option 2: Manual browser control (for complex browsing)**
1. browser_create_session → Connect to Chrome
2. browser_navigate url="https://www.google.com/search?q=YOUR+QUERY" → Search Google directly
3. browser_get_snapshot → Read results
4. browser_click → Visit pages
5. browser_close_session → Done

### Browser Automation Tools (Chrome DevTools Protocol)
**IMPORTANT**: You must call **browser_create_session** FIRST before using any other browser tools!

- **browser_create_session**: Launch a new browser instance (CALL THIS FIRST!)
- **browser_close_session**: Close a browser session when done
- **browser_navigate**: Navigate to any website URL
- **browser_get_snapshot**: Get AI-optimized element tree with refs (like @e1, @e2) - USE THIS to understand page structure
- **browser_click**: Click elements using refs (@e1) or CSS selectors
- **browser_fill**: Fill input fields (clears existing content first)
- **browser_type**: Type text character by character
- **browser_press_key**: Press keyboard keys (Enter, Tab, Escape, etc.)
- **browser_wait**: Wait for elements to appear or page to load
- **browser_screenshot**: Take screenshots of web pages
- **browser_evaluate**: Execute JavaScript in page context
- **browser_get_content**: Get HTML content of the page
- **browser_get_context**: Get structured page context (forms, buttons, links)
- **browser_analyze_forms**: Analyze all forms on the page
- **browser_fill_form**: Fill multiple form fields at once

### Desktop Tools
- **desktop_screenshot**: Take screenshots of the desktop
- **desktop_click**: Click on desktop UI elements
- **desktop_type**: Type text on the desktop

## BROWSER AUTOMATION - YOU CAN NAVIGATE TO WEBSITES
**CRITICAL**: You HAVE browser automation tools available. Follow this workflow:

1. **Start a session**: Call **browser_create_session** to launch browser
2. **Navigate**: Use **browser_navigate** with the URL
3. **Understand the page**: Call **browser_get_snapshot** to see elements with refs
4. **Interact**: Use **browser_click** with refs like "@e1" or CSS selectors
5. **Fill forms**: Use **browser_fill** or **browser_fill_form** for inputs
6. **Extract data**: Use **browser_get_content** or **browser_evaluate** for data
7. **Close**: Call **browser_close_session** when done

**Example workflow to visit a website:**
\`\`\`
1. browser_create_session() → Gets sessionId
2. browser_navigate({ url: "https://example.com" })
3. browser_get_snapshot() → Shows elements like: button "Submit" [ref=e1]
4. browser_click({ selector: "@e1" }) → Clicks the Submit button
\`\`\`

**DO NOT** say you cannot navigate to websites. You CAN and SHOULD use these browser tools!

## FILE OPERATIONS - IMPORTANT
When creating files (documents, images, code, etc.):
1. **For files**: Use the "desktop_command" tool to run terminal commands
2. Use shell commands or programming languages to write files directly
3. Files are saved to the local filesystem and accessible immediately

## TEXT OUTPUT TIMING - CRITICAL
- Do NOT output text while tools/sub-agents are running
- WAIT for tool results before writing your response
- The user sees tool execution in real-time - no need to narrate
- Only respond AFTER tool calls complete

## CRITICAL RULES
- NEVER skip the createPlan step
- NEVER use tools without a plan
- ALWAYS update task status before AND after each task
- Complete ALL tasks before ending your response
- NEVER output text while waiting for tool results`;

/**
 * Pure agentic instructions for when planning is NOT required.
 * The agent can use tools directly without creating a plan first.
 * Planning tools are still available but not mandated.
 */
export const PURE_AGENTIC_INSTRUCTIONS = `You are an autonomous AI agent for Shadower.

## YOUR CAPABILITIES
You have access to powerful tools. Use them directly to complete the user's request.

## HOW TO WORK
1. **Understand the request** - Read what the user needs
2. **Use tools directly** - Call the appropriate tools to complete the task
3. **Provide your response** - Give the user what they asked for

## AVAILABLE TOOLS

### Web Search & Browser
- **browser_search**: Quick one-shot web search (RECOMMENDED for most searches)
- **browser_create_session**: Connect to user's real Chrome browser (for complex browsing)
- **browser_navigate**: Navigate to URLs
- **browser_get_snapshot**: Read page content with clickable refs
- **browser_click**: Click on elements
- **browser_close_session**: Close browser when done

### Desktop & Files
- **desktop_command**: Execute terminal commands and manage files
- **desktop_screenshot**: Take screenshots
- **desktop_click**: Click UI elements
- **desktop_type**: Type text

### Sub-agents (for complex tasks)
- **spawnSystemAgent**: Delegate to specialized agents
  - agentType "deep-research": In-depth multi-step web research
  - agentType "data-analysis": Analyze data and create visualizations
  - agentType "coding": Build applications
  - agentType "documents": Create presentations and documents
  - agentType "web-automation": Browser automation
  - agentType "computer-use": Desktop automation
- **spawnAgent**: Use user-created custom agents
- **spawnParallelAgents**: Run multiple agents in parallel

### Context Sharing
- **setContext/getContext**: Store and retrieve information between steps

### Optional Planning (not required)
- **createPlan**: Create a task plan (use for complex multi-step requests if helpful)
- **updateTaskStatus**: Track task progress

## WEB SEARCH
This is a LOCAL desktop app with access to the user's real Chrome browser.

**Quick search**: Use browser_search with your query
\`\`\`
browser_search({ query: "your search query", engine: "google" })
\`\`\`

**Complex browsing**: Use manual browser control
1. browser_create_session
2. browser_navigate
3. browser_get_snapshot
4. browser_click (as needed)
5. browser_close_session

## CRITICAL RULES
- **Use tools immediately** - Don't explain what you're going to do, just do it
- **Wait for results** - Don't output text while tools are running
- **Be direct** - Complete the request and provide the answer

## WHEN TO USE PLANNING
Planning is OPTIONAL but helpful for:
- Very complex multi-step requests
- Tasks that benefit from progress tracking
- Research projects with multiple phases

For simple requests, just use tools directly without a plan.`;

/**
 * Creates the agent context tools for task management
 * @param ctx - The agent context manager
 * @param dataStream - Optional data stream for UI updates
 * @param requirePlanning - Whether to include planning tools (createPlan, updateTaskStatus, etc.)
 *                          When false, only context-sharing tools (setContext, getContext) are included
 */
function createAgentContextTools(
  ctx: AgentContextManager,
  dataStream?: UIMessageStreamWriter,
  requirePlanning: boolean = true,
): Record<string, Tool> {
  // Direct Zod schema for createPlan - basic type validation only
  // NOTE: We intentionally use loose validation here (no .min(1)) so that malformed
  // inputs reach our execute function where we provide helpful error messages
  // that guide the AI to retry with correct parameters
  const createPlanZodSchema = z.object({
    request: z.string().optional(),
    tasks: z.array(
      z.object({
        description: z.string().optional(),
        assignedAgent: z.string().optional(),
        parentTaskId: z.string().optional(),
      })
    ).optional(),
  });

  const createPlanTool = createTool({
    description: `CALLABLE FUNCTION: Creates a structured execution plan for completing the user's request.

CALL THIS FUNCTION FIRST before doing anything else. This is NOT a text output - you must INVOKE this tool.

Parameters:
- request (string, REQUIRED): The user's request summarized in your own words
- tasks (array, REQUIRED): Array of task objects with 'description' field

Example invocation:
createPlan({ request: "Research and summarize topic X", tasks: [{ description: "Search for information" }, { description: "Compile findings" }] })

IMPORTANT: Do NOT output a plan as text - you MUST call this function to create the plan.`,
    inputSchema: createPlanZodSchema as z.ZodType<any>,
    execute: async ({
      request,
      tasks,
    }: {
      request?: string;
      tasks?: Array<{
        description: string;
        assignedAgent?: string;
        parentTaskId?: string;
      }>;
    }) => {
      // Log when this tool is actually called
      logger.info("🎯 createPlan tool INVOKED", {
        hasRequest: !!request,
        requestType: typeof request,
        requestPreview: typeof request === "string" ? request.slice(0, 100) : "N/A",
        hasTasks: !!tasks,
        tasksType: typeof tasks,
        tasksCount: Array.isArray(tasks) ? tasks.length : "N/A",
      });

      // CRITICAL: Validate input parameters and provide helpful error messages
      // This catches cases where the model calls the tool with empty/missing arguments
      if (!request || typeof request !== "string" || request.trim() === "") {
        logger.error(
          "createPlan called without valid 'request' parameter",
          { request, tasks },
        );

        // Emit error event for UI feedback
        if (dataStream) {
          dataStream.write({
            type: "data-plan-created",
            data: {
              planId: "error",
              request: "Error: Missing request parameter",
              tasks: [],
              status: "failed" as const,
              progress: 0,
              error: "The createPlan tool was called without required parameters. The AI will retry.",
            },
          });
        }

        return {
          error: "MISSING_REQUIRED_PARAMETER",
          message:
            "The 'request' parameter is REQUIRED and must be a non-empty string describing the user's request.",
          instruction:
            "Call createPlan again with: { request: '<user request as string>', tasks: [{ description: '<task 1>' }, { description: '<task 2>' }] }",
          example: {
            request: "Research and create a presentation about renewable energy",
            tasks: [
              { description: "Research renewable energy sources" },
              { description: "Create presentation slides" },
            ],
          },
        };
      }

      if (!tasks || !Array.isArray(tasks) || tasks.length === 0) {
        logger.error(
          "createPlan called without valid 'tasks' parameter",
          { request, tasks },
        );

        // Emit error event for UI feedback
        if (dataStream) {
          dataStream.write({
            type: "data-plan-created",
            data: {
              planId: "error",
              request: request,
              tasks: [],
              status: "failed" as const,
              progress: 0,
              error: "The createPlan tool was called without tasks. The AI will retry.",
            },
          });
        }

        return {
          error: "MISSING_REQUIRED_PARAMETER",
          message:
            "The 'tasks' parameter is REQUIRED and must be a non-empty array of task objects with 'description' fields.",
          instruction:
            "Call createPlan again with: { request: '<user request>', tasks: [{ description: '<task 1>' }, { description: '<task 2>' }] }",
          example: {
            request: request,
            tasks: [
              { description: "First step to complete the request" },
              { description: "Second step to complete the request" },
            ],
          },
        };
      }

      // Validate each task has a description
      const invalidTasks = tasks.filter(
        (t) => !t || !t.description || typeof t.description !== "string",
      );
      if (invalidTasks.length > 0) {
        logger.error("createPlan called with invalid tasks", { invalidTasks });
        return {
          error: "INVALID_TASK_FORMAT",
          message:
            "Each task must be an object with a 'description' field that is a non-empty string.",
          instruction:
            "Each task in the tasks array must have this format: { description: 'What to do' }",
          example: {
            request: request,
            tasks: [
              { description: "Research the topic" },
              { description: "Analyze findings" },
              { description: "Create summary" },
            ],
          },
        };
      }

      // Guard: Prevent creating duplicate plans
      const existingPlan = ctx.getPlan();
      if (existingPlan) {
        // STRICT GUARD: If plan exists in ANY state, do not create another
        // This prevents the agent from creating "continuation" plans after completion
        const totalTasks = existingPlan.tasks.length;

        if (existingPlan.status === "completed") {
          logger.info(
            "Attempted to create a new plan but previous plan is complete - guiding to completion",
          );
          // DO NOT send STOP - let agent decide if more work is truly needed
          return {
            message: `Plan "${existingPlan.id}" completed all ${totalTasks} tasks. Review if the user's request is fully satisfied.`,
            instruction:
              "If the user's request is complete, provide a comprehensive summary. If more work is genuinely needed beyond the original scope, describe what additional work you'll do.",
            completedTasks: existingPlan.tasks
              .filter((t) => t.status === "completed")
              .map((t) => ({ description: t.description, result: t.result })),
            planProgress: 100,
            planStatus: "completed",
            allTasksComplete: true,
          };
        }
        if (
          existingPlan.status === "planning" ||
          existingPlan.status === "executing"
        ) {
          logger.info(
            "Attempted to create a new plan but one is already in progress - guiding to existing plan",
          );
          // DO NOT send STOP signal - guide agent to continue with existing plan
          const nextPendingTask = existingPlan.tasks.find(
            (t) => t.status === "pending",
          );
          const inProgressTask = existingPlan.tasks.find(
            (t) => t.status === "in-progress",
          );
          return {
            existingPlanId: existingPlan.id,
            message: `A plan already exists and is ${existingPlan.status}. Continue working on the existing tasks.`,
            currentTasks: existingPlan.tasks.map((t) => ({
              id: t.id,
              description: t.description,
              status: t.status,
            })),
            currentTask: inProgressTask
              ? { id: inProgressTask.id, description: inProgressTask.description }
              : null,
            nextPendingTask: nextPendingTask
              ? { id: nextPendingTask.id, description: nextPendingTask.description }
              : null,
            instruction: inProgressTask
              ? `Continue working on the current task: "${inProgressTask.description}"`
              : nextPendingTask
                ? `Start the next pending task: "${nextPendingTask.description}" by updating its status to 'in-progress'`
                : "All tasks are in progress or complete. Check the plan status.",
          };
        }
      }

      const taskDefs: TaskDefinition[] = tasks.map((t) => ({
        description: t.description,
        assignedAgent: t.assignedAgent,
        parentTaskId: t.parentTaskId,
      }));

      const plan = ctx.createPlan(request, taskDefs);
      logger.info(`Created plan ${plan.id} with ${plan.tasks.length} tasks`);

      // Emit plan-created event for UI updates
      if (dataStream) {
        dataStream.write({
          type: "data-plan-created",
          data: {
            planId: plan.id,
            request,
            tasks: plan.tasks.map((t) => ({
              id: t.id,
              description: t.description,
              status: t.status,
              assignedAgent: t.assignedAgent,
            })),
            status: plan.status,
            progress: plan.progress,
          },
        });
      }

      return {
        planId: plan.id,
        taskCount: plan.tasks.length,
        tasks: plan.tasks.map((t) => ({
          id: t.id,
          description: t.description,
          status: t.status,
        })),
        message:
          "Plan created. Start executing tasks by updating their status to 'in-progress'.",
      };
    },
  });

  const updateTaskStatusTool = createTool({
    description:
      "Update the status of a task in the current plan. ALWAYS use this before and after working on a task. Cannot set completed tasks back to in-progress.",
    inputSchema: jsonSchemaToZod(updateTaskStatusSchema),
    execute: async ({
      taskId,
      status,
      result,
    }: {
      taskId: string;
      status: "in-progress" | "completed" | "failed" | "blocked";
      result?: unknown;
    }) => {
      const plan = ctx.getPlan();
      const task = ctx.getTask(taskId);

      // Guard: Prevent invalid state transitions that cause loops
      if (!task) {
        logger.warn(`Task ${taskId} not found in plan`);
        return {
          error: `Task ${taskId} not found`,
          planStatus: plan?.status ?? "unknown",
          remainingTasks: ctx.getTasksByStatus("pending").length,
        };
      }

      // Prevent re-activating completed tasks (main cause of loops)
      if (task.status === "completed" && status === "in-progress") {
        logger.info(
          `Attempted to set completed task ${taskId} back to in-progress - guiding to next task`,
        );
        const remainingTasks = ctx.getTasksByStatus("pending");
        const nextTask = remainingTasks[0];

        // If no remaining tasks, guide agent to assess completion (DO NOT force stop)
        if (remainingTasks.length === 0) {
          return {
            message: `Task "${task.description}" is already completed and all planned tasks are done.`,
            instruction:
              "Review if the user's original request is fully satisfied. If more work is needed, describe what additional tasks you'll perform. Otherwise, provide a comprehensive summary.",
            taskId,
            currentStatus: task.status,
            planProgress: plan?.progress ?? 100,
            planStatus: plan?.status ?? "completed",
            allTasksComplete: true,
          };
        }

        // Guide to next task (DO NOT force stop)
        return {
          message: `Task "${task.description}" is already completed. Cannot re-activate completed tasks.`,
          nextTask: nextTask
            ? { id: nextTask.id, description: nextTask.description }
            : null,
          instruction: nextTask
            ? `Move to the next pending task: "${nextTask.description}" (ID: ${nextTask.id})`
            : "Check the plan status.",
          taskId,
          currentStatus: task.status,
          planProgress: plan?.progress ?? 0,
          planStatus: plan?.status ?? "unknown",
          remainingTasks: remainingTasks.length,
        };
      }

      // Prevent redundant in-progress updates
      if (task.status === "in-progress" && status === "in-progress") {
        logger.info(`Task ${taskId} is already in-progress - no change needed`);
        return {
          message: `Task "${task.description}" is already in-progress. Continue working on it.`,
          taskId,
          currentStatus: task.status,
          planProgress: plan?.progress ?? 0,
          planStatus: plan?.status ?? "unknown",
          remainingTasks: ctx.getTasksByStatus("pending").length,
        };
      }

      ctx.updateTaskStatus(taskId, status, result);

      logger.info(`Task ${taskId} status updated to ${status}`);

      // Check if plan is now complete after this task update
      const updatedPlan = ctx.getPlan();
      if (updatedPlan && updatedPlan.status === "completed") {
        const completedTasks = updatedPlan.tasks.filter(
          (t) => t.status === "completed",
        ).length;
        const totalTasks = updatedPlan.tasks.length;

        logger.info(
          `Plan ${updatedPlan.id} is now COMPLETE (${completedTasks}/${totalTasks} tasks done)`,
        );

        // Emit final task-updated event for UI sync
        if (dataStream) {
          dataStream.write({
            type: "data-task-updated",
            data: {
              planId: updatedPlan.id,
              taskId,
              newStatus: status,
              taskDescription: task?.description,
              tasks: updatedPlan.tasks.map((t) => ({
                id: t.id,
                description: t.description,
                status: t.status,
                assignedAgent: t.assignedAgent,
              })),
              progress: updatedPlan.progress,
              planStatus: updatedPlan.status,
            },
          });
        }

        // CRITICAL FIX: Send STOP_AGENT_LOOP signal to prevent auto-continue loop
        // The frontend's sendAutomaticallyWhen callback checks for this signal
        // and stops the auto-continue behavior when plan is complete
        return {
          taskId,
          newStatus: status,
          taskDescription: task?.description,
          message: `All ${totalTasks} planned tasks are now complete. Provide a comprehensive summary of what was accomplished.`,
          completedTasks: updatedPlan.tasks
            .filter((t) => t.status === "completed")
            .map((t) => ({ description: t.description, result: t.result })),
          planProgress: updatedPlan.progress,
          planStatus: updatedPlan.status,
          remainingTasks: 0,
          allTasksComplete: true,
          STOP_AGENT_LOOP: true, // Signal to stop auto-continue in frontend
        };
      }

      // Emit task-updated event for UI updates
      if (dataStream && plan) {
        dataStream.write({
          type: "data-task-updated",
          data: {
            planId: plan.id,
            taskId,
            newStatus: status,
            taskDescription: task?.description,
            // Send full updated tasks array for UI sync
            tasks: plan.tasks.map((t) => ({
              id: t.id,
              description: t.description,
              status: t.status,
              assignedAgent: t.assignedAgent,
            })),
            progress: plan.progress,
            planStatus: plan.status,
          },
        });
      }

      return {
        taskId,
        newStatus: status,
        taskDescription: task?.description,
        planProgress: plan?.progress ?? 0,
        planStatus: plan?.status ?? "unknown",
        remainingTasks: ctx.getTasksByStatus("pending").length,
      };
    },
  });

  const getNextTaskTool = createTool({
    description: "Get the next pending task from the plan to work on",
    inputSchema: jsonSchemaToZod(emptySchema),
    execute: async () => {
      const task = ctx.getNextPendingTask();
      if (!task) {
        const plan = ctx.getPlan();
        return {
          message: "No pending tasks remaining",
          planStatus: plan?.status ?? "unknown",
          planProgress: plan?.progress ?? 100,
        };
      }
      return {
        taskId: task.id,
        description: task.description,
        assignedAgent: task.assignedAgent,
        hint: "Update this task to 'in-progress' before starting work",
      };
    },
  });

  const getPlanStatusTool = createTool({
    description: "Get the current plan status and progress overview",
    inputSchema: jsonSchemaToZod(emptySchema),
    execute: async () => {
      const plan = ctx.getPlan();
      if (!plan) {
        return {
          message:
            "No plan exists yet. You may create one with createPlan if needed for multi-step tasks.",
          hint: "For simple requests, you can respond directly without a plan.",
        };
      }

      const tasksByStatus = {
        pending: ctx.getTasksByStatus("pending").length,
        inProgress: ctx.getTasksByStatus("in-progress").length,
        completed: ctx.getTasksByStatus("completed").length,
        failed: ctx.getTasksByStatus("failed").length,
        blocked: ctx.getTasksByStatus("blocked").length,
      };

      // If plan is complete, tell the model to stop and respond
      if (plan.status === "completed") {
        return {
          planId: plan.id,
          request: plan.request,
          progress: 100,
          status: "completed",
          message:
            "ALL TASKS COMPLETE. Do NOT create a new plan. Provide your final response to the user now.",
          tasksByStatus,
        };
      }

      return {
        planId: plan.id,
        request: plan.request,
        progress: plan.progress,
        status: plan.status,
        tasksByStatus,
        tasks: plan.tasks.map((t) => ({
          id: t.id,
          description: t.description,
          status: t.status,
          hasResult: t.result !== undefined,
          error: t.error,
        })),
      };
    },
  });

  const setContextTool = createTool({
    description:
      "Store information to share between steps or with sub-agents. Use for important intermediate results.",
    inputSchema: jsonSchemaToZod(setContextSchema),
    execute: async ({ key, value }: { key: string; value: unknown }) => {
      ctx.setSharedContext(key, value);
      logger.debug(`Context set: ${key}`);
      return {
        stored: key,
        message:
          "Context stored successfully. Sub-agents can access this via contextKeys.",
      };
    },
  });

  const getContextTool = createTool({
    description: "Retrieve previously stored context by key",
    inputSchema: jsonSchemaToZod(getContextSchema),
    execute: async ({ key }: { key: string }) => {
      const value = ctx.getSharedContext(key);
      if (value === undefined) {
        return { key, found: false, message: "Context not found for this key" };
      }
      return { key, found: true, value };
    },
  });

  const getAllContextTool = createTool({
    description: "Get all stored context data",
    inputSchema: jsonSchemaToZod(emptySchema),
    execute: async () => {
      const allContext = ctx.getAllSharedContext();
      const keys = Object.keys(allContext);
      return {
        contextCount: keys.length,
        keys,
        context: allContext,
      };
    },
  });

  // Context-sharing tools are always available
  const contextTools: Record<string, Tool> = {
    setContext: setContextTool as Tool,
    getContext: getContextTool as Tool,
    getAllContext: getAllContextTool as Tool,
  };

  // Planning tools only included when requirePlanning is true
  if (requirePlanning) {
    return {
      ...contextTools,
      createPlan: createPlanTool as Tool,
      updateTaskStatus: updateTaskStatusTool as Tool,
      getNextTask: getNextTaskTool as Tool,
      getPlanStatus: getPlanStatusTool as Tool,
    };
  }

  // Pure agentic mode - no planning tools, just context sharing
  return contextTools;
}

/**
 * Creates sub-agent spawning tools with context sharing and streaming support
 */
function createSubAgentTools(
  config: OrchestratorConfig,
  ctx: AgentContextManager,
  dataStream?: UIMessageStreamWriter,
): Record<string, Tool> {
  const { userId, threadId, mcpTools, availableTools, chatModel, model: configModel } = config;

  /**
   * Helper to execute a sub-agent with streamText for real-time streaming
   * Uses stopWhen for multi-step tool loop execution
   * @param tools - The tools to make available to this sub-agent
   */
  async function executeSubAgentWithStreaming(
    agentId: string,
    agentName: string,
    task: string,
    systemPrompt: string,
    maxSteps: number,
    tools: Record<string, Tool> = mcpTools,
  ): Promise<{
    result: string;
    steps: number;
    success: boolean;
    error?: string;
  }> {
    // CRITICAL: Use pre-configured model with API keys from config
    const model = configModel || customModelProvider.getModel(chatModel);

    if (!configModel) {
      logger.warn(
        `[Sub-Agent ${agentName}] No pre-configured model passed - using customModelProvider. ` +
        `This may fail if API keys are not set in environment variables.`
      );
    }

    // Emit sub-agent start event
    if (dataStream) {
      dataStream.write({
        type: "data-sub-agent-start",
        data: { agentId, agentName, task: task.slice(0, 100) },
      });
    }

    // Log the tools being passed to the sub-agent
    const toolNames = Object.keys(tools);
    logger.info(
      `[Sub-Agent ${agentName}] Starting streamText with ${toolNames.length} tools: ${toolNames.slice(0, 10).join(", ")}${toolNames.length > 10 ? "..." : ""}`,
    );

    try {
      // Track accumulated text and tool results
      let accumulatedText = "";
      let lastToolResults: any[] = [];
      let stepCount = 0;

      // Helper to serialize tool results for streaming
      const serializeResult = (toolName: string, result: any): string | undefined => {
        if (result === undefined || result === null) {
          return undefined;
        }

        const toolNameLower = (toolName || "").toLowerCase();
        const isBrowserOrDesktop =
          (toolNameLower.startsWith("browser") && toolNameLower !== "browser") ||
          (toolNameLower.startsWith("desktop") && toolNameLower !== "desktop");
        const isWebSearch =
          toolNameLower === "websearch" || toolNameLower === "web_search" ||
          toolNameLower === "webcontent" || toolNameLower === "web_content";

        try {
          if (typeof result === "string") {
            try {
              const parsed = JSON.parse(result);
              return JSON.stringify(parsed);
            } catch {
              return result;
            }
          }

          if (typeof result === "object") {
            if (isBrowserOrDesktop || isWebSearch) {
              return JSON.stringify(result);
            }
            return JSON.stringify(result).slice(0, 1000);
          }

          return String(result);
        } catch (err) {
          logger.error(`[Sub-Agent ${agentName}] Serialization error for ${toolName}:`, err);
          return JSON.stringify({ success: true, message: "Result exists" });
        }
      };

      // Use streamText with stopWhen for multi-step tool loop
      const streamResult = streamText({
        model,
        system: systemPrompt,
        prompt: task,
        tools,
        toolChoice: "auto",
        stopWhen: stepCountIs(maxSteps),
        onChunk: ({ chunk }) => {
          // Forward text deltas to parent stream in real-time
          if (dataStream && chunk.type === "text-delta") {
            accumulatedText += chunk.text;
            dataStream.write({
              type: "data-sub-agent-text",
              data: { agentId, text: chunk.text },
            });
          }
        },
        onStepFinish: async ({ toolCalls, toolResults }) => {
          stepCount++;
          logger.info(
            `[Sub-Agent ${agentName}] Step ${stepCount}: ${toolCalls?.length || 0} tool calls, ` +
            `${toolResults?.length || 0} tool results`
          );

          // Store tool results for fallback
          if (toolResults && toolResults.length > 0) {
            lastToolResults = toolResults;
          }

          // Forward tool calls with results to parent stream
          if (dataStream && toolCalls && toolCalls.length > 0) {
            for (let i = 0; i < toolCalls.length; i++) {
              const toolCall = toolCalls[i];
              // In streamText, toolResults[i] is the direct result value
              const toolResult = toolResults?.[i];

              const serializedResult = serializeResult(toolCall.toolName, toolResult);

              logger.info(
                `[Sub-Agent ${agentName}] Tool: ${toolCall.toolName}, ` +
                `hasResult: ${toolResult !== undefined}, ` +
                `serialized: ${serializedResult ? serializedResult.slice(0, 100) : 'none'}...`
              );

              dataStream.write({
                type: "data-sub-agent-tool-call",
                data: {
                  agentId,
                  toolName: toolCall.toolName,
                  args: "args" in toolCall ? toolCall.args : undefined,
                  result: serializedResult,
                  timestamp: Date.now(),
                },
              });
            }
          }
        },
      });

      // Wait for stream completion
      let finalResult: string;
      let steps: number;

      try {
        const [textResult, stepsResult] = await Promise.all([
          streamResult.text,
          streamResult.steps,
        ]);

        finalResult = textResult || "";
        steps = stepsResult.length;

        // If no text but have tool results, build result from them
        if (!finalResult && lastToolResults.length > 0) {
          const resultStrings = lastToolResults
            .map((tr: any) => {
              if (typeof tr === "string") return tr;
              if (tr && typeof tr === "object") {
                if (tr.result !== undefined) {
                  return typeof tr.result === "string" ? tr.result : JSON.stringify(tr.result);
                }
                if (tr.message) return tr.message;
                if (tr.error) return `Error: ${tr.error}`;
                return JSON.stringify(tr).slice(0, 500);
              }
              return String(tr);
            })
            .filter(Boolean);

          finalResult = resultStrings.length > 0
            ? resultStrings.join("\n\n")
            : accumulatedText || `Sub-agent completed ${steps} step(s) successfully.`;
        } else if (!finalResult) {
          finalResult = accumulatedText || `Sub-agent completed ${steps} step(s) successfully.`;
        }
      } catch (streamError: any) {
        logger.warn(`[Sub-Agent ${agentName}] Stream error:`, streamError);
        steps = stepCount;
        finalResult = accumulatedText || `Sub-agent completed with stream error: ${streamError?.message || 'unknown'}`;
      }

      // Emit completion event
      if (dataStream) {
        dataStream.write({
          type: "data-sub-agent-complete",
          data: { agentId, agentName, success: true, result: finalResult },
        });
      }

      logger.info(
        `[Sub-Agent ${agentName}] Completed with ${steps} steps, result length: ${finalResult.length}`,
      );

      return {
        result: finalResult,
        steps,
        success: true,
      };
    } catch (err: any) {
      // Emit error event
      if (dataStream) {
        dataStream.write({
          type: "data-sub-agent-error",
          data: {
            agentId,
            error: err?.message || String(err),
          },
        });
      }

      logger.error(`[Sub-Agent ${agentName}] Failed:`, err);

      const errorMessage =
        err?.message ||
        err?.toString() ||
        "Unknown error occurred during sub-agent execution";

      return {
        result: `Sub-agent failed: ${errorMessage}`,
        steps: 0,
        success: false,
        error: errorMessage,
      };
    }
  }

  const spawnAgentTool = createTool({
    description:
      "Spawn an agent to handle a specific task. Can spawn user-defined agents by ID or system agents (use spawnSystemAgent for system agents).",
    inputSchema: jsonSchemaToZod(spawnAgentSchema),
    execute: async ({
      agentId,
      task,
      contextKeys,
    }: {
      agentId: string;
      task: string;
      contextKeys?: string[];
    }) => {
      logger.info(
        `Spawning agent ${agentId} for task: ${task.slice(0, 50)}...`,
      );

      // Check if this is a system agent
      if (isSystemAgent(agentId)) {
        const systemAgent = getSystemAgent(agentId);
        if (!systemAgent) {
          return {
            agentId,
            agentName: "unknown",
            result: "",
            error: "System agent not found.",
          };
        }

        const instructions = getSystemAgentInstructions(agentId);

        // Get system agent requirements and build appropriate tools
        const requirements = getSystemAgentRequirements(agentId);
        const systemAgentTools: Record<string, Tool> = { ...mcpTools };

        // CRITICAL: Add ONLY context-sharing tools (setContext/getContext) for inter-agent communication
        // Sub-agents should NOT have planning tools (createPlan, updateTaskStatus) - only the main orchestrator plans
        const contextToolsForSubAgent = createAgentContextTools(ctx);
        const safeContextTools = {
          setContext: contextToolsForSubAgent.setContext,
          getContext: contextToolsForSubAgent.getContext,
          getAllContext: contextToolsForSubAgent.getAllContext,
        };
        Object.assign(systemAgentTools, safeContextTools);

        if (availableTools) {
          if (requirements.browser) {
            // Use context-aware browser tools that pre-inject userId and threadId
            // This prevents the AI from inventing fake UUIDs like "user_1234"
            const contextAwareBrowserTools = createBrowserToolsWithContext(
              userId,
              threadId || null,
            );
            Object.assign(systemAgentTools, contextAwareBrowserTools);

            // Also add webSearch and webContent from availableTools
            for (const [name, tool] of Object.entries(availableTools)) {
              if (name === "webSearch" || name === "webContent") {
                systemAgentTools[name] = tool;
              }
            }
          }
          if (requirements.desktop) {
            // Desktop tools (GUI automation): desktopScreenshot, desktopClick, desktopType, etc.
            for (const [name, tool] of Object.entries(availableTools)) {
              if (name.startsWith("desktop")) {
                systemAgentTools[name] = tool;
              }
            }
          }
          // Terminal/shell execution tools - CRITICAL for most agents
          if (requirements.terminal) {
            for (const [name, tool] of Object.entries(availableTools)) {
              // Include shell execution tools
              if (
                name === "desktopCommand" ||
                name.includes("terminal") ||
                name.includes("command") ||
                name.includes("execute")
              ) {
                systemAgentTools[name] = tool;
              }
              // Include file operation tools
              if (
                name.includes("file_") ||
                name.includes("local_file")
              ) {
                systemAgentTools[name] = tool;
              }
            }
          }
          if (requirements.codeExecution) {
            // Local code execution: visualization, data analysis, and document tools
            for (const [name, tool] of Object.entries(availableTools)) {
              if (
                name.startsWith("create") || // createVisualization, createPieChart, createPresentation, etc.
                name.startsWith("edit") ||   // editSpreadsheet, editPresentation, editDocument
                name.startsWith("profile") || // profileData
                name.startsWith("analyze") || // analyzeData
                name.startsWith("list")       // listDocumentPalettes
              ) {
                systemAgentTools[name] = tool;
              }
            }
          }
        }

        const subAgentContext = gatherContextForSubAgent(ctx, contextKeys);
        const contextPrompt =
          Object.keys(subAgentContext).length > 0
            ? `\n\n## CONTEXT FROM PARENT AGENT\n${JSON.stringify(subAgentContext, null, 2)}`
            : "";

        const systemPrompt = instructions
          ? buildAgentSystemPrompt(instructions) + contextPrompt
          : contextPrompt;

        const { result, steps, success, error } =
          await executeSubAgentWithStreaming(
            agentId,
            systemAgent.name,
            task,
            systemPrompt,
            20,
            systemAgentTools,
          );

        return {
          agentId,
          agentName: systemAgent.name,
          result,
          steps,
          success,
          ...(error && { error }),
        };
      }

      // Otherwise, look up user-defined agent
      const agent = await agentRepository.selectAgentById(agentId, userId);
      if (!agent) {
        if (dataStream) {
          dataStream.write({
            type: "data-sub-agent-error",
            data: { agentId, error: "Agent not found" },
          });
        }
        return {
          agentId,
          agentName: "unknown",
          result: "",
          error: "Agent not found. Check the agent ID and try again.",
        };
      }

      // Gather context for sub-agent
      const subAgentContext = gatherContextForSubAgent(ctx, contextKeys);
      const contextPrompt =
        Object.keys(subAgentContext).length > 0
          ? `\n\n## CONTEXT FROM PARENT AGENT\n${JSON.stringify(subAgentContext, null, 2)}`
          : "";

      const systemPrompt =
        buildAgentSystemPrompt(agent.instructions) + contextPrompt;

      // Build tools for user agent - combine mcpTools with availableTools
      // This ensures user agents have access to webSearch, browser, desktop, etc.
      const userAgentTools: Record<string, Tool> = { ...mcpTools };

      // CRITICAL: Add ONLY context-sharing tools (setContext/getContext) for inter-agent communication
      // Sub-agents should NOT have planning tools (createPlan, updateTaskStatus) - only the main orchestrator plans
      const contextToolsForSubAgent = createAgentContextTools(ctx);
      const safeContextTools = {
        setContext: contextToolsForSubAgent.setContext,
        getContext: contextToolsForSubAgent.getContext,
        getAllContext: contextToolsForSubAgent.getAllContext,
      };
      Object.assign(userAgentTools, safeContextTools);

      if (availableTools) {
        Object.assign(userAgentTools, availableTools);
      }

      logger.info(
        `[User Agent ${agent.name}] Built ${Object.keys(userAgentTools).length} tools (including context tools) for execution`,
      );

      const { result, steps, success, error } =
        await executeSubAgentWithStreaming(
          agentId,
          agent.name,
          task,
          systemPrompt,
          15,
          userAgentTools, // Pass the full toolset!
        );

      return {
        agentId,
        agentName: agent.name,
        result,
        steps,
        success,
        ...(error && { error }),
      };
    },
  });

  const spawnParallelAgentsTool = createTool({
    description:
      "Execute multiple agent tasks simultaneously. Use when tasks are independent and can run in parallel for efficiency.",
    inputSchema: jsonSchemaToZod(spawnParallelAgentsSchema),
    execute: async ({
      tasks,
    }: {
      tasks: Array<{ agentId: string; task: string; contextKeys?: string[] }>;
    }) => {
      logger.info(`Spawning ${tasks.length} agents in parallel`);

      // Use Promise.allSettled to ensure partial failures don't crash all tasks
      const settledResults = await Promise.allSettled(
        tasks.map(async ({ agentId, task, contextKeys }) => {
          // Check if this is a system agent FIRST (system agents are not in the database)
          if (isSystemAgent(agentId)) {
            const systemAgent = getSystemAgent(agentId);
            if (!systemAgent) {
              if (dataStream) {
                dataStream.write({
                  type: "data-sub-agent-error",
                  data: { agentId, error: "System agent not found" },
                });
              }
              return {
                agentId,
                agentName: "unknown",
                result: "",
                error: "System agent not found",
                success: false,
              };
            }

            const instructions = getSystemAgentInstructions(agentId);
            const requirements = getSystemAgentRequirements(agentId);
            const systemAgentTools: Record<string, Tool> = { ...mcpTools };

            // Add context-sharing tools
            const contextToolsForSystemAgent = createAgentContextTools(ctx);
            Object.assign(systemAgentTools, {
              setContext: contextToolsForSystemAgent.setContext,
              getContext: contextToolsForSystemAgent.getContext,
              getAllContext: contextToolsForSystemAgent.getAllContext,
            });

            // Add tools based on system agent requirements
            if (availableTools) {
              if (requirements.browser) {
                const contextAwareBrowserTools = createBrowserToolsWithContext(
                  userId,
                  threadId || null,
                );
                Object.assign(systemAgentTools, contextAwareBrowserTools);
                for (const [name, tool] of Object.entries(availableTools)) {
                  if (name === "webSearch" || name === "webContent") {
                    systemAgentTools[name] = tool;
                  }
                }
              }
              if (requirements.desktop) {
                for (const [name, tool] of Object.entries(availableTools)) {
                  if (name.startsWith("desktop")) {
                    systemAgentTools[name] = tool;
                  }
                }
              }
              if (requirements.terminal) {
                for (const [name, tool] of Object.entries(availableTools)) {
                  if (
                    name === "desktopCommand" ||
                    name.includes("terminal") ||
                    name.includes("command") ||
                    name.includes("execute") ||
                    name.includes("file_") ||
                    name.includes("local_file")
                  ) {
                    systemAgentTools[name] = tool;
                  }
                }
              }
              if (requirements.codeExecution) {
                for (const [name, tool] of Object.entries(availableTools)) {
                  if (
                    name.startsWith("create") ||
                    name.startsWith("edit") ||
                    name.startsWith("profile") ||
                    name.startsWith("analyze") ||
                    name.startsWith("list")
                  ) {
                    systemAgentTools[name] = tool;
                  }
                }
              }
            }

            const subAgentContext = gatherContextForSubAgent(ctx, contextKeys);
            const contextPrompt =
              Object.keys(subAgentContext).length > 0
                ? `\n\n## CONTEXT FROM PARENT AGENT\n${JSON.stringify(subAgentContext, null, 2)}`
                : "";

            const systemPrompt = instructions
              ? buildAgentSystemPrompt(instructions) + contextPrompt
              : contextPrompt;

            const { result, steps, success, error } =
              await executeSubAgentWithStreaming(
                agentId,
                systemAgent.name,
                task,
                systemPrompt,
                10,
                systemAgentTools,
              );

            return {
              agentId,
              agentName: systemAgent.name,
              result,
              steps,
              success,
              ...(error && { error }),
            };
          }

          // Handle user-defined agents (lookup from database)
          const agent = await agentRepository.selectAgentById(agentId, userId);
          if (!agent) {
            if (dataStream) {
              dataStream.write({
                type: "data-sub-agent-error",
                data: { agentId, error: "Agent not found" },
              });
            }
            return {
              agentId,
              agentName: "unknown",
              result: "",
              error: "Agent not found. Check the agent ID and try again.",
              success: false,
            };
          }

          const subAgentContext = gatherContextForSubAgent(ctx, contextKeys);
          const contextPrompt =
            Object.keys(subAgentContext).length > 0
              ? `\n\n## CONTEXT FROM PARENT AGENT\n${JSON.stringify(subAgentContext, null, 2)}`
              : "";

          const systemPrompt =
            buildAgentSystemPrompt(agent.instructions) + contextPrompt;

          // Build tools for parallel user agent - combine mcpTools with availableTools
          // Add ONLY context-sharing tools (setContext/getContext), NOT planning tools
          const userAgentTools: Record<string, Tool> = { ...mcpTools };
          const contextToolsForSubAgent = createAgentContextTools(ctx);
          const safeContextTools = {
            setContext: contextToolsForSubAgent.setContext,
            getContext: contextToolsForSubAgent.getContext,
            getAllContext: contextToolsForSubAgent.getAllContext,
          };
          Object.assign(userAgentTools, safeContextTools);
          if (availableTools) {
            Object.assign(userAgentTools, availableTools);
          }

          const { result, steps, success, error } =
            await executeSubAgentWithStreaming(
              agentId,
              agent.name,
              task,
              systemPrompt,
              10,
              userAgentTools, // Pass the full toolset with context tools!
            );

          return {
            agentId,
            agentName: agent.name,
            result,
            steps,
            success,
            ...(error && { error }),
          };
        }),
      );

      // Extract results from settled promises, handling both fulfilled and rejected
      const results = settledResults.map((settled, index) => {
        if (settled.status === "fulfilled") {
          return settled.value;
        }
        // Handle rejected promises
        const task = tasks[index];
        const errorMessage = settled.reason?.message || String(settled.reason);
        logger.error(`Parallel agent ${task.agentId} failed:`, settled.reason);
        if (dataStream) {
          dataStream.write({
            type: "data-sub-agent-error",
            data: { agentId: task.agentId, error: errorMessage },
          });
        }
        return {
          agentId: task.agentId,
          agentName: "unknown",
          result: "",
          error: errorMessage,
          success: false,
        };
      });

      const completed = results.filter((r) => r.success).length;
      logger.info(
        `Parallel execution complete: ${completed}/${tasks.length} succeeded`,
      );

      return {
        totalTasks: tasks.length,
        completed,
        failed: tasks.length - completed,
        results,
      };
    },
  });

  /**
   * Spawn a system agent (pre-built, always available)
   */
  const spawnSystemAgentTool = createTool({
    description:
      "MANDATORY for specialized tasks: Spawn a system agent for research, analysis, coding, automation, or document creation. ALWAYS use this for research tasks instead of webSearch directly. System agents are pre-built and always available: deep-research (web research with citations - USE THIS FOR ALL RESEARCH TASKS), data-analysis (data + visualizations), coding (build apps), computer-use (desktop automation), web-automation (browser automation), documents (create docs/presentations).",
    inputSchema: jsonSchemaToZod(spawnSystemAgentSchema),
    execute: async ({
      agentType,
      task,
      contextKeys,
    }: {
      agentType: string;
      task: string;
      contextKeys?: string[];
    }) => {
      const systemAgentId = `system-${agentType}`;
      logger.info(
        `Spawning system agent ${systemAgentId} for task: ${task.slice(0, 50)}...`,
      );

      const systemAgent = getSystemAgent(systemAgentId);
      if (!systemAgent) {
        if (dataStream) {
          dataStream.write({
            type: "data-sub-agent-error",
            data: { agentId: systemAgentId, error: "System agent not found" },
          });
        }
        return {
          agentId: systemAgentId,
          agentName: agentType,
          result: "",
          error: `System agent '${agentType}' not found. Valid types: deep-research, data-analysis, coding, computer-use, web-automation, documents`,
        };
      }

      // Get system agent instructions
      const instructions = getSystemAgentInstructions(systemAgentId);

      // Get system agent requirements and build appropriate tools
      const requirements = getSystemAgentRequirements(systemAgentId);

      // Build tools for this system agent based on requirements
      // Start with mcpTools as base, then add required tools from availableTools
      const systemAgentTools: Record<string, Tool> = { ...mcpTools };

      // CRITICAL: Add ONLY context-sharing tools (setContext/getContext) for inter-agent communication
      // Sub-agents should NOT have planning tools (createPlan, updateTaskStatus) - only the main orchestrator plans
      // Giving sub-agents createPlan causes them to create nested plans and get stuck without prepareStep guidance
      const contextToolsForSubAgent = createAgentContextTools(ctx);
      // Only include context-sharing tools, NOT planning tools
      const safeContextTools = {
        setContext: contextToolsForSubAgent.setContext,
        getContext: contextToolsForSubAgent.getContext,
        getAllContext: contextToolsForSubAgent.getAllContext,
      };
      Object.assign(systemAgentTools, safeContextTools);
      logger.info(
        `[System Agent ${systemAgentId}] Added context-sharing tools (no planning): ${Object.keys(safeContextTools).join(", ")}`,
      );

      // Add tools from availableTools based on agent requirements
      if (availableTools) {
        // Browser tools (local Chrome DevTools) for deep-research, web-automation
        // Use context-aware browser tools that pre-inject userId and threadId
        // This prevents the AI from inventing fake UUIDs like "user_1234"
        if (requirements.browser) {
          const contextAwareBrowserTools = createBrowserToolsWithContext(
            userId,
            threadId || null,
          );
          Object.assign(systemAgentTools, contextAwareBrowserTools);

          // Also add webSearch and webContent from availableTools
          for (const [name, tool] of Object.entries(availableTools)) {
            if (name === "webSearch" || name === "webContent") {
              systemAgentTools[name] = tool;
            }
          }
          logger.info(
            `[System Agent ${systemAgentId}] Added context-aware browser tools for Chrome DevTools requirement`,
          );
        }

        // Desktop tools for local GUI automation requirement (computer-use)
        // Tool names: desktopScreenshot, desktopClick, desktopType, desktopPress, etc.
        if (requirements.desktop) {
          for (const [name, tool] of Object.entries(availableTools)) {
            if (name.startsWith("desktop")) {
              systemAgentTools[name] = tool;
            }
          }
          logger.info(
            `[System Agent ${systemAgentId}] Added desktop tools for GUI automation requirement`,
          );
        }

        // Terminal/shell execution tools - CRITICAL for most agents
        // Tool names: desktopCommand, terminal_execute, file_read, file_write, etc.
        if (requirements.terminal) {
          for (const [name, tool] of Object.entries(availableTools)) {
            // Include shell execution tools
            if (
              name === "desktopCommand" ||
              name.includes("terminal") ||
              name.includes("command") ||
              name.includes("execute")
            ) {
              systemAgentTools[name] = tool;
            }
            // Include file operation tools
            if (
              name.includes("file_") ||
              name.includes("local_file")
            ) {
              systemAgentTools[name] = tool;
            }
          }
          logger.info(
            `[System Agent ${systemAgentId}] Added terminal/shell tools for execution requirement`,
          );
        }

        // Visualization and document tools for local code execution requirement (data-analysis, coding, documents)
        // Tool names: createVisualization, createPieChart, profileData, analyzeData,
        // editSpreadsheet, editPresentation, editDocument, listDocumentPalettes, etc.
        if (requirements.codeExecution) {
          for (const [name, tool] of Object.entries(availableTools)) {
            if (
              name.startsWith("create") || // createVisualization, createPieChart, createPresentation, etc.
              name.startsWith("edit") ||   // editSpreadsheet, editPresentation, editDocument
              name.startsWith("profile") || // profileData
              name.startsWith("analyze") || // analyzeData
              name.startsWith("list")       // listDocumentPalettes
            ) {
              systemAgentTools[name] = tool;
            }
          }
          logger.info(
            `[System Agent ${systemAgentId}] Added code execution and document tools for local execution requirement`,
          );
        }
      }

      logger.info(
        `[System Agent ${systemAgentId}] Total tools: ${Object.keys(systemAgentTools).length}`,
      );

      // Gather context for sub-agent
      const subAgentContext = gatherContextForSubAgent(ctx, contextKeys);
      const contextPrompt =
        Object.keys(subAgentContext).length > 0
          ? `\n\n## CONTEXT FROM PARENT AGENT\n${JSON.stringify(subAgentContext, null, 2)}`
          : "";

      const systemPrompt = instructions
        ? buildAgentSystemPrompt(instructions) + contextPrompt
        : contextPrompt;

      const { result, steps, success, error } =
        await executeSubAgentWithStreaming(
          systemAgentId,
          systemAgent.name,
          task,
          systemPrompt,
          20, // System agents get more steps
          systemAgentTools, // Pass the built tools
        );

      return {
        agentId: systemAgentId,
        agentName: systemAgent.name,
        agentType,
        result,
        steps,
        success,
        ...(error && { error }),
      };
    },
  });

  return {
    spawnAgent: spawnAgentTool as Tool,
    spawnParallelAgents: spawnParallelAgentsTool as Tool,
    spawnSystemAgent: spawnSystemAgentTool as Tool,
  };
}

/**
 * Build system prompt from agent instructions
 * Handles null/undefined instructions gracefully
 */
function buildAgentSystemPrompt(instructions: {
  role?: string;
  systemPrompt?: string;
} | null | undefined): string {
  // Guard against null/undefined instructions
  if (!instructions) {
    return "";
  }

  const parts: string[] = [];

  if (instructions.role) {
    parts.push(`You are: ${instructions.role}`);
  }

  if (instructions.systemPrompt) {
    parts.push(instructions.systemPrompt);
  }

  return parts.join("\n\n");
}

/**
 * Checks if the agent plan is complete
 * Returns false if no plan exists - agent should continue until it creates one
 * Only returns true when a plan exists AND is explicitly marked complete/failed
 */
export function isPlanComplete(ctx: AgentContextManager): boolean {
  const plan = ctx.getPlan();

  // If no plan exists, DON'T stop - let the agent create one or continue working
  // The stepCountIs(maxSteps) will be the fallback stop condition
  if (!plan) return false;

  return plan.status === "completed" || plan.status === "failed";
}

/**
 * Configuration for creating an autonomous agent
 */
export interface AutonomousAgentConfig extends OrchestratorConfig {
  /** Persisted state to resume from (optional) */
  persistedState?: AgentState | null;
  /** Callback when state should be persisted */
  onPersistState?: (state: AgentStateUpdate) => Promise<void>;
  /** DataStream for forwarding sub-agent events to the UI */
  dataStream?: UIMessageStreamWriter;
  /** Continuous mode: don't stop on plan completion, run until maxSteps */
  continuousMode?: boolean;
  /**
   * Whether planning is required (forces createPlan on step 0).
   * When false, the agent works in pure agentic mode without mandatory planning.
   * Default: false (pure agentic mode)
   */
  requirePlanning?: boolean;
  /** Messages for plan reconstruction (handles stateless auto-continue) */
  messages?: Array<{
    role: string;
    content: string | Array<{
      type: string;
      toolName?: string;
      args?: Record<string, any>;
      toolCallId?: string;
      result?: any;
      text?: string;
    }>;
  }>;
}

/**
 * Creates a true autonomous agent using AI SDK v6 ToolLoopAgent
 * This implements the agent loop pattern for autonomous execution
 */
export function createAutonomousAgent(config: AutonomousAgentConfig): {
  agent: ToolLoopAgent<never, Record<string, Tool>>;
  contextManager: AgentContextManager;
  agentStateId?: string;
} {
  const {
    availableTools,
    mcpTools,
    userAgent,
    maxSteps = 50,
    persistedState,
    onPersistState,
    dataStream,
    continuousMode = false,
    requirePlanning = false, // Default: pure agentic mode (no mandatory planning)
    messages,
  } = config;

  // Create or restore context manager
  const ctx = createAgentContext();

  // Restore state if resuming
  let planAlreadyComplete = false;
  if (persistedState?.planData || persistedState?.sharedContext) {
    ctx.deserialize(
      JSON.stringify({
        plan: persistedState.planData,
        sharedContext: persistedState.sharedContext,
      }),
    );
    logger.info(
      `Restored agent state: ${persistedState.id}, progress: ${persistedState.planData?.progress ?? 0}%`,
    );

    // Check if we're resuming a completed plan
    if (persistedState.planData?.status === "completed") {
      planAlreadyComplete = true;
      logger.info("Restored plan is already COMPLETE - will block new plans");
    }
  } else if (requirePlanning && messages && messages.length > 0) {
    // Only reconstruct plan when planning is required (research toolkit enabled)
    // Skip entirely in pure agentic mode - no planning at all
    const { plan, isCompleted } = reconstructPlanFromMessages(messages);
    if (plan) {
      ctx.restorePlan(plan);
      logger.info(
        `Reconstructed plan from messages: status=${plan.status}, progress=${plan.progress}%`,
      );

      if (isCompleted) {
        planAlreadyComplete = true;
        logger.info("Reconstructed plan is already COMPLETE - will block new plans");
      }
    }
  }

  // Build system prompt based on whether planning is required
  // When requirePlanning is false: Use pure agentic instructions (no mandatory planning)
  // When requirePlanning is true: Use full orchestrator instructions (mandatory planning)
  const baseInstructions = requirePlanning
    ? AGENT_ORCHESTRATOR_INSTRUCTIONS
    : PURE_AGENTIC_INSTRUCTIONS;

  let systemPrompt = baseInstructions;

  // Add agent-specific instructions if provided
  if (userAgent?.instructions) {
    const agentPrompt = buildAgentSystemPrompt(userAgent.instructions);
    systemPrompt = `${agentPrompt}\n\n---\n\n${baseInstructions}`;
  }

  // If plan is already complete, add a strong directive to NOT create new plans
  if (planAlreadyComplete) {
    systemPrompt = `CRITICAL INSTRUCTION - READ THIS FIRST:
A previous execution plan for this conversation is ALREADY COMPLETE (100% done).
You MUST NOT call createPlan or create new tasks.
Simply summarize what was accomplished and respond to any follow-up questions directly.

${systemPrompt}`;
  }

  logger.info(`[createAutonomousAgent] Mode: ${requirePlanning ? "PLANNING REQUIRED" : "PURE AGENTIC"}`);

  // Create all tools (pass dataStream for plan/task/sub-agent streaming)
  // When requirePlanning is false, planning tools (createPlan, updateTaskStatus) are NOT included
  const contextTools = createAgentContextTools(ctx, dataStream, requirePlanning);
  const subAgentTools = createSubAgentTools(config, ctx, dataStream);

  // Combine all tools
  const combinedTools: Record<string, Tool> = {
    ...availableTools,
    ...mcpTools,
    ...contextTools,
    ...subAgentTools,
  };

  // Wrap ALL tools with call tracking to prevent infinite loops
  const allTools = wrapToolsWithCallTracking(combinedTools, ctx);

  // Track step count for persistence
  let stepCount = persistedState?.stepsExecuted ?? 0;

  /**
   * AI SDK 6 prepareStep - Dynamic per-step configuration
   *
   * When requirePlanning is TRUE:
   *   Force createPlan on step 0 if no plan exists
   *
   * When requirePlanning is FALSE (pure agentic mode):
   *   Let the agent use tools freely without mandatory planning
   *
   * FIXED: Also force text-only when plan is completed to prevent looping
   */
  const agentPrepareStep: PrepareStepFunction<ToolSet> = ({ steps, stepNumber }) => {
    const plan = ctx.getPlan();

    // Step 0: FORCE createPlan ONLY if requirePlanning is true and no plan exists
    if (requirePlanning && stepNumber === 0 && !plan) {
      logger.info("[Agent prepareStep] Step 0 - Forcing createPlan tool (planning required)");
      return {
        toolChoice: { type: "tool", toolName: "createPlan" },
      };
    }

    // CRITICAL FIX: When plan is COMPLETED, force text-only response to stop looping
    if (plan && plan.status === "completed") {
      logger.info("[Agent prepareStep] Plan completed - forcing text-only final response");
      return { toolChoice: "none" as const };
    }

    // Only enforce task workflow if planning is required and a plan exists
    if (requirePlanning && plan && plan.status === "planning") {
      const pendingTasks = ctx.getTasksByStatus("pending");
      const inProgressTasks = ctx.getTasksByStatus("in-progress");

      if (pendingTasks.length > 0 && inProgressTasks.length === 0) {
        logger.info("[Agent prepareStep] Plan has pending tasks - requiring tool use");
        return { toolChoice: "required" as const };
      }
    }

    // Check for explicit STOP signals or allTasksComplete - force text-only response
    const lastStep = steps.at(-1);
    if (lastStep?.toolResults) {
      const hasStopOrComplete = lastStep.toolResults.some((r: any) => {
        const result = r.result;
        // Force text response on explicit STOP OR allTasksComplete
        return result?.STOP === true || result?.allTasksComplete === true;
      });
      if (hasStopOrComplete) {
        logger.info("[Agent prepareStep] STOP/Complete signal - forcing text response");
        return { toolChoice: "none" as const };
      }
    }

    return { toolChoice: "auto" as const };
  };

  // Create the v6 ToolLoopAgent with proper callbacks
  const agentSettings: ToolLoopAgentSettings<never, Record<string, Tool>> = {
    id: persistedState?.id ?? `orchestrator-${Date.now()}`,
    model: customModelProvider.getModel(config.chatModel),
    instructions: systemPrompt,
    tools: allTools,
    toolChoice: "auto",
    prepareStep: agentPrepareStep, // KEY: Add prepareStep for forced tool calling
    stopWhen: [
      stepCountIs(maxSteps),

      // Plan completion or failure - stop when plan reaches terminal state
      (options: { steps: StepResult<Record<string, Tool>>[] }) => {
        if (continuousMode) return false;

        const plan = ctx.getPlan();
        if (!plan) return false;

        // Stop on plan failure
        if (plan.status === "failed") {
          logger.info("[Agent stopWhen] Plan failed - stopping");
          return true;
        }

        // Stop on plan completion when agent provides text-only response
        if (plan.status === "completed") {
          const lastStep = options.steps.at(-1);
          const hasToolCalls = lastStep?.toolCalls && lastStep.toolCalls.length > 0;

          if (!hasToolCalls) {
            logger.info("[Agent stopWhen] Plan completed with text response - stopping");
            return true;
          }
        }

        return false;
      },

      // STOP signal or allTasksComplete from tool results
      (options: { steps: StepResult<Record<string, Tool>>[] }) => {
        const lastStep = options.steps.at(-1);

        // If last step had no tool calls with completed plan, stop
        if (lastStep && (!lastStep.toolCalls || lastStep.toolCalls.length === 0)) {
          const plan = ctx.getPlan();
          if (plan?.status === "completed") {
            logger.info("[Agent stopWhen] Text response with completed plan - stopping");
            return true;
          }
        }

        if (lastStep?.toolResults) {
          for (const r of lastStep.toolResults) {
            const result = (r as any).result;
            if (result?.STOP === true) {
              logger.info("[Agent stopWhen] Explicit STOP signal received");
              return true;
            }
          }
        }
        return false;
      },

      // No plan after 8 steps
      (options: { steps: StepResult<Record<string, Tool>>[] }) => {
        if (options.steps.length >= 8 && !ctx.getPlan()) {
          logger.warn("[Agent stopWhen] No plan after 8 steps - stopping");
          return true;
        }
        return false;
      },

      // Loop detection - same tool 6+ times consecutively (allows legitimate multi-step operations)
      (options: { steps: StepResult<Record<string, Tool>>[] }) => {
        if (options.steps.length < 6) return false;

        const toolCalls = options.steps.slice(-6)
          .flatMap((step) => step.toolCalls?.map((tc: any) => tc.toolName) || [])
          .filter(Boolean);

        if (toolCalls.length >= 6) {
          const last6 = toolCalls.slice(-6);
          const unique = new Set(last6);
          if (unique.size === 1) {
            logger.warn(`[Agent stopWhen] Loop: "${last6[0]}" called 6x consecutively`);
            return true;
          }
        }
        return false;
      },

      // Repetitive pattern detection - detect loops with varying tools
      (options: { steps: StepResult<Record<string, Tool>>[] }) => {
        if (options.steps.length < 6) return false;

        const recentCalls = options.steps.slice(-6)
          .flatMap((s) => s.toolCalls?.map((tc: any) => tc.toolName) || [])
          .filter(Boolean);

        if (recentCalls.length >= 6) {
          const pattern1 = recentCalls.slice(0, 2).join(",");
          const pattern2 = recentCalls.slice(2, 4).join(",");
          const pattern3 = recentCalls.slice(4, 6).join(",");

          if (pattern1 === pattern2 && pattern2 === pattern3 && recentCalls[0] !== recentCalls[1]) {
            logger.warn(`[Agent stopWhen] Repetitive pattern: ${pattern1} repeated 3 times`);
            return true;
          }
        }
        return false;
      },
    ],

    // Persist state after each step
    onStepFinish: async (stepResult: StepResult<Record<string, Tool>>) => {
      stepCount++;
      const plan = ctx.getPlan();

      // Check for STOP signals in this step's results
      if (stepResult.toolResults) {
        const hasStopSignal = stepResult.toolResults.some((r: any) => {
          const result = r.result;
          return result?.STOP === true || result?.COMPLETED === true;
        });

        if (hasStopSignal) {
          logger.warn(
            `Step ${stepCount}: STOP signal detected - agent should stop on next iteration`,
          );
        }
      }

      // Log tool call counts to detect loops
      // Warning threshold is higher than blocking threshold to reduce noise
      const toolCallCounts = ctx.getToolCallCounts();
      const highCallTools = Object.entries(toolCallCounts)
        .filter(([_, count]) => (count as number) > 8)
        .map(([name, count]) => `${name}:${count}`);

      if (highCallTools.length > 0) {
        logger.warn(
          `Step ${stepCount}: High tool call counts detected: ${highCallTools.join(", ")}`,
        );
      }

      logger.info(
        `Step ${stepCount} completed. ` +
          `Plan: ${plan?.status ?? "no plan"}, Progress: ${plan?.progress ?? 0}%`,
      );

      // Persist state if callback provided
      if (onPersistState) {
        try {
          // Determine status based on plan state
          let status: "completed" | "failed" | "executing" = "executing";
          if (plan?.status === "completed") {
            status = "completed";
          } else if (plan?.status === "failed") {
            status = "failed";
          }

          await onPersistState({
            planData: plan ?? undefined,
            sharedContext: ctx.getAllSharedContext(),
            status,
            stepsExecuted: stepCount,
          });
        } catch (err) {
          logger.error("Failed to persist agent state:", err);
        }
      }
    },

    // Final callback when agent completes
    onFinish: async (event) => {
      const plan = ctx.getPlan();

      // Auto-complete any in-progress tasks (agent may have finished work but forgot to mark done)
      if (plan && plan.status !== "completed" && plan.status !== "failed") {
        const inProgressTasks = plan.tasks.filter(
          (t) => t.status === "in-progress",
        );
        for (const task of inProgressTasks) {
          ctx.updateTaskStatus(
            task.id,
            "completed",
            "Auto-completed on agent finish",
          );
          logger.info(`Auto-completed task ${task.id} on agent finish`);
        }
      }

      const finalPlan = ctx.getPlan();
      logger.info(
        `Agent completed after ${event.steps.length} steps. ` +
          `Final status: ${finalPlan?.status ?? "complete"}`,
      );

      // Emit final plan state to ensure UI is in sync
      if (dataStream && finalPlan) {
        dataStream.write({
          type: "data-task-updated",
          data: {
            planId: finalPlan.id,
            taskId: "final-sync",
            newStatus: "completed",
            tasks: finalPlan.tasks.map((t) => ({
              id: t.id,
              description: t.description,
              status: t.status,
              assignedAgent: t.assignedAgent,
            })),
            progress: finalPlan.progress,
            planStatus: finalPlan.status,
          },
        });
      }

      // Final state persistence
      if (onPersistState) {
        try {
          await onPersistState({
            planData: finalPlan ?? undefined,
            sharedContext: ctx.getAllSharedContext(),
            status: finalPlan?.status === "failed" ? "failed" : "completed",
            stepsExecuted: stepCount,
          });
        } catch (err) {
          logger.error("Failed to persist final agent state:", err);
        }
      }
    },
  };

  const agent = new ToolLoopAgent(agentSettings);

  return {
    agent,
    contextManager: ctx,
    agentStateId: persistedState?.id,
  };
}

/**
 * Initialize agent state in database for a new execution
 */
export async function initializeAgentState(
  userId: string,
  threadId?: string,
  maxSteps = 50,
): Promise<AgentState> {
  const state = await agentStateRepository.create({
    userId,
    threadId,
    status: "planning",
    maxSteps,
  });

  logger.info(`Initialized agent state: ${state.id}`);
  return state;
}

/**
 * Resume agent from persisted state
 */
export async function resumeAgentState(
  threadId: string,
): Promise<AgentState | null> {
  const state = await agentStateRepository.getByThreadId(threadId);

  if (
    state &&
    (state.status === "planning" ||
      state.status === "executing" ||
      state.status === "paused")
  ) {
    logger.info(`Resuming agent state: ${state.id}, status: ${state.status}`);
    return state;
  }

  return null;
}

/**
 * Build the working directory context section for system prompts
 * This is used by both createAgentOrchestratorConfig and createStreamingAutonomousAgent
 *
 * @param workingDirectory - Optional working directory configuration
 * @returns A string to append to the system prompt, or empty string if no directory set
 */
function buildWorkingDirectorySection(workingDirectory?: { path: string; name: string }): string {
  if (!workingDirectory?.path) {
    return "";
  }

  return `

## WORKING DIRECTORY
**Current Working Directory**: ${workingDirectory.path}
**Directory Name**: ${workingDirectory.name}

CRITICAL: All file operations and terminal commands MUST use this working directory as the base path.
- When creating files, save them to: ${workingDirectory.path}
- When running terminal commands, use this as the current directory (cwd)
- When reading files, look in this directory first
- The user expects ALL work to happen within this directory
`;
}

/**
 * Configuration options for the agent orchestrator
 */
export interface AgentOrchestratorOptions {
  /** Maximum number of steps the agent can take */
  maxSteps?: number;
  /** Optional abort signal for cancellation */
  abortSignal?: AbortSignal;
  /** Optional callback for step completion */
  onStepComplete?: (step: { stepNumber: number; type: string }) => void;
}

/**
 * Creates the full agent orchestrator configuration
 * This is the main entry point for v6 agent-style execution
 *
 * @param config - The orchestrator configuration
 * @returns Configuration object for generateText/streamText with all tools
 */
export function createAgentOrchestratorConfig(config: OrchestratorConfig) {
  const { availableTools, mcpTools, userAgent, maxSteps = 50, workingDirectory } = config;

  // Create context manager for this orchestrator instance
  const ctx = createAgentContext();

  // Build working directory context section using shared helper
  const workingDirSection = buildWorkingDirectorySection(workingDirectory);

  // Build system prompt
  let systemPrompt = AGENT_ORCHESTRATOR_INSTRUCTIONS + workingDirSection;

  if (userAgent?.instructions) {
    const agentPrompt = buildAgentSystemPrompt(userAgent.instructions);
    systemPrompt = `${agentPrompt}\n\n---\n\n${AGENT_ORCHESTRATOR_INSTRUCTIONS}${workingDirSection}`;
  }

  // Create all tools
  const contextTools = createAgentContextTools(ctx);
  const subAgentTools = createSubAgentTools(config, ctx);

  const allTools: Record<string, Tool> = {
    ...availableTools,
    ...mcpTools,
    ...contextTools,
    ...subAgentTools,
  };

  return {
    system: systemPrompt,
    tools: allTools,
    maxSteps,
    toolChoice: "auto" as const,
    // Return context manager for external access if needed
    contextManager: ctx,
  };
}

/**
 * Execute a task using the autonomous agent
 * This uses the v6 ToolLoopAgent for true agent loop execution
 *
 * @param config - Orchestrator configuration
 * @param prompt - The user's request/prompt
 * @param options - Additional execution options
 * @returns The generation result
 */
export async function executeAutonomousAgent(
  config: AutonomousAgentConfig,
  prompt: string,
  options?: AgentOrchestratorOptions,
) {
  const { agent, contextManager, agentStateId } = createAutonomousAgent(config);

  logger.info(
    `Starting autonomous agent (maxSteps: ${options?.maxSteps ?? config.maxSteps ?? 50}): ${prompt.slice(0, 100)}...`,
  );

  // Use the v6 agent.generate() method for autonomous execution
  const result = await agent.generate({
    prompt,
    abortSignal: options?.abortSignal,
  });

  const plan = contextManager.getPlan();
  logger.info(
    `Autonomous agent completed with ${result.steps.length} steps. ` +
      `Plan status: ${plan?.status ?? "no plan"}, progress: ${plan?.progress ?? 0}%`,
  );

  return {
    ...result,
    plan,
    contextManager,
    agentStateId,
  };
}

/**
 * Execute a task using the agent orchestrator (legacy method)
 * This is a convenience function for autonomous task execution with full agent capabilities
 *
 * @param config - Orchestrator configuration
 * @param prompt - The user's request/prompt
 * @param options - Additional execution options
 * @returns The generation result
 * @deprecated Use executeAutonomousAgent instead for true agent loop execution
 */
export async function executeAgentOrchestrator(
  config: OrchestratorConfig,
  prompt: string,
  options?: AgentOrchestratorOptions,
) {
  const orchestratorConfig = createAgentOrchestratorConfig(config);
  const model = customModelProvider.getModel(config.chatModel);
  const { contextManager, maxSteps, ...aiConfig } = orchestratorConfig;
  const effectiveMaxSteps = options?.maxSteps ?? maxSteps;

  logger.info(`Starting agent orchestrator: ${prompt.slice(0, 100)}...`);

  const result = await generateText({
    model,
    ...aiConfig,
    prompt,
    stopWhen: stepCountIs(effectiveMaxSteps),
    abortSignal: options?.abortSignal,
  });

  const plan = contextManager.getPlan();
  logger.info(
    `Agent orchestrator completed with ${result.steps.length} steps. ` +
      `Plan status: ${plan?.status ?? "no plan"}, progress: ${plan?.progress ?? 0}%`,
  );

  return {
    ...result,
    plan,
    contextManager,
  };
}

/**
 * Create a streaming agent orchestrator for real-time UI updates
 * This integrates with the chat API for streaming responses
 */
export function createStreamingAgentConfig(config: OrchestratorConfig) {
  const orchestratorConfig = createAgentOrchestratorConfig(config);

  // Remove contextManager and maxSteps from the config for streaming
  const { contextManager: _, maxSteps, ...streamConfig } = orchestratorConfig;

  return {
    ...streamConfig,
    stopWhen: stepCountIs(maxSteps ?? 50),
  };
}

/**
 * Create a streaming autonomous agent config with state persistence
 * Returns tools and system prompt like createStreamingAgentConfig
 * but with state persistence callback integrated
 *
 * KEY AI SDK 6 PATTERNS IMPLEMENTED:
 * 1. prepareStep - Forces createPlan tool on first step when no plan exists
 * 2. stopWhen - Clean stop conditions with hasToolCall for plan completion
 * 3. Proper toolChoice control per step
 */
export function createStreamingAutonomousAgent(config: AutonomousAgentConfig) {
  const {
    availableTools,
    mcpTools,
    userAgent,
    maxSteps = 50,
    dataStream,
    continuousMode = false,
    workingDirectory,
    requirePlanning = false, // Default: pure agentic mode (no mandatory planning)
  } = config;

  const { agent, contextManager, agentStateId } = createAutonomousAgent(config);

  // Build working directory context section
  const workingDirSection = buildWorkingDirectorySection(workingDirectory);

  // Build system prompt based on whether planning is required
  // When requirePlanning is false: Use pure agentic instructions (no mandatory planning)
  // When requirePlanning is true: Use full orchestrator instructions (mandatory planning)
  const baseInstructions = requirePlanning
    ? AGENT_ORCHESTRATOR_INSTRUCTIONS
    : PURE_AGENTIC_INSTRUCTIONS;

  let systemPrompt = baseInstructions + workingDirSection;
  if (userAgent?.instructions) {
    const agentPrompt = buildAgentSystemPrompt(userAgent.instructions);
    systemPrompt = `${agentPrompt}\n\n---\n\n${baseInstructions}${workingDirSection}`;
  }

  logger.info(`[createStreamingAutonomousAgent] Mode: ${requirePlanning ? "PLANNING REQUIRED" : "PURE AGENTIC"}`);

  // Create tools WITH dataStream for plan/task streaming events
  // When requirePlanning is false, planning tools (createPlan, updateTaskStatus) are NOT included
  const contextTools = createAgentContextTools(contextManager, dataStream, requirePlanning);
  const subAgentTools = createSubAgentTools(config, contextManager, dataStream);

  // Combine all tools
  const combinedTools: Record<string, Tool> = {
    ...availableTools,
    ...mcpTools,
    ...contextTools,
    ...subAgentTools,
  };

  // Wrap ALL tools with call tracking to prevent infinite loops
  const allTools = wrapToolsWithCallTracking(combinedTools, contextManager);

  /**
   * AI SDK 6 prepareStep - Dynamic per-step configuration
   *
   * When requirePlanning is TRUE:
   *   Force createPlan on step 0 if no plan exists
   *
   * When requirePlanning is FALSE (pure agentic mode):
   *   Let the agent use tools freely without mandatory planning
   *
   * Pattern from docs: "Use toolChoice: { type: 'tool', toolName: 'search' }
   * to mandate particular tool execution at designated steps"
   */
  const prepareStep: PrepareStepFunction<ToolSet> = ({ steps, stepNumber }) => {
    const plan = contextManager.getPlan();

    // Step 0: FORCE createPlan ONLY if requirePlanning is true and no plan exists
    if (requirePlanning && stepNumber === 0 && !plan) {
      logger.info("[prepareStep] Step 0 - Forcing createPlan tool (planning required, no plan exists)");
      return {
        toolChoice: { type: "tool", toolName: "createPlan" },
      };
    }

    // CRITICAL FIX: When plan is COMPLETED, force text-only response to stop looping
    // This ensures the agent provides a final summary instead of continuing to call tools
    if (plan && plan.status === "completed") {
      logger.info("[prepareStep] Plan completed - forcing text-only final response");
      return {
        toolChoice: "none" as const, // Force text generation, no more tools
      };
    }

    // Only enforce task workflow if planning is required and a plan exists
    if (requirePlanning && plan && plan.status === "planning") {
      const pendingTasks = contextManager.getTasksByStatus("pending");
      const inProgressTasks = contextManager.getTasksByStatus("in-progress");

      // If plan exists but no tasks are in-progress, guide agent to start first task
      if (pendingTasks.length > 0 && inProgressTasks.length === 0) {
        logger.info("[prepareStep] Plan exists with pending tasks - suggesting updateTaskStatus");
        // Don't force, just suggest - let agent pick the right task
        return {
          toolChoice: "required" as const, // Force a tool call, but any tool
        };
      }
    }

    // Check for explicit STOP signals or allTasksComplete - force text on completion
    const lastStep = steps.at(-1);
    if (lastStep?.toolResults) {
      const hasStopOrComplete = lastStep.toolResults.some((r: any) => {
        const result = r.result;
        // Force text response on explicit STOP, allTasksComplete, or STOP_AGENT_LOOP
        return (
          result?.STOP === true ||
          result?.allTasksComplete === true ||
          result?.STOP_AGENT_LOOP === true
        );
      });
      if (hasStopOrComplete) {
        logger.info("[prepareStep] STOP/Complete signal detected - forcing text-only response");
        return {
          toolChoice: "none" as const, // Force text generation, no more tools
        };
      }
    }

    // Default: let model decide - this allows natural completion when agent provides response
    return {
      toolChoice: "auto" as const,
    };
  };

  /**
   * AI SDK 6 stopWhen conditions
   * FIXED: Added plan completion stopping to prevent infinite loops after tasks complete
   */
  const stopConditions = [
    // 1. Maximum steps limit (backup safety)
    stepCountIs(maxSteps),

    // 2. Plan completion or failure - stop when plan reaches terminal state
    (options: { steps: StepResult<any>[] }) => {
      if (continuousMode) return false;

      const plan = contextManager.getPlan();
      if (!plan) return false;

      // Stop on plan failure
      if (plan.status === "failed") {
        logger.info("[stopWhen] Plan failed - stopping agent");
        return true;
      }

      // Stop on plan completion - give agent one step to provide final response
      // Check if last step had no tool calls (text-only response)
      if (plan.status === "completed") {
        const lastStep = options.steps.at(-1);
        const hasToolCalls = lastStep?.toolCalls && lastStep.toolCalls.length > 0;

        if (!hasToolCalls) {
          logger.info("[stopWhen] Plan completed and agent provided final text response - stopping");
          return true;
        }

        // If we've already had at least 2 steps since completion, force stop
        // This prevents infinite loops when model keeps calling tools after completion
        const completionStepIndex = options.steps.findIndex(s => {
          return s.toolResults?.some((r: any) => r.result?.allTasksComplete === true);
        });
        if (completionStepIndex >= 0 && options.steps.length > completionStepIndex + 1) {
          logger.info("[stopWhen] Plan completed with steps after completion - forcing stop");
          return true;
        }
      }

      return false;
    },

    // 3. STOP signal or allTasksComplete from tool results
    (options: { steps: StepResult<any>[] }) => {
      const lastStep = options.steps.at(-1);

      // If last step had no tool calls (text-only), stop
      if (lastStep && (!lastStep.toolCalls || lastStep.toolCalls.length === 0)) {
        const plan = contextManager.getPlan();
        if (plan?.status === "completed") {
          logger.info("[stopWhen] Text-only response with completed plan - stopping");
          return true;
        }
      }

      if (lastStep?.toolResults) {
        for (const r of lastStep.toolResults) {
          const result = (r as any).result;
          // Stop on explicit STOP signal or STOP_AGENT_LOOP
          if (result?.STOP === true || result?.STOP_AGENT_LOOP === true) {
            logger.info("[stopWhen] Explicit STOP/STOP_AGENT_LOOP signal received");
            return true;
          }
        }
      }
      return false;
    },

    // 4. No plan after 8 steps - but not in continuous mode
    (options: { steps: StepResult<any>[] }) => {
      if (continuousMode) return false;
      if (options.steps.length >= 8 && !contextManager.getPlan()) {
        logger.warn("[stopWhen] No plan after 8 steps - stopping confused agent");
        return true;
      }
      return false;
    },

    // 5. Loop detection - same tool 6+ times consecutively (allows legitimate multi-step operations)
    (options: { steps: StepResult<any>[] }) => {
      if (options.steps.length < 6) return false;

      const recentCalls = options.steps.slice(-6)
        .flatMap((s) => s.toolCalls?.map((tc: any) => tc.toolName) || [])
        .filter(Boolean);

      if (recentCalls.length >= 6) {
        const unique = new Set(recentCalls);
        if (unique.size === 1) {
          logger.warn(`[stopWhen] Loop detected - "${recentCalls[0]}" called 6+ times consecutively`);
          return true;
        }
      }
      return false;
    },

    // 6. Repetitive pattern detection - detect loops with varying tools
    (options: { steps: StepResult<any>[] }) => {
      if (options.steps.length < 6) return false;

      // Get last 6 tool calls
      const recentCalls = options.steps.slice(-6)
        .flatMap((s) => s.toolCalls?.map((tc: any) => tc.toolName) || [])
        .filter(Boolean);

      if (recentCalls.length >= 6) {
        // Check for pattern like [A, B, A, B, A, B] - repetitive 2-tool cycle
        const pattern1 = recentCalls.slice(0, 2).join(",");
        const pattern2 = recentCalls.slice(2, 4).join(",");
        const pattern3 = recentCalls.slice(4, 6).join(",");

        if (pattern1 === pattern2 && pattern2 === pattern3 && recentCalls[0] !== recentCalls[1]) {
          logger.warn(`[stopWhen] Repetitive pattern detected: ${pattern1} repeated 3 times`);
          return true;
        }
      }
      return false;
    },
  ];

  return {
    system: systemPrompt,
    tools: allTools,
    stopWhen: stopConditions,
    prepareStep, // KEY: Include prepareStep for forced tool calling
    toolChoice: "auto" as const,
    // Additional fields for state management
    agent,
    contextManager,
    agentStateId,
    // Convenience method for streaming in chat context
    stream: async (prompt: string, abortSignal?: AbortSignal) => {
      return agent.stream({
        prompt,
        abortSignal,
      });
    },
  };
}
