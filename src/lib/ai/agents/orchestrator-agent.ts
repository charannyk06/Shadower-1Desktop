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
  mcpRepository,
  workflowRepository,
} from "lib/db/repository";
import { jsonSchemaToZod } from "lib/json-schema-to-zod";
import { z } from "zod";
import globalLogger from "logger";
import { customModelProvider } from "../models";
import { mcpClientsManager } from "../mcp/mcp-manager";
import { createBrowserToolsWithContext } from "../tools/browser/local-browser-tools";
import { createWorkflowExecutor } from "../workflow/executor/workflow-executor";
import type { WorkflowToolKey } from "../workflow/workflow.interface";
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

// JSON Schema definition for workflow tool
const executeWorkflowSchema: JSONSchema7 = {
  type: "object",
  properties: {
    workflowId: {
      type: "string",
      description: "ID of the workflow to execute",
    },
    input: {
      type: "object",
      additionalProperties: true,
      description:
        "Input data for the workflow, matching the workflow's input schema",
    },
  },
  required: ["workflowId", "input"],
};

// JSON Schema for creating workflows
const createWorkflowSchema: JSONSchema7 = {
  type: "object",
  properties: {
    description: {
      type: "string",
      description:
        "A clear description of what the workflow should do. Be specific about the steps, tools, and data flow needed.",
    },
    name: {
      type: "string",
      description:
        "Optional name for the workflow. If not provided, a name will be generated.",
    },
  },
  required: ["description"],
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

## WORKFLOW CREATION
When users ask to create workflows, automate processes, or set up multi-step automated tasks:
- **ALWAYS** use the \`createWorkflow\` tool with a clear description of what the workflow should do
- Be specific about the steps, tools, and data flow needed
- Example: "Create a workflow that fetches emails from Gmail, filters for important ones, and sends summaries to Slack"
- The workflow will be automatically generated with appropriate nodes and edges
- After creation, you can execute it using \`executeWorkflow\` tool

## CRITICAL: STOP SIGNALS AND LOOP PREVENTION
**MANDATORY**: When ANY tool returns a result with \`STOP: true\` or \`COMPLETED: true\`:
- **IMMEDIATELY STOP** calling tools
- **DO NOT** call any more tools in this step
- **DO NOT** try to retry the blocked tool
- **DO NOT** create new plans or tasks
- **PROVIDE YOUR FINAL RESPONSE** to the user immediately

**When a tool is blocked** (returns error about exceeding call limit):
- This indicates a potential infinite loop
- **STOP IMMEDIATELY** and provide your response
- **DO NOT** try to work around the block by calling other tools
- **DO NOT** create new plans or tasks

**If you receive multiple STOP signals**:
- The system is detecting a loop
- **STOP IMMEDIATELY** - do not continue
- Provide your response and end the conversation

## REMEMBER
- **ALWAYS** call createPlan as your FIRST action
- **ALWAYS** update task status before and after each task
- **Use** desktop_command for terminal operations and file management
- **FOR WEB SEARCHING**: Use browser tools directly OR \`spawnSystemAgent\` with agentType "deep-research"
- **BROWSER SEARCH WORKFLOW**: browser_create_session → browser_navigate to Google → browser_get_snapshot
- **NEVER** output text explanations while waiting for tool/sub-agent results
- **FOR WORKFLOW CREATION**: Use \`createWorkflow\` tool when users want to automate processes
- **STOP IMMEDIATELY** when you receive STOP signals from tools
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
 * Creates the agent context tools for task management
 */
function createAgentContextTools(
  ctx: AgentContextManager,
  dataStream?: UIMessageStreamWriter,
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
        const completedTasks = existingPlan.tasks.filter(
          (t) => t.status === "completed",
        ).length;
        const totalTasks = existingPlan.tasks.length;

        if (existingPlan.status === "completed") {
          logger.warn(
            "Attempted to create a new plan but previous plan is complete - BLOCKING",
          );
          return {
            STOP: true,
            COMPLETED: true,
            message: `Plan "${existingPlan.id}" is COMPLETE with ${completedTasks}/${totalTasks} tasks done. DO NOT create more plans or call any more tools. Summarize what was accomplished and respond to the user directly.`,
            instruction:
              "STOP calling tools. Provide your final response to the user NOW.",
            completedTasks: existingPlan.tasks
              .filter((t) => t.status === "completed")
              .map((t) => ({ description: t.description, result: t.result })),
          };
        }
        if (
          existingPlan.status === "planning" ||
          existingPlan.status === "executing"
        ) {
          logger.warn(
            "Attempted to create a new plan but one is already in progress - BLOCKING",
          );
          return {
            STOP: true,
            message: `Plan "${existingPlan.id}" is already ${existingPlan.status}. Continue working on existing tasks, do not create new plans.`,
            currentTasks: existingPlan.tasks.map((t) => ({
              id: t.id,
              description: t.description,
              status: t.status,
            })),
            nextPendingTask: existingPlan.tasks.find(
              (t) => t.status === "pending",
            )?.description,
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
        logger.warn(
          `Attempted to set completed task ${taskId} back to in-progress - BLOCKING`,
        );
        const remainingTasks = ctx.getTasksByStatus("pending");
        const nextTask = remainingTasks[0];

        // If no remaining tasks, signal completion
        if (remainingTasks.length === 0) {
          return {
            STOP: true,
            COMPLETED: true,
            error: `Task "${task.description}" is already completed and there are no more pending tasks.`,
            instruction:
              "All tasks are done. Provide your final response to the user NOW.",
            planProgress: plan?.progress ?? 100,
            planStatus: plan?.status ?? "completed",
          };
        }

        return {
          STOP: true,
          error: `Cannot re-activate completed task "${task.description}".`,
          action: nextTask
            ? `Move to the next pending task: "${nextTask.description}" (ID: ${nextTask.id})`
            : "Check plan status with getPlanStatus.",
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
          `Plan ${updatedPlan.id} is now COMPLETE (${completedTasks}/${totalTasks} tasks done) - sending STOP signal`,
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

        // Return STOP signal to halt agent execution
        return {
          STOP: true,
          COMPLETED: true,
          taskId,
          newStatus: status,
          taskDescription: task?.description,
          message: `Plan "${updatedPlan.id}" is COMPLETE with ${completedTasks}/${totalTasks} tasks done. All work is finished.`,
          instruction:
            "STOP calling tools. Provide your final response to the user NOW summarizing what was accomplished.",
          completedTasks: updatedPlan.tasks
            .filter((t) => t.status === "completed")
            .map((t) => ({ description: t.description, result: t.result })),
          planProgress: updatedPlan.progress,
          planStatus: updatedPlan.status,
          remainingTasks: 0,
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

  return {
    createPlan: createPlanTool as Tool,
    updateTaskStatus: updateTaskStatusTool as Tool,
    getNextTask: getNextTaskTool as Tool,
    getPlanStatus: getPlanStatusTool as Tool,
    setContext: setContextTool as Tool,
    getContext: getContextTool as Tool,
    getAllContext: getAllContextTool as Tool,
  };
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
              error: "Agent not found",
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
 * Creates the workflow execution and creation tools
 */
function createWorkflowTool(
  config: OrchestratorConfig,
  ctx: AgentContextManager,
): Record<string, Tool> {
  const { userId, chatModel } = config;

  const executeWorkflowTool = createTool({
    description:
      "Execute a predefined workflow by ID. Use for complex deterministic tasks that have pre-built workflow definitions.",
    inputSchema: jsonSchemaToZod(executeWorkflowSchema),
    execute: async ({
      workflowId,
      input,
    }: {
      workflowId: string;
      input: Record<string, unknown>;
    }) => {
      logger.info(`Executing workflow ${workflowId}`);

      // Check access to workflow
      const hasAccess = await workflowRepository.checkAccess(
        workflowId,
        userId,
        true,
      );
      if (!hasAccess) {
        return {
          workflowId,
          error: "Workflow not found or access denied",
          success: false,
        };
      }

      // Get the workflow structure (nodes and edges)
      const workflow = await workflowRepository.selectStructureById(
        workflowId,
        {
          ignoreNote: true,
        },
      );

      if (!workflow) {
        return {
          workflowId,
          error: "Workflow structure not found",
          success: false,
        };
      }

      if (!workflow.isPublished) {
        return {
          workflowId,
          workflowName: workflow.name,
          error:
            "Workflow is not published. Only published workflows can be executed.",
          success: false,
        };
      }

      try {
        // Create workflow executor
        const executor = createWorkflowExecutor({
          nodes: workflow.nodes,
          edges: workflow.edges,
          userId,
        });

        // Execute the workflow with provided input
        const result = await executor.run(input);

        // Store result in context for use by other tools
        ctx.setSharedContext(`workflow_result_${workflowId}`, result);

        logger.info(`Workflow ${workflow.name} completed successfully`);

        return {
          workflowId,
          workflowName: workflow.name,
          result,
          success: true,
        };
      } catch (err) {
        logger.error(`Workflow ${workflow.name} failed:`, err);
        return {
          workflowId,
          workflowName: workflow.name,
          error: String(err),
          success: false,
        };
      }
    },
  });

  const createWorkflowTool = createTool({
    description:
      "Create a new workflow automatically based on a description. Use this when the user wants to automate a multi-step process or create a reusable workflow. The workflow will be created with appropriate nodes, edges, and tool integrations based on the description. IMPORTANT: Always use this tool when users ask to 'create a workflow', 'build a workflow', 'automate X', or want to set up a multi-step automated process.",
    inputSchema: jsonSchemaToZod(createWorkflowSchema),
    execute: async ({
      description,
      name,
    }: {
      description: string;
      name?: string;
    }) => {
      logger.info(
        `[CreateWorkflow] Creating workflow: ${name || "unnamed"} - ${description}`,
      );

      try {
        // Step 1: Create an empty workflow first
        const workflowName =
          name || `Auto-generated workflow - ${description.substring(0, 50)}`;
        const newWorkflow = await workflowRepository.save(
          {
            name: workflowName,
            description: description.substring(0, 200), // Limit description length
            userId,
            isPublished: false,
          },
          true, // noGenerateInputNode - we'll let the generation API create nodes
        );

        logger.info(
          `[CreateWorkflow] Created empty workflow: ${newWorkflow.id}`,
        );

        // Step 2: Get available tools for workflow generation
        // Fetch MCP tools and app tools (same as /api/workflow/tools)
        const [mcpTools, appTools] = await Promise.all([
          // Fetch MCP Tools
          (async () => {
            try {
              const servers = await mcpRepository.selectAllForUser(userId);
              const memoryClients = await mcpClientsManager.getClients();
              const memoryMap = new Map(
                memoryClients.map(({ id, client }) => [id, client] as const),
              );

              const tools: WorkflowToolKey[] = [];
              for (const server of servers) {
                const mem = memoryMap.get(server.id);
                const info = mem?.getInfo?.();
                if (info?.status === "connected" && info?.toolInfo) {
                  info.toolInfo.forEach((tool) => {
                    tools.push({
                      ...tool,
                      id: tool.name,
                      type: "mcp-tool",
                      serverId: server.id,
                      serverName: server.name,
                    } as WorkflowToolKey);
                  });
                }
              }
              return tools;
            } catch (e) {
              logger.error("[CreateWorkflow] Failed to fetch MCP tools", e);
              return [];
            }
          })(),
          // Fetch App Tools (web search, etc.)
          (async () => {
            try {
              // Get default app tools that are available for workflows
              const { exaSearchTool, exaContentsTool } = await import(
                "../tools/web/web-search"
              );
              // Convert inputSchema to JSONSchema7 format
              const getJsonSchema = (tool: any): JSONSchema7 | undefined => {
                if (!tool.inputSchema) return undefined;
                // If it's already a JSONSchema7, return it
                if (
                  tool.inputSchema &&
                  typeof tool.inputSchema === "object" &&
                  "type" in tool.inputSchema
                ) {
                  return tool.inputSchema as JSONSchema7;
                }
                // Otherwise try to extract from zod schema
                return undefined;
              };
              return [
                {
                  id: "webSearch",
                  description: exaSearchTool.description || "Search the web",
                  type: "app-tool" as const,
                  parameterSchema: getJsonSchema(exaSearchTool),
                },
                {
                  id: "webContent",
                  description: exaContentsTool.description || "Get web content",
                  type: "app-tool" as const,
                  parameterSchema: getJsonSchema(exaContentsTool),
                },
              ] as unknown as WorkflowToolKey[];
            } catch (e) {
              logger.error("[CreateWorkflow] Failed to fetch app tools", e);
              return [];
            }
          })(),
        ]);

        // Combine all tools
        const toolList = [...mcpTools, ...appTools];

        logger.info(
          `[CreateWorkflow] Fetched ${toolList.length} tools: ${mcpTools.length} MCP, ${appTools.length} app tools`,
        );

        // Step 3: Prepare messages for workflow generation
        // Format messages as UIMessage format (not raw model messages)
        // This avoids reasoning token issues
        // Note: messages and workflow state are used directly in the AI call below

        logger.info(
          `[CreateWorkflow] Generating workflow ${newWorkflow.id} with AI`,
        );

        // Step 5: Generate workflow directly using AI
        // Build the system prompt with available tools
        const toolListText =
          toolList.length > 0
            ? toolList
                .map((t) => `- ${t.id}: ${t.description || "No description"}`)
                .join("\n")
            : "No MCP tools available. Create workflow using LLM, HTTP, Template, and Condition nodes.";

        const workflowSystemPrompt = `You are a workflow designer. Create a visual workflow based on the user's description.

## NODE TYPES
- input: Entry point (one per workflow)
- output: Exit point (one per workflow)
- llm: AI/LLM processing with model and messages
- tool: MCP tool execution
- condition: Conditional branching
- http: HTTP requests
- template: Text templates with variables

## AVAILABLE TOOLS
${toolListText}

## RULES
1. Always include exactly one input and one output node
2. Position nodes left-to-right (x: 0, 300, 600, etc.)
3. Connect all nodes with edges
4. Use descriptive names

Respond with a JSON object containing:
- nodes: array of workflow nodes
- edges: array of edges connecting nodes

Each node needs: id, type: "default", position: {x, y}, data: {id, name, kind, outputSchema, ...}
Each edge needs: id, source, target`;

        // Use generateText to create the workflow
        const { generateText: genText } = await import("ai");

        // Get the model for generation
        const genModel = chatModel || { provider: "openai", model: "gpt-4o" };

        // Import the model creation function based on provider
        let aiModel;
        try {
          if (genModel.provider === "openai") {
            const { openai } = await import("@ai-sdk/openai");
            aiModel = openai(genModel.model);
          } else if (genModel.provider === "anthropic") {
            const { anthropic } = await import("@ai-sdk/anthropic");
            aiModel = anthropic(genModel.model);
          } else if (genModel.provider === "google") {
            const { google } = await import("@ai-sdk/google");
            aiModel = google(genModel.model);
          } else {
            // Default to OpenAI if provider not recognized
            const { openai } = await import("@ai-sdk/openai");
            aiModel = openai("gpt-4o");
          }
        } catch (modelError) {
          logger.error(
            `[CreateWorkflow] Failed to create model: ${modelError}`,
          );
          // Return workflow without nodes
          return {
            success: true,
            workflowId: newWorkflow.id,
            workflowName: workflowName,
            message: `Workflow "${workflowName}" created but AI model initialization failed. Edit it manually at /workflow/${newWorkflow.id}.`,
            warning: "AI generation failed - manual editing required",
          };
        }

        // Generate the workflow
        const genResult = await genText({
          model: aiModel,
          system: workflowSystemPrompt,
          prompt: description,
          temperature: 0.7,
        });

        // Parse the generated workflow
        let generatedWorkflow: { nodes: any[]; edges: any[] } | null = null;
        try {
          // Try to extract JSON from the response
          const responseText = genResult.text;
          // Look for JSON in the response (might be wrapped in markdown code blocks)
          const jsonMatch =
            responseText.match(/```(?:json)?\s*([\s\S]*?)```/) ||
            responseText.match(/\{[\s\S]*"nodes"[\s\S]*"edges"[\s\S]*\}/);

          if (jsonMatch) {
            const jsonStr = jsonMatch[1] || jsonMatch[0];
            generatedWorkflow = JSON.parse(jsonStr.trim());
          } else {
            // Try parsing the whole response as JSON
            generatedWorkflow = JSON.parse(responseText);
          }
        } catch (parseError) {
          logger.warn(
            `[CreateWorkflow] Failed to parse generated workflow: ${parseError}`,
          );
        }

        // Step 6: Save the generated workflow structure
        if (
          generatedWorkflow &&
          generatedWorkflow.nodes &&
          generatedWorkflow.nodes.length > 0
        ) {
          try {
            await workflowRepository.saveStructure({
              workflowId: newWorkflow.id,
              nodes: generatedWorkflow.nodes,
              edges: generatedWorkflow.edges || [],
            });
            logger.info(
              `[CreateWorkflow] Saved ${generatedWorkflow.nodes.length} nodes to workflow ${newWorkflow.id}`,
            );
          } catch (saveError) {
            logger.error(
              `[CreateWorkflow] Failed to save workflow structure: ${saveError}`,
            );
          }
        }

        // Step 7: Verify workflow was updated by checking if it has nodes
        const updatedWorkflow = await workflowRepository.selectStructureById(
          newWorkflow.id,
        );

        if (updatedWorkflow && updatedWorkflow.nodes.length > 0) {
          logger.info(
            `[CreateWorkflow] Workflow ${newWorkflow.id} generated successfully with ${updatedWorkflow.nodes.length} nodes`,
          );

          // Store workflow ID in context for potential future use
          ctx.setSharedContext(`created_workflow_${Date.now()}`, {
            workflowId: newWorkflow.id,
            description,
            name: workflowName,
          });

          return {
            success: true,
            workflowId: newWorkflow.id,
            workflowName: workflowName,
            message: `Workflow "${workflowName}" created successfully with ${updatedWorkflow.nodes.length} nodes. You can view and edit it at /workflow/${newWorkflow.id}, or execute it using the executeWorkflow tool.`,
          };
        } else {
          // Workflow was created but generation didn't populate it
          logger.warn(
            `[CreateWorkflow] Workflow ${newWorkflow.id} created but generation didn't populate nodes`,
          );
          return {
            success: true,
            workflowId: newWorkflow.id,
            workflowName: workflowName,
            message: `Workflow "${workflowName}" created but generation didn't complete. You can edit it manually at /workflow/${newWorkflow.id}.`,
            warning: "Workflow created but may need manual editing",
          };
        }
      } catch (err) {
        logger.error(`[CreateWorkflow] Failed to create workflow:`, err);
        return {
          success: false,
          error: `Failed to create workflow: ${String(err)}`,
        };
      }
    },
  });

  return {
    executeWorkflow: executeWorkflowTool as Tool,
    createWorkflow: createWorkflowTool as Tool,
  };
}

/**
 * Build system prompt from agent instructions
 */
function buildAgentSystemPrompt(instructions: {
  role?: string;
  systemPrompt?: string;
}): string {
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
  }

  // Build system prompt
  let systemPrompt = AGENT_ORCHESTRATOR_INSTRUCTIONS;

  // Add agent-specific instructions if provided
  if (userAgent?.instructions) {
    const agentPrompt = buildAgentSystemPrompt(userAgent.instructions);
    systemPrompt = `${agentPrompt}\n\n---\n\n${AGENT_ORCHESTRATOR_INSTRUCTIONS}`;
  }

  // If plan is already complete, add a strong directive to NOT create new plans
  if (planAlreadyComplete) {
    systemPrompt = `CRITICAL INSTRUCTION - READ THIS FIRST:
A previous execution plan for this conversation is ALREADY COMPLETE (100% done).
You MUST NOT call createPlan or create new tasks.
Simply summarize what was accomplished and respond to any follow-up questions directly.

${systemPrompt}`;
  }

  // Create all tools (pass dataStream for plan/task/sub-agent streaming)
  const contextTools = createAgentContextTools(ctx, dataStream);
  const subAgentTools = createSubAgentTools(config, ctx, dataStream);
  const workflowTools = createWorkflowTool(config, ctx);

  // Combine all tools
  const combinedTools: Record<string, Tool> = {
    ...availableTools,
    ...mcpTools,
    ...contextTools,
    ...subAgentTools,
    ...workflowTools,
  };

  // Wrap ALL tools with call tracking to prevent infinite loops
  const allTools = wrapToolsWithCallTracking(combinedTools, ctx);

  // Track step count for persistence
  let stepCount = persistedState?.stepsExecuted ?? 0;

  /**
   * AI SDK 6 prepareStep - Dynamic per-step configuration
   * KEY FIX: Force createPlan on step 0 if no plan exists
   */
  const agentPrepareStep: PrepareStepFunction<ToolSet> = ({ steps, stepNumber }) => {
    const plan = ctx.getPlan();

    // Step 0: FORCE createPlan if no plan exists
    if (stepNumber === 0 && !plan) {
      logger.info("[Agent prepareStep] Step 0 - Forcing createPlan tool");
      return {
        toolChoice: { type: "tool", toolName: "createPlan" },
      };
    }

    // If plan exists but status is "planning", encourage starting tasks
    if (plan && plan.status === "planning") {
      const pendingTasks = ctx.getTasksByStatus("pending");
      const inProgressTasks = ctx.getTasksByStatus("in-progress");

      if (pendingTasks.length > 0 && inProgressTasks.length === 0) {
        logger.info("[Agent prepareStep] Plan has pending tasks - requiring tool use");
        return { toolChoice: "required" as const };
      }
    }

    // Check for STOP signals - force text-only response
    const lastStep = steps.at(-1);
    if (lastStep?.toolResults) {
      const hasStop = lastStep.toolResults.some((r: any) =>
        r.result?.STOP === true || r.result?.COMPLETED === true
      );
      if (hasStop) {
        logger.info("[Agent prepareStep] STOP signal - forcing text response");
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

      // Plan completion check
      () => {
        if (continuousMode) return false;
        const plan = ctx.getPlan();
        if (plan?.status === "completed" || plan?.status === "failed") {
          logger.info(`[Agent stopWhen] Plan ${plan.status} - stopping`);
          return true;
        }
        return false;
      },

      // STOP signal detection
      (options: { steps: StepResult<Record<string, Tool>>[] }) => {
        const lastStep = options.steps.at(-1);
        if (lastStep?.toolResults) {
          for (const r of lastStep.toolResults) {
            const result = (r as any).result;
            if (result?.STOP === true || result?.COMPLETED === true) {
              logger.info("[Agent stopWhen] STOP signal received");
              return true;
            }
          }
        }
        return false;
      },

      // No plan after 5 steps
      (options: { steps: StepResult<Record<string, Tool>>[] }) => {
        if (options.steps.length >= 5 && !ctx.getPlan()) {
          logger.warn("[Agent stopWhen] No plan after 5 steps - stopping");
          return true;
        }
        return false;
      },

      // Loop detection - same tool 3+ times
      (options: { steps: StepResult<Record<string, Tool>>[] }) => {
        if (options.steps.length < 3) return false;

        const toolCalls = options.steps.slice(-3)
          .flatMap((step) => step.toolCalls?.map((tc: any) => tc.toolName) || [])
          .filter(Boolean);

        if (toolCalls.length >= 3) {
          const last3 = toolCalls.slice(-3);
          if (last3[0] === last3[1] && last3[1] === last3[2]) {
            logger.warn(`[Agent stopWhen] Loop: "${last3[0]}" called 3x`);
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
      const toolCallCounts = ctx.getToolCallCounts();
      const highCallTools = Object.entries(toolCallCounts)
        .filter(([_, count]) => (count as number) > 5)
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
  const workflowTools = createWorkflowTool(config, ctx);

  const allTools: Record<string, Tool> = {
    ...availableTools,
    ...mcpTools,
    ...contextTools,
    ...subAgentTools,
    ...workflowTools,
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
  } = config;

  const { agent, contextManager, agentStateId } = createAutonomousAgent(config);

  // Build working directory context section
  const workingDirSection = buildWorkingDirectorySection(workingDirectory);

  // Build system prompt - SIMPLIFIED for better model adherence
  let systemPrompt = AGENT_ORCHESTRATOR_INSTRUCTIONS + workingDirSection;
  if (userAgent?.instructions) {
    const agentPrompt = buildAgentSystemPrompt(userAgent.instructions);
    systemPrompt = `${agentPrompt}\n\n---\n\n${AGENT_ORCHESTRATOR_INSTRUCTIONS}${workingDirSection}`;
  }

  // Create tools WITH dataStream for plan/task streaming events
  const contextTools = createAgentContextTools(contextManager, dataStream);
  const subAgentTools = createSubAgentTools(config, contextManager, dataStream);
  const workflowTools = createWorkflowTool(config, contextManager);

  // Combine all tools
  const combinedTools: Record<string, Tool> = {
    ...availableTools,
    ...mcpTools,
    ...contextTools,
    ...subAgentTools,
    ...workflowTools,
  };

  // Wrap ALL tools with call tracking to prevent infinite loops
  const allTools = wrapToolsWithCallTracking(combinedTools, contextManager);

  /**
   * AI SDK 6 prepareStep - Dynamic per-step configuration
   * This is the KEY FIX for planning: Force createPlan on step 0 if no plan exists
   *
   * Pattern from docs: "Use toolChoice: { type: 'tool', toolName: 'search' }
   * to mandate particular tool execution at designated steps"
   */
  const prepareStep: PrepareStepFunction<ToolSet> = ({ steps, stepNumber }) => {
    const plan = contextManager.getPlan();

    // Step 0: FORCE createPlan if no plan exists
    if (stepNumber === 0 && !plan) {
      logger.info("[prepareStep] Step 0 - Forcing createPlan tool (no plan exists)");
      return {
        toolChoice: { type: "tool", toolName: "createPlan" },
      };
    }

    // After plan created, check if we should force updateTaskStatus
    if (plan && plan.status === "planning") {
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

    // Check for recent STOP signals - if found, force text generation to conclude
    const lastStep = steps.at(-1);
    if (lastStep?.toolResults) {
      const hasStopSignal = lastStep.toolResults.some((r: any) => {
        const result = r.result;
        return result?.STOP === true || result?.COMPLETED === true;
      });
      if (hasStopSignal) {
        logger.info("[prepareStep] STOP signal detected - forcing text-only response");
        return {
          toolChoice: "none" as const, // Force text generation, no more tools
        };
      }
    }

    // Default: let model decide
    return {
      toolChoice: "auto" as const,
    };
  };

  /**
   * AI SDK 6 stopWhen conditions
   * SIMPLIFIED: Using clean patterns from docs
   */
  const stopConditions = [
    // 1. Maximum steps limit (backup safety)
    stepCountIs(maxSteps),

    // 2. Plan completion - stop when all tasks done (unless continuous mode)
    (_options: { steps: StepResult<any>[] }) => {
      if (continuousMode) return false;

      const plan = contextManager.getPlan();
      if (plan?.status === "completed") {
        logger.info("[stopWhen] Plan completed - stopping agent");
        return true;
      }
      if (plan?.status === "failed") {
        logger.info("[stopWhen] Plan failed - stopping agent");
        return true;
      }
      return false;
    },

    // 3. STOP signal from tool results
    (options: { steps: StepResult<any>[] }) => {
      const lastStep = options.steps.at(-1);
      if (lastStep?.toolResults) {
        for (const r of lastStep.toolResults) {
          const result = (r as any).result;
          if (result?.STOP === true || result?.COMPLETED === true) {
            logger.info("[stopWhen] STOP/COMPLETED signal received");
            return true;
          }
        }
      }
      return false;
    },

    // 4. No plan after 5 steps (agent confused) - but not in continuous mode
    (options: { steps: StepResult<any>[] }) => {
      if (continuousMode) return false;
      if (options.steps.length >= 5 && !contextManager.getPlan()) {
        logger.warn("[stopWhen] No plan after 5 steps - stopping confused agent");
        return true;
      }
      return false;
    },

    // 5. Loop detection - same tool 5+ times consecutively
    (options: { steps: StepResult<any>[] }) => {
      if (options.steps.length < 5) return false;

      const recentCalls = options.steps.slice(-5)
        .flatMap((s) => s.toolCalls?.map((tc: any) => tc.toolName) || [])
        .filter(Boolean);

      if (recentCalls.length >= 5) {
        const unique = new Set(recentCalls);
        if (unique.size === 1) {
          logger.warn(`[stopWhen] Loop detected - "${recentCalls[0]}" called 5+ times`);
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
