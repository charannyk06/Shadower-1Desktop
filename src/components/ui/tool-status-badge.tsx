"use client";

import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";
import { memo } from "react";

export type ToolStatus = "pending" | "running" | "success" | "error";

interface ToolStatusBadgeProps {
  status: ToolStatus;
  className?: string;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
}

const statusConfig = {
  pending: {
    icon: Clock,
    color: "text-muted-foreground",
    bgColor: "bg-muted",
    borderColor: "border-muted-foreground/20",
    label: "Pending",
  },
  running: {
    icon: Loader2,
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/30",
    label: "Running",
    animate: true,
  },
  success: {
    icon: CheckCircle2,
    color: "text-emerald-500",
    bgColor: "bg-emerald-500/10",
    borderColor: "border-emerald-500/30",
    label: "Success",
  },
  error: {
    icon: XCircle,
    color: "text-red-500",
    bgColor: "bg-red-500/10",
    borderColor: "border-red-500/30",
    label: "Error",
  },
};

const sizeConfig = {
  sm: {
    icon: "h-3 w-3",
    text: "text-xs",
    padding: "px-1.5 py-0.5",
  },
  md: {
    icon: "h-4 w-4",
    text: "text-sm",
    padding: "px-2 py-1",
  },
  lg: {
    icon: "h-5 w-5",
    text: "text-base",
    padding: "px-2.5 py-1.5",
  },
};

export const ToolStatusBadge = memo(function ToolStatusBadge({
  status,
  className,
  size = "md",
  showLabel = false,
}: ToolStatusBadgeProps) {
  const config = statusConfig[status];
  const sizeStyles = sizeConfig[size];
  const Icon = config.icon;

  const iconElement =
    status === "running" ? (
      <motion.div
        animate={{ rotate: 360 }}
        transition={{
          duration: 1,
          repeat: Infinity,
          ease: "linear",
        }}
      >
        <Icon className={cn(sizeStyles.icon, config.color)} />
      </motion.div>
    ) : (
      <Icon className={cn(sizeStyles.icon, config.color)} />
    );

  if (showLabel) {
    return (
      <div
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border",
          config.bgColor,
          config.borderColor,
          sizeStyles.padding,
          sizeStyles.text,
          className,
        )}
      >
        {iconElement}
        <span className={cn("font-medium", config.color)}>{config.label}</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "inline-flex items-center justify-center rounded-md",
        config.bgColor,
        sizeStyles.padding,
        className,
      )}
    >
      {iconElement}
    </div>
  );
});

ToolStatusBadge.displayName = "ToolStatusBadge";
