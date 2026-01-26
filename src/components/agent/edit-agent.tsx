"use client";

import { ShareableActions } from "@/components/shareable-actions";
import { useMutateAgents } from "@/hooks/queries/use-agents";
import { useMcpList } from "@/hooks/queries/use-mcp-list";
import { useObjectState } from "@/hooks/use-object-state";
import {
  Agent,
  AgentCreateSchema,
  AgentUpdateSchema,
  AgentIcon,
} from "app-types/agent";
import { ChatMention } from "app-types/chat";
import { MCPServerInfo } from "app-types/mcp";
import { DefaultToolName } from "lib/ai/tools";
import { BACKGROUND_COLORS } from "lib/const";
import { notify } from "lib/notify";
import { agentApi } from "@/lib/electron/agent-api";
import { cn, objectFlow } from "lib/utils";
import { Loader, WandSparklesIcon } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { safe } from "ts-safe";
import { Button } from "ui/button";
import { Input } from "ui/input";
import { Label } from "ui/label";
import { ScrollArea } from "ui/scroll-area";
import { handleErrorWithToast } from "ui/shared-toast";
import { Skeleton } from "ui/skeleton";
import { TextShimmer } from "ui/text-shimmer";
import { Textarea } from "ui/textarea";
import { useSystemAgentIcon } from "@/hooks/use-system-agent-icon";
import { AgentIconPicker } from "./agent-icon-picker";
import { AgentToolSelector } from "./agent-tool-selector";
import { GenerateAgentDialog } from "./generate-agent-dialog";

const defaultConfig = (): PartialBy<
  Omit<Agent, "createdAt" | "updatedAt" | "userId">,
  "id"
> => {
  return {
    name: "",
    description: "",
    icon: {
      type: "emoji",
      value:
        "https://cdn.jsdelivr.net/npm/emoji-datasource-apple/img/apple/64/1f916.png",
      style: {
        backgroundColor: BACKGROUND_COLORS[0],
      },
    },
    instructions: {
      role: "",
      systemPrompt: "",
      mentions: [],
    },
  };
};

interface EditAgentProps {
  initialAgent?: Agent;
  userId: string;
  /** Whether this is a system agent (read-only, not stored in DB) */
  isSystemAgent?: boolean;
}

export default function EditAgent({
  initialAgent,
  userId,
  isSystemAgent = false,
}: EditAgentProps) {
  const mutateAgents = useMutateAgents();
  const navigate = useNavigate();

  const [openGenerateAgentDialog, setOpenGenerateAgentDialog] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Hook to manage custom icons for system agents
  const { customIcon, saveCustomIcon } = useSystemAgentIcon(
    isSystemAgent ? initialAgent?.id : undefined,
  );

  // Get initial icon - use custom icon for system agents if available, otherwise use default
  const getInitialIcon = useCallback((): AgentIcon => {
    if (isSystemAgent && initialAgent?.id && initialAgent?.icon) {
      // Use custom icon if available, otherwise use default
      return customIcon || initialAgent.icon;
    }
    return (initialAgent?.icon ?? defaultConfig().icon) as AgentIcon;
  }, [isSystemAgent, initialAgent?.id, initialAgent?.icon, customIcon]);

  // Initialize agent state with initial data or defaults
  const [agent, setAgent] = useObjectState({
    ...(initialAgent || defaultConfig()),
    icon: getInitialIcon(),
  });

  // Update icon when customIcon changes (loaded from localStorage)
  useEffect(() => {
    if (isSystemAgent && initialAgent?.id && initialAgent?.icon && customIcon) {
      setAgent({ icon: customIcon });
    }
  }, [
    customIcon,
    isSystemAgent,
    initialAgent?.id,
    initialAgent?.icon,
    setAgent,
  ]);

  const { data: mcpList, isLoading: isMcpLoading } = useMcpList();

  const assignToolsByNames = useCallback(
    (toolNames: string[]) => {
      const allMentions: ChatMention[] = [];

      objectFlow(DefaultToolName).forEach((toolName) => {
        if (toolNames.includes(toolName)) {
          allMentions.push({
            type: "defaultTool",
            name: toolName,
            label: toolName,
          });
        }
      });

      (mcpList as (MCPServerInfo & { id: string })[])?.forEach((mcp) => {
        mcp.toolInfo.forEach((tool) => {
          if (toolNames.includes(tool.name)) {
            allMentions.push({
              type: "mcpTool",
              serverName: mcp.name,
              name: tool.name,
              serverId: mcp.id,
            });
          }
        });
      });

      if (allMentions.length > 0) {
        setAgent((prev) => ({
          instructions: {
            ...prev.instructions,
            mentions: allMentions,
          },
        }));
      }
    },
    [mcpList, setAgent],
  );

  const saveAgent = useCallback(() => {
    if (initialAgent) {
      safe(() => setIsSaving(true))
        .map(() => AgentUpdateSchema.parse({ ...agent }))
        .map(async (data) => agentApi.update(initialAgent.id, data))
        .ifOk((updatedAgent) => {
          mutateAgents(updatedAgent);
          toast.success("Agent updated");
          navigate({ to: "/agents" });
        })
        .ifFail(handleErrorWithToast)
        .watch(() => setIsSaving(false));
    } else {
      safe(() => setIsSaving(true))
        .map(() => AgentCreateSchema.parse({ ...agent, userId }))
        .map(async (data) => agentApi.create(data))
        .ifOk((updatedAgent) => {
          mutateAgents(updatedAgent);
          toast.success("Agent created");
          navigate({ to: "/agents" });
        })
        .ifFail(handleErrorWithToast)
        .watch(() => setIsSaving(false));
    }
  }, [agent, userId, mutateAgents, navigate, initialAgent]);

  const deleteAgent = useCallback(async () => {
    if (!initialAgent?.id) return;
    const ok = await notify.confirm({
      description: "Are you sure you want to delete this agent?",
    });
    if (!ok) return;
    safe(() => setIsSaving(true))
      .map(() => agentApi.delete(initialAgent.id))
      .ifOk(() => {
        mutateAgents({ id: initialAgent.id }, true);
        toast.success("Agent deleted");
        navigate({ to: "/agents" });
      })
      .ifFail(handleErrorWithToast)
      .watch(() => setIsSaving(false));
  }, [initialAgent?.id, mutateAgents, navigate]);

  const handleAgentChange = useCallback((generatedData: any) => {
    if (textareaRef.current) {
      textareaRef.current.scrollTo({
        top: textareaRef.current.scrollHeight,
      });
    }
    setAgent((prev) => {
      const update: Partial<Agent> = {};
      objectFlow(generatedData).forEach((data, key) => {
        if (key === "name") {
          update.name = data as string;
        }
        if (key === "description") {
          update.description = data as string;
        }
        if (key === "instructions") {
          update.instructions = {
            ...prev.instructions,
            systemPrompt: data as string,
          };
        }
        if (key === "role") {
          update.instructions = {
            ...prev.instructions,
            role: data as string,
          };
        }
      });
      return { ...prev, ...update };
    });
  }, []);

  const isLoadingTool = useMemo(() => {
    return isMcpLoading;
  }, [isMcpLoading]);

  // Map snake_case tool names to camelCase DefaultToolName enum values
  const toolNameMap: Record<string, DefaultToolName> = {
    browser_create_session: DefaultToolName.BrowserCreateSession,
    browser_close_session: DefaultToolName.BrowserCloseSession,
    browser_navigate: DefaultToolName.BrowserNavigate,
    browser_click: DefaultToolName.BrowserClick,
    browser_fill: DefaultToolName.BrowserFill,
    browser_type: DefaultToolName.BrowserType,
    browser_get_snapshot: DefaultToolName.BrowserGetSnapshot,
    browser_get_content: DefaultToolName.BrowserGetContent,
    browser_screenshot: DefaultToolName.BrowserScreenshot,
    browser_wait: DefaultToolName.BrowserWait,
    browser_evaluate: DefaultToolName.BrowserEvaluate,
    desktop_create: DefaultToolName.DesktopCreate,
    desktop_screenshot: DefaultToolName.DesktopScreenshot,
    desktop_click: DefaultToolName.DesktopClick,
    desktop_type: DefaultToolName.DesktopType,
    desktop_press: DefaultToolName.DesktopPress,
    desktop_scroll: DefaultToolName.DesktopScroll,
    desktop_drag: DefaultToolName.DesktopDrag,
    desktop_launch_app: DefaultToolName.DesktopLaunchApp,
  };

  // Convert system agent defaultTools to mentions format for display
  const agentMentions = useMemo(() => {
    const baseMentions = agent.instructions?.mentions || [];

    // If this is a system agent, convert its defaultTools to mentions
    // System agents have tools in initialAgent.instructions.tools (array of strings)
    // Note: tools property may exist on system agents but not in the type definition
    if (isSystemAgent && initialAgent) {
      const instructionsWithTools =
        initialAgent.instructions as typeof initialAgent.instructions & {
          tools?: string[];
        };
      if (instructionsWithTools?.tools) {
        const defaultTools = instructionsWithTools.tools;

        const toolMentions: ChatMention[] = defaultTools
          .map((toolName) => {
            // Try direct match first (for camelCase names like "webSearch", "terminal")
            if (
              Object.values(DefaultToolName).includes(
                toolName as DefaultToolName,
              )
            ) {
              return {
                type: "defaultTool",
                name: toolName as DefaultToolName,
                label: toolName,
              } as ChatMention;
            }

            // Try snake_case to camelCase mapping (for names like "browser_navigate")
            const mappedName = toolNameMap[toolName];
            if (mappedName) {
              return {
                type: "defaultTool",
                name: mappedName,
                label: toolName,
              } as ChatMention;
            }

            // For tools that don't map (like "setContext", "getContext"),
            // still show them but as a generic defaultTool mention
            // This ensures all tools are visible even if not in DefaultToolName enum
            return {
              type: "defaultTool",
              name: toolName as any, // Allow any string for display purposes
              label: toolName,
            } as ChatMention;
          })
          .filter((m): m is ChatMention => m !== null);

        // Merge with any existing mentions (user-added tools)
        const existingMentionKeys = new Set(
          baseMentions.map((m) => `${m.type}:${m.name}`),
        );
        const uniqueToolMentions = toolMentions.filter(
          (m) => !existingMentionKeys.has(`${m.type}:${m.name}`),
        );

        return [...baseMentions, ...uniqueToolMentions];
      }
    }

    return baseMentions;
  }, [agent.instructions?.mentions, isSystemAgent, initialAgent?.instructions]);

  const isLoading = useMemo(() => {
    return isLoadingTool || isSaving;
  }, [isLoadingTool, isSaving]);

  const isGenerating = openGenerateAgentDialog;

  // In single-user mode, the user always has edit access
  const hasEditAccess = true;

  return (
    <ScrollArea className="h-full w-full relative">
      <div className="w-full h-8 absolute bottom-0 left-0 bg-gradient-to-t from-background to-transparent z-20 pointer-events-none" />
      <div className="z-10 relative flex flex-col gap-4 px-8 pt-8 pb-14 max-w-3xl h-full mx-auto">
        <div className="sticky top-0 bg-background z-10 flex items-center justify-between pb-4 gap-2">
          <div className="w-full h-8 absolute top-[100%] left-0 bg-gradient-to-b from-background to-transparent z-20 pointer-events-none" />
          {isGenerating ? (
            <TextShimmer className="w-full text-2xl font-bold">
              Generating agent...
            </TextShimmer>
          ) : (
            <p className="w-full text-2xl font-bold">Agent</p>
          )}

          <div className="flex items-center gap-2">
            {isSystemAgent && (
              <div className="px-3 py-1 rounded-full bg-purple-500/10 text-purple-500 text-xs font-medium">
                System Agent
              </div>
            )}
            {hasEditAccess && !initialAgent && (
              <>
                <Button
                  variant="ghost"
                  disabled={isLoading}
                  onClick={() => setOpenGenerateAgentDialog(true)}
                  data-testid="agent-generate-with-ai-button"
                >
                  <WandSparklesIcon className="size-3" />
                  Generate with AI
                </Button>
              </>
            )}

            {initialAgent && (
              <div className="flex items-center gap-2">
                <ShareableActions
                  type="agent"
                  isOwner={true}
                  editHref={`/agent/${initialAgent.id}`}
                  onDelete={deleteAgent}
                  isDeleteLoading={isSaving}
                  disabled={isLoading}
                />
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-4 mt-4">
          <div className="flex flex-col justify-between gap-2 flex-1">
            <Label htmlFor="agent-name">Agent Name and Icon</Label>
            {false ? (
              <Skeleton className="w-full h-10" />
            ) : (
              <Input
                value={agent.name || ""}
                onChange={(e) => setAgent({ name: e.target.value })}
                autoFocus
                disabled={isLoading || !hasEditAccess}
                className="hover:bg-input bg-secondary/40 transition-colors border-transparent border-none! focus-visible:bg-input! ring-0!"
                id="agent-name"
                data-testid="agent-name-input"
                placeholder="Enter agent name"
                readOnly={!hasEditAccess}
              />
            )}
          </div>
          {false ? (
            <Skeleton className="w-16 h-16" />
          ) : (
            <AgentIconPicker
              icon={agent.icon}
              disabled={!hasEditAccess && !isSystemAgent}
              onChange={(icon) => {
                setAgent({ icon });
                // For system agents, save custom icon to localStorage
                if (isSystemAgent && initialAgent?.id) {
                  saveCustomIcon(icon);
                }
              }}
            />
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="agent-description">Description</Label>
          {false ? (
            <Skeleton className="w-full h-10" />
          ) : (
            <Input
              id="agent-description"
              data-testid="agent-description-input"
              disabled={isLoading || !hasEditAccess}
              placeholder="Describe what this agent does"
              className="hover:bg-input placeholder:text-xs bg-secondary/40 transition-colors border-transparent border-none! focus-visible:bg-input! ring-0!"
              value={agent.description || ""}
              onChange={(e) => setAgent({ description: e.target.value })}
              readOnly={!hasEditAccess}
            />
          )}
        </div>

        <div className="mt-10 flex items-center gap-2">
          <p className="text-sm text-muted-foreground">
            Configure your agent's personality and capabilities
          </p>
        </div>

        <div className="flex flex-col gap-6">
          <div className="flex gap-2 items-center">
            <span>This agent is a</span>
            {false ? (
              <Skeleton className="w-44 h-10" />
            ) : (
              <Input
                id="agent-role"
                data-testid="agent-role-input"
                disabled={isLoading || !hasEditAccess}
                placeholder="e.g. software engineer"
                className="hover:bg-input placeholder:text-xs bg-secondary/40 w-44 transition-colors border-transparent border-none! focus-visible:bg-input! ring-0!"
                value={agent.instructions?.role || ""}
                onChange={(e) =>
                  setAgent({
                    instructions: {
                      ...agent.instructions,
                      role: e.target.value || "",
                    },
                  })
                }
                readOnly={!hasEditAccess}
              />
            )}
            <span>who is an expert in</span>
          </div>

          <div className="flex gap-2 flex-col">
            <Label htmlFor="agent-prompt" className="text-base">
              Instructions
            </Label>
            {false ? (
              <Skeleton className="w-full h-48" />
            ) : (
              <Textarea
                id="agent-prompt"
                data-testid="agent-prompt-textarea"
                ref={textareaRef}
                disabled={isLoading || !hasEditAccess}
                placeholder="Enter detailed instructions for how this agent should behave..."
                className="p-6 hover:bg-input min-h-48 max-h-96 overflow-y-auto resize-none placeholder:text-xs bg-secondary/40 transition-colors border-transparent border-none! focus-visible:bg-input! ring-0!"
                value={agent.instructions?.systemPrompt || ""}
                onChange={(e) =>
                  setAgent({
                    instructions: {
                      ...agent.instructions,
                      systemPrompt: e.target.value || "",
                    },
                  })
                }
                readOnly={!hasEditAccess}
              />
            )}
          </div>

          <div className="flex gap-2 flex-col">
            <Label htmlFor="agent-tool-bindings" className="text-base">
              Tools
            </Label>
            {false ? (
              <Skeleton className="w-full h-12" />
            ) : (
              <AgentToolSelector
                mentions={agentMentions}
                isLoading={isLoadingTool}
                disabled={isLoading || isSystemAgent}
                hasEditAccess={hasEditAccess && !isSystemAgent}
                onChange={(mentions) => {
                  // For system agents, filter out default tools before saving
                  // (they're read-only and shouldn't be saved)
                  if (isSystemAgent && initialAgent) {
                    const instructionsWithTools =
                      initialAgent.instructions as typeof initialAgent.instructions & {
                        tools?: string[];
                      };
                    if (instructionsWithTools?.tools) {
                      const defaultTools = instructionsWithTools.tools;
                      const defaultToolSet = new Set(defaultTools);

                      // Create reverse mapping from camelCase to snake_case for comparison
                      const reverseToolNameMap: Record<string, string> = {};
                      Object.entries(toolNameMap).forEach(([snake, camel]) => {
                        reverseToolNameMap[camel] = snake;
                      });

                      const userMentions = mentions.filter((m) => {
                        if (m.type !== "defaultTool") return true;

                        const toolName = m.name as string;
                        // Check if this is a default tool (either direct match or mapped)
                        return (
                          !defaultToolSet.has(toolName) &&
                          !defaultToolSet.has(
                            reverseToolNameMap[toolName] || "",
                          )
                        );
                      });

                      setAgent({
                        instructions: {
                          ...agent.instructions,
                          mentions: userMentions,
                        },
                      });
                      return;
                    }
                  }
                  setAgent({
                    instructions: {
                      ...agent.instructions,
                      mentions,
                    },
                  });
                }}
              />
            )}
          </div>
        </div>

        {hasEditAccess && (
          <div className={cn("flex justify-end gap-2")}>
            {/* Delete button */}
            {initialAgent && (
              <Button
                className="mt-2 hover:text-destructive"
                variant="ghost"
                onClick={deleteAgent}
                disabled={isLoading}
              >
                Delete
              </Button>
            )}

            <Button
              className={cn("mt-2", !initialAgent ? "ml-auto" : "")}
              onClick={saveAgent}
              disabled={isLoading || !hasEditAccess}
              data-testid="agent-save-button"
            >
              {isSaving ? "Saving..." : "Save"}
              {isSaving && <Loader className="size-4 animate-spin" />}
            </Button>
          </div>
        )}
      </div>

      <GenerateAgentDialog
        open={openGenerateAgentDialog}
        onOpenChange={setOpenGenerateAgentDialog}
        onAgentChange={handleAgentChange}
        onToolsGenerated={assignToolsByNames}
      />
    </ScrollArea>
  );
}
