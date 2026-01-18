"use client";

import { useCopy } from "@/hooks/use-copy";
import { cn } from "@/lib/utils";
import { formatToolData } from "@/lib/utils/tool-data-formatter";
import { Check, ChevronDown, Copy } from "lucide-react";
import React, { memo, useState } from "react";
import { Badge } from "ui/badge";
import { Button } from "ui/button";
import JsonView from "ui/json-view";

interface FormattedToolDataProps {
  data: unknown;
  toolName?: string;
  isInput?: boolean;
  className?: string;
  defaultExpanded?: boolean;
}

export const FormattedToolData = memo(function FormattedToolDataComponent({
  data,
  toolName,
  isInput = true,
  className,
  defaultExpanded = false,
}: FormattedToolDataProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const { copied, copy } = useCopy();
  const formatted = formatToolData(data, toolName, isInput);

  const handleCopy = () => {
    const jsonString = JSON.stringify(data, null, 2);
    copy(jsonString);
  };

  if (
    formatted.type === "formatted" &&
    formatted.fields &&
    formatted.fields.length > 0
  ) {
    return (
      <div className={cn("space-y-2", className)}>
        {formatted.title && (
          <div className="flex items-center justify-between">
            <h6 className="text-sm font-medium text-foreground">
              {formatted.title}
            </h6>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={handleCopy}
            >
              {copied ? (
                <Check className="h-3 w-3" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </Button>
          </div>
        )}

        {formatted.summary && (
          <p className="text-sm text-muted-foreground">{formatted.summary}</p>
        )}

        <div className="space-y-2">
          {formatted.fields.map((field) => {
            let displayValue: React.ReactNode;
            if (typeof field.value === "string") {
              displayValue = field.value;
            } else if (React.isValidElement(field.value)) {
              displayValue = field.value;
            } else if (
              typeof field.value === "object" &&
              field.value !== null
            ) {
              displayValue = JSON.stringify(field.value);
            } else {
              displayValue = String(field.value);
            }

            return (
              <div
                key={`${field.label}-${typeof field.value}`}
                className="flex items-start gap-2 rounded-md bg-muted/50 p-2"
              >
                <span className="text-xs font-medium text-muted-foreground min-w-[80px]">
                  {field.label}:
                </span>
                <div className="text-xs text-foreground break-words flex-1">
                  {displayValue}
                </div>
              </div>
            );
          })}
        </div>

        {formatted.raw !== undefined && formatted.raw !== null && (
          <div>
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronDown
                className={cn(
                  "h-3 w-3 transition-transform",
                  isExpanded && "rotate-180",
                )}
              />
              {isExpanded ? "Hide" : "Show"} raw JSON
            </button>
            {isExpanded && (
              <div className="mt-2 rounded-md border bg-muted/30 p-2 max-h-[300px] overflow-auto">
                <JsonView data={formatted.raw} initialExpandDepth={1} />
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // Fallback to JSON view for complex data
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            {getDataType(data)}
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={handleCopy}
        >
          {copied ? (
            <Check className="h-3 w-3" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
        </Button>
      </div>

      <div className="rounded-md border bg-muted/30 p-2 max-h-[300px] overflow-auto">
        <JsonView data={data} initialExpandDepth={1} />
      </div>
    </div>
  );
});

function getDataType(data: unknown): string {
  if (data === null) return "null";
  if (Array.isArray(data)) return "array";
  if (typeof data === "object") return "object";
  return typeof data;
}

FormattedToolData.displayName = "FormattedToolData";
