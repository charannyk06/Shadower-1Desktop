"use client";

import { ToolUIPart } from "ai";
import equal from "lib/equal";
import { cn, toAny } from "lib/utils";
import {
  AlertTriangleIcon,
  CheckIcon,
  CircleDotIcon,
  XIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { memo, useMemo } from "react";
import { TextShimmer } from "ui/text-shimmer";

interface TaskStatusInvocationProps {
  part: ToolUIPart;
}

interface TaskStatusInput {
  taskId: string;
  status: "pending" | "in-progress" | "completed" | "failed" | "blocked";
  result?: string;
}

interface TaskStatusOutput {
  taskId: string;
  newStatus: string;
  taskDescription?: string;
  planProgress: number;
  planStatus: string;
  remainingTasks: number;
  isError?: boolean;
  error?: string;
}

function PureTaskStatusInvocation({
  part,
}: Readonly<TaskStatusInvocationProps>) {
  const t = useTranslations();

  const input = part.input as TaskStatusInput | undefined;
  const result = useMemo(() => {
    if (!part.state.startsWith("output")) return null;
    return part.output as TaskStatusOutput;
  }, [part.state, part.output]);

  // Loading state - show minimal indicator
  if (!part.state.startsWith("output")) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <CircleDotIcon className="h-4 w-4 text-muted-foreground" />
        <TextShimmer>Updating task...</TextShimmer>
      </div>
    );
  }

  // Error state
  if (result?.isError) {
    return (
      <div className="flex items-center gap-2 text-sm text-red-500">
        <XIcon className="h-4 w-4" />
        <span>{result?.error || t("Common.error")}</span>
      </div>
    );
  }

  const taskDescription = result?.taskDescription || input?.taskId;
  const status = result?.newStatus || input?.status || "pending";
  const isCompleted = status === "completed";
  const isFailed = status === "failed";
  const isBlocked = status === "blocked";
  const isInProgress = status === "in-progress";

  // In-progress state - use TextShimmer like web search
  if (isInProgress) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <CircleDotIcon className="h-4 w-4 text-muted-foreground" />
        <TextShimmer>{`Working on: ${taskDescription || "task"}`}</TextShimmer>
      </div>
    );
  }

  // Completed/Failed/Blocked states - simple text like web search "Searched the web"
  return (
    <div
      data-testid="task-status"
      data-task-id={result?.taskId || input?.taskId}
      data-task-status={status}
      className="flex items-center gap-2 text-sm"
    >
      {isCompleted && <CheckIcon className="h-4 w-4 text-muted-foreground" />}
      {isFailed && <XIcon className="h-4 w-4 text-red-500" />}
      {isBlocked && <AlertTriangleIcon className="h-4 w-4 text-amber-500" />}
      <span
        className={cn(
          "font-semibold",
          isFailed && "text-red-500",
          isBlocked && "text-amber-500",
        )}
      >
        {isCompleted && "Completed: "}
        {isFailed && "Failed: "}
        {isBlocked && "Blocked: "}
        <span
          className={cn(
            isCompleted && "line-through font-normal text-muted-foreground",
          )}
        >
          {taskDescription}
        </span>
      </span>
    </div>
  );
}

function areEqual(
  { part: prevPart }: TaskStatusInvocationProps,
  { part: nextPart }: TaskStatusInvocationProps,
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

export const TaskStatusInvocation = memo(PureTaskStatusInvocation, areEqual);
