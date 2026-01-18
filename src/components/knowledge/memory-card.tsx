"use client";

import { EditIcon, TrashIcon } from "lucide-react";
import { Button } from "ui/button";
import { Card, CardContent } from "ui/card";
import { Badge } from "ui/badge";
import { Checkbox } from "ui/checkbox";
import { formatDistanceToNow } from "date-fns";
import { cn } from "lib/utils";

interface Memory {
  id: string;
  content: string;
  role?: "user" | "assistant";
  source?: "memory" | "knowledge" | "documents";
  threadId?: string;
  messageId?: string;
  createdAt?: string;
  // Knowledge base specific
  knowledgeBaseId?: string;
  knowledgeBaseName?: string;
  fileName?: string;
  // Document specific
  documentType?: string;
  title?: string;
}

interface MemoryCardProps {
  memory: Memory;
  onEdit: () => void;
  onDelete: () => void;
  selected?: boolean;
  onSelect?: (selected: boolean) => void;
  showCheckbox?: boolean;
}

export function MemoryCard({
  memory,
  onEdit,
  onDelete,
  selected = false,
  onSelect,
  showCheckbox = false,
}: MemoryCardProps) {
  const truncatedContent =
    memory.content.length > 300
      ? memory.content.slice(0, 300) + "..."
      : memory.content;

  const dateLabel = memory.createdAt
    ? formatDistanceToNow(new Date(memory.createdAt), { addSuffix: true })
    : "Unknown";

  return (
    <Card
      className={cn(
        "hover:bg-accent/50 transition-colors",
        selected && "ring-2 ring-primary",
      )}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          {showCheckbox && onSelect && (
            <div className="flex-shrink-0 pt-1">
              <Checkbox
                checked={selected}
                onCheckedChange={onSelect}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              {/* Source badge */}
              {memory.source && (
                <Badge
                  variant={
                    memory.source === "knowledge"
                      ? "default"
                      : memory.source === "documents"
                        ? "secondary"
                        : "outline"
                  }
                >
                  {memory.source === "memory"
                    ? "Memory"
                    : memory.source === "knowledge"
                      ? "Knowledge Base"
                      : "Auto Document"}
                </Badge>
              )}
              {/* Role badge (only for messages) */}
              {memory.role && (
                <Badge
                  variant={memory.role === "user" ? "default" : "secondary"}
                >
                  {memory.role}
                </Badge>
              )}
              {/* Knowledge base name */}
              {memory.knowledgeBaseName && (
                <Badge variant="outline" className="text-xs">
                  {memory.knowledgeBaseName}
                </Badge>
              )}
              {/* Document title */}
              {memory.title && (
                <Badge variant="outline" className="text-xs">
                  {memory.title}
                </Badge>
              )}
              {/* File name */}
              {memory.fileName && (
                <span className="text-xs text-muted-foreground">
                  {memory.fileName}
                </span>
              )}
              {memory.createdAt && (
                <span className="text-xs text-muted-foreground">
                  {dateLabel}
                </span>
              )}
            </div>
            <p className="text-sm whitespace-pre-wrap break-words">
              {truncatedContent}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              className="h-8 w-8"
            >
              <EditIcon className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="h-8 w-8 text-destructive hover:text-destructive"
            >
              <TrashIcon className="size-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
