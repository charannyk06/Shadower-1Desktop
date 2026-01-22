"use client";

import { ToolUIPart } from "ai";
import equal from "lib/equal";
import { toAny } from "lib/utils";
import { CheckIcon, ClipboardListIcon, XIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { memo, useMemo } from "react";
import { TextShimmer } from "ui/text-shimmer";

interface PlanStatusInvocationProps {
  part: ToolUIPart;
}

interface PlanStatusOutput {
  request?: string;
  status?: "planning" | "executing" | "completed" | "failed";
  progress?: number;
  tasksByStatus?: {
    pending: number;
    inProgress: number;
    completed: number;
    failed: number;
    blocked: number;
  };
  message: string;
  isError?: boolean;
  error?: string;
}

function PurePlanStatusInvocation({
  part,
}: Readonly<PlanStatusInvocationProps>) {
  const { t } = useTranslation();

  const result = useMemo(() => {
    if (!part.state.startsWith("output")) return null;
    return part.output as PlanStatusOutput;
  }, [part.state, part.output]);

  // Loading state
  if (!part.state.startsWith("output")) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <ClipboardListIcon className="h-4 w-4 text-muted-foreground" />
        <TextShimmer>{t("Chat.Tool.checkingPlanStatus")}</TextShimmer>
      </div>
    );
  }

  // No active plan
  if (!result?.status && result?.message) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <ClipboardListIcon className="h-4 w-4 text-muted-foreground" />
        <span className="text-muted-foreground">{result.message}</span>
      </div>
    );
  }

  const status = result?.status || "planning";
  const progress = result?.progress ?? 0;
  const tasksByStatus = result?.tasksByStatus;
  const isCompleted = status === "completed";
  const isExecuting = status === "executing";
  const isFailed = status === "failed";

  const totalTasks =
    (tasksByStatus?.pending || 0) +
    (tasksByStatus?.inProgress || 0) +
    (tasksByStatus?.completed || 0) +
    (tasksByStatus?.failed || 0) +
    (tasksByStatus?.blocked || 0);

  // Executing state - use TextShimmer
  if (isExecuting) {
    return (
      <div
        data-testid="plan-status"
        data-status="executing"
        data-progress={progress}
        className="flex items-center gap-2 text-sm"
      >
        <ClipboardListIcon className="h-4 w-4 text-muted-foreground" />
        <TextShimmer>
          {`Plan: ${progress}% complete (${tasksByStatus?.completed || 0}/${totalTasks} tasks)`}
        </TextShimmer>
      </div>
    );
  }

  // Completed state
  if (isCompleted) {
    return (
      <div
        data-testid="plan-status"
        data-status="completed"
        className="flex items-center gap-2 text-sm"
      >
        <CheckIcon className="h-4 w-4 text-muted-foreground" />
        <span className="font-semibold">
          Plan completed: {totalTasks} tasks done
        </span>
      </div>
    );
  }

  // Failed state
  if (isFailed) {
    return (
      <div
        data-testid="plan-status"
        data-status="failed"
        className="flex items-center gap-2 text-sm text-red-500"
      >
        <XIcon className="h-4 w-4" />
        <span className="font-semibold">
          Plan failed: {tasksByStatus?.failed || 0} tasks failed
        </span>
      </div>
    );
  }

  // Planning state
  return (
    <div
      data-testid="plan-status"
      data-status="planning"
      className="flex items-center gap-2 text-sm"
    >
      <ClipboardListIcon className="h-4 w-4 text-muted-foreground" />
      <TextShimmer>{`Planning: ${totalTasks} tasks`}</TextShimmer>
    </div>
  );
}

function areEqual(
  { part: prevPart }: PlanStatusInvocationProps,
  { part: nextPart }: PlanStatusInvocationProps,
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

export const PlanStatusInvocation = memo(PurePlanStatusInvocation, areEqual);
