import "server-only";
import {
  type StepResult,
  type Tool,
  ToolLoopAgent,
  type ToolLoopAgentSettings,
  type UIMessageStreamWriter,
  tool as createTool,
  generateText,
  stepCountIs,
  streamText,
} from "ai";
import type { AgentState, AgentStateUpdate } from "app-types/agent-state";
import { colorize } from "consola/utils";
import { JSONSchema7 } from "json-schema";
import { wrapToolsWithTracking } from "lib/billing/tool-tracking";
import {
  agentRepository,
  agentStateRepository,
  mcpRepository,
  workflowRepository,
} from "lib/db/repository";
import { jsonSchemaToZod } from "lib/json-schema-to-zod";
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
const createPlanSchema: JSONSchema7 = {
  type: "object",
  properties: {
    request: { type: "string", description: "The user's original request" },
    tasks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: {
            type: "string",
            description: "Clear description of the task",
          },
          assignedAgent: {
            type: "string",
            description: "ID of a specific agent to handle this task",
          },
          parentTaskId: {
            type: "string",
            description: "ID of a task this depends on",
          },
        },
        required: ["description"],
      },
      description: "Array of tasks to complete the request",
    },
  },
  required: ["request", "tasks"],
};

const updateTaskStatusSchema: JSONSchema7 = {
  type: "object",
  properties: {
    taskId: { type: "string", description: "ID of the task to update" },
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

## CRITICAL: ALWAYS CREATE A PLAN FIRST
**MANDATORY**: For EVERY user request, you MUST:
1. FIRST call \`createPlan\` to create a structured plan with tasks
2. THEN execute tasks one by one using \`updateTaskStatus\`
3. NEVER skip planning - even simple tasks need a plan for tracking

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
3. **STEP 3 - EXECUTE TASK**:
   - **For research tasks**: Use \`spawnSystemAgent\` with agentType "deep-research" (NOT webSearch)
   - **For other specialized tasks**: Use appropriate \`spawnSystemAgent\` or tools
   - **For simple tasks**: Use direct tools (webSearch, sandbox, etc.)
4. **STEP 4 - COMPLETE TASK**: Call \`updateTaskStatus\` with status "completed" and results
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

## DELEGATION RULES - CRITICAL: USE SUB-AGENTS FOR SPECIALIZED TASKS
**MANDATORY**: For tasks requiring specialized capabilities, ALWAYS delegate to sub-agents:
- **Research tasks** → ALWAYS use \`spawnSystemAgent\` with agentType "deep-research" (NOT webSearch directly)
- **Data analysis** → Use \`spawnSystemAgent\` with agentType "data-analysis"
- **Code generation** → Use \`spawnSystemAgent\` with agentType "coding"
- **Document creation** → Use \`spawnSystemAgent\` with agentType "documents"
- **Browser automation** → Use \`spawnSystemAgent\` with agentType "web-automation"
- **Desktop automation** → Use \`spawnSystemAgent\` with agentType "computer-use"
- **Independent tasks** → Use \`spawnParallelAgents\` for efficiency
- **Sequential tasks** → Execute one-by-one with status updates

**IMPORTANT**: Do NOT use webSearch directly for research tasks. Instead, delegate to the "deep-research" agent which provides better results with citations and multi-step research.

## 🚨 AUTONOMOUS FRAGMENT GENERATION - CRITICAL ROUTING RULES 🚨
**MANDATORY - READ THIS FIRST**: Use **createFragment** for ALL of the following (DO NOT use sandbox):
- **Web apps** (dashboards, admin panels, e-commerce, landing pages) → **createFragment** (Next.js template)
- **Interactive UIs/SPAs** (component libraries, progressive web apps) → **createFragment** (Vue template)
- **Data dashboards** (analytics, internal tools, ML demos) → **createFragment** (Streamlit template)
- **ML model interfaces** (AI demos, computer vision apps) → **createFragment** (Gradio template)
- **Games** (snake, tic-tac-toe, interactive games) → **createFragment** (Next.js or Vue template)
- **Documents** (Word, Excel, PowerPoint files) → **createFragment** (code-interpreter template)
- **Data analysis** (charts, visualizations, calculations) → **createFragment** (code-interpreter template)

**CRITICAL**: When user asks to "create dashboard", "build app", "make a game", "generate document" → ALWAYS use **createFragment**, NEVER use sandbox!

**The FragmentAgent is FULLY AUTONOMOUS:**
1. It analyzes the request and chooses the best template automatically
2. Generates production-quality code
3. Executes and returns preview URL instantly
4. Stores for future surgical edits

**DO NOT ask the user which template to use. YOU decide based on the request.**
**DO NOT ask for confirmation. Just CREATE.**

**CRITICAL: After createFragment succeeds:**
- **STOP IMMEDIATELY** - fragment creation is COMPLETE
- **DO NOT** create new plans or tasks
- **DO NOT** call createFragment again
- **DO NOT** call updateTaskStatus or other tools
- **PROVIDE YOUR FINAL RESPONSE** to the user with the preview URL
- The fragment is ready - your job is DONE

**Use sandbox ONLY for:**
- Simple one-off code execution (like "print hello world")
- File operations (readFile, writeFile, listDir) on existing files
- Quick Python/JavaScript snippets that don't need a full app

**For iterative development:**
- After creating a fragment, use **editFragment** for surgical edits
- Edits are TARGETED (only changes what's needed, not full rewrites)
- Preview updates instantly

## SYSTEM AGENTS (Always Available)
Use \`spawnSystemAgent\` with agentType to delegate to specialized system agents:
- **deep-research**: Multi-step web research with source citations. Uses local Chrome DevTools for browsing.
- **data-analysis**: Analyze datasets and create interactive Plotly visualizations. Uses local code execution.
- **coding**: Build full applications from descriptions. Uses local sandbox.
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
1. **ALWAYS use the "sandbox" tool** with "writeFile" action to save files
2. **NEVER use Python's built-in file operations** (open, write, save, close)
3. **NEVER use library save methods** (prs.save(), doc.save(), wb.save())
4. Files written directly via Python won't appear in the user's workspace!
5. Generate content in memory, then use sandbox tool to save it

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
- **NEVER** use tools like webSearch without first creating a plan
- **ALWAYS** call createPlan as your FIRST action
- **ALWAYS** update task status before and after each task
- **ALWAYS** use sandbox tool for file operations, NOT Python's file I/O
- **FOR RESEARCH TASKS**: Use \`spawnSystemAgent\` with agentType "deep-research" instead of webSearch directly
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
- **For research tasks**: Use \`spawnSystemAgent\` with agentType "deep-research" (NOT webSearch directly)
- **For other tasks**: Use appropriate tools (sandbox, spawnSystemAgent, etc.)
- Call \`updateTaskStatus\` with "completed" when done

**Step 3: Complete All Tasks**
- Continue until every task is marked "completed"
- Provide a final summary to the user

## EXAMPLE WORKFLOW
User asks: "Find information about React hooks"
1. Call createPlan with tasks: ["Search for React hooks info", "Compile key points"]
2. Call updateTaskStatus(task1, "in-progress")
3. Call webSearch for React hooks
4. Call updateTaskStatus(task1, "completed", searchResults)
5. Call updateTaskStatus(task2, "in-progress")
6. Summarize the findings
7. Call updateTaskStatus(task2, "completed", summary)
8. Respond to user with the summary

## AVAILABLE TOOLS
- **createPlan**: Create your task plan (ALWAYS call this first!)
- **updateTaskStatus**: Mark tasks as in-progress/completed
- **webSearch**: Search the internet
- **createFragment**: Autonomously create web apps, micro-apps, games, dashboards, and documents (FULLY AUTONOMOUS - AI chooses template) ⚠️ USE THIS FOR ALL APPS/DASHBOARDS
- **editFragment**: Surgically edit existing fragments (targeted edits, not full rewrites)
- **deployFragment**: Create shareable public links for fragments
- **sandbox**: Execute code and manage files (DEPRECATED - use createFragment for apps/documents)
- **browser_navigate**: Navigate to any website URL - USE THIS to visit websites, browse pages, and access web content
- **browser_act**: Interact with web pages using natural language (click buttons, fill forms, etc.)
- **browser_observe**: Analyze and understand web page structure
- **browser_extract**: Extract structured data from web pages
- **browser_screenshot**: Take screenshots of web pages
- **desktop_screenshot**: Take screenshots of the desktop
- **desktop_click**: Click on desktop UI elements
- **desktop_type**: Type text on the desktop
- **spawnSystemAgent**: Delegate to specialized agents (deep-research, web-automation, computer-use, etc.)
- **setContext/getContext**: Store and retrieve information

## 🚨 AUTONOMOUS FRAGMENT GENERATION - CRITICAL ROUTING RULES 🚨
**MANDATORY - READ THIS FIRST**: Use **createFragment** for ALL of the following (DO NOT use sandbox):
- **Web apps** (dashboards, admin panels, e-commerce, landing pages) → createFragment (Next.js template)
- **Interactive UIs/SPAs** (component libraries, progressive web apps) → createFragment (Vue template)
- **Data dashboards** (analytics, internal tools, ML demos) → createFragment (Streamlit template)
- **ML model interfaces** (AI demos, computer vision apps) → createFragment (Gradio template)
- **Games** (snake, tic-tac-toe, interactive games) → createFragment (Next.js or Vue template)
- **Documents** (Word, Excel, PowerPoint files) → createFragment (code-interpreter template)
- **Data analysis** (charts, visualizations, calculations) → createFragment (code-interpreter template)

**The FragmentAgent is FULLY AUTONOMOUS:**
1. It analyzes the request and chooses the best template automatically
2. Generates production-quality code
3. Executes and returns preview URL instantly
4. Stores for future surgical edits

**DO NOT ask the user which template to use. YOU decide based on the request.**
**DO NOT ask for confirmation. Just CREATE.**

**CRITICAL: After createFragment succeeds:**
- **STOP IMMEDIATELY** - fragment creation is COMPLETE
- **DO NOT** create new plans or tasks
- **DO NOT** call createFragment again
- **DO NOT** call updateTaskStatus or other tools
- **PROVIDE YOUR FINAL RESPONSE** to the user with the preview URL
- The fragment is ready - your job is DONE

**Use sandbox ONLY for:**
- Simple one-off code execution
- File operations (readFile, writeFile, listDir)
- Quick Python/JavaScript snippets that don't need a full app

**For iterative development:**
- After creating a fragment, use **editFragment** for surgical edits
- Edits are TARGETED (only changes what's needed, not full rewrites)
- Preview updates instantly

## BROWSER AUTOMATION - YOU CAN NAVIGATE TO WEBSITES
**CRITICAL**: You HAVE browser automation tools available. When users ask to:
- Navigate to a website → Use **browser_navigate** with the URL
- Visit a page → Use **browser_navigate**
- Browse the web → Use **browser_navigate** then **browser_observe** and **browser_act**
- Extract data from a website → Use **browser_navigate** → **browser_extract**

**DO NOT** say you cannot navigate to websites. You CAN and SHOULD use browser_navigate for any web navigation requests.

## FILE OPERATIONS - IMPORTANT
When creating files (documents, images, code, etc.):
1. **For apps/documents**: Use **createFragment** (autonomous, generates complete apps)
2. **For simple files**: Use the "sandbox" tool with "writeFile" action
3. NEVER use Python's file operations (open, save, write)
4. Generate content in memory, then use appropriate tool to save

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
  const createPlanTool = createTool({
    description:
      "Create a structured execution plan for a complex request. Use for requests requiring 3+ steps. Do NOT call if a plan already exists.",
    inputSchema: jsonSchemaToZod(createPlanSchema),
    execute: async ({
      request,
      tasks,
    }: {
      request: string;
      tasks: Array<{
        description: string;
        assignedAgent?: string;
        parentTaskId?: string;
      }>;
    }) => {
      // Guard: Check if fragment was just created (check recent tool calls)
      const fragmentCallCount = ctx.getToolCallCounts()["createFragment"] || 0;
      if (fragmentCallCount > 0) {
        // If createFragment was called, check if we have any completed plan
        const existingPlan = ctx.getPlan();
        if (existingPlan) {
          // Check if any task involved fragment creation
          const hasFragmentTask = existingPlan.tasks.some(
            (t) =>
              t.description.toLowerCase().includes("fragment") ||
              t.description.toLowerCase().includes("create") ||
              t.description.toLowerCase().includes("dashboard") ||
              t.description.toLowerCase().includes("app"),
          );

          if (hasFragmentTask) {
            logger.warn(
              "Attempted to create new plan after fragment creation task - BLOCKING",
            );
            return {
              STOP: true,
              COMPLETED: true,
              message:
                "A fragment creation task already exists in the plan. DO NOT create new plans. Complete the existing plan and provide your final response.",
              instruction:
                "STOP calling createPlan. Work on the existing plan or provide your final response NOW.",
              existingPlanId: existingPlan.id,
              existingTasks: existingPlan.tasks.map((t) => ({
                id: t.id,
                description: t.description,
                status: t.status,
              })),
            };
          }
        }
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
  const { userId, threadId, mcpTools, availableTools, chatModel } = config;

  /**
   * Helper to execute a sub-agent with streaming and emit events
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
    const model = customModelProvider.getModel(chatModel);

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
      `[Sub-Agent ${agentName}] Starting with ${toolNames.length} tools: ${toolNames.slice(0, 10).join(", ")}${toolNames.length > 10 ? "..." : ""}`,
    );

    try {
      const streamResult = streamText({
        model,
        system: systemPrompt,
        prompt: task,
        tools: tools,
        stopWhen: stepCountIs(maxSteps),
        onChunk: ({ chunk }) => {
          // Forward text deltas to parent stream
          if (dataStream && chunk.type === "text-delta") {
            dataStream.write({
              type: "data-sub-agent-text",
              data: { agentId, text: chunk.text },
            });
          }
        },
        onStepFinish: async ({ toolCalls, toolResults }) => {
          // Forward tool calls with full details
          if (dataStream && toolCalls && toolCalls.length > 0) {
            for (let i = 0; i < toolCalls.length; i++) {
              const toolCall = toolCalls[i];
              const toolResult = toolResults?.[i];

              // Serialize result properly - keep full structure for browser/desktop tools
              let serializedResult: string | undefined;
              if (toolResult) {
                if (typeof toolResult === "string") {
                  // Try to parse as JSON first, if it fails use as-is
                  try {
                    const parsed = JSON.parse(toolResult);
                    serializedResult = JSON.stringify(parsed);
                  } catch {
                    serializedResult = toolResult;
                  }
                } else {
                  // For objects, stringify fully (don't truncate browser/desktop/web search/sandbox results)
                  const toolName = toolCall.toolName || "";
                  const toolNameLower = toolName.toLowerCase();
                  const isBrowserOrDesktop =
                    (toolNameLower.startsWith("browser") &&
                      toolNameLower !== "browser") ||
                    (toolNameLower.startsWith("desktop") &&
                      toolNameLower !== "desktop");
                  const isWebSearch =
                    toolNameLower === "websearch" ||
                    toolNameLower === "web_search" ||
                    toolNameLower === "webcontent" ||
                    toolNameLower === "web_content";
                  const isSandbox =
                    toolNameLower === "sandbox" ||
                    toolNameLower.includes("sandbox");

                  if (isBrowserOrDesktop || isWebSearch || isSandbox) {
                    // Keep full result for these tools (they need images, articles, screenshots, artifacts, etc.)
                    serializedResult = JSON.stringify(toolResult);
                  } else {
                    // Truncate other tool results to prevent overflow
                    serializedResult = JSON.stringify(toolResult).slice(
                      0,
                      1000,
                    );
                  }
                }
              }

              dataStream.write({
                type: "data-sub-agent-tool-call",
                data: {
                  agentId,
                  toolName: toolCall.toolName,
                  args: "input" in toolCall ? toolCall.input : undefined,
                  result: serializedResult,
                  timestamp: Date.now(),
                },
              });
            }
          }
        },
      });

      // Consume the stream and get final result
      const finalResult = await streamResult.text;
      const steps = (await streamResult.steps).length;

      // Emit completion event
      if (dataStream) {
        dataStream.write({
          type: "data-sub-agent-complete",
          data: { agentId, agentName, success: true },
        });
      }

      logger.info(`Agent ${agentName} completed with ${steps} steps`);

      return {
        result: finalResult,
        steps,
        success: true,
      };
    } catch (err) {
      // Emit error event
      if (dataStream) {
        dataStream.write({
          type: "data-sub-agent-error",
          data: { agentId, error: String(err) },
        });
      }

      logger.error(`Agent ${agentName} failed:`, err);

      return {
        result: "",
        steps: 0,
        success: false,
        error: String(err),
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
            // Desktop tools (local terminal): desktopScreenshot, desktopClick, desktopType, etc.
            for (const [name, tool] of Object.entries(availableTools)) {
              if (name.startsWith("desktop")) {
                systemAgentTools[name] = tool;
              }
            }
          }
          if (requirements.codeExecution) {
            // Local code execution: fragments, visualization, and data analysis tools
            for (const [name, tool] of Object.entries(availableTools)) {
              if (
                name.startsWith("create") || // createFragment, createVisualization, createPieChart, etc.
                name.startsWith("edit") || // editFragment
                name.startsWith("profile") || // profileData
                name.startsWith("analyze") // analyzeData
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

      const { result, steps, success, error } =
        await executeSubAgentWithStreaming(
          agentId,
          agent.name,
          task,
          systemPrompt,
          15,
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

      const results = await Promise.all(
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

          const { result, steps, success, error } =
            await executeSubAgentWithStreaming(
              agentId,
              agent.name,
              task,
              systemPrompt,
              10,
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

        // Desktop tools for local terminal requirement (computer-use)
        // Tool names: desktopScreenshot, desktopClick, desktopType, desktopPress, etc.
        if (requirements.desktop) {
          for (const [name, tool] of Object.entries(availableTools)) {
            if (name.startsWith("desktop")) {
              systemAgentTools[name] = tool;
            }
          }
          logger.info(
            `[System Agent ${systemAgentId}] Added desktop tools for local terminal requirement`,
          );
        }

        // Fragment and visualization tools for local code execution requirement (data-analysis, coding, documents)
        // Tool names: createFragment, editFragment, createVisualization, createPieChart, profileData, analyzeData, etc.
        if (requirements.codeExecution) {
          for (const [name, tool] of Object.entries(availableTools)) {
            if (
              name.startsWith("create") || // createFragment, createVisualization, etc.
              name.startsWith("edit") || // editFragment
              name.startsWith("profile") ||
              name.startsWith("analyze")
            ) {
              systemAgentTools[name] = tool;
            }
          }
          logger.info(
            `[System Agent ${systemAgentId}] Added fragment/visualization tools for local code execution requirement`,
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
            visibility: "private",
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
        const messages = [
          {
            id: `msg-${Date.now()}`,
            role: "user" as const,
            parts: [
              {
                type: "text" as const,
                text: description,
              },
            ],
          },
        ];

        // Step 4: Get current workflow state (empty for new workflow)
        const currentWorkflowState = {
          nodes: [],
          edges: [],
        };

        // Step 5: Get base URL for internal API call
        // In server-side code, we can use relative URLs or construct from env
        const baseUrl =
          process.env.NEXT_PUBLIC_BASE_URL ||
          (process.env.VERCEL_URL
            ? `https://${process.env.VERCEL_URL}`
            : "http://localhost:3000");

        logger.info(
          `[CreateWorkflow] Calling generation API for workflow ${newWorkflow.id}`,
        );

        // Step 6: Make internal API call to workflow generation endpoint
        // Note: This requires proper authentication. In a real implementation,
        // you'd need to pass session cookies or use an internal service call.
        // For now, we'll make the HTTP call and handle errors gracefully.
        const response = await fetch(`${baseUrl}/api/ai/workflow/generate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // In production, you'd need to pass auth headers here
            // For internal calls, you might use a service token or session
          },
          body: JSON.stringify({
            messages,
            availableTools: toolList,
            currentWorkflowState,
            chatModel: chatModel || {
              provider: "openai",
              model: "gpt-4o",
            },
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          logger.error(`[CreateWorkflow] Generation API failed: ${errorText}`);

          // Even if generation fails, return the workflow ID so user can edit manually
          return {
            success: true,
            workflowId: newWorkflow.id,
            workflowName: workflowName,
            message: `Workflow "${workflowName}" created but generation failed. You can edit it manually at /workflow/${newWorkflow.id}. Error: ${errorText.substring(0, 200)}`,
            warning:
              "Workflow generation partially failed - workflow created but may need manual editing",
          };
        }

        // Step 7: Process the streaming response
        // The workflow generation API returns a stream with workflow updates
        // We need to consume it to trigger the workflow creation
        // Note: The generation API requires authentication, so this may fail in some environments
        // In that case, the workflow will be created but empty, and the user can generate it via the UI
        const reader = response.body?.getReader();
        if (reader) {
          try {
            // Consume the stream to completion
            // The stream contains the workflow generation result which gets saved automatically
            while (true) {
              const { done } = await reader.read();
              if (done) break;
            }
          } catch (streamError) {
            logger.warn(
              `[CreateWorkflow] Error consuming stream: ${streamError}`,
            );
          } finally {
            reader.releaseLock();
          }
        }

        // Step 8: Verify workflow was updated by checking if it has nodes
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

  // Wrap user tools (availableTools + mcpTools) with billing tracking
  // This ensures usage is tracked even in agent mode where tool results
  // don't appear in responseMessage.parts
  const trackedAvailableTools = wrapToolsWithTracking(
    availableTools,
    config.userId,
  );
  const trackedMcpTools = wrapToolsWithTracking(mcpTools, config.userId);

  // Combine all tools first
  const combinedTools: Record<string, Tool> = {
    ...trackedAvailableTools,
    ...trackedMcpTools,
    ...contextTools,
    ...subAgentTools,
    ...workflowTools,
  };

  // Wrap ALL tools with call tracking to prevent infinite loops
  const allTools = wrapToolsWithCallTracking(combinedTools, ctx);

  // Track step count for persistence
  let stepCount = persistedState?.stepsExecuted ?? 0;

  // Create the v6 ToolLoopAgent with proper callbacks
  const agentSettings: ToolLoopAgentSettings<never, Record<string, Tool>> = {
    id: persistedState?.id ?? `orchestrator-${Date.now()}`,
    model: customModelProvider.getModel(config.chatModel),
    instructions: systemPrompt,
    tools: allTools,
    toolChoice: "auto",
    stopWhen: [
      stepCountIs(maxSteps),
      // Custom stop condition: stop when plan is complete
      (_options: { steps: StepResult<Record<string, Tool>>[] }) => {
        const complete = isPlanComplete(ctx);
        if (complete) {
          logger.info("Plan complete - stopping agent loop");
        }
        return complete;
      },
      // NEW: Stop if STOP signal received from any tool result
      (options: { steps: StepResult<Record<string, Tool>>[] }) => {
        // Check last step first (most recent)
        const lastStep = options.steps.at(-1);
        if (lastStep?.toolResults) {
          const hasStopSignal = lastStep.toolResults.some((r: any) => {
            const result = r.result;
            if (result?.STOP === true || result?.COMPLETED === true) {
              logger.info(
                `STOP signal received from tool result: ${JSON.stringify(result).slice(0, 100)}`,
              );
              return true;
            }
            // Also check for successful fragment creation
            if (
              result?.success === true &&
              (result?.fragmentId || result?.previewUrl)
            ) {
              logger.info("Fragment creation successful - stopping agent loop");
              return true;
            }
            return false;
          });
          if (hasStopSignal) {
            logger.info("STOP signal received from tool - stopping agent loop");
            return true;
          }
        }

        // Also check ALL recent steps (last 5) for fragment creation success
        const recentSteps = options.steps.slice(-5);
        for (const step of recentSteps) {
          if (step.toolResults) {
            const hasFragmentSuccess = step.toolResults.some((r: any) => {
              const result = r.result;
              return (
                result?.success === true &&
                (result?.fragmentId || result?.previewUrl) &&
                result?.COMPLETED !== false // Allow explicit override
              );
            });
            if (hasFragmentSuccess) {
              logger.info(
                "Fragment creation detected in recent steps - stopping agent loop",
              );
              return true;
            }
          }

          // Also check tool calls for createFragment
          if (step.toolCalls) {
            const createFragmentCall = step.toolCalls.find(
              (tc: any) => tc.toolName === "createFragment",
            );
            if (createFragmentCall && step.toolResults) {
              // If createFragment was called, check if it succeeded
              const fragmentResult = step.toolResults.find(
                (r: any) => r.toolCallId === createFragmentCall.toolCallId,
              ) as any;
              if (fragmentResult?.result) {
                const result = fragmentResult.result as any;
                if (
                  result.success === true &&
                  (result.fragmentId || result.previewUrl || result.COMPLETED)
                ) {
                  logger.info(
                    "createFragment succeeded in recent step - stopping agent loop",
                  );
                  return true;
                }
              }
            }
          }
        }

        return false;
      },
      // NEW: Stop if no plan created after 5 steps (agent is confused)
      (options: { steps: StepResult<Record<string, Tool>>[] }) => {
        if (options.steps.length >= 5 && !ctx.getPlan()) {
          logger.warn(
            "No plan created after 5 steps - stopping confused agent",
          );
          return true;
        }
        return false;
      },
      // NEW: Stop if agent keeps calling same tool repeatedly (loop detection)
      (options: { steps: StepResult<Record<string, Tool>>[] }) => {
        if (options.steps.length < 3) return false;

        const recentSteps = options.steps.slice(-3);
        const toolCalls = recentSteps
          .map((step) => step.toolCalls?.map((tc: any) => tc.toolName))
          .flat()
          .filter(Boolean);

        // Check if same tool called 3+ times in a row
        if (toolCalls.length >= 3) {
          const lastThree = toolCalls.slice(-3);
          if (lastThree[0] === lastThree[1] && lastThree[1] === lastThree[2]) {
            logger.warn(
              `Agent loop detected: tool "${lastThree[0]}" called 3 times in a row - stopping`,
            );
            return true;
          }
        }

        return false;
      },
      // NEW: Stop if agent makes no progress after many steps (all tasks stuck)
      (options: { steps: StepResult<Record<string, Tool>>[] }) => {
        if (options.steps.length < 10) return false;

        const plan = ctx.getPlan();
        if (!plan) return false;

        // Check if plan progress hasn't changed in last 5 steps
        // Store progress at each step to track changes
        const recentSteps = options.steps.slice(-5);
        const currentProgress = plan.progress;
        const progressUnchanged = recentSteps.every(() => {
          // Check if progress is the same as current
          return plan.progress === currentProgress;
        });

        if (progressUnchanged && plan.progress < 100) {
          const pendingTasks = ctx.getTasksByStatus("pending");
          const inProgressTasks = ctx.getTasksByStatus("in-progress");

          // If no pending tasks and no in-progress tasks, we're stuck
          if (pendingTasks.length === 0 && inProgressTasks.length === 0) {
            logger.warn(
              `Agent stuck: no progress in ${recentSteps.length} steps, no active tasks - stopping`,
            );
            return true;
          }

          // Also check if we've been stuck for too long
          if (plan.progress === 0 && options.steps.length >= 15) {
            logger.warn(
              `Agent stuck: 0% progress after ${options.steps.length} steps - stopping`,
            );
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
  const { availableTools, mcpTools, userAgent, maxSteps = 50 } = config;

  // Create context manager for this orchestrator instance
  const ctx = createAgentContext();

  // Build system prompt
  let systemPrompt = AGENT_ORCHESTRATOR_INSTRUCTIONS;

  if (userAgent?.instructions) {
    const agentPrompt = buildAgentSystemPrompt(userAgent.instructions);
    systemPrompt = `${agentPrompt}\n\n---\n\n${AGENT_ORCHESTRATOR_INSTRUCTIONS}`;
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
 */
export function createStreamingAutonomousAgent(config: AutonomousAgentConfig) {
  const {
    availableTools,
    mcpTools,
    userAgent,
    maxSteps = 50,
    dataStream,
  } = config;

  const { agent, contextManager, agentStateId } = createAutonomousAgent(config);

  // Build system prompt (same as createAutonomousAgent)
  let systemPrompt = AGENT_ORCHESTRATOR_INSTRUCTIONS;
  if (userAgent?.instructions) {
    const agentPrompt = buildAgentSystemPrompt(userAgent.instructions);
    systemPrompt = `${agentPrompt}\n\n---\n\n${AGENT_ORCHESTRATOR_INSTRUCTIONS}`;
  }

  // Create tools WITH dataStream for plan/task streaming events
  // This ensures the returned tools have the dataStream-aware context tools
  const contextTools = createAgentContextTools(contextManager, dataStream);
  const subAgentTools = createSubAgentTools(config, contextManager, dataStream);
  const workflowTools = createWorkflowTool(config, contextManager);

  // Wrap user tools (availableTools + mcpTools) with billing tracking
  // This ensures usage is tracked even in agent mode where tool results
  // don't appear in responseMessage.parts
  const trackedAvailableTools = wrapToolsWithTracking(
    availableTools,
    config.userId,
  );
  const trackedMcpTools = wrapToolsWithTracking(mcpTools, config.userId);

  // Combine all tools first
  const combinedTools: Record<string, Tool> = {
    ...trackedAvailableTools,
    ...trackedMcpTools,
    ...contextTools,
    ...subAgentTools,
    ...workflowTools,
  };

  // Wrap ALL tools with call tracking to prevent infinite loops
  const allTools = wrapToolsWithCallTracking(combinedTools, contextManager);

  return {
    system: systemPrompt,
    tools: allTools,
    stopWhen: stepCountIs(maxSteps),
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
