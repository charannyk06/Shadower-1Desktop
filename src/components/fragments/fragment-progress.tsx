"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  FileCode,
  Package,
  Play,
  Edit3,
  Upload,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { FragmentProgressEvent } from "@/types/fragment";

interface FragmentProgressProps {
  event: FragmentProgressEvent;
  className?: string;
}

const STAGE_CONFIG = {
  analyzing: {
    icon: Sparkles,
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
  },
  "template-selected": {
    icon: FileCode,
    color: "text-purple-500",
    bgColor: "bg-purple-500/10",
  },
  generating: {
    icon: FileCode,
    color: "text-indigo-500",
    bgColor: "bg-indigo-500/10",
  },
  installing: {
    icon: Package,
    color: "text-amber-500",
    bgColor: "bg-amber-500/10",
  },
  executing: {
    icon: Play,
    color: "text-green-500",
    bgColor: "bg-green-500/10",
  },
  editing: {
    icon: Edit3,
    color: "text-orange-500",
    bgColor: "bg-orange-500/10",
  },
  deploying: {
    icon: Upload,
    color: "text-cyan-500",
    bgColor: "bg-cyan-500/10",
  },
  complete: {
    icon: CheckCircle2,
    color: "text-green-600",
    bgColor: "bg-green-500/10",
  },
  error: {
    icon: AlertCircle,
    color: "text-red-500",
    bgColor: "bg-red-500/10",
  },
};

export function FragmentProgress({ event, className }: FragmentProgressProps) {
  const config = STAGE_CONFIG[event.stage] || STAGE_CONFIG.analyzing;
  const Icon = config.icon;
  const isComplete = event.stage === "complete";
  const isError = event.stage === "error";
  const isLoading = !isComplete && !isError;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={event.stage}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        className={cn(
          "flex items-center gap-3 p-3 rounded-lg border",
          config.bgColor,
          isError ? "border-red-200" : "border-transparent",
          className,
        )}
      >
        <div
          className={cn(
            "flex items-center justify-center w-8 h-8 rounded-full",
            config.bgColor,
          )}
        >
          {isLoading ? (
            <Loader2 className={cn("h-5 w-5 animate-spin", config.color)} />
          ) : (
            <Icon className={cn("h-5 w-5", config.color)} />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <p className={cn("text-sm font-medium", isError && "text-red-600")}>
            {event.message}
          </p>
          {event.codeLength && event.stage === "generating" && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {event.codeLength.toLocaleString()} characters generated...
            </p>
          )}
          {event.template && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Template: {event.template}
            </p>
          )}
          {event.error && (
            <p className="text-xs text-red-500 mt-0.5">{event.error}</p>
          )}
        </div>

        {event.previewUrl && (
          <a
            href={event.previewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary hover:underline whitespace-nowrap"
          >
            View Preview →
          </a>
        )}
      </motion.div>
    </AnimatePresence>
  );
}

/**
 * Multi-step progress display for fragment generation
 */
interface FragmentProgressStepsProps {
  events: FragmentProgressEvent[];
  className?: string;
}

export function FragmentProgressSteps({
  events,
  className,
}: FragmentProgressStepsProps) {
  if (events.length === 0) return null;

  // Show only the latest event prominently, with history collapsed
  const latestEvent = events[events.length - 1];
  const previousEvents = events.slice(0, -1);

  return (
    <div className={cn("space-y-2", className)}>
      {/* Previous events - collapsed */}
      {previousEvents.length > 0 && (
        <div className="space-y-1">
          {previousEvents.map((event, index) => {
            const config = STAGE_CONFIG[event.stage] || STAGE_CONFIG.analyzing;
            const Icon = config.icon;

            return (
              <div
                key={index}
                className="flex items-center gap-2 text-xs text-muted-foreground"
              >
                <Icon className={cn("h-3 w-3", config.color)} />
                <span>{event.message}</span>
                <CheckCircle2 className="h-3 w-3 text-green-500 ml-auto" />
              </div>
            );
          })}
        </div>
      )}

      {/* Latest event - prominent */}
      <FragmentProgress event={latestEvent} />
    </div>
  );
}
