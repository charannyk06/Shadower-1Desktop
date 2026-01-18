"use client";

import { cn } from "lib/utils";
import { Bot, CheckIcon, XIcon } from "lucide-react";
import { memo, useMemo } from "react";
import { SubAgentEventPart } from "./sub-agent-event-part";
import type { SubAgentEvent } from "./tool-invocation/sub-agent-view";

interface SubAgentTileProps {
  events: SubAgentEvent[];
  threadId?: string;
}

/**
 * Consolidates consecutive text events into single events
 * This prevents the word-by-word display issue where each text delta
 * becomes a separate event.
 */
function consolidateTextEvents(events: SubAgentEvent[]): SubAgentEvent[] {
  const result: SubAgentEvent[] = [];
  let accumulatedText = "";
  let lastTextTimestamp = 0;
  let lastAgentId = "";

  for (const event of events) {
    if (event.type === "data-sub-agent-text") {
      // Accumulate text
      accumulatedText += event.data?.text || "";
      lastTextTimestamp = event.data?.timestamp || lastTextTimestamp;
      lastAgentId = event.data?.agentId || lastAgentId;
    } else {
      // Non-text event - flush accumulated text first
      if (accumulatedText) {
        result.push({
          type: "data-sub-agent-text",
          data: {
            agentId: lastAgentId,
            text: accumulatedText,
            timestamp: lastTextTimestamp,
          },
        } as SubAgentEvent);
        accumulatedText = "";
      }
      result.push(event);
    }
  }

  // Flush any remaining accumulated text
  if (accumulatedText) {
    result.push({
      type: "data-sub-agent-text",
      data: {
        agentId: lastAgentId,
        text: accumulatedText,
        timestamp: lastTextTimestamp,
      },
    } as SubAgentEvent);
  }

  return result;
}

/**
 * Groups all sub-agent events for a single agent into one tile
 * with a connecting line/avatar like the main chat messages
 */
export const SubAgentTile = memo(function SubAgentTile({
  events,
  threadId,
}: SubAgentTileProps) {
  // Group events by agentId
  const agentGroups = useMemo(() => {
    const groups: Record<string, SubAgentEvent[]> = {};

    for (const event of events) {
      if (!event?.data?.agentId) {
        console.warn("[SubAgentTile] Event missing agentId:", event);
        continue;
      }
      const agentId = event.data.agentId;
      if (!groups[agentId]) {
        groups[agentId] = [];
      }
      groups[agentId].push(event);
    }

    // Sort events within each group by timestamp and type order
    // Also remove duplicates based on type + agentId + toolName + timestamp + unique identifier
    for (const agentId in groups) {
      // Remove duplicates first - use a more comprehensive key
      const seen = new Set<string>();
      groups[agentId] = groups[agentId].filter((event, index) => {
        // Create a unique key that includes type, toolName (if present), timestamp, and content hash
        const toolName = event.data?.toolName || "";
        const timestamp = event.data?.timestamp || 0;

        // For different event types, use different strategies to create unique keys
        let contentHash = "";
        if (event.type === "data-sub-agent-tool-call" && event.data?.args) {
          // For tool calls, hash the args to distinguish different calls
          contentHash = JSON.stringify(event.data.args).slice(0, 50);
        } else if (event.type === "data-sub-agent-text" && event.data?.text) {
          // For text events, use a hash of the text content
          contentHash = event.data.text.slice(0, 50);
        } else if (
          event.type === "data-sub-agent-start" ||
          event.type === "data-sub-agent-complete"
        ) {
          // For start/complete events, use index as they should be unique per agent
          contentHash = String(index);
        }

        const key = `${event.type}-${toolName}-${timestamp}-${contentHash}`;

        if (seen.has(key)) {
          // Silently filter duplicates - no logging to reduce console noise
          return false;
        }
        seen.add(key);
        return true;
      });

      // DO NOT SORT - events arrive in correct chronological order from server
      // Sorting by timestamp breaks the streaming order

      // Consolidate consecutive text events to prevent word-by-word display
      groups[agentId] = consolidateTextEvents(groups[agentId]);
    }

    return groups;
  }, [events]);

  if (Object.keys(agentGroups).length === 0) {
    return null;
  }

  // DO NOT SORT - maintain arrival order from server
  const agentEntries = useMemo(() => {
    return Object.entries(agentGroups);
  }, [agentGroups]);

  return (
    <>
      {agentEntries.map(([agentId, agentEvents]) => {
        // Find agent name and status from events
        const startEvent = agentEvents.find(
          (e) => e.type === "data-sub-agent-start",
        );
        const completeEvent = agentEvents.find(
          (e) => e.type === "data-sub-agent-complete",
        );
        const errorEvent = agentEvents.find(
          (e) => e.type === "data-sub-agent-error",
        );

        const agentName = startEvent?.data.agentName || "Sub-Agent";
        const task = startEvent?.data.task;
        const isComplete = !!completeEvent;
        const isError = !!errorEvent;
        const status = isError ? "error" : isComplete ? "complete" : "running";

        return (
          <div key={agentId} className="group w-full">
            <div className="flex flex-col fade-in duration-300 animate-in">
              <div className="flex gap-2 py-2">
                {/* Connecting line and avatar */}
                <div className="w-7 flex justify-center">
                  <div className="relative flex flex-col items-center">
                    {/* Avatar */}
                    <div
                      className={cn(
                        "flex h-7 w-7 items-center justify-center rounded-full border-2 bg-background",
                        isComplete && "border-emerald-500",
                        isError && "border-red-500",
                        status === "running" && "border-blue-500",
                      )}
                    >
                      <Bot
                        className={cn(
                          "h-4 w-4",
                          isComplete && "text-emerald-500",
                          isError && "text-red-500",
                          status === "running" && "text-blue-500",
                        )}
                      />
                    </div>
                  </div>
                </div>

                {/* Content tile */}
                <div className="flex-1 min-w-0">
                  <div
                    className={cn(
                      "rounded-lg border bg-card overflow-hidden transition-colors",
                      isComplete && "border-emerald-500/30 bg-emerald-500/5",
                      isError && "border-red-500/30 bg-red-500/5",
                      status === "running" &&
                        "border-blue-500/30 bg-blue-500/5",
                    )}
                  >
                    {/* Header */}
                    <div className="px-4 py-3 border-b bg-muted/30">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "text-sm font-medium",
                            isComplete && "text-emerald-500 line-through",
                            isError && "text-red-500",
                            status === "running" && "text-blue-500",
                          )}
                        >
                          {agentName}
                        </span>
                        <span
                          className={cn(
                            "text-xs px-1.5 py-0.5 rounded font-medium",
                            isComplete && "bg-emerald-500/10 text-emerald-500",
                            isError && "bg-red-500/10 text-red-500",
                            status === "running" &&
                              "bg-blue-500/10 text-blue-500",
                          )}
                        >
                          {isComplete && (
                            <CheckIcon className="h-3 w-3 inline mr-1" />
                          )}
                          {isError && <XIcon className="h-3 w-3 inline mr-1" />}
                          {status}
                        </span>
                      </div>
                      {task && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {task}
                        </p>
                      )}
                    </div>

                    {/* Events content - render in arrival order (DO NOT SORT) */}
                    {(() => {
                      // Filter out start events, keep everything else in arrival order
                      const filteredEvents = agentEvents.filter(
                        (event) => event.type !== "data-sub-agent-start",
                      );

                      if (filteredEvents.length === 0) {
                        return (
                          <div className="p-3 text-xs text-muted-foreground">
                            No activity yet...
                          </div>
                        );
                      }

                      // DO NOT SORT - render in exact arrival order from server
                      return (
                        <div className="p-3 space-y-3">
                          {filteredEvents
                            .map((event, index) => {
                              try {
                                return (
                                  <SubAgentEventPart
                                    key={`${agentId}-${event.type}-${index}`}
                                    event={event}
                                    threadId={threadId}
                                  />
                                );
                              } catch (error) {
                                console.error(
                                  "[SubAgentTile] Error rendering event:",
                                  error,
                                  event,
                                );
                                return null;
                              }
                            })
                            .filter(Boolean)}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
});
