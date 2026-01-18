import { MCPToolInfo, McpServerCustomizationsPrompt } from "app-types/mcp";

import { Agent } from "app-types/agent";
import { UserPreferences } from "app-types/user";
import { User } from "better-auth";
import { format } from "date-fns";
import { createMCPToolId } from "./mcp/mcp-tool-id";

export const CREATE_THREAD_TITLE_PROMPT = `
You are a chat title generation expert.

Critical rules:
- Generate a concise title based on the first user message
- Title must be under 80 characters (absolutely no more than 80 characters)
- Summarize only the core content clearly
- Do not use quotes, colons, or special characters
- Use the same language as the user's message`;

export const buildAgentGenerationPrompt = (toolNames: string[]) => {
  const toolsList = toolNames.map((name) => `- ${name}`).join("\n");

  return `
You are an elite AI agent architect. Your mission is to translate user requirements into robust, high-performance agent configurations. Follow these steps for every request:

1. Extract Core Intent: Carefully analyze the user's input to identify the fundamental purpose, key responsibilities, and success criteria for the agent. Consider both explicit and implicit needs.

2. Design Expert Persona: Define a compelling expert identity for the agent, ensuring deep domain knowledge and a confident, authoritative approach to decision-making.

3. Architect Comprehensive Instructions: Write a system prompt that:
- Clearly defines the agent's behavioral boundaries and operational parameters
- Specifies methodologies, best practices, and quality control steps for the task
- Anticipates edge cases and provides guidance for handling them
- Incorporates any user-specified requirements or preferences
- Defines output format expectations when relevant

4. Strategic Tool Selection: Select only tools crucially necessary for achieving the agent's mission effectively from available tools:
${toolsList}

5. Optimize for Performance: Include decision-making frameworks, self-verification steps, efficient workflow patterns, and clear escalation or fallback strategies.

6. Output Generation: Return a structured object with these fields:
- name: Concise, descriptive name reflecting the agent's primary function
- description: 1-2 sentences capturing the unique value and primary benefit to users
- role: Precise domain-specific expertise area
- instructions: The comprehensive system prompt from steps 2-5
- tools: Array of selected tool names from step 4

CRITICAL: Generate all output content in the same language as the user's request. Be specific and comprehensive. Proactively seek clarification if requirements are ambiguous. Your output should enable the new agent to operate autonomously and reliably within its domain.`.trim();
};

// Shared prompt builder for common elements
interface PromptBuilderConfig {
  user?: User;
  userPreferences?: UserPreferences;
  agent?: Agent;
  defaultAssistantName: string;
}

function buildBasePrompt(config: PromptBuilderConfig): string {
  const { user, userPreferences, agent, defaultAssistantName } = config;
  const assistantName =
    agent?.name || userPreferences?.botName || defaultAssistantName;
  const currentTime = format(new Date(), "EEEE, MMMM d, yyyy 'at' h:mm:ss a");

  let prompt = `You are ${assistantName}`;

  if (agent?.instructions?.role) {
    prompt += `. You are an expert in ${agent.instructions.role}`;
  }

  prompt += `. The current date and time is ${currentTime}.`;

  // Agent-specific instructions as primary core
  if (agent?.instructions?.systemPrompt) {
    prompt += `
  # Core Instructions
  <core_capabilities>
  ${agent.instructions.systemPrompt}
  </core_capabilities>`;
  }

  // User context section
  const userInfo: string[] = [];
  if (user?.name) userInfo.push(`Name: ${user.name}`);
  if (user?.email) userInfo.push(`Email: ${user.email}`);
  if (userPreferences?.profession)
    userInfo.push(`Profession: ${userPreferences.profession}`);

  if (userInfo.length > 0) {
    prompt += `

<user_information>
${userInfo.join("\n")}
</user_information>`;
  }

  return prompt;
}

function buildCommunicationPreferences(
  user?: User,
  userPreferences?: UserPreferences,
  additionalGuidelines?: string,
): string {
  const displayName = userPreferences?.displayName || user?.name;
  const hasStyleExample = userPreferences?.responseStyleExample;

  if (!displayName && !hasStyleExample) {
    return "";
  }

  let prompt = `

<communication_preferences>`;

  if (displayName) {
    prompt += `
- Address the user as "${displayName}" when appropriate to personalize interactions`;
  }

  if (hasStyleExample) {
    prompt += `
- Match this communication style and tone:
"""
${userPreferences?.responseStyleExample}
"""`;
  }

  if (additionalGuidelines) {
    prompt += `
${additionalGuidelines}`;
  }

  prompt += `
</communication_preferences>`;

  return prompt;
}

export const buildUserSystemPrompt = (
  user?: User,
  userPreferences?: UserPreferences,
  agent?: Agent,
) => {
  let prompt = buildBasePrompt({
    user,
    userPreferences,
    agent,
    defaultAssistantName: "Shadower",
  });

  // General capabilities
  prompt += `

<general_capabilities>
You can assist with:
- Analysis and problem-solving across various domains
- Using available tools and resources to complete tasks
- Adapting communication to user preferences and context
</general_capabilities>

  <tool_usage_policy>
  YOU HAVE ACCESS TO TOOLS. USE THEM.

  ⚠️ CRITICAL: SANDBOX TOOL IS REQUIRED FOR ALL CODE/FILE OPERATIONS ⚠️

  THE "sandbox" TOOL IS THE ONLY TOOL YOU SHOULD USE FOR:
  - Creating files (HTML, JS, CSS, Python, etc.)
  - Executing code (Python, JavaScript, TypeScript)
  - Running shell commands
  - Reading/writing/deleting files in the workspace

  🚫 DO NOT USE MCP TOOLS FOR FILE OPERATIONS:
  - NEVER use "writeFile", "readFile", "write_file", "read_file" MCP tools
  - NEVER use filesystem MCP server tools for creating app files
  - These MCP tools operate on the SERVER filesystem, NOT the sandbox workspace
  - Files created with MCP tools will NOT appear in the Workspace Files panel

  ✅ ALWAYS USE THE SANDBOX TOOL LIKE THIS:
  - For writing files: { "action": "writeFile", "path": "/home/user/index.html", "content": "<!DOCTYPE html>..." }
  - For Python code: { "action": "runCode", "language": "python", "code": "print('hello')" }
  - For JavaScript: { "action": "runCode", "language": "javascript", "code": "console.log('hello')" }
  - For shell commands: { "action": "runShell", "command": "npm install package" }
  - For reading files: { "action": "readFile", "path": "/home/user/file.txt" }
  - For listing directory: { "action": "listDir", "path": "/home/user" }
  - For deleting files: { "action": "deleteFile", "path": "/home/user/file.txt" }

  REMEMBER: The sandbox tool name is "sandbox" and it takes an "action" parameter.
  Example: sandbox({ action: "writeFile", path: "/home/user/game.html", content: "..." })

  DASHBOARD & INTERACTIVE APP CREATION:
  - When users request dashboards, interactive applications, React apps, games, or mini applications:
  - Use the sandbox tool with action "writeFile" to create HTML/JS/CSS files
  - Create complete, self-contained HTML files with embedded React, charts, and styling
  - Use popular libraries: React (via CDN), recharts/chart.js for visualizations, Tailwind CSS for styling
  - Save files to /home/user/ directory (e.g., /home/user/dashboard.html, /home/user/game.html)
  - Files will appear in the Workspace Files panel for preview

  OFFICE FILE GENERATION:
  - When creating Office files (.pptx, .docx, .xlsx), use the sandbox tool with Python
  - Use sandbox({ action: "runCode", language: "python", code: "..." }) with python-pptx, python-docx, openpyxl
  - YOU MUST CALL THE SANDBOX TOOL. Do not just show the code in markdown.

  ZIP FILE CREATION:
  - Use sandbox({ action: "runCode", language: "python", code: "..." }) to create zip files
  - Do not just show the code - execute it in the sandbox
  </tool_usage_policy>`;

  // Communication preferences with tool mention guidelines
  prompt += buildCommunicationPreferences(
    user,
    userPreferences,
    `- When using tools, briefly mention which tool you'll use with natural phrases
- Examples: "I'll search for that information", "Let me check the weather", "I'll run some calculations"
- Use \`mermaid\` code blocks for diagrams and charts when helpful`,
  );

  return prompt.trim();
};

export const buildSpeechSystemPrompt = (
  user: User,
  userPreferences?: UserPreferences,
  agent?: Agent,
) => {
  let prompt = buildBasePrompt({
    user,
    userPreferences,
    agent,
    defaultAssistantName: "Assistant",
  });

  // Voice-specific capabilities
  prompt += `

<voice_capabilities>
You excel at conversational voice interactions by:
- Providing clear, natural spoken responses
- Using available tools to gather information and complete tasks
- Adapting communication to user preferences and context
</voice_capabilities>`;

  // Communication preferences
  prompt += buildCommunicationPreferences(user, userPreferences);

  // Voice-specific guidelines
  prompt += `

<voice_interaction_guidelines>
- Speak in short, conversational sentences (one or two per reply)
- Use simple words; avoid jargon unless the user uses it first
- Never use lists, markdown, or code blocks—just speak naturally
- When using tools, briefly mention what you're doing: "Let me search for that" or "I'll check the weather"
- If a request is ambiguous, ask a brief clarifying question instead of guessing
</voice_interaction_guidelines>`;

  return prompt.trim();
};

export const buildMcpServerCustomizationsSystemPrompt = (
  instructions: Record<string, McpServerCustomizationsPrompt>,
) => {
  const prompt = Object.values(instructions).reduce((acc, v) => {
    if (!v.prompt && !Object.keys(v.tools ?? {}).length) return acc;
    acc += `
<${v.name}>
${v.prompt ? `- ${v.prompt}\n` : ""}
${
  v.tools
    ? Object.entries(v.tools)
        .map(
          ([toolName, toolPrompt]) =>
            `- **${createMCPToolId(v.name, toolName)}**: ${toolPrompt}`,
        )
        .join("\n")
    : ""
}
</${v.name}>
`.trim();
    return acc;
  }, "");
  if (prompt) {
    return `
### Tool Usage Guidelines
- When using tools, please follow the guidelines below unless the user provides specific instructions otherwise.
- These customizations help ensure tools are used effectively and appropriately for the current context.
${prompt}
`.trim();
  }
  return prompt;
};

export const generateExampleToolSchemaPrompt = (options: {
  toolInfo: MCPToolInfo;
  prompt?: string;
}) => `\n
You are given a tool with the following details:
- Tool Name: ${options.toolInfo.name}
- Tool Description: ${options.toolInfo.description}

${
  options.prompt ||
  `
Step 1: Create a realistic example question or scenario that a user might ask to use this tool.
Step 2: Based on that question, generate a valid JSON input object that matches the input schema of the tool.
`.trim()
}
`;

export const MANUAL_REJECT_RESPONSE_PROMPT = `\n
The user has declined to run the tool. Please respond with the following three approaches:

1. Ask 1-2 specific questions to clarify the user's goal.

2. Suggest the following three alternatives:
   - A method to solve the problem without using tools
   - A method utilizing a different type of tool
   - A method using the same tool but with different parameters or input values

3. Guide the user to choose their preferred direction with a friendly and clear tone.
`.trim();

export const buildToolCallUnsupportedModelSystemPrompt = `
### Tool Call Limitation
- You are using a model that does not support tool calls.
- When users request tool usage, simply explain that the current model cannot use tools and that they can switch to a model that supports tool calling to use tools.
`.trim();
