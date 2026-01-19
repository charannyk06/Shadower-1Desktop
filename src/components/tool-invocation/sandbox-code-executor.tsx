"use client";

import { appStore } from "@/app/store";
import { ToolUIPart } from "ai";
import { cn } from "lib/utils";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  Check,
  FileCode,
  Loader2,
  Terminal,
  XCircle,
  FolderOpen,
  File,
} from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";
import { Button } from "ui/button";
import { useShallow } from "zustand/shallow";

/**
 * Result structure from sandbox/code execution tool
 */
interface SandboxExecutionResult {
  success: boolean;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  error?: string;
  message?: string;
  // Execution results (array of individual execution outputs)
  results?: Array<{
    type: string;
    content?: string;
    data?: any;
    format?: string;
    error?: string;
  }>;
  // Files created/modified during execution
  files?: Array<{
    path: string;
    content?: string;
    size?: number;
  }>;
  artifacts?: Array<{
    path: string;
    content?: string;
    url?: string;
    type?: string;
  }>;
  // Execution metadata
  language?: string;
  duration?: number;
  sandboxId?: string;
}

interface SandboxCodeExecutorProps {
  part: ToolUIPart;
  threadId?: string;
  type?: "sandbox" | "code";
  onResult?: (result: any) => void;
}

/**
 * Component to display sandbox/code execution results
 * Shows code output, errors, and any generated files/artifacts
 */
export const SandboxCodeExecutor = memo(function SandboxCodeExecutor({
  part,
  type = "sandbox",
  onResult,
}: SandboxCodeExecutorProps) {
  const [showCode, setShowCode] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const [copiedStdout, setCopiedStdout] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  const { fragmentProgress } = appStore(
    useShallow((state) => ({
      fragmentProgress: state.fragmentProgress,
    })),
  );

  // Get progress data for this tool call if available
  const progress = useMemo(() => {
    if (!part.toolCallId) return null;
    return fragmentProgress[part.toolCallId];
  }, [part.toolCallId, fragmentProgress]);

  const result = useMemo(() => {
    if (part.state === "input-streaming" || part.state === "input-available") {
      return null;
    }
    return part.output as SandboxExecutionResult;
  }, [part.state, part.output]);

  const input = useMemo(() => {
    if ("input" in part) {
      return part.input as {
        code?: string;
        language?: string;
        command?: string;
        action?: string;
      };
    }
    return null;
  }, [part]);

  const isLoading =
    part.state === "input-streaming" || part.state === "input-available";
  const hasError = result && (!result.success || !!result.error);
  const hasFiles =
    (result?.files?.length ?? 0) > 0 || (result?.artifacts?.length ?? 0) > 0;

  // Determine language from input or result
  const language = input?.language || result?.language || "python";

  // Copy handlers
  const handleCopyStdout = useCallback(() => {
    if (result?.stdout) {
      navigator.clipboard.writeText(result.stdout);
      setCopiedStdout(true);
      setTimeout(() => setCopiedStdout(false), 2000);
    }
  }, [result?.stdout]);

  const handleCopyCode = useCallback(() => {
    if (input?.code) {
      navigator.clipboard.writeText(input.code);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    }
  }, [input?.code]);

  // Notify parent of result
  useMemo(() => {
    if (result && onResult) {
      onResult(result);
    }
  }, [result, onResult]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground p-3 bg-muted/30 rounded-lg">
        <Loader2 className="size-4 animate-spin" />
        <span className="text-sm">
          {progress?.message || `Executing ${language} code...`}
        </span>
      </div>
    );
  }

  if (!result) return null;

  return (
    <div className="flex flex-col gap-3 p-3 bg-muted/30 rounded-lg border">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Code2 className="size-4 text-green-500" />
          <span className="text-sm font-medium capitalize">
            {type === "sandbox" ? "Code Execution" : language}
          </span>
          {result.success ? (
            <CheckCircle2 className="size-4 text-green-500" />
          ) : (
            <XCircle className="size-4 text-red-500" />
          )}
          {result.exitCode !== undefined && (
            <span
              className={cn(
                "text-xs px-1.5 py-0.5 rounded",
                result.exitCode === 0
                  ? "bg-green-500/20 text-green-600"
                  : "bg-red-500/20 text-red-600",
              )}
            >
              Exit: {result.exitCode}
            </span>
          )}
          {result.duration && (
            <span className="text-xs text-muted-foreground">
              {result.duration}ms
            </span>
          )}
        </div>
      </div>

      {/* Code Input (collapsible) */}
      {input?.code && (
        <div className="space-y-1">
          <button
            onClick={() => setShowCode(!showCode)}
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {showCode ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
            <FileCode className="size-3" />
            <span>Code ({language})</span>
          </button>
          {showCode && (
            <div className="relative">
              <pre className="bg-background/50 p-3 rounded text-xs overflow-x-auto max-h-64 whitespace-pre-wrap font-mono">
                {input.code}
              </pre>
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-2 right-2 h-6 w-6"
                onClick={handleCopyCode}
              >
                {copiedCode ? (
                  <Check className="size-3 text-green-500" />
                ) : (
                  <Copy className="size-3" />
                )}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Error message */}
      {hasError && (
        <div className="text-sm text-red-500 bg-red-500/10 px-3 py-2 rounded">
          {result.error || "Execution failed"}
        </div>
      )}

      {/* Success message */}
      {result.message && !hasError && (
        <div className="text-sm text-muted-foreground">{result.message}</div>
      )}

      {/* Stdout output */}
      {result.stdout && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-medium">
              <Terminal className="size-3" />
              Output
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={handleCopyStdout}
            >
              {copiedStdout ? (
                <Check className="size-3 text-green-500" />
              ) : (
                <Copy className="size-3" />
              )}
            </Button>
          </div>
          <pre className="bg-background/50 p-3 rounded text-xs overflow-x-auto max-h-64 whitespace-pre-wrap font-mono">
            {result.stdout}
          </pre>
        </div>
      )}

      {/* Stderr output */}
      {result.stderr && (
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs font-medium text-red-500">
            <Terminal className="size-3" />
            Error Output
          </div>
          <pre className="bg-red-500/10 p-3 rounded text-xs overflow-x-auto max-h-48 whitespace-pre-wrap text-red-600 font-mono">
            {result.stderr}
          </pre>
        </div>
      )}

      {/* Execution results array (for notebook-style output) */}
      {result.results && result.results.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium">Results</div>
          {result.results.map((r, i) => (
            <div
              key={i}
              className={cn(
                "p-2 rounded text-xs",
                r.error ? "bg-red-500/10 text-red-600" : "bg-background/50",
              )}
            >
              {r.type === "error" && (
                <pre className="whitespace-pre-wrap font-mono">
                  {r.error || r.content}
                </pre>
              )}
              {r.type === "text" && (
                <pre className="whitespace-pre-wrap font-mono">{r.content}</pre>
              )}
              {r.type === "image" && r.data && (
                <img
                  src={`data:image/${r.format || "png"};base64,${r.data}`}
                  alt="Execution output"
                  className="max-w-full rounded"
                />
              )}
              {r.type === "html" && (
                <div
                  className="prose prose-sm dark:prose-invert max-w-none"
                  dangerouslySetInnerHTML={{ __html: r.content || "" }}
                />
              )}
              {!["error", "text", "image", "html"].includes(r.type) && (
                <pre className="whitespace-pre-wrap font-mono">
                  {JSON.stringify(r, null, 2)}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Generated files (collapsible) */}
      {hasFiles && (
        <div className="space-y-1">
          <button
            onClick={() => setShowFiles(!showFiles)}
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {showFiles ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
            <FolderOpen className="size-3" />
            <span>
              Files (
              {(result.files?.length ?? 0) + (result.artifacts?.length ?? 0)})
            </span>
          </button>
          {showFiles && (
            <div className="space-y-1 pl-5">
              {result.files?.map((file, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 text-xs bg-background/50 px-2 py-1 rounded"
                >
                  <File className="size-3 text-blue-500" />
                  <span className="truncate flex-1">{file.path}</span>
                  {file.size && (
                    <span className="text-muted-foreground">
                      {formatBytes(file.size)}
                    </span>
                  )}
                </div>
              ))}
              {result.artifacts?.map((artifact, i) => (
                <div
                  key={`artifact-${i}`}
                  className="flex items-center gap-2 text-xs bg-background/50 px-2 py-1 rounded"
                >
                  <File className="size-3 text-purple-500" />
                  <span className="truncate flex-1">{artifact.path}</span>
                  {artifact.url && (
                    <a
                      href={artifact.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-500 hover:underline"
                    >
                      Open
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Sandbox ID */}
      {result.sandboxId && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-background/50 px-2 py-1 rounded">
          <Terminal className="size-3" />
          <span className="truncate">Sandbox: {result.sandboxId}</span>
        </div>
      )}
    </div>
  );
});

SandboxCodeExecutor.displayName = "SandboxCodeExecutor";

/**
 * Format bytes to human readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
