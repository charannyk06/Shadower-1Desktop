"use client";

import { appStore } from "@/app/store";
import { useCopy } from "@/hooks/use-copy";
import { ToolUIPart } from "ai";
import { cn, isString, toAny } from "lib/utils";
import {
  AlertTriangleIcon,
  CheckIcon,
  ChevronRight,
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  Loader,
  Maximize2Icon,
  PlayIcon,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { CodeBlock } from "ui/CodeBlock";
import { Button } from "ui/button";
import { TextShimmer } from "ui/text-shimmer";
import { useShallow } from "zustand/shallow";
import { FileTypeIcon } from "../file-type-icon";

interface E2BArtifact {
  type: "image" | "chart" | "data" | "file";
  value?: any;
  filename?: string;
  mediaType?: string;
  data?: string; // base64
  url?: string; // url to file (public/sandbox)
}

interface E2BResult {
  success: boolean;
  logs: any[];
  results: E2BArtifact[];
  error?: any;
  // Shell command specific
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  // File operation specific
  content?: string;
  size?: number;
  files?: { name: string; path: string; type: string; size: number }[];
  message?: string;
  action?: string;
}

// Input types for the unified sandbox tool
interface SandboxInput {
  action:
    | "code"
    | "shell"
    | "read"
    | "write"
    | "list"
    | "delete"
    | "execute_code"
    | "run_shell"
    | "read_file"
    | "write_file"
    | "list_dir"
    | "delete_file"
    | "runCode"
    | "runShell"
    | "readFile"
    | "writeFile"
    | "listDir"
    | "deleteFile";
  language?: "python" | "javascript" | "typescript";
  code?: string;
  command?: string;
  path?: string;
  content?: string;
}

export const E2BCodeExecutor = memo(function E2BCodeExecutor({
  part,
  onResult,
  type,
  threadId: threadIdProp,
}: {
  part: ToolUIPart;
  onResult?: (result?: any) => void;
  type: "javascript" | "python" | "sandbox";
  threadId?: string;
}) {
  const { copy, copied } = useCopy();
  const [isExecuting, setIsExecuting] = useState(false);
  const [streamingResult, setStreamingResult] = useState<E2BResult | null>(
    null,
  );
  const { mutate, currentThreadId: storeThreadId } = appStore(
    useShallow((state) => ({
      mutate: state.mutate,
      currentThreadId: state.currentThreadId,
    })),
  );

  // Use prop threadId if provided, otherwise fall back to store
  // This ensures we have the threadId even during streaming when store might not be ready
  const currentThreadId = threadIdProp || storeThreadId;

  const result = useMemo(() => {
    if (streamingResult) return streamingResult;
    if (part.state.startsWith("input")) return null;
    return part.output as E2BResult;
  }, [part, streamingResult]);

  // Automatically sync all artifacts from result to store whenever they're available
  useEffect(() => {
    console.log("[E2BCodeExecutor] Sync effect triggered:", {
      currentThreadId,
      threadIdSource: threadIdProp ? "prop" : storeThreadId ? "store" : "none",
      hasResult: !!result,
      resultsCount: result?.results?.length ?? 0,
      partState: part.state,
      partOutput: part.output
        ? JSON.stringify(part.output).slice(0, 200)
        : "null",
    });

    if (!currentThreadId || !result?.results || result.results.length === 0) {
      console.log(
        "[E2BCodeExecutor] Skipping sync - no artifacts or missing thread ID",
      );
      return;
    }

    console.log(
      "[E2BCodeExecutor] Syncing artifacts to store:",
      result.results.length,
    );

    mutate((state) => {
      const threadArtifacts = state.theaterMode.threadArtifacts || {};
      const existing = threadArtifacts[currentThreadId] || [];

      // Create deduplication map using filename as primary key
      const existingKeys = new Set(
        existing
          .map((a: any) => a.filename || a.id || a.url || a.content)
          .filter(Boolean),
      );

      // Add new artifacts that don't exist yet
      const toAdd = result.results.filter((art: any) => {
        const key = art.filename || art.id || art.url || art.content;
        return key && !existingKeys.has(key);
      });

      console.log(
        "[E2BCodeExecutor] Adding",
        toAdd.length,
        "new artifacts to store",
      );

      if (toAdd.length === 0) return state;

      return {
        theaterMode: {
          ...state.theaterMode,
          threadArtifacts: {
            ...threadArtifacts,
            [currentThreadId]: [...existing, ...toAdd],
          },
          // Increment version to trigger re-fetch in Theater Panel
          sandboxFilesVersion: (state.theaterMode.sandboxFilesVersion || 0) + 1,
        },
      };
    });
  }, [result?.results, currentThreadId, mutate, part.state, part.output]);

  // Trigger sandbox files refresh for ALL sandbox operations
  // This ensures the Files tab always shows the latest state
  useEffect(() => {
    // Only trigger when operation completes - avoid logging during streaming
    if (!part.state.startsWith("output")) {
      return;
    }

    const action = result?.action || (part.input as any)?.action;

    if (!result?.success) {
      console.log("[E2BCodeExecutor] Operation failed:", action, result?.error);
      return;
    }

    if (!currentThreadId) {
      console.warn(
        "[E2BCodeExecutor] Skipping files refresh - currentThreadId not yet available",
      );
      return;
    }

    console.log(
      "[E2BCodeExecutor] Triggering sandbox files refresh for:",
      action,
    );

    // Always refresh sandbox files on ANY successful sandbox operation
    // This ensures the Files tab is always up-to-date
    mutate((state) => ({
      theaterMode: {
        ...state.theaterMode,
        sandboxFilesVersion: (state.theaterMode.sandboxFilesVersion || 0) + 1,
      },
    }));
  }, [
    part.state,
    part.input,
    result?.success,
    result?.action,
    currentThreadId,
    mutate,
  ]);

  const handleEvent = useCallback(
    (event: any) => {
      if (event.type === "log") {
        setStreamingResult((prev) => ({
          ...prev!,
          logs: [...(prev?.logs || []), event.value],
        }));
      } else if (event.type === "command_output") {
        // Handle streaming shell command output
        setStreamingResult((prev) => ({
          ...prev!,
          logs: [
            ...(prev?.logs || []),
            {
              type: event.value.stream === "stderr" ? "error" : "log",
              args: [{ type: "text", value: event.value.data }],
            },
          ],
        }));
      } else if (event.type === "command_result") {
        // Handle shell command completion
        const cmdResult = event.value;
        setStreamingResult((prev) => ({
          ...prev!,
          success: cmdResult.success,
          stdout: cmdResult.stdout,
          stderr: cmdResult.stderr,
          exitCode: cmdResult.exitCode,
          error: cmdResult.error,
          action: "shell",
        }));
      } else if (event.type === "artifacts") {
        const newArtifacts = event.value;
        setStreamingResult((prev) => ({
          ...prev!,
          results: [...(prev?.results || []), ...newArtifacts],
        }));

        // Push to thread-scoped store immediately to update Theater Panel
        if (currentThreadId) {
          mutate((state) => {
            const threadArtifacts = state.theaterMode.threadArtifacts || {};
            const existing = threadArtifacts[currentThreadId] || [];
            // Improved dedup: check filename, id, url, or content to avoid duplicates
            const toAdd = newArtifacts.filter((na: any) => {
              const naKey = na.filename || na.id || na.url || na.content;
              if (!naKey) return true; // If no key, include it (might be a new format)
              return !existing.some((e: any) => {
                const eKey = e.filename || e.id || e.url || e.content;
                return eKey && eKey === naKey;
              });
            });
            if (toAdd.length === 0) return state;
            return {
              theaterMode: {
                ...state.theaterMode,
                threadArtifacts: {
                  ...threadArtifacts,
                  [currentThreadId]: [...existing, ...toAdd],
                },
              },
            };
          });
        }
      } else if (event.type === "error") {
        // Handle error events
        setStreamingResult((prev) => ({
          ...prev!,
          success: false,
          error: event.value,
          logs: [
            ...(prev?.logs || []),
            {
              type: "error",
              args: [{ type: "text", value: event.value }],
            },
          ],
        }));
      } else if (event.type === "finish") {
        const finalResult = {
          ...event.value,
          logs: (streamingResult?.logs || []).concat(event.value?.logs || []),
          results: (streamingResult?.results || []).concat(
            event.value?.results || [],
          ),
          // Preserve shell-specific fields
          stdout: streamingResult?.stdout || event.value?.stdout,
          stderr: streamingResult?.stderr || event.value?.stderr,
          exitCode: streamingResult?.exitCode ?? event.value?.exitCode,
          action: streamingResult?.action || event.value?.action,
        };

        if (!finalResult.logs) {
          finalResult.logs = streamingResult?.logs || [];
        }

        // Mark success based on exit code for shell commands
        if (
          finalResult.action === "shell" &&
          finalResult.success === undefined
        ) {
          finalResult.success = finalResult.exitCode === 0;
        }

        setStreamingResult(finalResult);

        if (onResult) {
          onResult(finalResult);
        }
      }
    },
    [
      onResult,
      streamingResult?.logs,
      streamingResult?.stdout,
      streamingResult?.stderr,
      streamingResult?.exitCode,
      streamingResult?.action,
      currentThreadId,
      mutate,
    ],
  );

  const processLine = useCallback(
    (lineStr: string) => {
      if (!lineStr.trim()) return;

      try {
        const event = JSON.parse(lineStr);
        handleEvent(event);
      } catch (e) {
        // Handle merged JSONs (e.g. "}{")
        const splitIdx = lineStr.indexOf("}{");
        if (splitIdx !== -1) {
          const part1 = lineStr.substring(0, splitIdx + 1);
          const part2 = lineStr.substring(splitIdx + 1);
          try {
            JSON.parse(part1);
            processLine(part1);
            processLine(part2);
            return;
          } catch {}
        }
        console.error(
          "Error parsing stream line:",
          e,
          lineStr.substring(0, 100),
        );
      }
    },
    [handleEvent],
  );

  // Parse sandbox input to get the appropriate code/command to display
  const sandboxInput = useMemo((): SandboxInput | null => {
    if (type !== "sandbox") return null;
    return toAny(part.input) as SandboxInput;
  }, [type, part.input]);

  const runCode = useCallback(
    async (input: SandboxInput | string) => {
      setIsExecuting(true);
      setStreamingResult({ success: false, logs: [], results: [] });

      try {
        let body: any;

        if (type === "sandbox" && typeof input === "object") {
          // Unified sandbox tool - pass the full action object
          body = input;
        } else {
          // Legacy code execution
          body = { code: input, language: type };
        }

        const res = await fetch("/api/sandbox/run", {
          method: "POST",
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(
            `Sandbox Execution Failed: ${errText || res.statusText}`,
          );
        }

        if (!res.body) throw new Error("No response body");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            processLine(line);
          }
        }
      } catch (err) {
        console.error(err);
        setStreamingResult((prev) => ({
          ...prev!,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        }));
      } finally {
        setIsExecuting(false);
      }
    },
    [type, onResult, processLine],
  );

  const logs = useMemo(() => {
    const error = result?.error;
    const logs = [...(Array.isArray(result?.logs) ? result.logs : [])];

    if (error) {
      logs.push({
        type: "error",
        args: [
          {
            type: "data",
            value: isString(error) ? error : JSON.stringify(error),
          },
        ],
      });
    }

    return logs.map((log: any, i: number) => {
      // Determine icon based on log type
      let IconComponent = ChevronRight;
      if (log.type === "error" || log.type === "warn") {
        IconComponent = AlertTriangleIcon;
      }

      return (
        <div
          key={`log-${log.type}-${i}-${JSON.stringify(log.args?.[0]?.value || "").slice(0, 20)}`}
          className={cn(
            "flex gap-1 text-muted-foreground pl-3 py-0.5",
            log.type === "error" && "text-destructive",
            log.type === "warn" && "text-yellow-500",
          )}
        >
          <div className="h-[15px] flex items-center">
            <IconComponent className="size-2" />
          </div>
          <div className="flex-1 min-w-0 whitespace-pre-wrap text-[10px] font-mono">
            {log.args.map((arg: any, j: number) => {
              const argKey = `arg-${i}-${j}-${typeof arg?.value}`;
              const argValue = isString(arg?.value)
                ? arg.line || arg.value
                : JSON.stringify(arg.value ?? arg);
              return <span key={argKey}>{argValue}</span>;
            })}
          </div>
        </div>
      );
    });
  }, [result]);

  const openInTheater = useCallback(
    (
      type: "app" | "file" | "chart" | "image" | "pdf" | "office",
      content: any,
      title?: string,
    ) => {
      if (!currentThreadId) return;
      mutate((state) => {
        const executionArtifacts = result?.results || [];
        const threadArtifacts = state.theaterMode.threadArtifacts || {};
        const existingThreadArtifacts = threadArtifacts[currentThreadId] || [];

        // Merge executionArtifacts into thread-scoped threadArtifacts (deduplicated)
        const seen = new Set<string>();
        const mergedArtifacts = [...existingThreadArtifacts];

        executionArtifacts.forEach((art: any) => {
          const key = art.filename || art.id || art.url || art.content;
          if (key && !seen.has(key)) {
            seen.add(key);
            // Check if it already exists in threadArtifacts
            const exists = existingThreadArtifacts.some(
              (e: any) => (e.filename || e.id || e.url || e.content) === key,
            );
            if (!exists) {
              mergedArtifacts.push(art);
            }
          }
        });

        return {
          theaterMode: {
            ...state.theaterMode,
            isOpen: true,
            type,
            content,
            title,
            executionArtifacts,
            threadArtifacts: {
              ...threadArtifacts,
              [currentThreadId]: mergedArtifacts,
            },
            defaultTab: "preview", // Opening specific content should show preview
          },
        };
      });
    },
    [mutate, result, currentThreadId],
  );

  const artifacts = useMemo(() => {
    if (!result?.results) return null;
    return result.results.map((art, i) => {
      const artifactKey =
        art.filename || art.url || `artifact-${art.type}-${i}`;

      if (art.type === "image") {
        return (
          <div
            key={artifactKey}
            className="mt-4 rounded-lg overflow-hidden border bg-background p-2 group/img relative"
          >
            <img src={art.value} alt="Output" className="w-full h-auto" />
            <Button
              variant="secondary"
              size="sm"
              className="absolute top-4 right-4 opacity-0 group-hover/img:opacity-100 transition-opacity gap-1.5 shadow-xl border-white/20 backdrop-blur-md bg-black/40 text-white hover:bg-black/60"
              onClick={() => openInTheater("image", art.value, "Image Preview")}
            >
              <Maximize2Icon className="size-3" />
              Expand
            </Button>
          </div>
        );
      }
      if (art.type === "file" && (art.url || art.data)) {
        // Prefer URL (new bypass method) over Data (legacy)
        const content = art.url || art.data;

        const ext = art.filename?.split(".").pop()?.toLowerCase();
        let type: "app" | "file" | "image" | "pdf" | "office" = "file";
        if (ext === "html" || ext === "htm" || ext === "svg") type = "app";
        else if (ext === "pdf") type = "pdf";
        else if (
          ["docx", "doc", "pptx", "ppt", "xlsx", "xls"].includes(ext || "")
        )
          type = "office";

        return (
          <FileArtifact
            key={artifactKey}
            artifact={{ ...art, data: content }}
            onExpand={() => {
              openInTheater(type, content, art.filename);
            }}
          />
        );
      }
      return null;
    });
  }, [result, openInTheater]);

  // Auto-open Theater Mode for new artifacts (UX Improvement)
  // Auto-open Theater Mode disabled per user request
  // useEffect(() => {
  //   if (result?.results && result.results.length > 0) {
  //     const lastArtifact = result.results[result.results.length - 1];
  //     // Only auto-open interesting things like apps, html, or images
  //     const shouldAutoOpen =
  //       lastArtifact.type === "image" ||
  //       (lastArtifact.type === "file" &&
  //         (lastArtifact.filename?.endsWith(".html") ||
  //           lastArtifact.filename?.endsWith(".tsx") ||
  //           lastArtifact.filename?.endsWith(".js")));

  //     if (shouldAutoOpen && lastArtifact.data) {
  //       openInTheater(
  //         lastArtifact.type as any, // Cast to any to avoid "data" type mismatch
  //         lastArtifact.data,
  //         lastArtifact.filename || "Preview",
  //       );
  //     } else if (lastArtifact.type === "image") {
  //       openInTheater("image", lastArtifact.value, "Image Preview");
  //     }
  //   }
  // }, [result?.results?.length]); // Only run when count changes to avoid loops

  const isRunning = useMemo(() => {
    return isExecuting || part.state.startsWith("input");
  }, [isExecuting, part.state]);

  const header = useMemo(() => {
    if (isRunning)
      return (
        <>
          <Loader className="size-3 animate-spin text-muted-foreground mr-2" />
          <TextShimmer className="text-xs">Executing in Sandbox...</TextShimmer>
        </>
      );
    return (
      <div className="flex items-center gap-2">
        {!isRunning && result?.success && (
          <span className="text-[10px] text-green-500 font-medium">Ready</span>
        )}
      </div>
    );
  }, [isRunning, result, type]);

  return (
    <div className="flex flex-col w-full max-w-3xl mx-auto my-4 group">
      <div className="border rounded-xl bg-card shadow-sm overflow-hidden border-border/50 transition-all hover:border-border/80">
        <div className="py-2.5 bg-muted/30 px-4 flex items-center justify-between border-b border-border/50">
          <div className="flex items-center">{header}</div>
          <div className="flex items-center gap-2">
            {logs.some((l: any) => l.type === "error") && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-[10px] gap-1.5 px-2 text-destructive hover:bg-destructive/10 hover:text-destructive transition-colors min-w-[60px]"
                onClick={() => {
                  const errorLogs = logs
                    .filter((l: any) => l.type === "error")
                    .map((l: any) =>
                      l.args
                        .map((a: any) => a.value || JSON.stringify(a))
                        .join(" "),
                    )
                    .join("\n");
                  copy(
                    `The code execution failed with the following error:\n\n${errorLogs}\n\nPlease fix the code and try again.`,
                  );
                  // Optional: trigger user notification
                  // toast.success("Error copied! Paste it in the chat to fix.");
                }}
              >
                <div className="size-1.5 rounded-full bg-destructive animate-pulse" />
                Fix
              </Button>
            )}
            {part.state.startsWith("output") && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-[10px] gap-1.5 px-2 hover:bg-primary/5 hover:text-primary transition-colors"
                onClick={() => {
                  if (sandboxInput) {
                    runCode(sandboxInput);
                  } else {
                    runCode(toAny(part.input)?.code);
                  }
                }}
                disabled={isExecuting}
              >
                <PlayIcon className="size-2.5" />
                Run
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 size-7 p-0"
              onClick={() => {
                const content = sandboxInput
                  ? sandboxInput.code ||
                    sandboxInput.command ||
                    sandboxInput.path ||
                    ""
                  : (toAny(part.input)?.code ?? "");
                copy(content);
              }}
            >
              {copied ? (
                <CheckIcon className="size-3 text-green-500" />
              ) : (
                <CopyIcon className="size-3" />
              )}
            </Button>
          </div>
        </div>

        <div className="relative bg-muted/5">
          <div className="p-4 overflow-x-auto max-h-[300px] scrollbar-thin scrollbar-thumb-border">
            {sandboxInput ? (
              <SandboxInputDisplay input={sandboxInput} />
            ) : (
              <CodeBlock
                code={toAny(part.input)?.code}
                lang={type === "sandbox" ? "python" : type}
                className="text-[11px] bg-transparent !p-0"
              />
            )}
          </div>
        </div>

        {(logs.length > 0 ||
          artifacts?.some(Boolean) ||
          result?.stdout ||
          result?.stderr ||
          result?.files ||
          result?.content !== undefined) && (
          <div className="border-t border-border/50 bg-muted/20 p-4 space-y-3">
            {/* Shell command stdout/stderr output */}
            {(result?.stdout || result?.stderr) && (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <div className="text-[9px] font-bold text-muted-foreground/60 uppercase tracking-wider mb-2">
                    Command Output
                  </div>
                  {result?.exitCode !== undefined && (
                    <span
                      className={cn(
                        "text-[9px] font-mono px-1.5 py-0.5 rounded",
                        result.exitCode === 0
                          ? "bg-green-500/10 text-green-500"
                          : "bg-red-500/10 text-red-500",
                      )}
                    >
                      exit {result.exitCode}
                    </span>
                  )}
                </div>
                <div className="flex flex-col bg-black/5 rounded-lg p-2 max-h-[200px] overflow-y-auto">
                  {result?.stdout && (
                    <pre className="text-[10px] font-mono text-foreground whitespace-pre-wrap">
                      {result.stdout}
                    </pre>
                  )}
                  {result?.stderr && (
                    <pre className="text-[10px] font-mono text-destructive whitespace-pre-wrap mt-1">
                      {result.stderr}
                    </pre>
                  )}
                </div>
              </div>
            )}

            {/* File operation results */}
            {result?.action === "read" && result?.content !== undefined && (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <div className="text-[9px] font-bold text-muted-foreground/60 uppercase tracking-wider mb-2">
                    File Content
                  </div>
                  {result?.size !== undefined && (
                    <span className="text-[9px] font-mono text-muted-foreground">
                      {result.size} bytes
                    </span>
                  )}
                </div>
                <div className="bg-black/5 rounded-lg p-2 max-h-[200px] overflow-y-auto">
                  <pre className="text-[10px] font-mono text-foreground whitespace-pre-wrap">
                    {result.content}
                  </pre>
                </div>
              </div>
            )}

            {/* List directory results */}
            {result?.action === "list" && result?.files && (
              <div className="space-y-1">
                <div className="text-[9px] font-bold text-muted-foreground/60 uppercase tracking-wider mb-2">
                  Directory Contents ({result.files.length} items)
                </div>
                <div className="bg-black/5 rounded-lg p-2 max-h-[200px] overflow-y-auto">
                  {result.files.map((file: any, i: number) => (
                    <div
                      key={`file-${i}-${file.name}`}
                      className="flex items-center gap-2 py-0.5"
                    >
                      <span
                        className={cn(
                          "text-[9px] font-mono px-1 rounded",
                          file.type === "directory"
                            ? "bg-blue-500/10 text-blue-500"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {file.type === "directory" ? "DIR" : "FILE"}
                      </span>
                      <span className="text-[10px] font-mono text-foreground">
                        {file.name}
                      </span>
                      {file.type === "file" && (
                        <span className="text-[9px] text-muted-foreground ml-auto">
                          {file.size} B
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Operation message (write, delete) */}
            {result?.message && !result?.stdout && (
              <div className="flex items-center gap-2 p-2 bg-green-500/5 rounded-lg border border-green-500/20">
                <CheckIcon className="size-3 text-green-500" />
                <span className="text-[10px] text-green-500">
                  {result.message}
                </span>
              </div>
            )}

            {/* Standard logs (for code execution) */}
            {logs.length > 0 && !result?.stdout && (
              <div className="space-y-1">
                <div className="text-[9px] font-bold text-muted-foreground/60 uppercase tracking-wider mb-2">
                  Terminal Output
                </div>
                <div className="flex flex-col bg-black/5 rounded-lg p-2 max-h-[200px] overflow-y-auto">
                  {logs}
                </div>
              </div>
            )}
            {artifacts?.some(Boolean) && (
              <div className="space-y-2">
                <div className="text-[9px] font-bold text-muted-foreground/60 uppercase tracking-wider">
                  Artifacts
                </div>
                {artifacts}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

const FileArtifact = memo(function FileArtifact({
  artifact,
  onExpand,
}: {
  artifact: E2BArtifact;
  onExpand?: () => void;
}) {
  const download = useCallback(async () => {
    // If it's a URL-based artifact (new method), download directly
    if (
      artifact.url ||
      (typeof artifact.data === "string" &&
        (artifact.data.startsWith("/") || artifact.data.startsWith("http")))
    ) {
      const a = document.createElement("a");
      a.href = artifact.url || artifact.data || "";
      a.download = artifact.filename || "download";
      document.body.appendChild(a);
      a.click();
      a.remove();
      return;
    }

    // Fallback: Base64 artifact (legacy/small files)
    if (!artifact.data) return;
    try {
      const blob = b64toBlob(artifact.data, artifact.mediaType || "");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = artifact.filename || "download";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Download failed:", e);
    }
  }, [artifact]);

  const icon = useMemo(() => {
    return (
      <FileTypeIcon
        filename={artifact.filename}
        className="text-muted-foreground"
        size={16}
      />
    );
  }, [artifact.filename]);

  return (
    <div className="flex items-center justify-between p-3 rounded-xl border bg-background/50 hover:bg-background transition-all group/artifact">
      <div className="flex items-center gap-3">
        <div className="size-10 rounded-lg bg-muted flex items-center justify-center border shadow-sm group-hover/artifact:border-primary/30 transition-colors">
          {icon}
        </div>
        <div className="flex flex-col">
          <span className="text-[11px] font-semibold text-foreground truncate max-w-[200px]">
            {artifact.filename}
          </span>
          <span className="text-[9px] text-muted-foreground uppercase tracking-tight">
            {artifact.filename?.split(".").pop()} Document
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-2 rounded-lg text-[10px] font-medium border-border/60 hover:border-primary/40 hover:bg-primary/5"
          onClick={download}
        >
          <DownloadIcon className="size-3" />
          Download
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="h-8 gap-2 rounded-lg text-[10px] font-medium hover:bg-primary/10 hover:text-primary"
          onClick={onExpand}
        >
          <EyeIcon className="size-3" />
          Preview
        </Button>
      </div>
    </div>
  );
});

// Component to display sandbox input based on action type
function SandboxInputDisplay({ input }: { readonly input: SandboxInput }) {
  const { action, language, code, command, path, content } = input;

  // Normalize action to handle all naming conventions (camelCase, snake_case, legacy)
  const normalizedAction = (() => {
    const actionMap: Record<string, string> = {
      // camelCase names (current primary)
      runCode: "code",
      runShell: "shell",
      readFile: "read",
      writeFile: "write",
      listDir: "list",
      deleteFile: "delete",
      // snake_case names
      execute_code: "code",
      run_shell: "shell",
      read_file: "read",
      write_file: "write",
      list_dir: "list",
      delete_file: "delete",
      // Legacy single-word names stay as-is
      code: "code",
      shell: "shell",
      read: "read",
      write: "write",
      list: "list",
      delete: "delete",
    };
    return actionMap[action] || action;
  })();

  switch (normalizedAction) {
    case "code":
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <span className="px-1.5 py-0.5 bg-primary/10 text-primary rounded font-medium">
              {language || "python"}
            </span>
          </div>
          <CodeBlock
            code={code || ""}
            lang={language || "python"}
            className="text-[11px] bg-transparent !p-0"
          />
        </div>
      );

    case "shell":
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <span className="px-1.5 py-0.5 bg-green-500/10 text-green-500 rounded font-medium">
              shell
            </span>
          </div>
          <div className="font-mono text-[11px] text-foreground">
            <span className="text-green-500">$</span> {command}
          </div>
        </div>
      );

    case "read":
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <span className="px-1.5 py-0.5 bg-blue-500/10 text-blue-500 rounded font-medium">
              read file
            </span>
          </div>
          <div className="font-mono text-[11px] text-foreground">{path}</div>
        </div>
      );

    case "write":
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <span className="px-1.5 py-0.5 bg-yellow-500/10 text-yellow-500 rounded font-medium">
              write file
            </span>
            <span className="font-mono">{path}</span>
          </div>
          <CodeBlock
            code={content || ""}
            lang="text"
            className="text-[11px] bg-transparent !p-0"
          />
        </div>
      );

    case "list":
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <span className="px-1.5 py-0.5 bg-purple-500/10 text-purple-500 rounded font-medium">
              list directory
            </span>
          </div>
          <div className="font-mono text-[11px] text-foreground">
            {path || "/home/user"}
          </div>
        </div>
      );

    case "delete":
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <span className="px-1.5 py-0.5 bg-red-500/10 text-red-500 rounded font-medium">
              delete file
            </span>
          </div>
          <div className="font-mono text-[11px] text-foreground">{path}</div>
        </div>
      );

    default:
      return (
        <div className="font-mono text-[11px] text-muted-foreground">
          Unknown action: {action}
        </div>
      );
  }
}

function b64toBlob(b64Data: string, contentType = "") {
  try {
    const byteCharacters = atob(b64Data.replaceAll(/\s/g, ""));
    const byteArrays: any[] = [];
    const sliceSize = 512;

    for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
      const slice = byteCharacters.slice(offset, offset + sliceSize);
      const byteNumbers = new Array(slice.length);
      for (let i = 0; i < slice.length; i++) {
        byteNumbers[i] = slice.codePointAt(i) ?? 0;
      }
      const byteArray = new Uint8Array(byteNumbers);
      byteArrays.push(byteArray);
    }

    return new Blob(byteArrays, { type: contentType });
  } catch (e) {
    console.error("b64toBlob failed", e);
    return new Blob([], { type: contentType });
  }
}
