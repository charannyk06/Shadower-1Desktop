"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, FileEdit, Terminal, Check, X } from "lucide-react";
import { Button } from "ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "ui/dialog";
import { Checkbox } from "ui/checkbox";
import { ScrollArea } from "ui/scroll-area";
import type { ACPPermissionRequest, RespondToPermissionRequest } from "@/types/acp";
import { AGENT_DISPLAY_NAMES } from "@/lib/electron/acp-api";

interface PermissionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: ACPPermissionRequest | null;
  onRespond: (response: RespondToPermissionRequest) => void;
}

export function ACPPermissionDialog({
  open,
  onOpenChange,
  request,
  onRespond,
}: PermissionDialogProps) {
  const [rememberGlobally, setRememberGlobally] = useState(false);

  useEffect(() => {
    // Reset remember checkbox when dialog opens with new request
    if (open) {
      setRememberGlobally(false);
    }
  }, [open, request?.requestId]);

  if (!request) return null;

  const handleRespond = (optionId: string) => {
    onRespond({
      requestId: request.requestId,
      optionId,
      rememberGlobally,
    });
    onOpenChange(false);
  };

  // Determine the type of permission request based on permissionType or description
  const isFileEdit = request.permissionType === "file_edit" ||
    request.permissionType === "file_create" ||
    request.permissionType === "file_delete" ||
    request.description?.toLowerCase().includes("edit") ||
    request.description?.toLowerCase().includes("file") ||
    request.description?.toLowerCase().includes("write");

  const isTerminal = request.permissionType === "terminal" ||
    request.description?.toLowerCase().includes("terminal") ||
    request.description?.toLowerCase().includes("command") ||
    request.description?.toLowerCase().includes("execute");

  const agentDisplayName = AGENT_DISPLAY_NAMES[request.agentId] || request.agentId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isFileEdit ? (
              <FileEdit className="size-5 text-amber-500" />
            ) : isTerminal ? (
              <Terminal className="size-5 text-amber-500" />
            ) : (
              <AlertTriangle className="size-5 text-amber-500" />
            )}
            {request.description || "Permission Request"}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {agentDisplayName} is requesting permission to perform an action
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          {/* File path if applicable */}
          {request.filePath && (
            <div className="mb-4">
              <p className="text-xs font-medium text-muted-foreground mb-1">File:</p>
              <p className="text-sm font-mono bg-muted px-2 py-1 rounded">{request.filePath}</p>
            </div>
          )}

          {/* Command if terminal operation */}
          {request.command && (
            <div className="mb-4">
              <p className="text-xs font-medium text-muted-foreground mb-1">Command:</p>
              <pre className="text-sm font-mono bg-muted px-2 py-1 rounded overflow-x-auto">{request.command}</pre>
            </div>
          )}

          {/* Diff preview for file edits */}
          {request.diff && (
            <div className="mb-4">
              <p className="text-xs font-medium text-muted-foreground mb-2">
                Changes to be made:
              </p>
              <ScrollArea className="h-[200px] w-full rounded-md border bg-muted/30 p-3">
                <pre className="text-xs font-mono whitespace-pre-wrap">
                  {request.diff.split("\n").map((line, i) => {
                    const isAddition = line.startsWith("+");
                    const isDeletion = line.startsWith("-");
                    const isHeader = line.startsWith("@@") || line.startsWith("---") || line.startsWith("+++");

                    return (
                      <div
                        key={i}
                        className={
                          isAddition
                            ? "text-green-600 dark:text-green-400 bg-green-500/10"
                            : isDeletion
                              ? "text-red-600 dark:text-red-400 bg-red-500/10"
                              : isHeader
                                ? "text-blue-600 dark:text-blue-400"
                                : ""
                        }
                      >
                        {line}
                      </div>
                    );
                  })}
                </pre>
              </ScrollArea>
            </div>
          )}

          {/* Remember globally checkbox */}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="remember"
              checked={rememberGlobally}
              onCheckedChange={(checked) => setRememberGlobally(checked === true)}
            />
            <label
              htmlFor="remember"
              className="text-sm text-muted-foreground cursor-pointer"
            >
              Always allow this action from {agentDisplayName}
            </label>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {/* Render all available options */}
          {request.options && request.options.length > 0 ? (
            request.options.map((option) => {
              // Check if this is a deny/reject option using either grants flag or text matching
              const isDeny = option.grants === false ||
                option.id?.toLowerCase().includes("deny") ||
                option.id?.toLowerCase().includes("reject") ||
                option.label?.toLowerCase().includes("deny") ||
                option.label?.toLowerCase().includes("reject") ||
                option.label?.toLowerCase().includes("cancel");

              const optionId = option.id || `option-${Math.random()}`;
              const optionLabel = option.label || (isDeny ? "Deny" : "Allow");

              return (
                <Button
                  key={optionId}
                  variant={isDeny ? "outline" : "default"}
                  onClick={() => handleRespond(optionId)}
                  className="gap-1"
                >
                  {isDeny ? (
                    <X className="size-4" />
                  ) : (
                    <Check className="size-4" />
                  )}
                  {optionLabel}
                </Button>
              );
            })
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => handleRespond("deny")}
                className="gap-1"
              >
                <X className="size-4" />
                Deny
              </Button>
              <Button
                onClick={() => handleRespond("allow")}
                className="gap-1"
              >
                <Check className="size-4" />
                Allow
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ACPPermissionDialog;
