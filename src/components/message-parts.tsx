"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import { FileUIPart, ToolUIPart, UIMessage, getToolName } from "ai";
import { cn, safeJSONParse, truncateString } from "lib/utils";
import {
  Check,
  ChevronDownIcon,
  ChevronUp,
  Copy,
  Download,
  EllipsisIcon,
  FileIcon,
  Loader,
  Pencil,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Badge } from "ui/badge";
import { Button } from "ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";
import { InlineDocumentPreview } from "./inline-document-preview";
import { Markdown } from "./markdown";
import { MessageEditor } from "./message-editor";

import { threadApi } from "@/lib/electron/thread-api";
import { AnimatePresence, motion } from "framer-motion";
import { SelectModel } from "./select-model";

import { ChatMetadata, ChatModel, ManualToolConfirmTag } from "app-types/chat";
import { toast } from "sonner";
import { safe } from "ts-safe";

import { useCopy } from "@/hooks/use-copy";
import { useTranslation } from "react-i18next";
import { Separator } from "ui/separator";

import { DefaultToolName, ImageToolName } from "lib/ai/tools";
import equal from "lib/equal";
import {
  Shortcut,
  getShortcutKeyList,
  isShortcutEvent,
} from "lib/keyboard-shortcuts";
import { Avatar, AvatarFallback, AvatarImage } from "ui/avatar";
import { TextShimmer } from "ui/text-shimmer";

import { appStore } from "@/app/store";
import { BACKGROUND_COLORS, EMOJI_DATA } from "lib/const";
import { notify } from "lib/notify";
import { ModelProviderIcon } from "ui/model-provider-icon";
import type { ToolStatus } from "ui/tool-status-badge";

const ToolCallCard = lazy(() =>
  import("./tool-invocation/tool-call-card").then((mod) => ({
    default: mod.ToolCallCard,
  })),
);

type MessagePart = UIMessage["parts"][number];
type TextMessagePart = Extract<MessagePart, { type: "text" }>;
type AssistMessagePart = Extract<MessagePart, { type: "text" }>;

interface UserMessagePartProps {
  part: TextMessagePart;
  isLast: boolean;
  message: UIMessage;
  setMessages?: UseChatHelpers<UIMessage>["setMessages"];
  sendMessage?: UseChatHelpers<UIMessage>["sendMessage"];
  status?: UseChatHelpers<UIMessage>["status"];
  isError?: boolean;
  readonly?: boolean;
}

interface AssistMessagePartProps {
  part: AssistMessagePart;
  isLast?: boolean;
  isLoading?: boolean;
  message: UIMessage;
  prevMessage?: UIMessage;
  showActions: boolean;
  threadId?: string;
  setMessages?: UseChatHelpers<UIMessage>["setMessages"];
  sendMessage?: UseChatHelpers<UIMessage>["sendMessage"];
  isError?: boolean;
  readonly?: boolean;
}

interface ToolMessagePartProps {
  part: ToolUIPart;
  messageId: string;
  showActions: boolean;
  isLast?: boolean;
  isManualToolInvocation?: boolean;
  addToolResult?: UseChatHelpers<UIMessage>["addToolResult"];
  isError?: boolean;
  setMessages?: UseChatHelpers<UIMessage>["setMessages"];
  readonly?: boolean;
  threadId?: string;
}

const MAX_TEXT_LENGTH = 600;
export const UserMessagePart = memo(
  function UserMessagePart({
    part,
    isLast,
    status,
    message,
    setMessages,
    sendMessage,
    readonly,
    isError,
  }: UserMessagePartProps) {
    const { copied, copy } = useCopy();
    const { t } = useTranslation();
    const [mode, setMode] = useState<"view" | "edit">("view");
    const [isDeleting, setIsDeleting] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const scrolledRef = useRef(false);

    const isLongText = part.text.length > MAX_TEXT_LENGTH;
    const displayText =
      expanded || !isLongText
        ? part.text
        : truncateString(part.text, MAX_TEXT_LENGTH);

    const deleteMessage = useCallback(async () => {
      if (!setMessages) return;
      const ok = await notify.confirm({
        title: "Delete Message",
        description: "Are you sure you want to delete this message?",
      });
      if (!ok) return;
      safe(() => setIsDeleting(true))
        .ifOk(() => threadApi.deleteMessage(message.id))
        .ifOk(() =>
          setMessages((messages) => {
            const index = messages.findIndex((m) => m.id === message.id);
            if (index !== -1) {
              return messages.filter((_, i) => i !== index);
            }
            return messages;
          }),
        )
        .ifFail((error) => toast.error(error.message))
        .watch(() => setIsDeleting(false))
        .unwrap();
    }, [message.id]);

    // Note: Auto-scroll is now handled centrally by useAutoScroll hook in chat-bot.tsx
    // Removed conflicting scrollIntoView that was causing animation stacking and "stuck" feeling
    useEffect(() => {
      if (status === "submitted" && isLast && !scrolledRef.current) {
        scrolledRef.current = true;
        // Scroll is handled by useAutoScroll hook - no need for additional scroll here
      }
    }, [status, isLast]);

    if (mode === "edit" && setMessages && sendMessage) {
      return (
        <div className="flex flex-row gap-2 items-start w-full">
          <MessageEditor
            message={message}
            setMode={setMode}
            setMessages={setMessages}
            sendMessage={sendMessage}
          />
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-2 items-end my-2">
        <div
          data-testid="message-content"
          className={cn(
            "flex flex-col gap-4 max-w-full ring ring-input relative overflow-hidden",
            {
              "bg-accent text-accent-foreground px-4 py-3 rounded-2xl": isLast,
              "opacity-50": isError,
            },
            isError && "border-destructive border",
          )}
        >
          {isLongText && !expanded && (
            <div className="absolute pointer-events-none bg-gradient-to-t from-accent to-transparent w-full h-40 bottom-0 left-0" />
          )}
          <p className={cn("whitespace-pre-wrap text-sm break-words")}>
            {displayText}
          </p>
          {isLongText && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded(!expanded)}
              className="h-auto p-1 text-xs z-10 text-muted-foreground hover:text-foreground self-start"
            >
              <span className="flex items-center gap-1">
                {t(expanded ? "Common.showLess" : "Common.showMore")}
                {expanded ? (
                  <ChevronUp className="size-3" />
                ) : (
                  <ChevronDownIcon className="size-3" />
                )}
              </span>
            </Button>
          )}
        </div>
        {isLast && (
          <div className="flex w-full justify-end md:opacity-0 group-hover/message:opacity-100 transition-opacity duration-300">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  data-testid="message-edit-button"
                  variant="ghost"
                  size="icon"
                  className={cn("size-3! p-4!")}
                  onClick={() => copy(part.text)}
                >
                  {copied ? <Check /> : <Copy />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Copy</TooltipContent>
            </Tooltip>
            {!readonly && (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      data-testid="message-edit-button"
                      variant="ghost"
                      size="icon"
                      className="size-3! p-4!"
                      onClick={() => setMode("edit")}
                    >
                      <Pencil />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Edit</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      disabled={isDeleting}
                      onClick={deleteMessage}
                      variant="ghost"
                      size="icon"
                      className="size-3! p-4! hover:text-destructive"
                    >
                      {isDeleting ? (
                        <Loader className="animate-spin" />
                      ) : (
                        <Trash2 />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="text-destructive" side="bottom">
                    Delete Message
                  </TooltipContent>
                </Tooltip>
              </>
            )}
          </div>
        )}
        <div ref={ref} className="min-w-0" />
      </div>
    );
  },
  (prev, next) => {
    if (prev.part.text != next.part.text) return false;
    if (prev.isError != next.isError) return false;
    if (prev.isLast != next.isLast) return false;
    if (prev.status != next.status) return false;
    if (prev.message.id != next.message.id) return false;
    if (!equal(prev.part, next.part)) return false;
    return true;
  },
);
UserMessagePart.displayName = "UserMessagePart";

// Minimum character length for content to be shown in document preview
const DOCUMENT_PREVIEW_MIN_LENGTH = 500;

// Detect if text content qualifies for document preview (long text, code blocks, structured markdown)
function isDocumentContent(text: string): { isDocument: boolean; type: "markdown" | "code" | "text"; language?: string } {
  // Check for code blocks (```lang ... ```)
  const codeBlockMatch = text.match(/^```(\w*)\n[\s\S]+```$/m);
  if (codeBlockMatch && text.length > 200) {
    return { isDocument: true, type: "code", language: codeBlockMatch[1] || undefined };
  }

  // Check for multiple code blocks indicating generated code
  const codeBlockCount = (text.match(/```/g) || []).length / 2;
  if (codeBlockCount >= 2) {
    return { isDocument: true, type: "code" };
  }

  // Check for structured markdown (multiple headings)
  const headingCount = (text.match(/^#{1,3}\s/gm) || []).length;
  if (headingCount >= 2 && text.length > DOCUMENT_PREVIEW_MIN_LENGTH) {
    return { isDocument: true, type: "markdown" };
  }

  // Check for markdown-like content (bold text with lists)
  const hasBoldText = (text.match(/\*\*[^*]+\*\*/g) || []).length >= 2;
  const hasLists = (text.match(/^[-*]\s/gm) || []).length >= 3 || (text.match(/^\d+\.\s/gm) || []).length >= 3;
  if ((hasBoldText || hasLists) && text.length > DOCUMENT_PREVIEW_MIN_LENGTH) {
    return { isDocument: true, type: "markdown" };
  }

  // Long text content
  if (text.length > DOCUMENT_PREVIEW_MIN_LENGTH * 2) {
    return { isDocument: true, type: "text" };
  }

  return { isDocument: false, type: "text" };
}

export const AssistMessagePart = memo(function AssistMessagePart({
  part,
  showActions,
  message,
  prevMessage,
  isError,
  threadId,
  setMessages,
  readonly,
  sendMessage,
}: AssistMessagePartProps) {
  const { copied, copy } = useCopy();
  const [isLoading, setIsLoading] = useState(false);
  const agentList = appStore((state) => state.agentList);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDocPreview, setShowDocPreview] = useState(false);
  // Simple state: if user edited content, use that; otherwise use part.text
  const [editedDocContent, setEditedDocContent] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const metadata = message.metadata as ChatMetadata | undefined;

  // Simple: use edited content if available, otherwise use part.text
  const documentContent = editedDocContent ?? part.text;
  
  // Debug logging
  useEffect(() => {
    console.log("[MessageParts] State changed:", {
      editedDocContentLength: editedDocContent?.length,
      partTextLength: part.text?.length,
      documentContentLength: documentContent?.length,
      usingEdited: editedDocContent !== null,
    });
  }, [editedDocContent, documentContent, part.text]);
  
  const documentInfo = useMemo(() => isDocumentContent(documentContent), [documentContent]);

  const agent = useMemo(() => {
    return agentList.find((a) => a.id === metadata?.agentId);
  }, [metadata, agentList]);

  const deleteMessage = useCallback(async () => {
    if (!setMessages) return;
    const ok = await notify.confirm({
      title: "Delete Message",
      description: "Are you sure you want to delete this message?",
    });
    if (!ok) return;
    safe(() => setIsDeleting(true))
      .ifOk(() => threadApi.deleteMessage(message.id))
      .ifOk(() =>
        setMessages((messages) => {
          const index = messages.findIndex((m) => m.id === message.id);
          if (index !== -1) {
            return messages.filter((_, i) => i !== index);
          }
          return messages;
        }),
      )
      .ifFail((error) => toast.error(error.message))
      .watch(() => setIsDeleting(false))
      .unwrap();
  }, [message.id]);

  const handleModelChange = (model: ChatModel) => {
    if (!setMessages || !sendMessage || !prevMessage) return;
    safe(() => setIsLoading(true))
      .ifOk(() =>
        threadId
          ? threadApi.deleteMessagesAfterTimestamp(threadId, message.id)
          : Promise.resolve(),
      )
      .ifOk(() =>
        setMessages((messages) => {
          const index = messages.findIndex((m) => m.id === prevMessage.id);
          if (index !== -1) {
            return [...messages.slice(0, index)];
          }
          return messages;
        }),
      )
      .ifOk(() =>
        sendMessage(prevMessage, {
          body: {
            model,
          },
        }),
      )
      .ifFail((error) => toast.error(error.message))
      .watch(() => setIsLoading(false))
      .unwrap();
  };

  // Handle request for changes from document preview
  const handleRequestChanges = useCallback((selectedText: string, instruction: string) => {
    if (sendMessage) {
      const changeRequest = `Please modify this text: "${selectedText}"\n\nInstruction: ${instruction}`;
      sendMessage({ role: "user", content: changeRequest } as any);
    }
  }, [sendMessage]);

  return (
    <div
      className={cn(
        isLoading && "animate-pulse",
        "flex flex-col gap-2 group/message",
      )}
    >
      <div
        data-testid="message-content"
        className={cn("flex flex-col gap-4 px-2", {
          "opacity-50 border border-destructive bg-card rounded-lg": isError,
        })}
      >
        {documentInfo.isDocument && showDocPreview ? (
          <InlineDocumentPreview
            content={documentContent}
            type={documentInfo.type}
            language={documentInfo.language}
            onRequestChanges={handleRequestChanges}
            sendMessage={sendMessage ? (msg) => sendMessage({ role: "user", content: msg } as any) : undefined}
            onContentChange={async (newContent) => {
              console.log("[MessageParts] Content changed, saving...");
              setEditedDocContent(newContent);
              
              // Persist to database
              try {
                // Update the part with new content
                const updatedParts = message.parts.map((p) => {
                  if (p === part || (p.type === "text" && p.text === part.text)) {
                    return { ...p, text: newContent };
                  }
                  return p;
                });
                
                // Save to database
                await threadApi.updateMessageParts(message.id, updatedParts);
                console.log("[MessageParts] Saved to database");
                
                // Update in-memory state too
                if (setMessages) {
                  setMessages((msgs) => 
                    msgs.map((m) => 
                      m.id === message.id 
                        ? { ...m, parts: updatedParts }
                        : m
                    )
                  );
                }
              } catch (error) {
                console.error("[MessageParts] Failed to save:", error);
                toast.error("Failed to save changes");
              }
            }}
            onClose={() => setShowDocPreview(false)}
            className="my-2"
          />
        ) : (
          <>
            <Markdown>{documentContent}</Markdown>
            {documentInfo.isDocument && (
              <Button
                variant="ghost"
                size="sm"
                className="self-start text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setShowDocPreview(true)}
              >
                <FileIcon className="w-3 h-3 mr-1" />
                Open as document
              </Button>
            )}
          </>
        )}
      </div>
      {showActions && (
        <div className="flex w-full">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="message-edit-button"
                variant="ghost"
                size="icon"
                className="size-3! p-4!"
                onClick={() => copy(part.text)}
              >
                {copied ? <Check /> : <Copy />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Copy</TooltipContent>
          </Tooltip>
          {!readonly && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <SelectModel onSelect={handleModelChange}>
                      <Button
                        data-testid="message-edit-button data-[state=open]:bg-secondary!"
                        variant="ghost"
                        size="icon"
                        className="size-3! p-4!"
                      >
                        {<RefreshCw />}
                      </Button>
                    </SelectModel>
                  </div>
                </TooltipTrigger>
                <TooltipContent>Change Model</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={isDeleting}
                    onClick={deleteMessage}
                    className="size-3! p-4! hover:text-destructive"
                  >
                    {isDeleting ? (
                      <Loader className="animate-spin" />
                    ) : (
                      <Trash2 />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="text-destructive">
                  Delete Message
                </TooltipContent>
              </Tooltip>
            </>
          )}

          {metadata && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-3! p-4! opacity-0 group-hover/message:opacity-100 transition-opacity duration-300"
                >
                  <EllipsisIcon />
                </Button>
              </TooltipTrigger>
              <TooltipContent className="p-4 w-72 bg-card border shadow-lg">
                <div className="space-y-4">
                  {agent && (
                    <>
                      <div className="space-y-2">
                        <h4 className="text-sm font-semibold text-foreground">
                          Agent
                        </h4>
                        <div className="flex gap-3 items-center">
                          <div
                            className="p-1.5 rounded-full ring-2 ring-border/50 bg-background shadow-sm"
                            style={{
                              backgroundColor:
                                agent.icon?.style?.backgroundColor ||
                                BACKGROUND_COLORS[0],
                            }}
                          >
                            <Avatar className="size-3">
                              <AvatarImage
                                src={agent.icon?.value || EMOJI_DATA[0]}
                              />
                              <AvatarFallback className="bg-transparent text-xs">
                                {agent.name[0]}
                              </AvatarFallback>
                            </Avatar>
                          </div>
                          <span className="font-medium text-sm">
                            {agent.name}
                          </span>
                        </div>
                      </div>
                      <div className="border-t border-border/50" />
                    </>
                  )}

                  {metadata.chatModel && (
                    <>
                      <div className="space-y-2">
                        <h4 className="text-sm font-semibold text-foreground">
                          Model
                        </h4>
                        <div className="flex gap-3 items-center">
                          <ModelProviderIcon
                            provider={metadata.chatModel.provider}
                            className="size-5 flex-shrink-0"
                          />
                          <div className="space-y-0.5 flex-1">
                            <div className="text-sm font-medium text-foreground">
                              {metadata.chatModel.provider}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {metadata.chatModel.model}
                              {metadata.toolCount !== undefined &&
                                metadata.toolCount > 0 && (
                                  <span className="ml-2">
                                    • {metadata.toolCount} tools
                                  </span>
                                )}
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="border-t border-border/50" />
                    </>
                  )}

                  {metadata?.usage && (
                    <>
                      <div className="flex flex-col gap-2">
                        <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                          Token Usage
                          <span className="text-xs text-muted-foreground font-normal">
                            {
                              message.parts.filter(
                                (v) => v.type != "step-start",
                              ).length
                            }{" "}
                            Steps
                          </span>
                        </h4>
                        <p className="px-2 mb-2 text-xs text-muted-foreground">
                          High input token usage may occur when many tools are
                          available.
                        </p>
                        <div className="space-y-2">
                          {metadata.usage?.inputTokens !== undefined && (
                            <div className="flex items-center justify-between py-1 px-2 rounded-md bg-muted/30">
                              <span className="text-xs text-muted-foreground">
                                Input
                              </span>
                              <span className="text-xs font-mono font-medium">
                                {/* Handle both flat (number) and nested ({ total: number }) structures */}
                                {(() => {
                                  const val = metadata.usage?.inputTokens as any;
                                  const num = typeof val === "number" ? val : (val?.total ?? 0);
                                  return num.toLocaleString();
                                })()}
                              </span>
                            </div>
                          )}
                          {metadata.usage?.outputTokens !== undefined && (
                            <div className="flex items-center justify-between py-1 px-2 rounded-md bg-muted/30">
                              <span className="text-xs text-muted-foreground">
                                Output
                              </span>
                              <span className="text-xs font-mono font-medium">
                                {/* Handle both flat (number) and nested ({ total: number }) structures */}
                                {(() => {
                                  const val = metadata.usage?.outputTokens as any;
                                  const num = typeof val === "number" ? val : (val?.total ?? 0);
                                  return num.toLocaleString();
                                })()}
                              </span>
                            </div>
                          )}
                          {(metadata.usage?.totalTokens !== undefined ||
                            (metadata.usage?.inputTokens !== undefined && metadata.usage?.outputTokens !== undefined)) && (
                            <div className="flex items-center justify-between py-1.5 px-2 rounded-md bg-primary/10 border border-primary/20">
                              <span className="text-xs font-medium text-primary">
                                Total
                              </span>
                              <span className="text-xs font-mono font-bold text-primary">
                                {/* Calculate total from inputTokens + outputTokens if totalTokens not present */}
                                {(() => {
                                  if (metadata.usage?.totalTokens !== undefined) {
                                    return metadata.usage.totalTokens.toLocaleString();
                                  }
                                  const inputVal = metadata.usage?.inputTokens as any;
                                  const outputVal = metadata.usage?.outputTokens as any;
                                  const input = typeof inputVal === "number" ? inputVal : (inputVal?.total ?? 0);
                                  const output = typeof outputVal === "number" ? outputVal : (outputVal?.total ?? 0);
                                  return (input + output).toLocaleString();
                                })()}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      )}
      <div ref={ref} className="min-w-0" />
    </div>
  );
});
AssistMessagePart.displayName = "AssistMessagePart";
const variants = {
  collapsed: {
    height: 0,
    opacity: 0,
    marginTop: 0,
    marginBottom: 0,
  },
  expanded: {
    height: "auto",
    opacity: 1,
    marginTop: "1rem",
    marginBottom: "0.5rem",
  },
};
export const ReasoningPart = memo(function ReasoningPart({
  reasoningText,
  isThinking,
}: {
  reasoningText: string;
  isThinking?: boolean;
  readonly?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(isThinking);

  useEffect(() => {
    if (!isThinking && isExpanded) {
      setIsExpanded(false);
    }
  }, [isThinking]);

  return (
    <div
      className="flex flex-col cursor-pointer"
      onClick={() => {
        setIsExpanded(!isExpanded);
      }}
    >
      <div className="flex flex-row gap-2 items-center text-ring hover:text-primary transition-colors">
        {isThinking ? (
          <TextShimmer>Thinking..</TextShimmer>
        ) : (
          <div className="font-medium">Thinking..</div>
        )}

        <button
          data-testid="message-reasoning-toggle"
          type="button"
          className="cursor-pointer"
        >
          <ChevronDownIcon size={16} />
        </button>
      </div>

      <div className="pl-4">
        <AnimatePresence initial={false}>
          {isExpanded && (
            <motion.div
              data-testid="message-reasoning"
              key="content"
              initial="collapsed"
              animate="expanded"
              exit="collapsed"
              variants={variants}
              transition={{ duration: 0.2, ease: "easeInOut" }}
              style={{ overflow: "hidden" }}
              className="pl-6 text-muted-foreground border-l flex flex-col gap-4"
            >
              <Markdown>
                {reasoningText || (isThinking ? "" : "Hmm, let's see...")}
              </Markdown>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
});
ReasoningPart.displayName = "ReasoningPart";

const LoadingFallback = memo(function LoadingFallback() {
  return (
    <div className="px-6 py-4">
      <div className="h-44 w-full rounded-md opacity-0" />
    </div>
  );
});

const PieChart = lazy(() =>
  import("./tool-invocation/pie-chart").then((mod) => ({
    default: mod.PieChart,
  })),
);

const BarChart = lazy(() =>
  import("./tool-invocation/bar-chart").then((mod) => ({
    default: mod.BarChart,
  })),
);

const LineChart = lazy(() =>
  import("./tool-invocation/line-chart").then((mod) => ({
    default: mod.LineChart,
  })),
);

const InteractiveTable = lazy(() =>
  import("./tool-invocation/interactive-table").then((mod) => ({
    default: mod.InteractiveTable,
  })),
);

const WebSearchToolInvocation = lazy(() =>
  import("./tool-invocation/web-search").then((mod) => ({
    default: mod.WebSearchToolInvocation,
  })),
);

const RememberContextToolInvocation = lazy(() =>
  import("./tool-invocation/remember-context").then((mod) => ({
    default: mod.RememberContextToolInvocation,
  })),
);

const ImageGeneratorToolInvocation = lazy(() =>
  import("./tool-invocation/image-generator").then((mod) => ({
    default: mod.ImageGeneratorToolInvocation,
  })),
);

const PlanViewInvocation = lazy(() =>
  import("./tool-invocation/plan-view").then((mod) => ({
    default: mod.PlanViewInvocation,
  })),
);

const TaskStatusInvocation = lazy(() =>
  import("./tool-invocation/task-status").then((mod) => ({
    default: mod.TaskStatusInvocation,
  })),
);

const NextTaskInvocation = lazy(() =>
  import("./tool-invocation/next-task").then((mod) => ({
    default: mod.NextTaskInvocation,
  })),
);

const PlanStatusInvocation = lazy(() =>
  import("./tool-invocation/plan-status").then((mod) => ({
    default: mod.PlanStatusInvocation,
  })),
);

const BrowserToolInvocation = lazy(() =>
  import("./tool-invocation/browser-tool-invocation").then((mod) => ({
    default: mod.BrowserToolInvocation,
  })),
);

const DesktopToolInvocation = lazy(() =>
  import("./tool-invocation/desktop-tool-invocation").then((mod) => ({
    default: mod.DesktopToolInvocation,
  })),
);

// Local shortcuts for tool invocation approval/rejection
const approveToolInvocationShortcut: Shortcut = {
  description: "approveToolInvocation",
  shortcut: {
    key: "Enter",
    command: true,
  },
};

const rejectToolInvocationShortcut: Shortcut = {
  description: "rejectToolInvocation",
  shortcut: {
    key: "Escape",
    command: true,
  },
};

export const ToolMessagePart = memo(
  ({
    part,
    isLast,
    showActions,
    addToolResult,
    isError,
    messageId,
    setMessages,
    isManualToolInvocation,
    threadId,
  }: ToolMessagePartProps) => {
    const { t } = useTranslation();

    const { output, toolCallId, state, input, errorText } = part;

    const toolName = useMemo(() => getToolName(part), [part.type]);

    const isCompleted = useMemo(() => {
      return state?.startsWith("output") ?? false;
    }, [state]);

    const [expanded, setExpanded] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    // Handle keyboard shortcuts for approve/reject actions
    useEffect(() => {
      // Only enable shortcuts when manual tool invocation buttons are shown
      if (!isManualToolInvocation) return;

      const handleKeyDown = (e: KeyboardEvent) => {
        const isApprove = isShortcutEvent(e, approveToolInvocationShortcut);
        const isReject = isShortcutEvent(e, rejectToolInvocationShortcut);

        if (!isApprove && !isReject) return;

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        if (isApprove) {
          addToolResult?.({
            tool: toolName,
            toolCallId,
            output: ManualToolConfirmTag.create({ confirm: true }),
          });
        }

        if (isReject) {
          addToolResult?.({
            tool: toolName,
            toolCallId,
            output: ManualToolConfirmTag.create({ confirm: false }),
          });
        }
      };

      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isManualToolInvocation, isLast]);

    const deleteMessage = useCallback(async () => {
      const ok = await notify.confirm({
        title: "Delete Message",
        description: "Are you sure you want to delete this message?",
      });
      if (!ok) return;
      safe(() => setIsDeleting(true))
        .ifOk(() => threadApi.deleteMessage(messageId))
        .ifOk(() =>
          setMessages?.((messages) => {
            const index = messages.findIndex((m) => m.id === messageId);
            if (index !== -1) {
              return messages.filter((_, i) => i !== index);
            }
            return messages;
          }),
        )
        .ifFail((error) => toast.error(error.message))
        .watch(() => setIsDeleting(false))
        .unwrap();
    }, [messageId]);

    const onToolCallDirect = useCallback(
      (result: any) => {
        addToolResult?.({
          tool: toolName,
          toolCallId,
          output: result,
        });
      },
      [addToolResult, toolCallId],
    );

    const result = useMemo(() => {
      if (state == "output-error") {
        return errorText;
      }
      if (isCompleted) {
        return Array.isArray(output)
          ? {
              ...output,
              content: output.map((node) => {
                // mcp tools
                if (node?.type === "text" && typeof node?.text === "string") {
                  const parsed = safeJSONParse(node.text);
                  return {
                    ...node,
                    text: parsed.success ? parsed.value : node.text,
                  };
                }
                return node;
              }),
            }
          : output;
      }
      return null;
    }, [isCompleted, output, state, errorText]);

    const CustomToolComponent = useMemo(() => {
      if (
        toolName === DefaultToolName.WebSearch ||
        toolName === DefaultToolName.WebContent
      ) {
        return (
          <Suspense fallback={<LoadingFallback />}>
            <WebSearchToolInvocation part={part} />
          </Suspense>
        );
      }

      if (toolName === DefaultToolName.RememberContext) {
        return (
          <Suspense fallback={<LoadingFallback />}>
            <RememberContextToolInvocation part={part} />
          </Suspense>
        );
      }

      if (toolName === ImageToolName) {
        return (
          <Suspense fallback={<LoadingFallback />}>
            <ImageGeneratorToolInvocation part={part} />
          </Suspense>
        );
      }

      // Agent planning tools
      if (toolName === "createPlan") {
        return (
          <Suspense fallback={<LoadingFallback />}>
            <PlanViewInvocation part={part} />
          </Suspense>
        );
      }

      if (toolName === "updateTaskStatus") {
        return (
          <Suspense fallback={<LoadingFallback />}>
            <TaskStatusInvocation part={part} />
          </Suspense>
        );
      }

      if (toolName === "getNextTask") {
        return (
          <Suspense fallback={<LoadingFallback />}>
            <NextTaskInvocation part={part} />
          </Suspense>
        );
      }

      if (toolName === "getPlanStatus") {
        return (
          <Suspense fallback={<LoadingFallback />}>
            <PlanStatusInvocation part={part} />
          </Suspense>
        );
      }

      // Browser tools (Local Chrome DevTools) - camelCase names like browserNavigate, browserAct
      if (toolName.startsWith("browser") && toolName !== "browser") {
        return (
          <Suspense fallback={<LoadingFallback />}>
            <BrowserToolInvocation part={part} threadId={threadId} />
          </Suspense>
        );
      }

      // Desktop tools (Local Terminal) - camelCase names like desktopScreenshot, desktopClick
      if (toolName.startsWith("desktop") && toolName !== "desktop") {
        return (
          <Suspense fallback={<LoadingFallback />}>
            <DesktopToolInvocation part={part} threadId={threadId} />
          </Suspense>
        );
      }

      if (state === "output-available") {
        switch (toolName) {
          case DefaultToolName.CreatePieChart:
            return (
              <Suspense fallback={<LoadingFallback />}>
                <PieChart
                  key={`${toolCallId}-${toolName}`}
                  {...(input as any)}
                />
              </Suspense>
            );
          case DefaultToolName.CreateBarChart:
            return (
              <Suspense fallback={<LoadingFallback />}>
                <BarChart
                  key={`${toolCallId}-${toolName}`}
                  {...(input as any)}
                />
              </Suspense>
            );
          case DefaultToolName.CreateLineChart:
            return (
              <Suspense fallback={<LoadingFallback />}>
                <LineChart
                  key={`${toolCallId}-${toolName}`}
                  {...(input as any)}
                />
              </Suspense>
            );
          case DefaultToolName.CreateTable:
            return (
              <Suspense fallback={<LoadingFallback />}>
                <InteractiveTable
                  key={`${toolCallId}-${toolName}`}
                  {...(input as any)}
                />
              </Suspense>
            );
        }
      }
      return null;
    }, [toolName, state, onToolCallDirect, result, input]);

    const isExpanded = useMemo(() => {
      return expanded || result === null;
    }, [expanded, result]);

    const isExecuting = useMemo(() => {
      return !isCompleted && isLast;
    }, [isCompleted, isLast]);

    const toolStatus: ToolStatus = useMemo(() => {
      if (isError || state === "output-error") return "error";
      if (isExecuting) return "running";
      if (isCompleted) return "success";
      return "pending";
    }, [isError, state, isExecuting, isCompleted]);

    const renderToolContent = () => {
      if (CustomToolComponent) {
        return CustomToolComponent;
      }
      return (
        <div className="space-y-3">
          <Suspense fallback={<LoadingFallback />}>
            <ToolCallCard
              toolName={toolName}
              input={input}
              output={result ?? undefined}
              status={toolStatus}
              isExpanded={isExpanded}
              onToggleExpand={() => setExpanded(!expanded)}
            />
          </Suspense>

          {isManualToolInvocation && (
            <div className="flex flex-row gap-2 items-center">
              <Button
                variant="secondary"
                size="sm"
                className="rounded-full text-xs hover:ring py-2"
                onClick={() =>
                  addToolResult?.({
                    tool: toolName,
                    toolCallId,
                    output: ManualToolConfirmTag.create({
                      confirm: true,
                    }),
                  })
                }
              >
                <Check />
                {t("Common.approve")}
                <Separator orientation="vertical" className="h-4" />
                <span className="text-muted-foreground">
                  {getShortcutKeyList(approveToolInvocationShortcut).join(" ")}
                </span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="rounded-full text-xs py-2"
                onClick={() =>
                  addToolResult?.({
                    tool: toolName,
                    toolCallId,
                    output: ManualToolConfirmTag.create({
                      confirm: false,
                    }),
                  })
                }
              >
                <X />
                {t("Common.reject")}
                <Separator orientation="vertical" />
                <span className="text-muted-foreground">
                  {getShortcutKeyList(rejectToolInvocationShortcut).join(" ")}
                </span>
              </Button>
            </div>
          )}

          {showActions && (
            <div className="flex flex-row gap-2 items-center">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    disabled={isDeleting}
                    onClick={deleteMessage}
                    variant="ghost"
                    size="icon"
                    className="size-3! p-4! opacity-0 group-hover/message:opacity-100 hover:text-destructive"
                  >
                    {isDeleting ? (
                      <Loader className="animate-spin" />
                    ) : (
                      <Trash2 />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="text-destructive" side="bottom">
                  Delete Message
                </TooltipContent>
              </Tooltip>
            </div>
          )}
        </div>
      );
    };

    return <div className="group w-full">{renderToolContent()}</div>;
  },
  (prev, next) => {
    if (prev.isError !== next.isError) return false;
    if (prev.isLast !== next.isLast) return false;
    if (prev.showActions !== next.showActions) return false;
    if (prev.isManualToolInvocation !== next.isManualToolInvocation)
      return false;
    if (prev.messageId !== next.messageId) return false;
    if (!equal(prev.part, next.part)) return false;
    return true;
  },
);

ToolMessagePart.displayName = "ToolMessagePart";

// File Message Part Component
interface FileMessagePartProps {
  part: FileUIPart; // FileUIPart from AI SDK
  isUserMessage: boolean;
}

export const FileMessagePart = memo(
  ({ part, isUserMessage }: FileMessagePartProps) => {
    const isImage = part.mediaType?.startsWith("image/");

    const fileExtension =
      part.filename?.split(".").pop()?.toUpperCase() ||
      part.mediaType?.split("/").pop()?.toUpperCase() ||
      "FILE";
    const fileUrl = part.url;
    const filename =
      part.filename || part.url?.split("/").pop() || "Attachment";
    const secondaryLabel =
      part.mediaType && part.mediaType !== "application/octet-stream"
        ? part.mediaType
        : undefined;

    if (isImage && fileUrl) {
      return (
        <div
          className={cn(
            "max-w-md rounded-lg overflow-hidden border border-border",
            isUserMessage ? "ml-auto" : "mr-auto",
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={fileUrl}
            alt={part.filename || "Uploaded image"}
            className="w-full h-auto"
          />
          {part.filename && (
            <div className="px-3 py-2 bg-muted text-sm text-muted-foreground">
              {part.filename}
            </div>
          )}
        </div>
      );
    }

    // Non-image file
    return (
      <div
        className={cn(
          "max-w-md rounded-2xl border border-border/80 p-4 shadow-sm backdrop-blur-sm",
          isUserMessage
            ? "ml-auto bg-accent text-accent-foreground border-accent/40"
            : "mr-auto bg-muted/60 text-foreground",
        )}
      >
        <div className="flex items-start gap-4">
          <div
            className={cn(
              "flex-shrink-0 rounded-xl p-3",
              isUserMessage ? "bg-accent-foreground/10" : "bg-muted",
            )}
          >
            <FileIcon
              className={cn(
                "size-6",
                isUserMessage
                  ? "text-accent-foreground/80"
                  : "text-muted-foreground",
              )}
            />
          </div>
          <div className="flex-1 min-w-0 space-y-1 pr-3">
            <p
              className={cn(
                "text-sm font-medium line-clamp-1",
                isUserMessage ? "text-accent-foreground" : "text-foreground",
              )}
              title={filename}
            >
              {filename}
            </p>
            <div
              className={cn(
                "flex flex-wrap items-center gap-2 text-xs",
                isUserMessage
                  ? "text-accent-foreground/70"
                  : "text-muted-foreground",
              )}
            >
              <Badge
                variant="outline"
                className={cn(
                  "uppercase tracking-wide px-2 py-0.5",
                  isUserMessage &&
                    "border-accent-foreground/30 text-accent-foreground/90",
                )}
              >
                {fileExtension}
              </Badge>
              {secondaryLabel && (
                <span
                  className={cn(
                    "truncate max-w-[10rem]",
                    isUserMessage
                      ? "text-accent-foreground/70"
                      : "text-muted-foreground",
                  )}
                  title={secondaryLabel}
                >
                  {secondaryLabel}
                </span>
              )}
            </div>
          </div>
          {fileUrl && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  asChild
                  size="icon"
                  variant="ghost"
                  className={cn(
                    "size-9 flex-shrink-0 hover:text-foreground",
                    isUserMessage
                      ? "text-accent-foreground/70 hover:text-accent-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  <a href={fileUrl} download={part.filename ?? filename}>
                    <Download className="size-4" />
                    <span className="sr-only">Download {filename}</span>
                  </a>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Download</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    );
  },
);

FileMessagePart.displayName = "FileMessagePart";

// Source URL (non-model) attachment renderer
export function SourceUrlMessagePart({
  part,
  isUserMessage,
}: {
  part: { type: "source-url"; url: string; title?: string; mediaType?: string };
  isUserMessage: boolean;
}) {
  const name = part.title || part.url?.split("/").pop() || "attachment";
  const ext = name.split(".").pop()?.toUpperCase() || "FILE";
  const mediaType =
    part.mediaType && part.mediaType !== "application/octet-stream"
      ? part.mediaType
      : undefined;
  return (
    <div
      className={cn(
        "max-w-md rounded-2xl border border-border/80 p-4 backdrop-blur-sm shadow-sm",
        isUserMessage
          ? "ml-auto bg-accent text-accent-foreground border-accent/40"
          : "mr-auto bg-muted/60 text-foreground",
      )}
    >
      <div className="flex items-start gap-4 max-w-sm">
        <div
          className={cn(
            "flex-shrink-0 rounded-xl p-3",
            isUserMessage ? "bg-accent-foreground/10" : "bg-muted",
          )}
        >
          <FileIcon
            className={cn(
              "size-6",
              isUserMessage
                ? "text-accent-foreground/80"
                : "text-muted-foreground",
            )}
          />
        </div>
        <div className="flex-1 min-w-0 space-y-1 pr-3">
          <a
            href={part.url}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "text-sm font-medium hover:underline line-clamp-1",
              isUserMessage ? "text-accent-foreground" : "text-foreground",
            )}
            title={name}
          >
            {name}
          </a>
          <div
            className={cn(
              "flex flex-wrap items-center gap-2 text-xs",
              isUserMessage
                ? "text-accent-foreground/70"
                : "text-muted-foreground",
            )}
          >
            <Badge
              variant="outline"
              className={cn(
                "uppercase tracking-wide px-2 py-0.5",
                isUserMessage &&
                  "border-accent-foreground/30 text-accent-foreground/90",
              )}
            >
              {ext}
            </Badge>
            {mediaType && (
              <span className="truncate max-w-[10rem]" title={mediaType}>
                {mediaType}
              </span>
            )}
          </div>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              asChild
              size="icon"
              variant="ghost"
              className={cn(
                "size-9 flex-shrink-0 hover:text-foreground",
                isUserMessage
                  ? "text-accent-foreground/70 hover:text-accent-foreground"
                  : "text-muted-foreground",
              )}
            >
              <a href={part.url} target="_blank" rel="noopener noreferrer">
                <Download className="size-4" />
                <span className="sr-only">Open attachment</span>
              </a>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Open attachment</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
