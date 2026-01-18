"use client";

import { ToolUIPart } from "ai";
import equal from "lib/equal";
import { toAny } from "lib/utils";
import { CheckIcon, PlayIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { memo, useMemo } from "react";
import { TextShimmer } from "ui/text-shimmer";

interface NextTaskInvocationProps {
  part: ToolUIPart;
}

interface NextTaskOutput {
  task?: {
    id: string;
    description: string;
    status: string;
  };
  message: string;
  isError?: boolean;
  error?: string;
}

function PureNextTaskInvocation({ part }: Readonly<NextTaskInvocationProps>) {
  const t = useTranslations();

  const result = useMemo(() => {
    if (!part.state.startsWith("output")) return null;
    return part.output as NextTaskOutput;
  }, [part.state, part.output]);

  // Loading state
  if (!part.state.startsWith("output")) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <PlayIcon className="h-4 w-4 text-muted-foreground" />
        <TextShimmer>{t("Chat.Tool.gettingNextTask")}</TextShimmer>
      </div>
    );
  }

  // Error state
  if (result?.isError) {
    return (
      <div className="flex items-center gap-2 text-sm text-red-500">
        <XIcon className="h-4 w-4" />
        <span>{result?.error}</span>
      </div>
    );
  }

  // No pending tasks - all complete
  if (!result?.task) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <CheckIcon className="h-4 w-4 text-muted-foreground" />
        <span className="font-semibold">{t("Chat.Tool.allTasksComplete")}</span>
      </div>
    );
  }

  // Active task - use TextShimmer like web search
  return (
    <div className="flex items-center gap-2 text-sm">
      <PlayIcon className="h-4 w-4 text-muted-foreground fill-muted-foreground" />
      <TextShimmer>{`Working on: ${result.task.description}`}</TextShimmer>
    </div>
  );
}

function areEqual(
  { part: prevPart }: NextTaskInvocationProps,
  { part: nextPart }: NextTaskInvocationProps,
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

export const NextTaskInvocation = memo(PureNextTaskInvocation, areEqual);
