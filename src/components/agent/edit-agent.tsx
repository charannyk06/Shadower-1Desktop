"use client";

import { ShareableActions, Visibility } from "@/components/shareable-actions";
import { useMutateAgents } from "@/hooks/queries/use-agents";
import { useBookmark } from "@/hooks/queries/use-bookmark";
import { useMcpList } from "@/hooks/queries/use-mcp-list";
import { useWorkflowToolList } from "@/hooks/queries/use-workflow-tool-list";
import { useObjectState } from "@/hooks/use-object-state";
import {
  Agent,
  AgentCreateSchema,
  AgentUpdateSchema,
  AgentIcon,
} from "app-types/agent";
import { ChatMention } from "app-types/chat";
import { MCPServerInfo } from "app-types/mcp";
import { WorkflowSummary } from "app-types/workflow";
import { DefaultToolName } from "lib/ai/tools";
import { BACKGROUND_COLORS } from "lib/const";
import { notify } from "lib/notify";
import { agentApi } from "@/lib/electron/agent-api";
import { cn, objectFlow } from "lib/utils";
import { Loader, WandSparklesIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
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
    visibility: "private",
  };
};

interface EditAgentProps {
  initialAgent?: Agent;
  userId: string;
  isOwner?: boolean;
  hasEditAccess?: boolean;
  isBookmarked?: boolean;
  /** Whether this is a system agent (read-only, not stored in DB) */
  isSystemAgent?: boolean;
}

export default function EditAgent({
  initialAgent,
  userId,
  isOwner = true,
  hasEditAccess = true,
  isSystemAgent = false,
}: EditAgentProps) {
  const t = useTranslations();
  const mutateAgents = useMutateAgents();
  const router = useRouter();

  const [openGenerateAgentDialog, setOpenGenerateAgentDialog] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isVisibilityChangeLoading, setIsVisibilityChangeLoading] =
    useState(false);

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

  const { toggleBookmark, isLoading: isBookmarkToggleLoadingFn } = useBookmark({
    itemType: "agent",
  });
  const isBookmarkToggleLoading = useMemo(
    () =>
      (initialAgent?.id && isBookmarkToggleLoadingFn(initialAgent?.id)) ||
      false,
    [initialAgent?.id, isBookmarkToggleLoadingFn],
  );

  const { data: mcpList, isLoading: isMcpLoading } = useMcpList();
  const { data: workflowToolList, isLoading: isWorkflowLoading } =
    useWorkflowToolList();

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

      (workflowToolList as WorkflowSummary[])?.forEach((workflow) => {
        if (toolNames.includes(workflow.name)) {
          allMentions.push({
            type: "workflow",
            name: workflow.name,
            workflowId: workflow.id,
          });
        }
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
    [mcpList, workflowToolList, setAgent],
  );

  const saveAgent = useCallback(() => {
    if (initialAgent) {
      safe(() => setIsSaving(true))
        .map(() => AgentUpdateSchema.parse({ ...agent }))
        .map(async (data) => agentApi.update(initialAgent.id, data))
        .ifOk((updatedAgent) => {
          mutateAgents(updatedAgent);
          toast.success(t("Agent.updated"));
          router.push(`/agents`);
        })
        .ifFail(handleErrorWithToast)
        .watch(() => setIsSaving(false));
    } else {
      safe(() => setIsSaving(true))
        .map(() => AgentCreateSchema.parse({ ...agent, userId }))
        .map(async (data) => agentApi.create(data))
        .ifOk((updatedAgent) => {
          mutateAgents(updatedAgent);
          toast.success(t("Agent.created"));
          router.push(`/agents`);
        })
        .ifFail(handleErrorWithToast)
        .watch(() => setIsSaving(false));
    }
  }, [agent, userId, mutateAgents, router, initialAgent, t]);

  const updateVisibility = useCallback(
    async (visibility: Visibility) => {
      if (initialAgent?.id) {
        safe(() => setIsVisibilityChangeLoading(true))
          .map(() => AgentUpdateSchema.parse({ visibility }))
          .map(async (data) => agentApi.update(initialAgent.id, data))
          .ifOk(() => {
            setAgent({ visibility });
            mutateAgents({ id: initialAgent.id, visibility });
            toast.success(t("Agent.visibilityUpdated"));
          })
          .ifFail(handleErrorWithToast)
          .watch(() => setIsVisibilityChangeLoading(false));
      } else {
        setAgent({ visibility });
      }
    },
    [initialAgent?.id, mutateAgents, setAgent, setIsVisibilityChangeLoading, t],
  );

  const deleteAgent = useCallback(async () => {
    if (!initialAgent?.id) return;
    const ok = await notify.confirm({
      description: t("Agent.deleteConfirm"),
    });
    if (!ok) return;
    safe(() => setIsSaving(true))
      .map(() => agentApi.delete(initialAgent.id))
      .ifOk(() => {
        mutateAgents({ id: initialAgent.id }, true);
        toast.success(t("Agent.deleted"));
        router.push("/agents");
      })
      .ifFail(handleErrorWithToast)
      .watch(() => setIsSaving(false));
  }, [initialAgent?.id, mutateAgents, router, t]);

  const handleBookmarkToggle = useCallback(async () => {
    if (!initialAgent?.id || isBookmarkToggleLoading) return;
    safe(async () => {
      await toggleBookmark({
        id: initialAgent.id,
        isBookmarked: agent.isBookmarked,
      });
    })
      .ifOk(() => {
        setAgent({ isBookmarked: !agent.isBookmarked });
      })
      .ifFail(handleErrorWithToast);
  }, [
    initialAgent?.id,
    toggleBookmark,
    agent.isBookmarked,
    isBookmarkToggleLoading,
  ]);

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
    return isMcpLoading || isWorkflowLoading;
  }, [isMcpLoading, isWorkflowLoading]);

  // Map snake_case tool names to camelCase DefaultToolName enum values
  const toolNameMap: Record<string, DefaultToolName> = {
    browser_navigate: DefaultToolName.BrowserNavigate,
    browser_act: DefaultToolName.BrowserAct,
    browser_observe: DefaultToolName.BrowserObserve,
    browser_extract: DefaultToolName.BrowserExtract,
    browser_screenshot: DefaultToolName.BrowserScreenshot,
    browser_stealth: DefaultToolName.BrowserStealth,
    browser_wait: DefaultToolName.BrowserWait,
    browser_close: DefaultToolName.BrowserClose,
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
            // Try direct match first (for camelCase names like "webSearch", "sandbox")
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
    return (
      isLoadingTool ||
      isSaving ||
      isVisibilityChangeLoading ||
      isBookmarkToggleLoading
    );
  }, [
    isLoadingTool,
    isSaving,
    isVisibilityChangeLoading,
    isBookmarkToggleLoading,
  ]);

  const isGenerating = openGenerateAgentDialog;

  return (
    <ScrollArea className="h-full w-full relative">
      <div className="w-full h-8 absolute bottom-0 left-0 bg-gradient-to-t from-background to-transparent z-20 pointer-events-none" />
      <div className="z-10 relative flex flex-col gap-4 px-8 pt-8 pb-14 max-w-3xl h-full mx-auto">
        <div className="sticky top-0 bg-background z-10 flex items-center justify-between pb-4 gap-2">
          <div className="w-full h-8 absolute top-[100%] left-0 bg-gradient-to-b from-background to-transparent z-20 pointer-events-none" />
          {isGenerating ? (
            <TextShimmer className="w-full text-2xl font-bold">
              {t("Agent.generatingAgent")}
            </TextShimmer>
          ) : (
            <p className="w-full text-2xl font-bold">{t("Agent.title")}</p>
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
                  {t("Common.generateWithAI")}
                </Button>
                {/* Hidden: Create With Example dropdown
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      className="justify-between data-[state=open]:bg-input"
                      disabled={isLoading}
                      data-testid="agent-create-with-example-button"
                    >
                      {t("Common.createWithExample")}
                      <ChevronDownIcon className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-54" align="end">
                    <DropdownMenuItem
                      onClick={() => setAgent(RandomDataGeneratorExample)}
                    >
                      <div className="flex items-center gap-2">
                        <span>🎲</span>
                        <span>Generate Random Data</span>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      data-testid="agent-create-with-example-weather-button"
                      onClick={() => setAgent(WeatherExample)}
                    >
                      <div className="flex items-center gap-2">
                        <span>🌤️</span>
                        <span>Weather Checker</span>
                      </div>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                */}
              </>
            )}

            {initialAgent && (
              <div className="flex items-center gap-2">
                <ShareableActions
                  type="agent"
                  visibility={agent.visibility || "private"}
                  isBookmarked={agent?.isBookmarked || false}
                  isOwner={isOwner}
                  onVisibilityChange={updateVisibility}
                  isVisibilityChangeLoading={isVisibilityChangeLoading}
                  disabled={isLoading}
                  onBookmarkToggle={handleBookmarkToggle}
                  isBookmarkToggleLoading={isBookmarkToggleLoading}
                />
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-4 mt-4">
          <div className="flex flex-col justify-between gap-2 flex-1">
            <Label htmlFor="agent-name">
              {t("Agent.agentNameAndIconLabel")}
            </Label>
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
                placeholder={t("Agent.agentNamePlaceholder")}
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
          <Label htmlFor="agent-description">
            {t("Agent.agentDescriptionLabel")}
          </Label>
          {false ? (
            <Skeleton className="w-full h-10" />
          ) : (
            <Input
              id="agent-description"
              data-testid="agent-description-input"
              disabled={isLoading || !hasEditAccess}
              placeholder={t("Agent.agentDescriptionPlaceholder")}
              className="hover:bg-input placeholder:text-xs bg-secondary/40 transition-colors border-transparent border-none! focus-visible:bg-input! ring-0!"
              value={agent.description || ""}
              onChange={(e) => setAgent({ description: e.target.value })}
              readOnly={!hasEditAccess}
            />
          )}
        </div>

        <div className="mt-10 flex items-center gap-2">
          <p className="text-sm text-muted-foreground">
            {t("Agent.agentSettingsDescription")}
          </p>
        </div>

        <div className="flex flex-col gap-6">
          <div className="flex gap-2 items-center">
            <span>{t("Agent.thisAgentIs")}</span>
            {false ? (
              <Skeleton className="w-44 h-10" />
            ) : (
              <Input
                id="agent-role"
                data-testid="agent-role-input"
                disabled={isLoading || !hasEditAccess}
                placeholder={t("Agent.agentRolePlaceholder")}
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
            <span>{t("Agent.expertIn")}</span>
          </div>

          <div className="flex gap-2 flex-col">
            <Label htmlFor="agent-prompt" className="text-base">
              {t("Agent.agentInstructionsLabel")}
            </Label>
            {false ? (
              <Skeleton className="w-full h-48" />
            ) : (
              <Textarea
                id="agent-prompt"
                data-testid="agent-prompt-textarea"
                ref={textareaRef}
                disabled={isLoading || !hasEditAccess}
                placeholder={t("Agent.agentInstructionsPlaceholder")}
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
              {t("Agent.agentToolsLabel")}
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
            {/* Delete button - only for owners */}
            {initialAgent && isOwner && (
              <Button
                className="mt-2 hover:text-destructive"
                variant="ghost"
                onClick={deleteAgent}
                disabled={isLoading}
              >
                {t("Common.delete")}
              </Button>
            )}

            <Button
              className={cn("mt-2", !initialAgent || !isOwner ? "ml-auto" : "")}
              onClick={saveAgent}
              disabled={isLoading || !hasEditAccess}
              data-testid="agent-save-button"
            >
              {isSaving ? t("Common.saving") : t("Common.save")}
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
