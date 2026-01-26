"use client";

import { type ToolUIPart, type UIMessage, isToolUIPart } from "ai";
import equal from "lib/equal";
import { memo, useMemo, useState } from "react";

import type { UseChatHelpers } from "@ai-sdk/react";
import { ChatMetadata } from "app-types/chat";
import { cn, truncateString } from "lib/utils";
import { ChevronDown, ChevronUp, TriangleAlertIcon } from "lucide-react";
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
import { CheckIcon, ListTodoIcon, Loader2 } from "lucide-react";

// Simple ACP Plan Part component for rendering plan steps from coding agents
const ACPPlanPart = memo(function ACPPlanPart({
  plan,
}: {
  plan: {
    planId: string;
    title?: string;
    steps: Array<{ id: string; description: string; status: string }>;
    status: string;
  };
}) {
  const completedCount = plan.steps.filter(
    (s) => s.status === "completed",
  ).length;
  const totalCount = plan.steps.length;
  const isAllDone = completedCount === totalCount && totalCount > 0;

  return (
    <div
      className={cn(
        "rounded-lg border bg-card overflow-hidden transition-colors",
        isAllDone && "border-emerald-500/30 bg-emerald-500/5",
      )}
    >
      <div className="flex items-center gap-3 p-4">
        <div
          className={cn(
            "p-2 rounded-md",
            isAllDone ? "bg-emerald-500/10" : "bg-primary/10",
          )}
        >
          {isAllDone ? (
            <CheckIcon className="h-4 w-4 text-emerald-500" />
          ) : (
            <ListTodoIcon className="h-4 w-4 text-primary" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">
              {plan.title || "Agent Plan"}
            </span>
            <span
              className={cn(
                "text-xs px-1.5 py-0.5 rounded font-medium",
                isAllDone
                  ? "bg-emerald-500/10 text-emerald-500"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {completedCount}/{totalCount}
            </span>
          </div>
        </div>
      </div>
      <div className="px-4 pb-4 space-y-1">
        {plan.steps.map((step, index) => {
          const isCompleted = step.status === "completed";
          const isInProgress =
            step.status === "in-progress" || step.status === "running";
          return (
            <div
              key={step.id || index}
              className={cn(
                "flex items-start gap-3 px-3 py-2 rounded-md transition-colors",
                isInProgress && "bg-blue-500/5",
                isCompleted && "opacity-60",
              )}
            >
              <div
                className={cn(
                  "mt-0.5 flex items-center justify-center w-5 h-5 rounded border-2 transition-colors",
                  isCompleted && "bg-emerald-500 border-emerald-500",
                  isInProgress && "border-blue-500",
                  step.status === "failed" && "border-red-500",
                  step.status === "pending" && "border-muted-foreground/30",
                )}
              >
                {isCompleted && <CheckIcon className="h-3 w-3 text-white" />}
                {isInProgress && (
                  <Loader2 className="h-3 w-3 text-blue-500 animate-spin" />
                )}
              </div>
              <span
                className={cn(
                  "flex-1 text-sm leading-tight",
                  isCompleted && "line-through text-muted-foreground",
                )}
              >
                {step.description}
              </span>
              <span className="text-xs text-muted-foreground/60 font-mono tabular-nums">
                {index + 1}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
});

type RenderUnit =
  | { type: "part"; part: any; index: number }
  | {
      type: "subAgentTile";
      events: SubAgentEvent[];
      index: number;
      stableKey: string;
    };

/**
 * Groups ALL sub-agent events into a single SubAgentTile, placed AFTER the
 * spawning tool call (spawnSystemAgent or spawnAgent). This ensures the
 * "Spawn system agent" tool call appears BEFORE the agent tile in the UI.
 *
 * The SubAgentTile component internally groups events by agentId.
 */
function mergeAndGroupParts(parts: any[]): RenderUnit[] {
  const result: RenderUnit[] = [];
  const allSubAgentEvents: SubAgentEvent[] = [];
  let partIndex = 0;

  // First pass: collect all sub-agent events and group by agentId
  const subAgentEventsByAgent: Record<string, SubAgentEvent[]> = {};
  for (const part of parts) {
    const partType = typeof part.type === "string" ? part.type : "";
    if (partType.startsWith("data-sub-agent-")) {
      const event = part as SubAgentEvent;
      allSubAgentEvents.push(event);
      const agentId = event.data?.agentId;
      if (agentId) {
        if (!subAgentEventsByAgent[agentId]) {
          subAgentEventsByAgent[agentId] = [];
        }
        subAgentEventsByAgent[agentId].push(event);
      }
    }
  }

  // Track which agents have had their tiles inserted
  const insertedAgentTiles = new Set<string>();
  let allAgentsTileInserted = false;

  // Second pass: build render units, inserting SubAgentTile after spawn tool calls
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const partType = typeof part.type === "string" ? part.type : "";

    // Skip all sub-agent events (they're grouped into tiles)
    if (partType.startsWith("data-sub-agent-")) {
      continue;
    }

    // Add regular part first
    result.push({
      type: "part",
      part,
      index: partIndex++,
    });

    // Check if this is a spawn tool call - insert SubAgentTile AFTER it
    if (isToolUIPart(part)) {
      const toolPart = part as ToolUIPart;
      // Extract tool name from the type (e.g., "tool-spawnSystemAgent" -> "spawnSystemAgent")
      const toolName =
        typeof toolPart.type === "string" && toolPart.type.startsWith("tool-")
          ? toolPart.type.slice(5)
          : "";
      const isSpawnTool =
        toolName === "spawnSystemAgent" || toolName === "spawnAgent";

      if (isSpawnTool && !allAgentsTileInserted) {
        // For spawnSystemAgent, the agentId is "system-{agentType}"
        // For spawnAgent, we'd need to match by task or other means
        const args = (toolPart as any).input;
        let matchedAgentId: string | null = null;

        if (toolName === "spawnSystemAgent" && args?.agentType) {
          matchedAgentId = `system-${args.agentType}`;
        }

        // If we found a matching agent with events, insert its tile
        if (matchedAgentId && subAgentEventsByAgent[matchedAgentId]) {
          if (!insertedAgentTiles.has(matchedAgentId)) {
            result.push({
              type: "subAgentTile",
              events: subAgentEventsByAgent[matchedAgentId],
              index: partIndex++,
              stableKey: matchedAgentId, // Stable key based on agentId
            });
            insertedAgentTiles.add(matchedAgentId);
          }
        } else if (allSubAgentEvents.length > 0 && !allAgentsTileInserted) {
          // Fallback: insert all sub-agent events as one tile after spawn tool
          // Use first agentId for stable key
          const firstAgentId =
            allSubAgentEvents[0]?.data?.agentId || "fallback";
          result.push({
            type: "subAgentTile",
            events: allSubAgentEvents,
            index: partIndex++,
            stableKey: firstAgentId,
          });
          allAgentsTileInserted = true;
        }
      }
    }
  }

  // If there are sub-agent events but no spawn tool call was found,
  // append the tile at the end (fallback for edge cases)
  if (
    allSubAgentEvents.length > 0 &&
    !allAgentsTileInserted &&
    insertedAgentTiles.size === 0
  ) {
    const firstAgentId = allSubAgentEvents[0]?.data?.agentId || "fallback";
    result.push({
      type: "subAgentTile",
      events: allSubAgentEvents,
      index: partIndex++,
      stableKey: firstAgentId,
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
      (message.parts || []).filter(
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
                  key={`sub-agent-tile-${message.id}-${unit.stableKey}`}
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
                // Use the actual part from message.parts if available to get the latest text
                // Cast to the same type as part since we're in a text part block
                const actualPart = (message.parts?.[unit.index] ||
                  part) as typeof part;

                // STREAMING FIX: Use stable key during streaming to prevent unmount/remount flickering
                // Content-based keys cause component to remount on every update, restarting animations
                // Only use content-based key after streaming completes to handle stale content edge cases
                const isCurrentlyStreaming =
                  isLoading && isLastMessage && isLastPart;
                let contentKey: string;
                if (isCurrentlyStreaming) {
                  // Stable key during streaming - prevents flickering
                  contentKey = key;
                } else {
                  // Content-based key when not streaming - ensures fresh render if content was stale
                  const partTextHash = actualPart.text
                    ? actualPart.text.substring(0, 100).replace(/\s/g, "")
                    : "";
                  const partsHash = message.parts
                    ? message.parts.length +
                      "-" +
                      message.parts
                        .map((p: any) => p.text?.length || 0)
                        .join("-")
                    : "";
                  contentKey = `${key}-${partTextHash}-${partsHash}`;
                }

                return (
                  <AssistMessagePart
                    threadId={threadId}
                    isLast={isLastMessage && isLastPart}
                    isLoading={isLoading}
                    key={contentKey}
                    readonly={readonly}
                    part={actualPart}
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

              // Use stable key during streaming to prevent flickering
              // Key based on toolCallId which is stable across updates
              const toolCallId =
                (toolPart as any).toolCallId || `tool-${unit.index}`;
              const isCurrentlyStreaming =
                isLoading && isLastMessage && isLastPart;
              const stableKey = isCurrentlyStreaming
                ? `tool-${message.id}-${toolCallId}`
                : `${key}-${toolCallId}-${toolPart.state}`;

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
                  key={stableKey}
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

            // Handle ACP plan parts
            if ((part as any).type === "plan") {
              const planPart = part as {
                type: "plan";
                planId: string;
                title?: string;
                steps: Array<{
                  id: string;
                  description: string;
                  status: string;
                }>;
                status: string;
              };
              return <ACPPlanPart key={key} plan={planPart} />;
            }

            // Handle terminal_output parts
            if ((part as any).type === "terminal_output") {
              return null; // Terminal output handled separately
            }

            // Skip other data events (plan updates, etc.) - sub-agent events are already handled above
            const partType = (part as any).type;
            if (typeof partType === "string" && partType.startsWith("data-")) {
              return null;
            }

            return null; // Skip unknown parts silently
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
              <p className="font-medium text-sm mb-2">Chat Error</p>
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
                        Show less
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-3 w-3 mr-1" />
                        Show more
                      </>
                    )}
                  </Button>
                )}
                <p className="text-xs text-muted-foreground mt-3 italic">
                  This message was not saved. Please try the chat again.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
