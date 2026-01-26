"use client";

import { UploadedFile, appStore } from "@/app/store";
import { ContextIndicator } from "@/components/ui/context-indicator";
import { UIMessage, UseChatHelpers } from "@ai-sdk/react";
import type {
  ACPSession,
  SessionConfigOption,
  SessionConfigSelectGroup,
  SessionConfigSelectOption,
} from "app-types/acp";
import { ChatMention, ChatModel } from "app-types/chat";
import {
  Check,
  ChevronDown,
  CornerRightUp,
  FileTextIcon,
  ImagesIcon,
  Loader2,
  MicIcon,
  PaperclipIcon,
  PlusIcon,
  Settings2,
  Square,
  XIcon,
} from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "ui/button";
import { useShallow } from "zustand/shallow";
import { SelectModel } from "./select-model";
import { ToolModeDropdown } from "./tool-mode-dropdown";
import { ChatModeDropdown } from "./chat-mode-dropdown";

import { useThreadFileUploader } from "@/hooks/use-thread-file-uploader";
import { cn } from "@/lib/utils";
import { Editor } from "@tiptap/react";
import { DefaultToolName } from "lib/ai/tools";
import equal from "lib/equal";
import { Avatar, AvatarFallback, AvatarImage } from "ui/avatar";
import { ClaudeIcon } from "ui/claude-icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "ui/dropdown-menu";
import { GeminiIcon } from "ui/gemini-icon";
import { GrokIcon } from "ui/grok-icon";
import { GroqIcon } from "ui/groq-icon";
import { MCPIcon } from "ui/mcp-icon";
import { OllamaIcon } from "ui/ollama-icon";
import { OpenRouterIcon } from "ui/open-router-icon";
import { OpenAIIcon } from "ui/openai-icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";
import { DefaultToolIcon } from "./default-tool-icon";
import { ToolSelectDropdown } from "./tool-select-dropdown";

import { useChatModels } from "@/hooks/queries/use-chat-models";
import { isFilePartSupported, isIngestSupported } from "@/lib/ai/file-support";
import { FileUIPart, TextUIPart } from "ai";
import { AgentSummary } from "app-types/agent";
import { EMOJI_DATA } from "lib/const";
import { toast } from "sonner";
import { FileTypeIcon } from "./file-type-icon";

interface PromptInputProps {
  placeholder?: string;
  setInput: (value: string) => void;
  input: string;
  onStop: () => void;
  sendMessage: UseChatHelpers<UIMessage>["sendMessage"];
  toolDisabled?: boolean;
  isLoading?: boolean;
  model?: ChatModel;
  setModel?: (model: ChatModel) => void;
  acpSession?: ACPSession | null;
  onSetAcpModel?: (modelId: string) => Promise<void>;
  onSetAcpConfigOption?: (configId: string, value: string) => Promise<void>;
  onSetAcpMode?: (modeId: string) => Promise<void>;
  voiceDisabled?: boolean;
  threadId?: string;
  disabledMention?: boolean;
  onFocus?: () => void;
}

const ChatMentionInput = lazy(() => import("./chat-mention-input"));

type ConfigOptionValue = {
  value: string;
  name: string;
  description?: string | null;
  group?: string;
};

const isConfigGroup = (
  value: SessionConfigSelectOption | SessionConfigSelectGroup,
): value is SessionConfigSelectGroup => {
  return "group" in value;
};

const flattenConfigOptions = (
  options: SessionConfigOption["options"],
): ConfigOptionValue[] => {
  if (!Array.isArray(options)) return [];
  if (options.length === 0) return [];

  if (
    isConfigGroup(
      options[0] as SessionConfigSelectOption | SessionConfigSelectGroup,
    )
  ) {
    return (options as SessionConfigSelectGroup[]).flatMap((group) =>
      group.options.map((opt) => ({
        value: opt.value,
        name: opt.name,
        description: opt.description ?? undefined,
        group: group.name,
      })),
    );
  }

  return (options as SessionConfigSelectOption[]).map((opt) => ({
    value: opt.value,
    name: opt.name,
    description: opt.description ?? undefined,
  }));
};

function ACPAgentOptionsDropdown({
  session,
  onSetModel,
  onSetConfigOption,
  onSetMode,
}: {
  session?: ACPSession | null;
  onSetModel?: (modelId: string) => Promise<void>;
  onSetConfigOption?: (configId: string, value: string) => Promise<void>;
  onSetMode?: (modeId: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);

  const availableModes = session?.availableModes || [];
  const currentMode = session?.currentMode;
  const models = session?.models;
  const hasModels = !!models?.availableModels?.length;

  const filteredConfigOptions = useMemo(() => {
    const options = session?.configOptions || [];
    if (hasModels) {
      return options.filter((option) => option.category !== "model");
    }
    return options;
  }, [session?.configOptions, hasModels]);

  const hasOptions =
    availableModes.length > 0 || hasModels || filteredConfigOptions.length > 0;

  const handleSetModel = useCallback(
    async (modelId: string) => {
      if (!onSetModel) return;
      try {
        await onSetModel(modelId);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to set model",
        );
      }
    },
    [onSetModel],
  );

  const handleSetMode = useCallback(
    async (modeId: string) => {
      if (!onSetMode) return;
      try {
        await onSetMode(modeId);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to set mode",
        );
      }
    },
    [onSetMode],
  );

  const handleSetConfigOption = useCallback(
    async (configId: string, value: string) => {
      if (!onSetConfigOption) return;
      try {
        await onSetConfigOption(configId, value);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to update option",
        );
      }
    },
    [onSetConfigOption],
  );

  if (!session || !hasOptions) return null;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "rounded-full p-2! data-[state=open]:bg-input! hover:bg-input! mr-1",
            open && "bg-input!",
          )}
        >
          <Settings2 className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-64">
        {availableModes.length > 0 && (
          <>
            <DropdownMenuLabel className="text-muted-foreground">
              Mode
            </DropdownMenuLabel>
            {availableModes.map((mode) => (
              <DropdownMenuItem
                key={mode}
                className="cursor-pointer"
                onClick={() => handleSetMode(mode)}
              >
                {currentMode === mode ? (
                  <Check className="size-3 mr-2" />
                ) : (
                  <span className="w-5" />
                )}
                <span className="truncate">{mode}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </>
        )}

        {hasModels && (
          <>
            <DropdownMenuLabel className="text-muted-foreground">
              Model
            </DropdownMenuLabel>
            {models?.availableModels?.map((model) => (
              <DropdownMenuItem
                key={model.modelId}
                className="cursor-pointer"
                onClick={() => handleSetModel(model.modelId)}
              >
                {models.currentModelId === model.modelId ? (
                  <Check className="size-3 mr-2" />
                ) : (
                  <span className="w-5" />
                )}
                <span className="truncate">{model.name}</span>
              </DropdownMenuItem>
            ))}
            {filteredConfigOptions.length > 0 && <DropdownMenuSeparator />}
          </>
        )}

        {filteredConfigOptions.map((option) => {
          const flattened = flattenConfigOptions(option.options);
          const valueMap = new Map(
            flattened.map((item) => [item.value, item.name]),
          );
          const currentLabel =
            valueMap.get(option.currentValue || "") || option.currentValue;

          const grouped = flattened.reduce((acc, item) => {
            const key = item.group || "__ungrouped__";
            const list = acc.get(key) || [];
            list.push(item);
            acc.set(key, list);
            return acc;
          }, new Map<string, ConfigOptionValue[]>());

          return (
            <DropdownMenuSub key={option.id}>
              <DropdownMenuSubTrigger className="cursor-pointer">
                <span className="truncate">{option.name}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {currentLabel}
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-64">
                {Array.from(grouped.entries()).map(([group, items], idx) => (
                  <div key={`${option.id}-${group}`}>
                    {group !== "__ungrouped__" && (
                      <DropdownMenuLabel className="text-muted-foreground">
                        {group}
                      </DropdownMenuLabel>
                    )}
                    {items.map((item) => (
                      <DropdownMenuItem
                        key={item.value}
                        className="cursor-pointer"
                        onClick={() =>
                          handleSetConfigOption(option.id, item.value)
                        }
                      >
                        {option.currentValue === item.value ? (
                          <Check className="size-3 mr-2" />
                        ) : (
                          <span className="w-5" />
                        )}
                        <span className="truncate">{item.name}</span>
                      </DropdownMenuItem>
                    ))}
                    {idx < grouped.size - 1 && <DropdownMenuSeparator />}
                  </div>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function PromptInput({
  placeholder,
  sendMessage,
  model,
  setModel,
  acpSession,
  onSetAcpModel,
  onSetAcpConfigOption,
  onSetAcpMode,
  input,
  onFocus,
  setInput,
  onStop,
  isLoading,
  toolDisabled,
  voiceDisabled,
  threadId,
  disabledMention,
}: PromptInputProps) {
  const [isUploadDropdownOpen, setIsUploadDropdownOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { uploadFiles } = useThreadFileUploader(threadId);
  const { data: providers } = useChatModels();

  const [
    globalModel,
    threadMentions,
    threadFiles,
    threadImageToolModel,
    appStoreMutate,
  ] = appStore(
    useShallow((state) => [
      state.chatModel,
      state.threadMentions,
      state.threadFiles,
      state.threadImageToolModel,
      state.mutate,
    ]),
  );

  const modelInfo = useMemo(() => {
    const provider = providers?.find(
      (provider) => provider.provider === globalModel?.provider,
    );
    const model = provider?.models.find(
      (model) => model.name === globalModel?.model,
    );
    return model;
  }, [providers, globalModel]);

  const supportedFileMimeTypes = modelInfo?.supportedFileMimeTypes;
  const canUploadImages =
    supportedFileMimeTypes?.some((mime) => mime.startsWith("image/")) ?? true;

  const mentions = useMemo<ChatMention[]>(() => {
    if (!threadId) return [];
    return threadMentions[threadId!] ?? [];
  }, [threadMentions, threadId]);

  const uploadedFiles = useMemo<UploadedFile[]>(() => {
    if (!threadId) return [];
    return threadFiles[threadId] ?? [];
  }, [threadFiles, threadId]);

  const imageToolModel = useMemo(() => {
    if (!threadId) return undefined;
    return threadImageToolModel[threadId];
  }, [threadImageToolModel, threadId]);

  const chatModel = useMemo(() => {
    return model ?? globalModel;
  }, [model, globalModel]);

  const editorRef = useRef<Editor | null>(null);

  const setChatModel = useCallback(
    (model: ChatModel) => {
      // Auto-sync settings when a coding agent (ACP agent) is selected
      const isACPAgent = model.provider === "coding-agents";
      console.log("[PromptInput] setChatModel called:", { model, isACPAgent });

      if (setModel) {
        setModel(model);
      } else {
        appStoreMutate({ chatModel: model });
      }

      // When an ACP agent is selected, auto-configure appropriate settings
      if (isACPAgent) {
        console.log("[PromptInput] Auto-syncing settings for ACP agent");
        appStoreMutate({
          // ACP agents handle tools internally, so set to "auto" mode
          toolChoice: "auto",
          // Agent mode works best with coding agents for autonomous execution
          chatMode: "agent",
        });
        // Verify the store was updated
        setTimeout(() => {
          const state = appStore.getState();
          console.log("[PromptInput] Store state after auto-sync:", {
            toolChoice: state.toolChoice,
            chatMode: state.chatMode,
          });
        }, 0);
      }
    },
    [setModel, appStoreMutate],
  );

  const deleteMention = useCallback(
    (mention: ChatMention) => {
      if (!threadId) return;
      appStoreMutate((prev) => {
        const newMentions = mentions.filter((m) => !equal(m, mention));
        return {
          threadMentions: {
            ...prev.threadMentions,
            [threadId!]: newMentions,
          },
        };
      });
    },
    [mentions, threadId],
  );

  const deleteFile = useCallback(
    (fileId: string) => {
      if (!threadId) return;

      // Find file and abort if uploading
      const file = uploadedFiles.find((f) => f.id === fileId);
      if (file?.isUploading && file.abortController) {
        file.abortController.abort();
      }

      // Cleanup preview URL if exists
      if (file?.previewUrl) {
        URL.revokeObjectURL(file.previewUrl);
      }

      appStoreMutate((prev) => {
        const newFiles = uploadedFiles.filter((f) => f.id !== fileId);
        return {
          threadFiles: {
            ...prev.threadFiles,
            [threadId]: newFiles,
          },
        };
      });
    },
    [uploadedFiles, threadId, appStoreMutate],
  );

  // uploadFiles handled by hook

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const list = e.target.files;
      if (!list) return;
      await uploadFiles(Array.from(list));
      // Reset input
      if (fileInputRef.current) fileInputRef.current.value = "";
      setIsUploadDropdownOpen(false);
    },
    [uploadFiles],
  );

  const handleGenerateImage = useCallback(
    (provider?: "google" | "openai") => {
      if (!provider) {
        appStoreMutate({
          threadImageToolModel: {},
        });
      }
      if (!threadId) return;

      setIsUploadDropdownOpen(false);

      appStoreMutate((prev) => ({
        threadImageToolModel: {
          ...prev.threadImageToolModel,
          [threadId]: provider,
        },
      }));

      // Focus on the input
      editorRef.current?.commands.focus();
    },
    [threadId, editorRef],
  );

  const addMention = useCallback(
    (mention: ChatMention) => {
      if (!threadId) return;
      appStoreMutate((prev) => {
        if (mentions.some((m) => equal(m, mention))) return prev;

        const newMentions =
          mention.type == "agent"
            ? [...mentions.filter((m) => m.type !== "agent"), mention]
            : [...mentions, mention];

        return {
          threadMentions: {
            ...prev.threadMentions,
            [threadId!]: newMentions,
          },
        };
      });
    },
    [mentions, threadId],
  );

  const onSelectAgent = useCallback(
    (agent: AgentSummary) => {
      appStoreMutate((prev) => {
        return {
          threadMentions: {
            ...prev.threadMentions,
            [threadId!]: [
              {
                type: "agent",
                name: agent.name,
                icon: agent.icon,
                description: agent.description,
                agentId: agent.id,
              },
            ],
          },
        };
      });
    },
    [mentions, threadId],
  );

  const onChangeMention = useCallback(
    (mentions: ChatMention[]) => {
      let hasAgent = false;
      [...mentions]
        .reverse()
        .filter((m) => {
          if (m.type == "agent") {
            if (hasAgent) return false;
            hasAgent = true;
          }

          return true;
        })
        .reverse()
        .forEach(addMention);
    },
    [addMention],
  );

  const submit = () => {
    if (isLoading) return;
    if (uploadedFiles.some((file) => file.isUploading)) {
      toast.error("Please wait for files to finish uploading before sending.");
      return;
    }
    const userMessage = input?.trim() || "";
    if (userMessage.length === 0) return;

    setInput("");
    const attachmentParts = uploadedFiles.reduce<
      Array<FileUIPart | TextUIPart | any>
    >((acc, file) => {
      const isFileSupported = isFilePartSupported(
        file.mimeType,
        supportedFileMimeTypes,
      );
      const link = file.url || file.dataUrl || "";
      if (!link) return acc;
      if (isFileSupported) {
        acc.push({
          type: "file",
          url: link,
          mediaType: file.mimeType,
          filename: file.name,
        } as FileUIPart);
      } else {
        // Use a rich UI part for unsupported file types; will be filtered out for model input
        acc.push({
          type: "source-url",
          url: link,
          title: file.name,
          mediaType: file.mimeType,
        } as any);
      }
      return acc;
    }, []);

    if (attachmentParts.length) {
      const summary = uploadedFiles
        .map((file, index) => {
          const type = file.mimeType || "unknown";
          return `${index + 1}. ${file.name} (${type})`;
        })
        .join("\n");

      attachmentParts.unshift({
        type: "text",
        text: `Attached files:\n${summary}`,
        ingestionPreview: true,
      });
    }

    // Check if model is selected before sending
    if (!chatModel || !chatModel.provider || !chatModel.model) {
      toast.error(
        "Please select a model first. Add an API key in Settings > Models.",
      );
      return;
    }

    sendMessage({
      role: "user",
      parts: [...attachmentParts, { type: "text", text: userMessage }],
    });
    appStoreMutate((prev) => ({
      threadFiles: {
        ...prev.threadFiles,
        [threadId!]: [],
      },
    }));
  };

  // Handle ESC key to clear mentions
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === "Escape" &&
        threadId &&
        (mentions.length > 0 || imageToolModel)
      ) {
        e.preventDefault();
        e.stopPropagation();
        appStoreMutate(() => ({
          threadMentions: {},
          agentId: undefined,
          threadImageToolModel: {},
        }));
        editorRef.current?.commands.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mentions.length, threadId, appStoreMutate, imageToolModel]);

  // Drag overlay handled globally in ChatBot

  return (
    <div className="max-w-3xl mx-auto fade-in animate-in">
      <div className="z-10 mx-auto w-full max-w-3xl relative">
        <fieldset className="flex w-full min-w-0 max-w-full flex-col px-4">
          <div className="shadow-lg overflow-hidden rounded-2xl backdrop-blur-sm transition-all duration-200 bg-muted/60 relative flex w-full flex-col cursor-text z-10 items-stretch focus-within:bg-muted hover:bg-muted focus-within:ring-muted hover:ring-muted">
            {mentions.length > 0 && (
              <div className="bg-input rounded-b-sm rounded-t-3xl p-3 flex flex-col gap-4 mx-2 my-2">
                {mentions.map((mention, i) => {
                  return (
                    <div key={i} className="flex items-center gap-2">
                      {mention.type === "agent" ? (
                        <Avatar
                          className="size-6 p-1 ring ring-border rounded-full flex-shrink-0"
                          style={mention.icon?.style}
                        >
                          <AvatarImage
                            src={
                              mention.icon?.value ||
                              EMOJI_DATA[i % EMOJI_DATA.length]
                            }
                          />
                          <AvatarFallback>
                            {mention.name.slice(0, 1)}
                          </AvatarFallback>
                        </Avatar>
                      ) : (
                        <Button className="size-6 flex items-center justify-center ring ring-border rounded-full flex-shrink-0 p-0.5">
                          {mention.type == "mcpServer" ? (
                            <MCPIcon className="size-3.5" />
                          ) : (
                            <DefaultToolIcon
                              name={mention.name as DefaultToolName}
                              className="size-3.5"
                            />
                          )}
                        </Button>
                      )}

                      <div className="flex flex-col flex-1 min-w-0">
                        <span className="text-sm font-semibold truncate">
                          {mention.name}
                        </span>
                        {mention.description ? (
                          <span className="text-muted-foreground text-xs truncate">
                            {mention.description}
                          </span>
                        ) : null}
                      </div>
                      <Button
                        variant={"ghost"}
                        size={"icon"}
                        disabled={!threadId}
                        className="rounded-full hover:bg-input! flex-shrink-0"
                        onClick={() => {
                          deleteMention(mention);
                        }}
                      >
                        <XIcon />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="flex flex-col gap-3.5 px-6 pt-4 pb-6">
              <div className="relative min-h-[3rem]">
                <Suspense
                  fallback={
                    <div className="h-[3rem] w-full animate-pulse"></div>
                  }
                >
                  <ChatMentionInput
                    input={input}
                    onChange={setInput}
                    onChangeMention={onChangeMention}
                    onEnter={submit}
                    placeholder={placeholder ?? "Ask anything or @mention"}
                    ref={editorRef}
                    disabledMention={disabledMention}
                    onFocus={onFocus}
                  />
                </Suspense>
              </div>
              <div className="flex w-full items-center z-30">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,.pdf,.txt,.md,.csv,.json,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.rar,.7z,.tar,.gz,.mp3,.wav,.m4a,.ogg,.mp4,.webm,.mov"
                  multiple
                  className="hidden"
                  onChange={handleFileSelect}
                  disabled={!threadId}
                />

                <DropdownMenu
                  open={isUploadDropdownOpen}
                  onOpenChange={setIsUploadDropdownOpen}
                >
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant={"ghost"}
                      size={"sm"}
                      className="rounded-full hover:bg-input! p-2! data-[state=open]:bg-input!"
                      disabled={!threadId}
                    >
                      <PlusIcon />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" side="top">
                    <DropdownMenuItem
                      className="cursor-pointer"
                      disabled={
                        modelInfo?.isImageInputUnsupported || !canUploadImages
                      }
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <PaperclipIcon className="mr-2 size-4" />
                      Upload File
                    </DropdownMenuItem>

                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger className="cursor-pointer">
                        <ImagesIcon className="mr-4 size-4 text-muted-foreground" />
                        <span className="mr-4">Generate Image</span>
                      </DropdownMenuSubTrigger>
                      <DropdownMenuPortal>
                        <DropdownMenuSubContent>
                          <DropdownMenuItem
                            disabled={modelInfo?.isToolCallUnsupported}
                            onClick={() => handleGenerateImage("google")}
                            className="cursor-pointer"
                          >
                            <GeminiIcon className="mr-2 size-4" />
                            Gemini (Nano Banana)
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={modelInfo?.isToolCallUnsupported}
                            onClick={() => handleGenerateImage("openai")}
                            className="cursor-pointer"
                          >
                            <OpenAIIcon className="mr-2 size-4" />
                            OpenAI
                          </DropdownMenuItem>
                        </DropdownMenuSubContent>
                      </DropdownMenuPortal>
                    </DropdownMenuSub>
                  </DropdownMenuContent>
                </DropdownMenu>

                {!toolDisabled &&
                  (imageToolModel ? (
                    <Button
                      variant={"ghost"}
                      size={"sm"}
                      className="rounded-full hover:bg-input! p-2! group/image-generator text-primary"
                      onClick={() => handleGenerateImage()}
                    >
                      <ImagesIcon className="size-3.5" />
                      Generate Image
                      <XIcon className="size-3 group-hover/image-generator:opacity-100 opacity-0 transition-opacity duration-200" />
                    </Button>
                  ) : chatModel?.provider === "coding-agents" ? (
                    // ACP agents handle tools internally - show agent indicator instead
                    <div className="flex items-center gap-1.5">
                      <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
                        {modelInfo?.acpProvider === "anthropic" ? (
                          <ClaudeIcon className="size-3" />
                        ) : modelInfo?.acpProvider === "openai" ? (
                          <OpenAIIcon className="size-3" />
                        ) : modelInfo?.acpProvider === "google" ? (
                          <GeminiIcon className="size-3" />
                        ) : null}
                        <span>Agent Mode</span>
                      </div>
                      <ACPAgentOptionsDropdown
                        session={acpSession}
                        onSetModel={onSetAcpModel}
                        onSetConfigOption={onSetAcpConfigOption}
                        onSetMode={onSetAcpMode}
                      />
                    </div>
                  ) : (
                    <>
                      <ChatModeDropdown />
                      <ToolModeDropdown />
                      <ToolSelectDropdown
                        className="mx-1"
                        align="start"
                        side="top"
                        onSelectAgent={onSelectAgent}
                        onGenerateImage={handleGenerateImage}
                        mentions={mentions}
                      />
                    </>
                  ))}

                <div className="flex-1" />

                <div className="mr-2">
                  <ContextIndicator threadId={threadId} compact />
                </div>
                <SelectModel onSelect={setChatModel} currentModel={chatModel}>
                  <Button
                    variant={"ghost"}
                    size={"sm"}
                    className="rounded-full group data-[state=open]:bg-input! hover:bg-input! mr-1"
                    data-testid="model-selector-button"
                  >
                    {chatModel?.model ? (
                      <>
                        {chatModel.provider === "openai" ? (
                          <OpenAIIcon className="size-3 opacity-70 transition-opacity group-data-[state=open]:opacity-100 group-hover:opacity-100" />
                        ) : chatModel.provider === "xai" ? (
                          <GrokIcon className="size-3 opacity-70 transition-opacity group-data-[state=open]:opacity-100 group-hover:opacity-100" />
                        ) : chatModel.provider === "anthropic" ? (
                          <ClaudeIcon className="size-3 opacity-70 transition-opacity group-data-[state=open]:opacity-100 group-hover:opacity-100" />
                        ) : chatModel.provider === "google" ? (
                          <GeminiIcon className="size-3 opacity-70 transition-opacity group-data-[state=open]:opacity-100 group-hover:opacity-100" />
                        ) : chatModel.provider === "groq" ? (
                          <GroqIcon className="size-3 opacity-70 transition-opacity group-data-[state=open]:opacity-100 group-hover:opacity-100" />
                        ) : chatModel.provider === "openRouter" ? (
                          <OpenRouterIcon className="size-3 opacity-70 transition-opacity group-data-[state=open]:opacity-100 group-hover:opacity-100" />
                        ) : chatModel.provider === "ollama" ? (
                          <OllamaIcon className="size-3 opacity-70 transition-opacity group-data-[state=open]:opacity-100 group-hover:opacity-100" />
                        ) : null}
                        <span
                          className="text-foreground group-data-[state=open]:text-foreground"
                          data-testid="selected-model-name"
                        >
                          {chatModel.model.replace(/:free$/i, "")}
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground text-xs">
                        Select model
                      </span>
                    )}

                    <ChevronDown className="size-3" />
                  </Button>
                </SelectModel>
                {!isLoading && !input.length && !voiceDisabled ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size={"sm"}
                        onClick={() => {
                          appStoreMutate((state) => ({
                            voiceChat: {
                              ...state.voiceChat,
                              isOpen: true,
                              agentId: undefined,
                            },
                          }));
                        }}
                        className="rounded-full p-2!"
                      >
                        <MicIcon size={16} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Voice Chat Mode</TooltipContent>
                  </Tooltip>
                ) : (
                  <div
                    onClick={() => {
                      if (isLoading) {
                        onStop();
                      } else {
                        submit();
                      }
                    }}
                    className="fade-in animate-in cursor-pointer text-muted-foreground rounded-full p-2 bg-secondary hover:bg-accent-foreground hover:text-accent transition-all duration-200"
                  >
                    {isLoading ? (
                      <Square
                        size={16}
                        className="fill-muted-foreground text-muted-foreground"
                      />
                    ) : (
                      <CornerRightUp size={16} />
                    )}
                  </div>
                )}
              </div>

              {/* Uploaded Files Preview - Below Input */}
              {uploadedFiles.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {uploadedFiles.map((file) => {
                    const isImage = file.mimeType.startsWith("image/");
                    const imageSrc =
                      file.previewUrl || file.url || file.dataUrl || "";
                    const displayName = file.name;
                    const displayExt =
                      file.name.split(".").pop()?.toUpperCase() || "FILE";
                    const isSummarizable = isIngestSupported(file.mimeType);
                    return (
                      <div
                        key={file.id}
                        className="relative group rounded-lg overflow-hidden border-2 border-border hover:border-primary transition-all"
                      >
                        {isImage ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={imageSrc}
                            alt={file.name}
                            className="w-24 h-24 object-cover"
                          />
                        ) : (
                          <div className="w-32 h-28 flex flex-col items-center justify-center bg-muted px-2 py-3 text-center">
                            <FileTypeIcon
                              filename={displayName}
                              className="text-muted-foreground mb-1"
                              size={32}
                            />
                            <span className="text-xs font-medium text-muted-foreground line-clamp-2 w-full">
                              {displayName}
                            </span>
                            <span className="text-[11px] text-muted-foreground/80">
                              {displayExt}
                            </span>
                          </div>
                        )}

                        {/* Upload Progress Overlay */}
                        {file.isUploading && (
                          <div className="absolute inset-0 bg-background/90 flex rounded-lg flex-col items-center justify-center backdrop-blur-sm">
                            <Loader2 className="size-6 animate-spin text-foreground mb-2" />
                            <div className="w-16 h-1 bg-muted rounded-full overflow-hidden">
                              <div
                                className="h-full bg-primary transition-all duration-300"
                                style={{ width: `${file.progress || 0}%` }}
                              />
                            </div>
                            <span className="text-foreground text-xs mt-1">
                              {file.progress || 0}%
                            </span>
                          </div>
                        )}

                        {/* Hover Actions */}
                        <div
                          className={cn(
                            "absolute inset-0 bg-background/80 backdrop-blur-sm transition-opacity flex items-center justify-center rounded-lg",
                            file.isUploading
                              ? "opacity-0"
                              : "opacity-0 group-hover:opacity-100",
                          )}
                        >
                          <div className="flex gap-2 items-center">
                            {isSummarizable && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="secondary"
                                    size="icon"
                                    className="rounded-full"
                                    onClick={async () => {
                                      try {
                                        const url = file.url || file.dataUrl;
                                        if (!url) {
                                          toast.error("No file URL available");
                                          return;
                                        }
                                        const res = await fetch(
                                          "/api/storage/ingest",
                                          {
                                            method: "POST",
                                            headers: {
                                              "Content-Type":
                                                "application/json",
                                            },
                                            body: JSON.stringify({ url }),
                                          },
                                        );
                                        if (!res.ok) {
                                          const e = await res
                                            .json()
                                            .catch(() => ({}));
                                          toast.error(
                                            e.error || "Failed to ingest file",
                                          );
                                          return;
                                        }
                                        const data = await res.json();
                                        // Append preview text to input for the user to send
                                        setInput(
                                          `${input ? input + "\n\n" : ""}${data.text}`,
                                        );
                                      } catch (_err) {
                                        toast.error("Failed to ingest file");
                                      }
                                    }}
                                  >
                                    <FileTextIcon className="size-4" />
                                    <span className="sr-only">Summarize</span>
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Summarize</TooltipContent>
                              </Tooltip>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="rounded-full bg-background/80 hover:bg-background"
                              onClick={() => deleteFile(file.id)}
                              disabled={file.isUploading}
                            >
                              <XIcon className="size-4" />
                            </Button>
                          </div>
                        </div>

                        {/* Cancel Upload Button (Top Right) */}
                        {file.isUploading && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="absolute top-1 right-1 size-6 rounded-full bg-background/60 hover:bg-background/80 backdrop-blur-sm"
                            onClick={() => deleteFile(file.id)}
                          >
                            <XIcon className="size-3" />
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </fieldset>
      </div>
    </div>
  );
}
