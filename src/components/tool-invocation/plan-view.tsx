"use client";

import { useAppStore } from "@/app/store";
import { ToolUIPart } from "ai";
import { AnimatePresence, motion } from "framer-motion";
import equal from "lib/equal";
import { cn, toAny } from "lib/utils";
import {
  AlertTriangleIcon,
  CheckIcon,
  ChevronDownIcon,
  ListTodoIcon,
  XIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { memo, useEffect, useMemo, useState } from "react";
import { TextShimmer } from "ui/text-shimmer";
import { useShallow } from "zustand/shallow";

interface PlanViewInvocationProps {
  part: ToolUIPart;
}

interface TaskItem {
  id: string;
  description: string;
  status: "pending" | "in-progress" | "completed" | "failed" | "blocked";
  assignedAgent?: string;
}

interface PlanOutput {
  planId: string;
  taskCount: number;
  tasks: TaskItem[];
  message: string;
  isError?: boolean;
  error?: string;
}

interface PlanInput {
  request: string;
  tasks: Array<{ description: string; assignedAgent?: string }>;
}

function PurePlanViewInvocation({ part }: Readonly<PlanViewInvocationProps>) {
  const t = useTranslations();
  const [isExpanded, setIsExpanded] = useState(true);

  // Get real-time plan state from store
  const { currentThreadId, threadPlans } = useAppStore(
    useShallow((s) => ({
      currentThreadId: s.currentThreadId,
      threadPlans: s.threadPlans,
    })),
  );

  const input = part.input as PlanInput | undefined;
  const toolResult = useMemo(() => {
    if (!part.state.startsWith("output")) return null;
    return part.output as PlanOutput;
  }, [part.state, part.output]);

  // Use store data for real-time updates, fallback to tool result
  const storePlan = currentThreadId ? threadPlans[currentThreadId] : undefined;

  // Merge store data with tool result - prefer store for tasks (real-time updates)
  const result = useMemo(() => {
    if (!toolResult) return null;

    // If we have store data with matching planId, use its tasks for real-time progress
    if (storePlan && storePlan.planId === toolResult.planId) {
      return {
        ...toolResult,
        tasks: storePlan.tasks as TaskItem[],
      };
    }

    return toolResult;
  }, [toolResult, storePlan]);

  const { completed, total, progress } = useMemo(() => {
    // Use store progress if available for smoother updates
    if (storePlan && toolResult?.planId === storePlan.planId) {
      const comp = storePlan.tasks.filter(
        (t) => t.status === "completed",
      ).length;
      return {
        completed: comp,
        total: storePlan.tasks.length,
        progress: storePlan.progress,
      };
    }

    if (!result?.tasks?.length) return { completed: 0, total: 0, progress: 0 };
    const comp = result.tasks.filter((t) => t.status === "completed").length;
    return {
      completed: comp,
      total: result.tasks.length,
      progress: Math.round((comp / result.tasks.length) * 100),
    };
  }, [result?.tasks, storePlan, toolResult?.planId]);

  const isAllDone = progress === 100;

  // Auto-collapse when all tasks are completed
  useEffect(() => {
    if (isAllDone) {
      setIsExpanded(false);
    }
  }, [isAllDone]);

  // Loading state
  if (!part.state.startsWith("output")) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <ListTodoIcon className="h-4 w-4 text-muted-foreground" />
        <TextShimmer>Creating plan...</TextShimmer>
      </div>
    );
  }

  // Error state
  if (result?.isError) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4">
        <div className="flex items-center gap-2 text-sm text-red-500">
          <XIcon className="h-4 w-4" />
          <span>{result.error}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="plan-view"
      className={cn(
        "rounded-lg border bg-card overflow-hidden transition-colors",
        isAllDone && "border-emerald-500/30 bg-emerald-500/5",
      )}
    >
      {/* Header - Clickable to expand/collapse */}
      <button
        data-testid="plan-view-toggle"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-3 p-4 hover:bg-muted/50 transition-colors text-left"
      >
        {/* Icon */}
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

        {/* Title & Progress */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">
              {t("Chat.Tool.agentPlan")}
            </span>
            <span
              className={cn(
                "text-xs px-1.5 py-0.5 rounded font-medium",
                isAllDone
                  ? "bg-emerald-500/10 text-emerald-500"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {completed}/{total}
            </span>
          </div>
          {input?.request && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {input.request}
            </p>
          )}
        </div>

        {/* Progress & Chevron */}
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "text-sm font-mono",
              isAllDone ? "text-emerald-500" : "text-muted-foreground",
            )}
          >
            {progress}%
          </span>
          <ChevronDownIcon
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform",
              isExpanded && "rotate-180",
            )}
          />
        </div>
      </button>

      {/* Progress bar */}
      <div className="h-0.5 bg-muted">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.3 }}
          className={cn("h-full", isAllDone ? "bg-emerald-500" : "bg-primary")}
        />
      </div>

      {/* Expandable Task List */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="p-2 space-y-0.5">
              {result?.tasks?.map((task, index) => {
                const isCompleted = task.status === "completed";
                const isInProgress = task.status === "in-progress";

                return (
                  <div
                    key={task.id || index}
                    data-testid={`plan-task-${task.id || index}`}
                    data-task-status={task.status}
                    className={cn(
                      "flex items-start gap-3 px-3 py-2 rounded-md transition-colors",
                      isInProgress && "bg-blue-500/5",
                      isCompleted && "opacity-60",
                    )}
                  >
                    {/* Checkbox-style indicator */}
                    <div
                      className={cn(
                        "mt-0.5 flex items-center justify-center w-5 h-5 rounded border-2 transition-colors",
                        isCompleted && "bg-emerald-500 border-emerald-500",
                        isInProgress && "border-blue-500",
                        task.status === "failed" && "border-red-500",
                        task.status === "blocked" && "border-amber-500",
                        task.status === "pending" &&
                          "border-muted-foreground/30",
                      )}
                    >
                      {isCompleted && (
                        <CheckIcon className="h-3 w-3 text-white" />
                      )}
                      {task.status === "failed" && (
                        <XIcon className="h-3 w-3 text-red-500" />
                      )}
                      {task.status === "blocked" && (
                        <AlertTriangleIcon className="h-3 w-3 text-amber-500" />
                      )}
                    </div>

                    {/* Task text */}
                    <span
                      className={cn(
                        "flex-1 text-sm leading-tight",
                        isCompleted && "line-through text-muted-foreground",
                      )}
                    >
                      {task.description}
                    </span>

                    {/* Step indicator */}
                    <span className="text-xs text-muted-foreground/60 font-mono tabular-nums">
                      {index + 1}
                    </span>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function areEqual(
  { part: prevPart }: PlanViewInvocationProps,
  { part: nextPart }: PlanViewInvocationProps,
) {
  if (prevPart.state !== nextPart.state) return false;
  if (!equal(prevPart.input, nextPart.input)) return false;
  if (
    prevPart.state.startsWith("output") &&
    !equal(prevPart.output, toAny(nextPart).output)
  )
    return false;
  return true;
}

export const PlanViewInvocation = memo(PurePlanViewInvocation, areEqual);
