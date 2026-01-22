"use client";

import { type ToolUIPart, type UIMessage, isToolUIPart } from "ai";
import equal from "lib/equal";
import { memo, useMemo, useState } from "react";

import type { UseChatHelpers } from "@ai-sdk/react";
import { ChatMetadata } from "app-types/chat";
import { cn, truncateString } from "lib/utils";
import { ChevronDown, ChevronUp, TriangleAlertIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "ui/button";
import {
  AssistMessagePart,
  FileMessagePart,
  ReasoningPart,
  SourceUrlMessagePart,
  ToolMessagePart,
  UserMessagePart,
} from "./message-parts";
import { ContextCompressionToolBlock } from "./tool-invocation/context-compression";
import { SubAgentTile } from "./sub-agent-tile";
import type { SubAgentEvent } from "./tool-invocation/sub-agent-view";

type RenderUnit =
  | { type: "part"; part: any; index: number }
  | { type: "subAgentTile"; events: SubAgentEvent[]; index: number };

/**
 * Groups consecutive sub-agent events for the same agent and merges them
 * with regular parts in chronological order
 */
function mergeAndGroupParts(parts: any[]): RenderUnit[] {
  const result: RenderUnit[] = [];
  let currentSubAgentGroup: SubAgentEvent[] = [];
  let currentAgentId: string | null = null;
  let partIndex = 0;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const partType = typeof part.type === "string" ? part.type : "";

    // Check if this is a sub-agent event
    if (partType.startsWith("data-sub-agent-")) {
      const event = part as SubAgentEvent;
      const agentId = event.data?.agentId || "";

      // If this is a new agent or we're starting a new group, flush previous group
      if (currentAgentId !== null && currentAgentId !== agentId) {
        if (currentSubAgentGroup.length > 0) {
          result.push({
            type: "subAgentTile",
            events: [...currentSubAgentGroup],
            index: partIndex++,
          });
          currentSubAgentGroup = [];
        }
      }

      // Add to current group
      currentSubAgentGroup.push(event);
      currentAgentId = agentId;
    } else {
      // Flush any pending sub-agent group before processing regular part
      if (currentSubAgentGroup.length > 0) {
        result.push({
          type: "subAgentTile",
          events: [...currentSubAgentGroup],
          index: partIndex++,
        });
        currentSubAgentGroup = [];
        currentAgentId = null;
      }

      // Add regular part
      result.push({
        type: "part",
        part,
        index: partIndex++,
      });
    }
  }

  // Flush any remaining sub-agent group
  if (currentSubAgentGroup.length > 0) {
    result.push({
      type: "subAgentTile",
      events: [...currentSubAgentGroup],
      index: partIndex++,
    });
  }

  return result;
}

interface Props {
  message: UIMessage;
  prevMessage?: UIMessage;
  threadId?: string;
  isLoading?: boolean;
  isLastMessage?: boolean;
  setMessages?: UseChatHelpers<UIMessage>["setMessages"];
  sendMessage?: UseChatHelpers<UIMessage>["sendMessage"];
  className?: string;
  addToolResult?: UseChatHelpers<UIMessage>["addToolResult"];
  messageIndex?: number;
  status?: UseChatHelpers<UIMessage>["status"];
  readonly?: boolean;
}

const PurePreviewMessage = ({
  message,
  prevMessage,
  readonly,
  threadId,
  isLoading,
  isLastMessage,
  status,
  className,
  setMessages,
  addToolResult,
  messageIndex,
  sendMessage,
}: Props) => {
  const isUserMessage = useMemo(() => message.role === "user", [message.role]);
  const partsForDisplay = useMemo(
    () =>
      message.parts.filter(
        (part) => !(part.type === "text" && (part as any).ingestionPreview),
      ),
    [message.parts],
  );

  // Merge and group parts chronologically - sub-agent events grouped by agent, inline with regular parts
  const mergedParts = useMemo(() => {
    return mergeAndGroupParts(partsForDisplay);
  }, [partsForDisplay]);

  if (message.role == "system") {
    return null; // system message is not shown
  }
  // Don't return null if we have parts to display
  if (mergedParts.length === 0) return null;

  return (
    <div className="w-full mx-auto max-w-3xl px-6 group/message">
      <div
        className={cn(
          "flex gap-4 w-full group-data-[role=user]/message:ml-auto group-data-[role=user]/message:max-w-2xl",
          className,
        )}
      >
        <div className="flex flex-col gap-4 w-full">
          {/* Render all parts in chronological order - sub-agent events inline with regular parts */}
          {mergedParts.map((unit, unitIndex) => {
            const isLastUnit = unitIndex === mergedParts.length - 1;

            // Handle sub-agent tile
            if (unit.type === "subAgentTile") {
              return (
                <SubAgentTile
                  key={`sub-agent-tile-${message.id}-${unit.index}`}
                  events={unit.events}
                  threadId={threadId}
                />
              );
            }

            // Handle regular parts
            const part = unit.part;
            const key = `message-${messageIndex}-part-${part.type}-${unit.index}`;
            const isLastPart = isLastUnit;

            // Handle reasoning parts
            if (part.type === "reasoning") {
              return (
                <ReasoningPart
                  key={key}
                  readonly={readonly}
                  reasoningText={part.text}
                  isThinking={isLastPart && isLastMessage && isLoading}
                />
              );
            }

            // Handle text parts - render in place (maintains streaming order)
            if (part.type === "text") {
              if (isUserMessage && part.text) {
                return (
                  <UserMessagePart
                    key={key}
                    status={status}
                    part={part}
                    readonly={readonly}
                    isLast={isLastPart}
                    message={message}
                    setMessages={setMessages}
                    sendMessage={sendMessage}
                  />
                );
              }

              if (!isUserMessage) {
                return (
                  <AssistMessagePart
                    threadId={threadId}
                    isLast={isLastMessage && isLastPart}
                    isLoading={isLoading}
                    key={key}
                    readonly={readonly}
                    part={part}
                    prevMessage={prevMessage}
                    showActions={
                      isLastMessage ? isLastPart && !isLoading : isLastPart
                    }
                    message={message}
                    setMessages={setMessages}
                    sendMessage={sendMessage}
                  />
                );
              }

              return null;
            }

            // Handle tool parts
            if (isToolUIPart(part)) {
              const toolPart = part as ToolUIPart;
              const isLast = isLastMessage && isLastPart;
              const isManualToolInvocation =
                (message.metadata as ChatMetadata)?.toolChoice == "manual" &&
                isLastMessage &&
                isLastPart &&
                toolPart.state == "input-available" &&
                isLoading &&
                !readonly;
              return (
                <ToolMessagePart
                  isLast={isLast}
                  readonly={readonly}
                  messageId={message.id}
                  isManualToolInvocation={isManualToolInvocation}
                  showActions={
                    !readonly &&
                    (isLastMessage ? isLastPart && !isLoading : isLastPart)
                  }
                  addToolResult={addToolResult}
                  key={key}
                  part={toolPart}
                  setMessages={setMessages}
                  threadId={threadId}
                />
              );
            }

            // Handle context compression tool block
            if (part.type === "tool-context-compression") {
              return (
                <ContextCompressionToolBlock
                  key={key}
                  state={(part as any).state}
                  compactedCount={(part as any).compactedCount}
                  tokensSaved={(part as any).tokensSaved}
                  oldPercentage={(part as any).oldPercentage}
                  newPercentage={(part as any).newPercentage}
                />
              );
            }

            // Handle other part types
            if (part.type === "step-start") {
              return null;
            }

            if (part.type === "file") {
              return (
                <FileMessagePart
                  key={key}
                  part={part}
                  isUserMessage={isUserMessage}
                />
              );
            }

            if ((part as any).type === "source-url") {
              return (
                <SourceUrlMessagePart
                  key={key}
                  part={part as any}
                  isUserMessage={isUserMessage}
                />
              );
            }

            // Skip other data events (plan updates, etc.) - sub-agent events are already handled above
            const partType = (part as any).type;
            if (typeof partType === "string" && partType.startsWith("data-")) {
              return null;
            }

            return <div key={key}> unknown part {part.type}</div>;
          })}
        </div>
      </div>
    </div>
  );
};

export const PreviewMessage = memo(
  PurePreviewMessage,
  function equalMessage(prevProps: Props, nextProps: Props) {
    if (prevProps.message.id !== nextProps.message.id) return false;

    if (prevProps.isLoading !== nextProps.isLoading) return false;

    if (prevProps.isLastMessage !== nextProps.isLastMessage) return false;

    if (prevProps.className !== nextProps.className) return false;

    if (nextProps.isLoading && nextProps.isLastMessage) return false;

    if (!equal(prevProps.message.metadata, nextProps.message.metadata))
      return false;

    if (prevProps.message.parts.length !== nextProps.message.parts.length) {
      return false;
    }
    if (!equal(prevProps.message.parts, nextProps.message.parts)) {
      return false;
    }

    return true;
  },
);

export const ErrorMessage = ({
  error,
}: {
  error: Error;
  message?: UIMessage;
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const maxLength = 200;
  const { t } = useTranslation();

  // Default error message
  return (
    <div className="w-full mx-auto max-w-3xl px-6 animate-in fade-in mt-4">
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-4 px-2 opacity-70">
          <div className="flex items-start gap-3">
            <div className="p-1.5 bg-muted rounded-sm">
              <TriangleAlertIcon className="h-3.5 w-3.5 text-destructive" />
            </div>
            <div className="flex-1">
              <p className="font-medium text-sm mb-2">{t("Chat.Error")}</p>
              <div className="text-sm text-muted-foreground">
                <div className="whitespace-pre-wrap">
                  {isExpanded
                    ? error.message
                    : truncateString(error.message, maxLength)}
                </div>
                {error.message.length > maxLength && (
                  <Button
                    onClick={() => setIsExpanded(!isExpanded)}
                    variant={"ghost"}
                    className="h-auto p-1 text-xs mt-2"
                    size={"sm"}
                  >
                    {isExpanded ? (
                      <>
                        <ChevronUp className="h-3 w-3 mr-1" />
                        {t("Common.showLess")}
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-3 w-3 mr-1" />
                        {t("Common.showMore")}
                      </>
                    )}
                  </Button>
                )}
                <p className="text-xs text-muted-foreground mt-3 italic">
                  {t("Chat.thisMessageWasNotSavedPleaseTryTheChatAgain")}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
