import { Tool, tool as createTool } from "ai";
import { z } from "zod";
import type { UIMessageStreamWriter } from "ai";
import { fragmentAgent } from "lib/ai/agents/fragment-agent";
import { deploymentService } from "lib/ai/fragments/deployment-service";
import {
  sandboxCostTracker,
  QuotaExceededError,
} from "lib/billing/sandbox-cost-tracker";
import { fragmentRepository } from "lib/db/repository";
import logger from "logger";

import type { ChatModel } from "app-types/chat";

/**
 * Fragment Tool Context
 */
export interface FragmentToolContext {
  userId: string;
  threadId: string;
  dataStream?: UIMessageStreamWriter;
  chatModel?: ChatModel;
}

/**
 * Create Fragment Tool - Autonomously creates web apps, micro-apps, and documents
 * This is the main entry point for the agent to create fragments
 */
export function createFragmentTool(context: FragmentToolContext): Tool {
  return createTool({
    description: `Autonomously create web apps, micro-apps, games, dashboards, and documents.

🚀 CAPABILITIES:
- **Next.js Apps**: Full-stack web apps, dashboards, admin panels, e-commerce, landing pages
- **Vue.js SPAs**: Interactive UIs, component libraries, progressive web apps
- **Streamlit**: Data dashboards, analytics apps, internal tools, ML demos
- **Gradio**: ML model interfaces, AI demos, computer vision apps
- **Python**: Data analysis, charts, Word/Excel/PPT documents, calculations

⚡ HOW IT WORKS:
1. Describe what you want to build
2. AI automatically chooses the best template
3. Production-quality code is generated
4. Preview URL is provided instantly
5. Edits are surgical (no full rewrites)

💡 EXAMPLES:
- "Build a todo app with dark mode"
- "Create a dashboard showing sales data"
- "Make a snake game"
- "Generate a PowerPoint about AI trends"
- "Build a ML model demo interface"

The system is FULLY AUTONOMOUS - just describe what you want!`,
    inputSchema: z.object({
      request: z.string().describe("Description of what to create"),
    }),
    execute: async (
      { request }: { request: string },
      {
        toolCallId,
      }: { toolCallId: string; abortSignal?: AbortSignal; messages?: any[] },
    ) => {
      const startTime = Date.now();

      try {
        // Check quota before starting
        await sandboxCostTracker.enforceQuota(context.userId);

        logger.info(
          `[FRAGMENT_TOOL] Creating fragment for user ${context.userId} (toolCallId: ${toolCallId}): ${request.slice(0, 50)}...`,
        );

        // Create a wrapper dataStream that includes toolCallId in all writes
        const wrappedDataStream = context.dataStream
          ? {
              ...context.dataStream,
              write: (data: any) => {
                // Ensure toolCallId is included in data-fragment-progress events
                if (data.type === "data-fragment-progress" && data.data) {
                  data.data.toolCallId = toolCallId;
                }
                return context.dataStream!.write(data);
              },
            }
          : undefined;

        // Call FragmentAgent for autonomous creation
        const result = await fragmentAgent.autonomousCreate(request, {
          userId: context.userId,
          threadId: context.threadId,
          dataStream: wrappedDataStream,
          chatModel: context.chatModel,
          toolCallId, // Pass toolCallId explicitly
        });

        // Track usage
        const durationMs = Date.now() - startTime;
        await sandboxCostTracker.trackSession({
          userId: context.userId,
          sessionId: result.sandboxId,
          template: result.template,
          durationMs,
          operationType: "create",
        });

        return {
          success: true,
          COMPLETED: true, // Signal that fragment creation is complete - agent should stop
          fragmentId: result.fragmentId,
          title: result.title,
          template: result.template,
          previewUrl: result.previewUrl,
          code: result.code, // Include the generated code for workspace files display
          message: `Created ${result.title} using ${result.template}`,
          hint: result.previewUrl
            ? `Preview available at: ${result.previewUrl}`
            : "Code executed successfully",
          instruction:
            "Fragment creation is complete. Provide your final response to the user NOW. Do NOT create new plans or tasks.",
        };
      } catch (error: any) {
        if (error instanceof QuotaExceededError) {
          return {
            success: false,
            error: error.message,
            hint: "Consider upgrading your plan for more sandbox time.",
          };
        }

        logger.error("[FRAGMENT_TOOL] Creation failed:", error);
        return {
          success: false,
          error: error.message || "Failed to create fragment",
        };
      }
    },
  });
}

/**
 * Edit Fragment Tool - Surgically edit existing fragments
 */
export function createEditFragmentTool(context: FragmentToolContext): Tool {
  return createTool({
    description: `Edit an existing fragment with surgical precision.

🔧 HOW IT WORKS:
- Uses Morph API for targeted edits
- Only changes what's necessary (NO full rewrites)
- Preserves existing code structure
- Updates preview instantly

💡 EXAMPLES:
- "Change the button color to blue"
- "Add a dark mode toggle"
- "Fix the chart labels"
- "Add input validation"

Provide the fragment ID and describe your edit.`,
    inputSchema: z.object({
      fragmentId: z.string().describe("ID of the fragment to edit"),
      editRequest: z.string().describe("Description of the edit to make"),
    }),
    execute: async (
      { fragmentId, editRequest }: { fragmentId: string; editRequest: string },
      {
        toolCallId,
      }: { toolCallId: string; abortSignal?: AbortSignal; messages?: any[] },
    ) => {
      const startTime = Date.now();

      try {
        // Check quota
        await sandboxCostTracker.enforceQuota(context.userId);

        logger.info(
          `[FRAGMENT_TOOL] Editing fragment ${fragmentId}: ${editRequest.slice(0, 50)}...`,
        );

        // Create a wrapper dataStream that includes toolCallId in all writes
        const wrappedDataStream = context.dataStream
          ? {
              ...context.dataStream,
              write: (data: any) => {
                // Ensure toolCallId is included in data-fragment-progress events
                if (data.type === "data-fragment-progress" && data.data) {
                  data.data.toolCallId = toolCallId;
                }
                return context.dataStream!.write(data);
              },
            }
          : undefined;

        // Call FragmentAgent for autonomous edit
        const result = await fragmentAgent.autonomousEdit(
          fragmentId,
          editRequest,
          {
            userId: context.userId,
            dataStream: wrappedDataStream,
            chatModel: context.chatModel,
            toolCallId, // Pass toolCallId explicitly
          },
        );

        // Track usage
        const durationMs = Date.now() - startTime;
        await sandboxCostTracker.trackSession({
          userId: context.userId,
          sessionId: result.sandboxId,
          template: result.template,
          durationMs,
          operationType: "edit",
        });

        return {
          success: true,
          fragmentId: result.fragmentId,
          previewUrl: result.previewUrl,
          code: result.code, // Include the updated code for workspace files display
          template: result.template,
          message: "Edit applied successfully",
        };
      } catch (error: any) {
        if (error instanceof QuotaExceededError) {
          return {
            success: false,
            error: error.message,
          };
        }

        logger.error("[FRAGMENT_TOOL] Edit failed:", error);
        return {
          success: false,
          error: error.message || "Failed to edit fragment",
        };
      }
    },
  });
}

/**
 * Deploy Fragment Tool - Create shareable link for a fragment
 */
export function createDeployFragmentTool(context: FragmentToolContext): Tool {
  return createTool({
    description: `Deploy a fragment and get a shareable public URL.

🌐 DEPLOYMENT OPTIONS:
- 1h: Quick share for testing
- 6h: Extended demo session
- 24h: Day-long access (default)
- 7d: Week-long deployment

The deployed fragment will be accessible to anyone with the link.`,
    inputSchema: z.object({
      fragmentId: z.string().describe("ID of the fragment to deploy"),
      duration: z
        .enum(["1h", "6h", "24h", "7d"])
        .optional()
        .default("24h")
        .describe("How long the deployment should last"),
    }),
    execute: async ({
      fragmentId,
      duration = "24h",
    }: {
      fragmentId: string;
      duration?: "1h" | "6h" | "24h" | "7d";
    }) => {
      try {
        logger.info(
          `[FRAGMENT_TOOL] Deploying fragment ${fragmentId} for ${duration}`,
        );

        const result = await deploymentService.deployFragment(
          fragmentId,
          context.userId,
          duration,
        );

        return {
          success: true,
          url: result.url,
          shareId: result.shareId,
          expiresAt: result.expiresAt.toISOString(),
          message: `Fragment deployed! Share this link: ${result.url}`,
        };
      } catch (error: any) {
        logger.error("[FRAGMENT_TOOL] Deploy failed:", error);
        return {
          success: false,
          error: error.message || "Failed to deploy fragment",
        };
      }
    },
  });
}

/**
 * Get Fragment Tool - Retrieve fragment details
 */
export function createGetFragmentTool(context: FragmentToolContext): Tool {
  return createTool({
    description:
      "Get details about an existing fragment including its code and preview URL.",
    inputSchema: z.object({
      fragmentId: z.string().describe("ID of the fragment to retrieve"),
    }),
    execute: async ({ fragmentId }: { fragmentId: string }) => {
      try {
        const fragment = await fragmentRepository.getById(fragmentId);

        if (!fragment) {
          return {
            success: false,
            error: "Fragment not found",
          };
        }

        // Verify ownership
        if (fragment.user_id !== context.userId) {
          return {
            success: false,
            error: "Not authorized to access this fragment",
          };
        }

        return {
          success: true,
          fragment: {
            id: fragment.id,
            title: fragment.title,
            description: fragment.description,
            template: fragment.template,
            status: fragment.status,
            previewUrl: fragment.preview_url,
            deploymentUrl: fragment.deployment_url,
            createdAt: fragment.created_at.toISOString(),
          },
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message || "Failed to get fragment",
        };
      }
    },
  });
}

/**
 * List Fragments Tool - Get user's fragments
 */
export function createListFragmentsTool(context: FragmentToolContext): Tool {
  return createTool({
    description:
      "List all fragments created in the current thread or by the user.",
    inputSchema: z.object({
      scope: z
        .enum(["thread", "user"])
        .optional()
        .default("thread")
        .describe("Scope of fragments to list"),
      limit: z
        .number()
        .optional()
        .default(10)
        .describe("Maximum number of fragments to return"),
    }),
    execute: async ({
      scope = "thread",
      limit = 10,
    }: {
      scope?: "thread" | "user";
      limit?: number;
    }) => {
      try {
        let fragments;

        if (scope === "thread") {
          fragments = await fragmentRepository.getByThread(context.threadId);
        } else {
          fragments = await fragmentRepository.getByUser(context.userId, limit);
        }

        return {
          success: true,
          count: fragments.length,
          fragments: fragments.slice(0, limit).map((f) => ({
            id: f.id,
            title: f.title,
            template: f.template,
            status: f.status,
            previewUrl: f.preview_url,
            createdAt: f.created_at.toISOString(),
          })),
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message || "Failed to list fragments",
        };
      }
    },
  });
}

/**
 * Create all fragment tools for the orchestrator
 */
export function createFragmentTools(
  context: FragmentToolContext,
): Record<string, Tool> {
  return {
    createFragment: createFragmentTool(context),
    editFragment: createEditFragmentTool(context),
    deployFragment: createDeployFragmentTool(context),
    getFragment: createGetFragmentTool(context),
    listFragments: createListFragmentsTool(context),
  };
}
