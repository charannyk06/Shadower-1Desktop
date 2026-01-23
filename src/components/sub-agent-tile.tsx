"use client";

import { cn } from "lib/utils";
import {
  ChevronRight,
  MessageSquare,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { SubAgentEventPart } from "./sub-agent-event-part";
import type { SubAgentEvent } from "./tool-invocation/sub-agent-view";
import { TextShimmer } from "ui/text-shimmer";
import { getToolIcon } from "./tool-invocation/tool-call-row";

interface SubAgentTileProps {
  events: SubAgentEvent[];
  threadId?: string;
}

/**
 * Consolidates consecutive text events into single events
 */
function consolidateTextEvents(events: SubAgentEvent[]): SubAgentEvent[] {
  const result: SubAgentEvent[] = [];
  let accumulatedText = "";
  let lastTextTimestamp = 0;
  let lastAgentId = "";

  for (const event of events) {
    if (event.type === "data-sub-agent-text") {
      accumulatedText += event.data?.text || "";
      lastTextTimestamp = event.data?.timestamp || lastTextTimestamp;
      lastAgentId = event.data?.agentId || lastAgentId;
    } else {
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
 * Counts the stats for a subagent's events and collects tool names
 */
function getEventStats(events: SubAgentEvent[]) {
  let toolCalls = 0;
  let messages = 0;
  const toolNames: string[] = [];

  for (const event of events) {
    switch (event.type) {
      case "data-sub-agent-tool-call":
        toolCalls++;
        if (event.data?.toolName) {
          toolNames.push(event.data.toolName);
        }
        break;
      case "data-sub-agent-text":
        if (event.data?.text?.trim()) {
          messages++;
        }
        break;
    }
  }

  return { toolCalls, messages, toolNames };
}

/**
 * SubAgent tile with collapsible UI
 * - When running: expanded to show all activity
 * - When complete: collapsed to show summary "X tool calls, Y messages"
 * - User can click to expand/collapse
 */
export const SubAgentTile = memo(function SubAgentTile({
  events,
  threadId,
}: SubAgentTileProps) {
  // Track expanded state per agent - default false for completed, true for running
  const [expandedAgents, setExpandedAgents] = useState<Record<string, boolean>>({});
  // Track which agents we've seen complete - to auto-collapse them
  const completedAgentsRef = useRef<Set<string>>(new Set());

  // Group events by agentId
  const agentGroups = useMemo(() => {
    const groups: Record<string, SubAgentEvent[]> = {};

    for (const event of events) {
      if (!event?.data?.agentId) continue;
      const agentId = event.data.agentId;
      if (!groups[agentId]) {
        groups[agentId] = [];
      }
      groups[agentId].push(event);
    }

    // Remove duplicates and consolidate text
    for (const agentId in groups) {
      const seen = new Set<string>();
      groups[agentId] = groups[agentId].filter((event, index) => {
        const toolName = event.data?.toolName || "";
        const timestamp = event.data?.timestamp || 0;
        let contentHash = "";
        if (event.type === "data-sub-agent-tool-call" && event.data?.args) {
          contentHash = JSON.stringify(event.data.args).slice(0, 50);
        } else if (event.type === "data-sub-agent-text" && event.data?.text) {
          contentHash = event.data.text.slice(0, 50);
        } else if (
          event.type === "data-sub-agent-start" ||
          event.type === "data-sub-agent-complete"
        ) {
          contentHash = String(index);
        }
        const key = `${event.type}-${toolName}-${timestamp}-${contentHash}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      groups[agentId] = consolidateTextEvents(groups[agentId]);
    }

    return groups;
  }, [events]);

  // Determine if each agent is complete
  const agentStatuses = useMemo(() => {
    const statuses: Record<string, { isComplete: boolean; isError: boolean }> = {};

    for (const [agentId, agentEvents] of Object.entries(agentGroups)) {
      const isComplete = agentEvents.some((e) => e.type === "data-sub-agent-complete");
      const isError = agentEvents.some((e) => e.type === "data-sub-agent-error");
      statuses[agentId] = { isComplete, isError };
    }

    return statuses;
  }, [agentGroups]);

  // Auto-collapse when agent completes (only once)
  useEffect(() => {
    const newlyCompleted: string[] = [];

    for (const [agentId, status] of Object.entries(agentStatuses)) {
      if ((status.isComplete || status.isError) && !completedAgentsRef.current.has(agentId)) {
        newlyCompleted.push(agentId);
      }
    }

    if (newlyCompleted.length === 0) return;

    setExpandedAgents((prev) => {
      const next = { ...prev };
      for (const agentId of newlyCompleted) {
        next[agentId] = false;
      }
      return next;
    });

    for (const agentId of newlyCompleted) {
      completedAgentsRef.current.add(agentId);
    }
  }, [agentStatuses]);

  const toggleExpanded = useCallback((agentId: string) => {
    setExpandedAgents((prev) => ({
      ...prev,
      [agentId]: !prev[agentId],
    }));
  }, []);

  if (Object.keys(agentGroups).length === 0) {
    return null;
  }

  const agentEntries = Object.entries(agentGroups);

  return (
    <>
      {agentEntries.map(([agentId, agentEvents]) => {
        const startEvent = agentEvents.find((e) => e.type === "data-sub-agent-start");
        const agentName = startEvent?.data.agentName || "Sub-Agent";
        const task = startEvent?.data.task;

        const { isComplete, isError } = agentStatuses[agentId] || {};
        const isRunning = !isComplete && !isError;

        const stats = getEventStats(agentEvents);

        // Running agents are expanded by default, completed are collapsed
        const isExpanded = expandedAgents[agentId] ?? isRunning;

        const displayEvents = agentEvents.filter(
          (event) => event.type !== "data-sub-agent-start"
        );

        // Get unique tool icons for collapsed view (computed inline, not using useMemo in render)
        const uniqueToolIcons = (() => {
          const seen = new Set<string>();
          const icons: Array<{ icon: ReturnType<typeof getToolIcon>["icon"]; color: string; name: string }> = [];

          for (const name of stats.toolNames) {
            if (!seen.has(name)) {
              seen.add(name);
              const { icon, color } = getToolIcon(name);
              icons.push({ icon, color, name });
            }
            if (icons.length >= 5) break; // Limit to 5 unique icons
          }

          return icons;
        })();

        return (
          <div key={agentId} className="w-full my-1">
            <div className="rounded-lg border border-border/50 bg-background overflow-hidden">
              {/* Collapsible Header */}
              <button
                type="button"
                onClick={() => toggleExpanded(agentId)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
              >
                {/* Expand/Collapse Arrow */}
                <ChevronRight
                  className={cn(
                    "h-4 w-4 text-muted-foreground transition-transform duration-200 flex-shrink-0",
                    isExpanded && "rotate-90"
                  )}
                />

                {/* Running State */}
                {isRunning ? (
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    <TextShimmer className="text-sm font-medium" duration={1.5}>
                      {agentName}
                    </TextShimmer>
                    {task && (
                      <span className="text-xs text-muted-foreground truncate">
                        — {task}
                      </span>
                    )}
                  </div>
                ) : (
                  /* Completed State: Show agent name + summary stats */
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {agentName}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {stats.toolCalls > 0 || stats.messages > 0 ? (
                        <>
                          — {stats.toolCalls > 0 && (
                            <>{stats.toolCalls} tool{stats.toolCalls !== 1 ? "s" : ""}</>
                          )}
                          {stats.toolCalls > 0 && stats.messages > 0 && ", "}
                          {stats.messages > 0 && (
                            <>{stats.messages} message{stats.messages !== 1 ? "s" : ""}</>
                          )}
                        </>
                      ) : (
                        isComplete ? "— completed" : "— failed"
                      )}
                    </span>
                  </div>
                )}

                {/* Right-side icons for collapsed view - show actual tool icons */}
                {!isExpanded && !isRunning && (
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    {uniqueToolIcons.length > 0 ? (
                      // Show actual tool icons that were used
                      uniqueToolIcons.map(({ icon: Icon, color, name }, idx) => (
                        <Icon
                          key={`${name}-${idx}`}
                          className={cn("h-3.5 w-3.5", color)}
                        />
                      ))
                    ) : (
                      // Fallback to message icon if no tools
                      stats.messages > 0 && (
                        <MessageSquare className="h-4 w-4" />
                      )
                    )}
                  </div>
                )}
              </button>

              {/* Expandable Content */}
              <AnimatePresence initial={false}>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.15, ease: "easeOut" }}
                    className="overflow-hidden"
                  >
                    {displayEvents.length === 0 ? (
                      <div className="px-4 py-3 text-xs text-muted-foreground border-t border-border/50">
                        Waiting for activity...
                      </div>
                    ) : (
                      <div className="px-4 py-2 space-y-0.5 border-t border-border/50">
                        {displayEvents.map((event, index) => (
                          <SubAgentEventPart
                            key={`${agentId}-${event.type}-${index}`}
                            event={event}
                            threadId={threadId}
                            isAgentRunning={isRunning}
                          />
                        ))}
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        );
      })}
    </>
  );
});
