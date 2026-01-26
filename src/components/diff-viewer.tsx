"use client";

import { cn } from "@/lib/utils";
import { diffLines, Change } from "diff";
import { ChevronDown, ChevronRight, FileCode, Minus, Plus } from "lucide-react";
import { useMemo, useState } from "react";

interface DiffLine {
  type: "added" | "removed" | "unchanged" | "header";
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

interface DiffViewerProps {
  original: string;
  modified: string;
  filename?: string;
  language?: string;
  className?: string;
  showLineNumbers?: boolean;
  collapsible?: boolean;
  defaultExpanded?: boolean;
}

/**
 * VS Code-style diff viewer component
 * Shows file changes with red (deletions) and green (additions) highlighting
 */
export function DiffViewer({
  original,
  modified,
  filename,
  language: _language,
  className,
  showLineNumbers = true,
  collapsible = false,
  defaultExpanded = true,
}: DiffViewerProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const { lines, stats } = useMemo(() => {
    const changes: Change[] = diffLines(original, modified);
    const diffLines_: DiffLine[] = [];
    let oldLineNum = 1;
    let newLineNum = 1;
    let addedCount = 0;
    let removedCount = 0;

    for (const change of changes) {
      const changeLines = change.value.split("\n");
      // Remove trailing empty line from split
      if (changeLines[changeLines.length - 1] === "") {
        changeLines.pop();
      }

      for (const line of changeLines) {
        if (change.added) {
          diffLines_.push({
            type: "added",
            content: line,
            newLineNumber: newLineNum++,
          });
          addedCount++;
        } else if (change.removed) {
          diffLines_.push({
            type: "removed",
            content: line,
            oldLineNumber: oldLineNum++,
          });
          removedCount++;
        } else {
          diffLines_.push({
            type: "unchanged",
            content: line,
            oldLineNumber: oldLineNum++,
            newLineNumber: newLineNum++,
          });
        }
      }
    }

    return {
      lines: diffLines_,
      stats: { added: addedCount, removed: removedCount },
    };
  }, [original, modified]);

  const hasChanges = stats.added > 0 || stats.removed > 0;

  if (!hasChanges) {
    return (
      <div className={cn("text-sm text-white/50 py-4 text-center", className)}>
        No changes
      </div>
    );
  }

  const header = (
    <div
      className={cn(
        "flex items-center gap-3 px-3 py-2 bg-white/[0.03] border-b border-white/10",
        collapsible && "cursor-pointer hover:bg-white/[0.05] transition-colors",
      )}
      onClick={collapsible ? () => setIsExpanded(!isExpanded) : undefined}
    >
      {collapsible && (
        <span className="text-white/40">
          {isExpanded ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
        </span>
      )}
      {filename && (
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <FileCode className="w-4 h-4 text-white/50 flex-shrink-0" />
          <span className="text-sm text-white/80 truncate font-mono">
            {filename}
          </span>
        </div>
      )}
      <div className="flex items-center gap-3 text-xs flex-shrink-0">
        {stats.added > 0 && (
          <span className="flex items-center gap-1 text-green-400">
            <Plus className="w-3 h-3" />
            {stats.added}
          </span>
        )}
        {stats.removed > 0 && (
          <span className="flex items-center gap-1 text-red-400">
            <Minus className="w-3 h-3" />
            {stats.removed}
          </span>
        )}
      </div>
    </div>
  );

  return (
    <div
      className={cn(
        "rounded-lg border border-white/10 overflow-hidden bg-[#0d0d0d]",
        className,
      )}
    >
      {(filename || collapsible) && header}

      {(!collapsible || isExpanded) && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono border-collapse">
            <tbody>
              {lines.map((line, index) => (
                <tr
                  key={index}
                  className={cn(
                    "border-b border-white/[0.03] last:border-b-0",
                    line.type === "added" && "bg-green-500/10",
                    line.type === "removed" && "bg-red-500/10",
                  )}
                >
                  {/* Line numbers */}
                  {showLineNumbers && (
                    <>
                      {/* Old line number */}
                      <td
                        className={cn(
                          "w-12 px-2 py-0.5 text-right select-none border-r border-white/[0.06]",
                          line.type === "removed"
                            ? "text-red-400/60 bg-red-500/5"
                            : line.type === "added"
                              ? "bg-green-500/5"
                              : "text-white/30",
                        )}
                      >
                        {line.type !== "added" ? line.oldLineNumber : ""}
                      </td>
                      {/* New line number */}
                      <td
                        className={cn(
                          "w-12 px-2 py-0.5 text-right select-none border-r border-white/[0.06]",
                          line.type === "added"
                            ? "text-green-400/60 bg-green-500/5"
                            : line.type === "removed"
                              ? "bg-red-500/5"
                              : "text-white/30",
                        )}
                      >
                        {line.type !== "removed" ? line.newLineNumber : ""}
                      </td>
                    </>
                  )}

                  {/* Change indicator */}
                  <td
                    className={cn(
                      "w-6 px-1 py-0.5 text-center select-none font-bold",
                      line.type === "added" && "text-green-400 bg-green-500/5",
                      line.type === "removed" && "text-red-400 bg-red-500/5",
                    )}
                  >
                    {line.type === "added" && "+"}
                    {line.type === "removed" && "−"}
                  </td>

                  {/* Content */}
                  <td
                    className={cn(
                      "px-3 py-0.5 whitespace-pre",
                      line.type === "added" && "text-green-300",
                      line.type === "removed" && "text-red-300",
                      line.type === "unchanged" && "text-white/70",
                    )}
                  >
                    {line.content || " "}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Inline diff for showing changes within text content
 * Shows strikethrough for removed text and highlight for added text
 */
interface InlineDiffProps {
  original: string;
  modified: string;
  className?: string;
}

export function InlineDiff({ original, modified, className }: InlineDiffProps) {
  const changes = useMemo(
    () => diffLines(original, modified),
    [original, modified],
  );

  return (
    <div className={cn("text-sm leading-relaxed", className)}>
      {changes.map((change, index) => {
        if (change.added) {
          return (
            <span
              key={index}
              className="bg-green-500/20 text-green-300 rounded px-0.5"
            >
              {change.value}
            </span>
          );
        }
        if (change.removed) {
          return (
            <span
              key={index}
              className="bg-red-500/20 text-red-300 line-through rounded px-0.5"
            >
              {change.value}
            </span>
          );
        }
        return <span key={index}>{change.value}</span>;
      })}
    </div>
  );
}

/**
 * Side-by-side diff viewer (like VS Code's split view)
 */
interface SideBySideDiffProps {
  original: string;
  modified: string;
  originalTitle?: string;
  modifiedTitle?: string;
  filename?: string;
  className?: string;
}

export function SideBySideDiff({
  original,
  modified,
  originalTitle = "Original",
  modifiedTitle = "Modified",
  filename,
  className,
}: SideBySideDiffProps) {
  const { leftLines, rightLines, stats } = useMemo(() => {
    const changes: Change[] = diffLines(original, modified);
    const left: Array<{
      lineNum: number;
      content: string;
      type: "removed" | "unchanged" | "empty";
    }> = [];
    const right: Array<{
      lineNum: number;
      content: string;
      type: "added" | "unchanged" | "empty";
    }> = [];
    let leftLineNum = 1;
    let rightLineNum = 1;
    let addedCount = 0;
    let removedCount = 0;

    for (const change of changes) {
      const changeLines = change.value.split("\n");
      if (changeLines[changeLines.length - 1] === "") {
        changeLines.pop();
      }

      if (change.added) {
        for (const line of changeLines) {
          left.push({ lineNum: 0, content: "", type: "empty" });
          right.push({ lineNum: rightLineNum++, content: line, type: "added" });
          addedCount++;
        }
      } else if (change.removed) {
        for (const line of changeLines) {
          left.push({ lineNum: leftLineNum++, content: line, type: "removed" });
          right.push({ lineNum: 0, content: "", type: "empty" });
          removedCount++;
        }
      } else {
        for (const line of changeLines) {
          left.push({
            lineNum: leftLineNum++,
            content: line,
            type: "unchanged",
          });
          right.push({
            lineNum: rightLineNum++,
            content: line,
            type: "unchanged",
          });
        }
      }
    }

    return {
      leftLines: left,
      rightLines: right,
      stats: { added: addedCount, removed: removedCount },
    };
  }, [original, modified]);

  return (
    <div
      className={cn(
        "rounded-lg border border-white/10 overflow-hidden bg-[#0d0d0d]",
        className,
      )}
    >
      {/* Header */}
      <div className="flex border-b border-white/10">
        <div className="flex-1 px-3 py-2 bg-red-500/5 border-r border-white/10">
          <div className="flex items-center justify-between">
            <span className="text-xs text-red-400/80 font-medium">
              {originalTitle}
            </span>
            {stats.removed > 0 && (
              <span className="flex items-center gap-1 text-xs text-red-400">
                <Minus className="w-3 h-3" />
                {stats.removed}
              </span>
            )}
          </div>
          {filename && (
            <div className="text-xs text-white/50 font-mono mt-0.5 truncate">
              {filename}
            </div>
          )}
        </div>
        <div className="flex-1 px-3 py-2 bg-green-500/5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-green-400/80 font-medium">
              {modifiedTitle}
            </span>
            {stats.added > 0 && (
              <span className="flex items-center gap-1 text-xs text-green-400">
                <Plus className="w-3 h-3" />
                {stats.added}
              </span>
            )}
          </div>
          {filename && (
            <div className="text-xs text-white/50 font-mono mt-0.5 truncate">
              {filename}
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex overflow-x-auto">
        {/* Left side (original) */}
        <div className="flex-1 border-r border-white/10 min-w-0">
          <table className="w-full text-xs font-mono border-collapse">
            <tbody>
              {leftLines.map((line, index) => (
                <tr
                  key={index}
                  className={cn(
                    "border-b border-white/[0.03] last:border-b-0",
                    line.type === "removed" && "bg-red-500/10",
                    line.type === "empty" && "bg-white/[0.02]",
                  )}
                >
                  <td
                    className={cn(
                      "w-10 px-2 py-0.5 text-right select-none border-r border-white/[0.06]",
                      line.type === "removed"
                        ? "text-red-400/60"
                        : "text-white/30",
                    )}
                  >
                    {line.lineNum || ""}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-0.5 whitespace-pre",
                      line.type === "removed" && "text-red-300",
                      line.type === "unchanged" && "text-white/70",
                      line.type === "empty" && "text-white/20",
                    )}
                  >
                    {line.content || " "}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Right side (modified) */}
        <div className="flex-1 min-w-0">
          <table className="w-full text-xs font-mono border-collapse">
            <tbody>
              {rightLines.map((line, index) => (
                <tr
                  key={index}
                  className={cn(
                    "border-b border-white/[0.03] last:border-b-0",
                    line.type === "added" && "bg-green-500/10",
                    line.type === "empty" && "bg-white/[0.02]",
                  )}
                >
                  <td
                    className={cn(
                      "w-10 px-2 py-0.5 text-right select-none border-r border-white/[0.06]",
                      line.type === "added"
                        ? "text-green-400/60"
                        : "text-white/30",
                    )}
                  >
                    {line.lineNum || ""}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-0.5 whitespace-pre",
                      line.type === "added" && "text-green-300",
                      line.type === "unchanged" && "text-white/70",
                      line.type === "empty" && "text-white/20",
                    )}
                  >
                    {line.content || " "}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default DiffViewer;
