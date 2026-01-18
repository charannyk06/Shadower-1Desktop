"use client";

import { AnimatePresence, motion } from "framer-motion";
import { cn } from "lib/utils";
import { Bot, CheckIcon, ChevronDownIcon, XIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { memo, useMemo, useState } from "react";

// Lazy load visualization components
const BarChart = dynamic(
  () => import("./bar-chart").then((mod) => mod.BarChart),
  { ssr: false },
);
const LineChart = dynamic(
  () => import("./line-chart").then((mod) => mod.LineChart),
  { ssr: false },
);
const PieChart = dynamic(
  () => import("./pie-chart").then((mod) => mod.PieChart),
  { ssr: false },
);
const InteractiveTable = dynamic(
  () => import("./interactive-table").then((mod) => mod.InteractiveTable),
  { ssr: false },
);
const ToolCallTimeline = dynamic(
  () => import("./tool-call-timeline").then((mod) => mod.ToolCallTimeline),
  { ssr: false },
);

// Visualization tool names
const VISUALIZATION_TOOLS = [
  "createBarChart",
  "createLineChart",
  "createPieChart",
  "createTable",
];

/**
 * Sub-agent event types from the data stream
 */
export type SubAgentEventType =
  | "data-sub-agent-start"
  | "data-sub-agent-text"
  | "data-sub-agent-tool-call"
  | "data-sub-agent-complete"
  | "data-sub-agent-error";

export interface SubAgentEvent {
  type: SubAgentEventType;
  data: {
    agentId: string;
    agentName?: string;
    task?: string;
    text?: string;
    toolName?: string;
    args?: unknown;
    result?: string;
    timestamp?: number;
    success?: boolean;
    error?: string;
  };
}

interface ToolCall {
  name: string;
  args?: unknown;
  result?: string;
  timestamp: number;
}

interface SubAgentState {
  status: "running" | "complete" | "error";
  name: string;
  task?: string;
  text: string;
  tools: ToolCall[];
  error?: string;
}

interface SubAgentViewProps {
  events: SubAgentEvent[];
  className?: string;
}

interface AgentCardProps {
  state: SubAgentState;
}

function AgentCard({ state }: Readonly<AgentCardProps>) {
  const [isExpanded, setIsExpanded] = useState(true);
  const isComplete = state.status === "complete";
  const isRunning = state.status === "running";
  const isError = state.status === "error";

  return (
    <div
      data-testid="sub-agent-card"
      data-agent-status={state.status}
      className={cn(
        "rounded-lg border bg-card overflow-hidden transition-colors",
        isComplete && "border-emerald-500/30 bg-emerald-500/5",
        isRunning && "border-blue-500/30 bg-blue-500/5",
        isError && "border-red-500/30 bg-red-500/5",
      )}
    >
      {/* Header - Clickable */}
      <button
        data-testid="sub-agent-toggle"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-3 p-4 hover:bg-muted/50 transition-colors text-left"
      >
        {/* Icon */}
        <div
          className={cn(
            "p-2 rounded-md",
            isComplete && "bg-emerald-500/10",
            isRunning && "bg-blue-500/10",
            isError && "bg-red-500/10",
          )}
        >
          <Bot
            className={cn(
              "h-4 w-4",
              isComplete && "text-emerald-500",
              isRunning && "text-blue-500",
              isError && "text-red-500",
            )}
          />
        </div>

        {/* Title & Status */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "font-medium text-sm",
                isComplete && "line-through text-muted-foreground",
              )}
            >
              {state.name || "Sub-Agent"}
            </span>
            <span
              className={cn(
                "flex items-center gap-1 text-xs px-1.5 py-0.5 rounded font-medium",
                isComplete && "bg-emerald-500/10 text-emerald-500",
                isRunning && "bg-blue-500/10 text-blue-500",
                isError && "bg-red-500/10 text-red-500",
              )}
            >
              {isComplete && <CheckIcon className="h-3 w-3" />}
              {isError && <XIcon className="h-3 w-3" />}
              {state.status}
            </span>
          </div>
          {state.task && (
            <p
              className={cn(
                "text-xs text-muted-foreground truncate mt-0.5",
                isComplete && "line-through",
              )}
            >
              {state.task}
            </p>
          )}
        </div>

        {/* Chevron */}
        <ChevronDownIcon
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform",
            isExpanded && "rotate-180",
          )}
        />
      </button>

      {/* Expandable Content */}
      <AnimatePresence initial={false}>
        {isExpanded &&
          (state.text || state.tools.length > 0 || state.error) && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-4 pt-0 space-y-3">
                {/* Streaming text */}
                {state.text && (
                  <div className="rounded-md bg-muted/50 p-3">
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-5">
                      {state.text}
                    </p>
                  </div>
                )}

                {/* Tool calls - show all in chronological order */}
                {state.tools.length > 0 && (
                  <div className="space-y-3">
                    {/* Separate visualization tools from regular tools */}
                    {state.tools.some((toolCall) =>
                      VISUALIZATION_TOOLS.includes(toolCall.name),
                    ) && (
                      <div className="space-y-3">
                        {state.tools
                          .filter((toolCall) =>
                            VISUALIZATION_TOOLS.includes(toolCall.name),
                          )
                          .map((toolCall, i) => {
                            if (!toolCall.args) return null;
                            const args =
                              typeof toolCall.args === "string"
                                ? JSON.parse(toolCall.args)
                                : toolCall.args;

                            return (
                              <div
                                key={`${toolCall.name}-${i}-${toolCall.timestamp}`}
                                className="rounded-md border bg-card p-3"
                              >
                                {toolCall.name === "createBarChart" && (
                                  <BarChart {...args} />
                                )}
                                {toolCall.name === "createLineChart" && (
                                  <LineChart {...args} />
                                )}
                                {toolCall.name === "createPieChart" && (
                                  <PieChart {...args} />
                                )}
                                {toolCall.name === "createTable" && (
                                  <InteractiveTable {...args} />
                                )}
                              </div>
                            );
                          })}
                      </div>
                    )}

                    {/* Regular tool calls - use timeline */}
                    {state.tools.some(
                      (toolCall) =>
                        !VISUALIZATION_TOOLS.includes(toolCall.name),
                    ) && (
                      <div className="max-h-[600px] overflow-y-auto">
                        <ToolCallTimeline
                          toolCalls={state.tools
                            .filter(
                              (toolCall) =>
                                !VISUALIZATION_TOOLS.includes(toolCall.name),
                            )
                            .map((toolCall) => ({
                              name: toolCall.name,
                              args: toolCall.args,
                              result: toolCall.result,
                              timestamp: toolCall.timestamp,
                              status:
                                toolCall.result === undefined
                                  ? ("pending" as const)
                                  : ("success" as const),
                            }))}
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Error */}
                {state.error && (
                  <div className="rounded-md bg-red-500/10 p-3">
                    <p className="text-xs text-red-500">{state.error}</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Renders sub-agent activity from streaming events
 * Maintains chronological order of events across all agents
 */
function PureSubAgentView({ events, className }: Readonly<SubAgentViewProps>) {
  // Group events by agentId and build state for each agent
  // Maintain chronological order by processing events in order
  const agentStates = useMemo(() => {
    const states: Record<string, SubAgentState> = {};

    // Process events in chronological order (they arrive in order)
    for (const event of events) {
      const { agentId } = event.data;
      if (!states[agentId]) {
        states[agentId] = {
          status: "running",
          name: "",
          text: "",
          tools: [],
        };
      }

      switch (event.type) {
        case "data-sub-agent-start":
          states[agentId].name = event.data.agentName || agentId;
          states[agentId].task = event.data.task;
          break;
        case "data-sub-agent-text":
          states[agentId].text += event.data.text || "";
          break;
        case "data-sub-agent-tool-call":
          if (event.data.toolName) {
            states[agentId].tools.push({
              name: event.data.toolName,
              args: event.data.args,
              result: event.data.result,
              timestamp: event.data.timestamp || Date.now(),
            });
          }
          break;
        case "data-sub-agent-complete":
          states[agentId].status = "complete";
          break;
        case "data-sub-agent-error":
          states[agentId].status = "error";
          states[agentId].error = event.data.error;
          break;
      }
    }

    // Sort tools within each agent by timestamp to maintain order
    for (const agentId in states) {
      states[agentId].tools.sort((a, b) => a.timestamp - b.timestamp);
    }

    return states;
  }, [events]);

  // Sort agents by first event timestamp to maintain chronological order
  const agentEntries = useMemo(() => {
    const entries = Object.entries(agentStates);

    // Find first event timestamp for each agent
    const agentFirstTimestamps = new Map<string, number>();
    for (const event of events) {
      const { agentId } = event.data;
      if (!agentFirstTimestamps.has(agentId)) {
        agentFirstTimestamps.set(agentId, event.data.timestamp || Date.now());
      }
    }

    // Sort by first event timestamp
    return entries.sort(([idA], [idB]) => {
      const timeA = agentFirstTimestamps.get(idA) || 0;
      const timeB = agentFirstTimestamps.get(idB) || 0;
      return timeA - timeB;
    });
  }, [agentStates, events]);

  if (agentEntries.length === 0) {
    return null;
  }

  return (
    <div data-testid="sub-agent-view" className={cn("space-y-2", className)}>
      {agentEntries.map(([agentId, state]) => (
        <AgentCard key={agentId} state={state} />
      ))}
    </div>
  );
}

export const SubAgentView = memo(PureSubAgentView);

/**
 * Helper to check if an event is a sub-agent event
 */
export function isSubAgentEvent(event: {
  type: string;
}): event is SubAgentEvent {
  return event.type.startsWith("data-sub-agent-");
}
