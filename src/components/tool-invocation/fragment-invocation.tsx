"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { ToolUIPart } from "ai";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  FileCode,
  Package,
  Play,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Code,
  ExternalLink,
  Copy,
  Check,
  Edit3,
  ChevronDown,
  ChevronUp,
  Terminal,
  File,
  Bot,
  Server,
  Info,
  Wrench,
  FolderOpen,
  Maximize2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CodeBlock } from "@/components/ui/CodeBlock";
import {
  appStore,
  useAppStore,
  FragmentProgressData,
  FragmentOperation,
} from "@/app/store";
import { toast } from "sonner";

interface FragmentInvocationProps {
  part: ToolUIPart;
  threadId?: string;
}

const STAGE_CONFIG = {
  analyzing: {
    icon: Sparkles,
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
    label: "Analyzing",
  },
  "template-selected": {
    icon: FileCode,
    color: "text-purple-500",
    bgColor: "bg-purple-500/10",
    label: "Template Selected",
  },
  generating: {
    icon: FileCode,
    color: "text-indigo-500",
    bgColor: "bg-indigo-500/10",
    label: "Generating Code",
  },
  installing: {
    icon: Package,
    color: "text-amber-500",
    bgColor: "bg-amber-500/10",
    label: "Installing Dependencies",
  },
  executing: {
    icon: Play,
    color: "text-green-500",
    bgColor: "bg-green-500/10",
    label: "Launching Preview",
  },
  editing: {
    icon: Edit3,
    color: "text-orange-500",
    bgColor: "bg-orange-500/10",
    label: "Editing",
  },
  deploying: {
    icon: Play,
    color: "text-cyan-500",
    bgColor: "bg-cyan-500/10",
    label: "Deploying",
  },
  complete: {
    icon: CheckCircle2,
    color: "text-green-600",
    bgColor: "bg-green-500/10",
    label: "Complete",
  },
  error: {
    icon: AlertCircle,
    color: "text-red-500",
    bgColor: "bg-red-500/10",
    label: "Error",
  },
};

const TEMPLATE_INFO: Record<
  string,
  { label: string; color: string; icon: string }
> = {
  "nextjs-developer": {
    label: "Next.js",
    color: "bg-black text-white",
    icon: "⚛️",
  },
  "vue-developer": {
    label: "Vue.js",
    color: "bg-emerald-500 text-white",
    icon: "💚",
  },
  "streamlit-developer": {
    label: "Streamlit",
    color: "bg-red-500 text-white",
    icon: "📊",
  },
  "gradio-developer": {
    label: "Gradio",
    color: "bg-orange-500 text-white",
    icon: "🤖",
  },
  "code-interpreter-v1": {
    label: "Python",
    color: "bg-blue-500 text-white",
    icon: "🐍",
  },
};

/**
 * Get language for syntax highlighting based on template or file path
 */
function getLanguageFromTemplate(template: string): string {
  const langMap: Record<string, string> = {
    "nextjs-developer": "tsx",
    "vue-developer": "vue",
    "streamlit-developer": "python",
    "gradio-developer": "python",
    "code-interpreter-v1": "python",
  };
  return langMap[template] || "typescript";
}

function getLanguageFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  const langMap: Record<string, string> = {
    tsx: "tsx",
    ts: "typescript",
    jsx: "jsx",
    js: "javascript",
    py: "python",
    vue: "vue",
    html: "html",
    css: "css",
    json: "json",
  };
  return langMap[ext] || "plaintext";
}

export function FragmentInvocation({
  part,
}: Omit<FragmentInvocationProps, "threadId">) {
  const { output, state, input, toolCallId } = part;
  const [showCode, setShowCode] = useState(false);
  const [copied, setCopied] = useState(false);
  const [codeExpanded, setCodeExpanded] = useState(false);
  const [showOperations, setShowOperations] = useState(false); // Hidden by default - less noise
  const [showWorkspaceFiles, setShowWorkspaceFiles] = useState(true); // Show files by default
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  // Get fragment progress from app store (updated via data stream events)
  // Try the specific toolCallId first, then fall back to 'current' for backwards compatibility
  const fragmentProgress = appStore((s) => {
    // Priority: specific toolCallId > 'current'
    const specificProgress = s.fragmentProgress[toolCallId];
    if (specificProgress) {
      console.log(
        `[FragmentInvocation] Found progress for toolCallId: ${toolCallId}`,
        {
          operationsCount: specificProgress.operations?.length || 0,
          stage: specificProgress.stage,
        },
      );
      return specificProgress;
    }
    const currentProgress = s.fragmentProgress["current"];
    if (currentProgress) {
      console.log(
        `[FragmentInvocation] Using 'current' progress (toolCallId: ${toolCallId})`,
        {
          operationsCount: currentProgress.operations?.length || 0,
          stage: currentProgress.stage,
        },
      );
    }
    return currentProgress;
  }) as FragmentProgressData | undefined;
  const mutateStore = useAppStore((s) => s.mutate);

  const isCompleted = state?.startsWith("output");
  const isError = state === "output-error";

  // Parse input request
  const request = useMemo(() => {
    return (input as any)?.request || "Creating fragment...";
  }, [input]);

  // Parse output result
  const result = useMemo(() => {
    if (!isCompleted || !output) return null;
    return output as {
      success: boolean;
      fragmentId?: string;
      title?: string;
      template?: string;
      previewUrl?: string;
      code?: string;
      message?: string;
      error?: string;
      hint?: string;
    };
  }, [isCompleted, output]);

  // Trigger Theater Panel file refresh when fragment completes successfully
  useEffect(() => {
    if (isCompleted && result?.success) {
      // Increment sandbox files version to trigger Theater Panel refresh
      mutateStore((state) => ({
        theaterMode: {
          ...state.theaterMode,
          sandboxFilesVersion: (state.theaterMode.sandboxFilesVersion || 0) + 1,
        },
      }));
    }
  }, [isCompleted, result?.success, mutateStore]);

  // Get current progress stage
  const currentStage =
    fragmentProgress?.stage || (isCompleted ? "complete" : "analyzing");
  const stageConfig =
    STAGE_CONFIG[currentStage as keyof typeof STAGE_CONFIG] ||
    STAGE_CONFIG.analyzing;
  const Icon = stageConfig.icon;

  // Get generated code from progress or result
  const generatedCode = fragmentProgress?.generatedCode || result?.code;

  // Get operations log
  const operations = fragmentProgress?.operations || [];

  // Debug logging
  if (operations.length > 0) {
    console.log(`[FragmentInvocation] Operations found: ${operations.length}`, {
      toolCallId,
      operations: operations.map((op) => ({
        type: op.type,
        status: op.status,
        command: op.command?.substring(0, 50),
        filePath: op.filePath,
      })),
    });
  } else if (!isCompleted) {
    console.log(
      `[FragmentInvocation] No operations yet (toolCallId: ${toolCallId}, stage: ${fragmentProgress?.stage || "unknown"})`,
    );
  }

  // Get workspace files - merge from progress and result
  const workspaceFiles = useMemo(() => {
    const progressFiles = fragmentProgress?.workspaceFiles || [];
    const resultFiles = result?.code
      ? [
          {
            path:
              result.template === "nextjs-developer"
                ? "pages/index.tsx"
                : result.template === "vue-developer"
                  ? "app/app.vue"
                  : result.template === "streamlit-developer"
                    ? "app.py"
                    : result.template === "gradio-developer"
                      ? "app.py"
                      : "script.py",
            content: result.code,
            language:
              result.template?.includes("nextjs") ||
              result.template?.includes("vue")
                ? "typescript"
                : result.template?.includes("streamlit") ||
                    result.template?.includes("gradio")
                  ? "python"
                  : "javascript",
          },
        ]
      : [];

    // Merge files, avoiding duplicates by path
    const allFiles = [...progressFiles];
    for (const resultFile of resultFiles) {
      const existingIndex = allFiles.findIndex(
        (f) => f.path === resultFile.path,
      );
      if (existingIndex >= 0) {
        allFiles[existingIndex] = resultFile; // Update existing
      } else {
        allFiles.push(resultFile); // Add new
      }
    }

    // Debug logging
    if (allFiles.length > 0) {
      console.log(`[FragmentInvocation] Workspace files: ${allFiles.length}`, {
        files: allFiles.map((f) => ({
          path: f.path,
          contentLength: f.content?.length || 0,
        })),
        fromProgress: progressFiles.length,
        fromResult: resultFiles.length,
      });
    }

    return allFiles;
  }, [fragmentProgress?.workspaceFiles, result?.code, result?.template]);

  // Template info
  const template = result?.template || fragmentProgress?.template;
  const templateInfo = template ? TEMPLATE_INFO[template] : null;

  // Handle copy code
  const handleCopyCode = async () => {
    if (result?.code) {
      try {
        await navigator.clipboard.writeText(result.code);
        setCopied(true);
        toast.success("Code copied to clipboard!");
        setTimeout(() => setCopied(false), 2000);
      } catch {
        toast.error("Failed to copy code");
      }
    }
  };

  // Open preview in Theater Panel - clicking the preview card opens in theater
  const openInTheater = useCallback(() => {
    // Use preview URL from either result or fragmentProgress
    const previewUrl = result?.previewUrl || fragmentProgress?.previewUrl;
    const title =
      result?.title || fragmentProgress?.template || "Fragment Preview";

    if (!previewUrl) {
      console.warn("[FragmentInvocation] No preview URL available for theater");
      return;
    }

    console.log("[FragmentInvocation] Opening in Theater:", {
      previewUrl,
      title,
    });

    mutateStore((state) => ({
      theaterMode: {
        ...state.theaterMode,
        isOpen: true,
        type: "app",
        content: previewUrl,
        title: title,
        defaultTab: "preview",
      },
    }));
  }, [result, fragmentProgress, mutateStore]);

  // Open in new tab
  const openInNewTab = useCallback(() => {
    if (result?.previewUrl) {
      window.open(result.previewUrl, "_blank", "noopener,noreferrer");
    }
  }, [result?.previewUrl]);

  // Get icon for operation type
  const getOperationIcon = (type: FragmentOperation["type"]) => {
    switch (type) {
      case "bash":
      case "install":
        return <Terminal className="h-3 w-3" />;
      case "file-write":
      case "file-read":
        return <File className="h-3 w-3" />;
      case "ai-call":
        return <Bot className="h-3 w-3" />;
      case "sandbox":
        return <Server className="h-3 w-3" />;
      case "tool-call":
        return <Wrench className="h-3 w-3" />;
      case "info":
      default:
        return <Info className="h-3 w-3" />;
    }
  };

  // Render progress indicator
  const renderProgress = () => {
    if (isCompleted && result?.success) return null;

    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn(
          "flex items-center gap-3 p-3 rounded-lg border",
          stageConfig.bgColor,
          isError ? "border-red-200" : "border-transparent",
        )}
      >
        <div
          className={cn(
            "flex items-center justify-center w-8 h-8 rounded-full",
            stageConfig.bgColor,
          )}
        >
          {!isCompleted && !isError ? (
            <Loader2
              className={cn("h-5 w-5 animate-spin", stageConfig.color)}
            />
          ) : (
            <Icon className={cn("h-5 w-5", stageConfig.color)} />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <p className={cn("text-sm font-medium", isError && "text-red-600")}>
            {fragmentProgress?.message || stageConfig.label}
          </p>
          {(fragmentProgress?.codeLength || fragmentProgress?.generatedCode) &&
            currentStage === "generating" && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {(
                  fragmentProgress.codeLength ||
                  fragmentProgress.generatedCode?.length ||
                  0
                ).toLocaleString()}{" "}
                characters generated...
              </p>
            )}
          {templateInfo && (
            <Badge
              variant="secondary"
              className={cn("text-xs mt-1", templateInfo.color)}
            >
              {templateInfo.icon} {templateInfo.label}
            </Badge>
          )}
        </div>
      </motion.div>
    );
  };

  // Render operations log (collapsed by default - less noise)
  const renderOperationsLog = () => {
    // Only show operations panel if there are actual operations
    // This reduces UI noise - code streaming is the primary view
    if (operations.length === 0) return null;

    return (
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: "auto" }}
        className="mt-3 rounded-lg border bg-zinc-950 overflow-hidden font-mono text-xs"
      >
        <button
          onClick={() => setShowOperations(!showOperations)}
          className="w-full flex items-center justify-between px-3 py-2 border-b border-zinc-800 bg-zinc-900 hover:bg-zinc-800/50 transition-colors"
        >
          <span className="text-zinc-400 flex items-center gap-2">
            <Terminal className="h-3 w-3" />
            Operations ({operations.length})
          </span>
          {showOperations ? (
            <ChevronUp className="h-3 w-3 text-zinc-500" />
          ) : (
            <ChevronDown className="h-3 w-3 text-zinc-500" />
          )}
        </button>

        <AnimatePresence>
          {showOperations && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="max-h-[500px] overflow-auto p-2 space-y-2"
            >
              {operations.map((op, idx) => (
                <div
                  key={`${op.timestamp}-${idx}`}
                  className={cn(
                    "flex items-start gap-2 px-2 py-1.5 rounded",
                    op.status === "running" && "bg-blue-500/10 text-blue-400",
                    op.status === "success" && "bg-green-500/10 text-green-400",
                    op.status === "error" && "bg-red-500/10 text-red-400",
                  )}
                >
                  <span className="flex-shrink-0 mt-0.5">
                    {op.status === "running" ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : op.status === "success" ? (
                      <Check className="h-3 w-3" />
                    ) : (
                      <AlertCircle className="h-3 w-3" />
                    )}
                  </span>
                  <span className="flex-shrink-0 mt-0.5 text-zinc-500">
                    {getOperationIcon(op.type)}
                  </span>
                  <div className="flex-1 min-w-0">
                    {/* Show operation type and details */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-zinc-400 text-[10px] uppercase font-semibold">
                        {op.type}
                      </span>
                      {op.command && (
                        <span className="text-blue-400 font-mono text-xs break-all">
                          {op.command}
                        </span>
                      )}
                      {op.filePath && (
                        <span className="text-cyan-400 font-mono text-xs break-all">
                          {op.filePath}
                        </span>
                      )}
                      {op.toolName && (
                        <span className="text-purple-400 font-semibold text-xs">
                          {op.toolName}
                        </span>
                      )}
                    </div>
                    {/* Show output prominently */}
                    {op.output && (
                      <div className="text-zinc-300 mt-1 break-words whitespace-pre-wrap text-xs font-mono">
                        {op.output.length > 500
                          ? `${op.output.substring(0, 500)}...`
                          : op.output}
                      </div>
                    )}
                    {/* Show tool args if available */}
                    {op.type === "tool-call" && op.toolArgs && (
                      <div className="text-zinc-500 mt-1 text-[10px] font-mono break-all">
                        {JSON.stringify(op.toolArgs, null, 2).slice(0, 200)}
                        {JSON.stringify(op.toolArgs).length > 200 ? "..." : ""}
                      </div>
                    )}
                    {/* Show file content preview for file operations */}
                    {op.type === "file-write" && op.content && (
                      <div className="text-zinc-400 mt-1 text-[10px] font-mono break-all max-h-20 overflow-auto">
                        {op.content.length > 300
                          ? `${op.content.substring(0, 300)}...`
                          : op.content}
                      </div>
                    )}
                    {op.durationMs !== undefined && op.status !== "running" && (
                      <span className="text-zinc-600 text-[10px] mt-1 block">
                        {op.durationMs}ms
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    );
  };

  // Render workspace files panel - shows files being created/edited in real-time
  const renderWorkspaceFiles = () => {
    // ALWAYS show workspace files panel if there are any files OR if we're generating/executing
    // This ensures files appear as soon as they're created
    const shouldShow =
      workspaceFiles.length > 0 ||
      (fragmentProgress &&
        (currentStage === "generating" ||
          currentStage === "executing" ||
          currentStage === "installing" ||
          currentStage === "editing"));

    if (!shouldShow) return null;

    // Show "waiting" message if no files yet but we're in an active stage
    // Don't show empty state - only show when files exist
    if (workspaceFiles.length === 0) {
      return null;
    }

    console.log(
      `[FragmentInvocation] Rendering ${workspaceFiles.length} workspace files`,
    );

    const currentFile = selectedFile
      ? workspaceFiles.find((f) => f.path === selectedFile)
      : workspaceFiles[0];

    return (
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: "auto" }}
        className="mt-3 rounded-lg border bg-zinc-950 overflow-hidden"
      >
        <button
          onClick={() => setShowWorkspaceFiles(!showWorkspaceFiles)}
          className="w-full flex items-center justify-between px-3 py-2 border-b border-zinc-800 bg-zinc-900 hover:bg-zinc-800/50 transition-colors"
        >
          <span className="text-zinc-400 flex items-center gap-2 text-xs">
            <FolderOpen className="h-3 w-3" />
            Workspace Files ({workspaceFiles.length})
          </span>
          {showWorkspaceFiles ? (
            <ChevronUp className="h-3 w-3 text-zinc-500" />
          ) : (
            <ChevronDown className="h-3 w-3 text-zinc-500" />
          )}
        </button>

        <AnimatePresence>
          {showWorkspaceFiles && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
            >
              {/* File tabs */}
              <div className="flex gap-1 px-2 py-1.5 bg-zinc-900/50 border-b border-zinc-800 overflow-x-auto">
                {workspaceFiles.map((file) => (
                  <button
                    key={file.path}
                    onClick={() => setSelectedFile(file.path)}
                    className={cn(
                      "px-2 py-1 rounded text-[10px] font-mono whitespace-nowrap transition-colors",
                      selectedFile === file.path ||
                        (!selectedFile && file === workspaceFiles[0])
                        ? "bg-zinc-700 text-zinc-200"
                        : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800",
                    )}
                  >
                    {file.path.split("/").pop()}
                  </button>
                ))}
              </div>

              {/* File content */}
              {currentFile && (
                <div className="max-h-[250px] overflow-auto">
                  <CodeBlock
                    code={currentFile.content}
                    lang={
                      currentFile.language ||
                      getLanguageFromPath(currentFile.path)
                    }
                    showLineNumbers={true}
                    fallback={
                      <pre className="p-4 text-xs overflow-auto font-mono text-zinc-300">
                        <code>{currentFile.content}</code>
                      </pre>
                    }
                  />
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    );
  };

  // Render code preview during generation
  const renderCodePreview = () => {
    if (!generatedCode || currentStage !== "generating") return null;

    return (
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: "auto" }}
        className="mt-3 rounded-lg border bg-muted/30 overflow-hidden"
      >
        <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/50">
          <span className="text-xs text-muted-foreground font-mono flex items-center gap-2">
            <Loader2 className="h-3 w-3 animate-spin" />
            Generating code... ({generatedCode.length.toLocaleString()} chars)
          </span>
        </div>
        <div className="max-h-[200px] overflow-auto">
          <CodeBlock
            code={generatedCode}
            lang={getLanguageFromTemplate(template || "nextjs-developer")}
            showLineNumbers={true}
            fallback={
              <pre className="p-4 text-xs overflow-auto">
                <code>{generatedCode.slice(-2000)}</code>
              </pre>
            }
          />
        </div>
      </motion.div>
    );
  };

  // Render preview card that opens in Theater Panel
  const renderPreviewCard = () => {
    if (!result?.previewUrl || !result?.success) return null;

    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="mt-3 rounded-xl border-2 border-primary/20 bg-gradient-to-br from-primary/5 to-primary/10 overflow-hidden cursor-pointer group hover:border-primary/40 transition-all"
        onClick={openInTheater}
      >
        {/* Preview thumbnail */}
        <div className="relative h-[200px] bg-white overflow-hidden">
          <iframe
            src={result.previewUrl}
            className="w-full h-full border-0 pointer-events-none"
            title={result.title || "Fragment Preview"}
            sandbox="allow-scripts allow-same-origin"
          />
          {/* Overlay on hover */}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
            <div className="opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center gap-2">
              <div className="bg-white/90 backdrop-blur rounded-full p-3 shadow-lg">
                <Maximize2 className="h-6 w-6 text-primary" />
              </div>
              <span className="text-white text-sm font-medium shadow-sm">
                Open in Theater
              </span>
            </div>
          </div>
        </div>

        {/* Card footer */}
        <div className="px-4 py-3 flex items-center justify-between bg-card">
          <div className="flex items-center gap-3">
            {templateInfo && (
              <span className="text-lg">{templateInfo.icon}</span>
            )}
            <div>
              <h3 className="font-medium text-sm">
                {result.title || "Fragment"}
              </h3>
              {templateInfo && (
                <Badge variant="secondary" className="text-xs mt-0.5">
                  {templateInfo.label}
                </Badge>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                setShowCode(!showCode);
              }}
            >
              <Code className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                openInNewTab();
              }}
            >
              <ExternalLink className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </motion.div>
    );
  };

  // Render completed result (with code view option)
  const renderResult = () => {
    if (!isCompleted || !result) return null;

    if (!result.success) {
      return (
        <div className="p-4 rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-red-600">
                {result.error || "Failed to create fragment"}
              </p>
              {result.hint && (
                <p className="text-xs text-muted-foreground mt-1">
                  {result.hint}
                </p>
              )}
            </div>
          </div>
        </div>
      );
    }

    return (
      <>
        {/* Preview Card - Click to open in Theater */}
        {renderPreviewCard()}

        {/* Code view (toggled) */}
        <AnimatePresence>
          {showCode && result.code && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-3 rounded-lg border bg-card overflow-hidden"
            >
              <div className="flex items-center justify-between px-4 py-2 bg-muted/50 border-b">
                <span className="text-xs text-muted-foreground font-mono">
                  {result.code.length.toLocaleString()} characters
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setCodeExpanded(!codeExpanded)}
                  >
                    {codeExpanded ? (
                      <ChevronUp className="h-4 w-4 mr-1" />
                    ) : (
                      <ChevronDown className="h-4 w-4 mr-1" />
                    )}
                    {codeExpanded ? "Collapse" : "Expand"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={handleCopyCode}>
                    {copied ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              <div
                className={cn(
                  "overflow-auto bg-muted/30",
                  codeExpanded ? "max-h-[600px]" : "max-h-[300px]",
                )}
              >
                <CodeBlock
                  code={result.code}
                  lang={getLanguageFromTemplate(template || "nextjs-developer")}
                  showLineNumbers={true}
                  fallback={
                    <pre className="p-4 text-sm overflow-auto">
                      <code>{result.code}</code>
                    </pre>
                  }
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </>
    );
  };

  return (
    <div className="space-y-3">
      {/* Request summary */}
      <div className="flex items-start gap-2 text-sm">
        <Sparkles className="h-4 w-4 text-purple-500 flex-shrink-0 mt-0.5" />
        <span className="text-muted-foreground line-clamp-2">{request}</span>
      </div>

      {/* Progress or Result */}
      {!isCompleted ? (
        <>
          {renderProgress()}
          {renderOperationsLog()}
          {renderWorkspaceFiles()}
          {renderCodePreview()}
        </>
      ) : (
        <>
          {/* Show operations log even after completion for visibility */}
          {renderOperationsLog()}
          {/* Show workspace files after completion too */}
          {workspaceFiles.length > 0 && renderWorkspaceFiles()}
          {renderResult()}
        </>
      )}
    </div>
  );
}
