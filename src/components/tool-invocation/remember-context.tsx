"use client";

import { ToolUIPart } from "ai";
import { RememberContextResult } from "lib/ai/tools/memory/remember-context";
import equal from "lib/equal";
import { cn, toAny } from "lib/utils";
import {
  AlertTriangleIcon,
  BrainIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { memo, useMemo, useState } from "react";
import { Button } from "ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "ui/hover-card";
import JsonView from "ui/json-view";
import { Separator } from "ui/separator";
import { TextShimmer } from "ui/text-shimmer";

interface RememberContextToolInvocationProps {
  part: ToolUIPart;
}

// Helper function to extract clean filename from potentially prefixed string
function extractFileName(fileName: string | undefined): string {
  if (!fileName) return "";
  // If it contains a path separator, get the last part
  if (fileName.includes("/")) {
    return fileName.split("/").pop() || fileName;
  }
  // If it contains UUID-like patterns followed by the actual filename, extract just the filename
  // Pattern: uuid-uuid-timestamp-Filename.ext or uuid-uuid-uuid-timestamp-Filename.ext
  // Look for the last occurrence of a dash followed by text that contains a dot (file extension)
  const lastDashIndex = fileName.lastIndexOf("-");
  if (lastDashIndex !== -1) {
    const afterLastDash = fileName.substring(lastDashIndex + 1);
    // If the part after the last dash contains a dot, it's likely the filename
    if (afterLastDash.includes(".")) {
      return afterLastDash;
    }
  }
  // Fallback: try splitting by dash and finding the part with extension
  const parts = fileName.split("-");
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].includes(".")) {
      // Return from this part onwards, joined with dashes
      return parts.slice(i).join("-");
    }
  }
  // If no extension found, return the last part
  return parts[parts.length - 1] || fileName;
}

// Helper to truncate text with ellipsis
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}

function PureRememberContextToolInvocation({
  part,
}: RememberContextToolInvocationProps) {
  const { t } = useTranslation();
  // Default to collapsed to reduce chat bloat
  const [isExpanded, setIsExpanded] = useState(false);
  // Also track if the whole component should be minimized
  const [isMinimized, setIsMinimized] = useState(true);

  const result = useMemo(() => {
    if (!part.state?.startsWith("output")) return null;
    return part.output as RememberContextResult & {
      isError: boolean;
      error?: string;
    };
  }, [part.state]);

  const options = useMemo(() => {
    return (
      <HoverCard openDelay={200} closeDelay={0}>
        <HoverCardTrigger asChild>
          <span className="hover:text-primary transition-colors text-xs text-muted-foreground">
            {t("Chat.Tool.searchOptions")}
          </span>
        </HoverCardTrigger>
        <HoverCardContent className="max-w-xs md:max-w-md! w-full! overflow-auto flex flex-col">
          <p className="text-xs text-muted-foreground px-2 mb-2">
            {t("Chat.Tool.searchOptionsDescription")}
          </p>
          <div className="p-2">
            <JsonView data={part.input} />
          </div>
        </HoverCardContent>
      </HoverCard>
    );
  }, [part.input, t]);

  if (!part.state?.startsWith("output"))
    return (
      <div className="flex items-center gap-2 text-sm">
        <BrainIcon className="size-5 wiggle text-muted-foreground" />
        <TextShimmer>{t("Chat.Tool.remembering")}</TextShimmer>
      </div>
    );

  // Minimized single-line view - click to expand
  if (isMinimized) {
    return (
      <button
        onClick={() => setIsMinimized(false)}
        className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors py-1 px-2 rounded hover:bg-secondary/50 w-fit"
      >
        <BrainIcon className="size-3.5" />
        <span>Memory context</span>
        {result?.results && result.results.length > 0 && (
          <span className="text-[10px] bg-secondary px-1.5 py-0.5 rounded">
            {result.results.length}{" "}
            {result.results.length === 1 ? "result" : "results"}
          </span>
        )}
        <ChevronDownIcon className="size-3" />
      </button>
    );
  }

  return (
    <div
      className="flex flex-col gap-2 w-full overflow-hidden"
      style={{ maxWidth: "100%", overflowX: "hidden" }}
    >
      <div className="flex items-center gap-2 overflow-hidden w-full min-w-0">
        <BrainIcon className="size-5 text-muted-foreground flex-shrink-0" />
        <span className="text-sm font-semibold flex-shrink-0">
          {t("Chat.Tool.retrievedContext")}
        </span>
        <div className="flex-shrink-0">{options}</div>
        {result?.results && result.results.length > 0 && (
          <span className="text-xs text-muted-foreground flex-shrink-0">
            ({result.results.length}{" "}
            {result.results.length === 1 ? "result" : "results"})
          </span>
        )}
        <button
          onClick={() => setIsMinimized(true)}
          className="ml-auto text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronUpIcon className="size-4" />
        </button>
      </div>
      <div
        className="flex gap-2 overflow-hidden w-full min-w-0"
        style={{ maxWidth: "100%", overflowX: "hidden" }}
      >
        <div className="px-2.5 flex-shrink-0">
          <Separator
            orientation="vertical"
            className="bg-gradient-to-b from-border to-transparent from-80%"
          />
        </div>
        <div
          className="flex flex-col gap-2 pb-2 flex-1 min-w-0 overflow-hidden"
          style={{ maxWidth: "calc(100% - 20px)", overflowX: "hidden" }}
        >
          {result?.isError ? (
            <p className="text-xs text-destructive flex items-center gap-1">
              <AlertTriangleIcon className="size-3.5" />
              {result.error || t("Common.error")}
            </p>
          ) : result?.results && result.results.length > 0 ? (
            <>
              {/* Compact summary view when collapsed */}
              {!isExpanded && (
                <div className="flex flex-wrap gap-1.5">
                  {result.results.slice(0, 3).map((item, i) => (
                    <HoverCard key={i} openDelay={200} closeDelay={0}>
                      <HoverCardTrigger asChild>
                        <div className="group rounded-full bg-secondary/60 px-2 py-1 text-xs cursor-pointer hover:bg-secondary transition-colors flex items-center gap-1.5 overflow-hidden max-w-full">
                          {item.source === "knowledge" ? (
                            <span className="px-1 py-0.5 rounded text-[10px] font-medium bg-green-500/20 text-green-600 dark:text-green-400 whitespace-nowrap flex-shrink-0">
                              KB
                            </span>
                          ) : item.source === "documents" ? (
                            <span className="px-1 py-0.5 rounded text-[10px] font-medium bg-orange-500/20 text-orange-600 dark:text-orange-400 whitespace-nowrap flex-shrink-0">
                              DOC
                            </span>
                          ) : (
                            <span
                              className={cn(
                                "px-1 py-0.5 rounded text-[10px] font-medium whitespace-nowrap flex-shrink-0",
                                item.role === "user"
                                  ? "bg-blue-500/20 text-blue-600 dark:text-blue-400"
                                  : "bg-purple-500/20 text-purple-600 dark:text-purple-400",
                              )}
                            >
                              {item.role}
                            </span>
                          )}
                          <span className="text-[10px] text-muted-foreground whitespace-nowrap flex-shrink-0">
                            {(item.score * 100).toFixed(0)}%
                          </span>
                          <span className="text-muted-foreground truncate min-w-0 flex-1 max-w-[200px]">
                            {truncateText(item.content, 25)}...
                          </span>
                        </div>
                      </HoverCardTrigger>
                      <HoverCardContent className="flex flex-col gap-2 p-4 max-w-md">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            {item.source === "knowledge" ? (
                              <span className="px-2 py-1 rounded text-xs font-medium bg-green-500/20 text-green-600 dark:text-green-400 whitespace-nowrap flex-shrink-0">
                                Knowledge Base
                              </span>
                            ) : item.source === "documents" ? (
                              <span className="px-2 py-1 rounded text-xs font-medium bg-orange-500/20 text-orange-600 dark:text-orange-400 whitespace-nowrap flex-shrink-0">
                                Document
                              </span>
                            ) : (
                              <span
                                className={cn(
                                  "px-2 py-1 rounded text-xs font-medium whitespace-nowrap flex-shrink-0",
                                  item.role === "user"
                                    ? "bg-blue-500/20 text-blue-600 dark:text-blue-400"
                                    : "bg-purple-500/20 text-purple-600 dark:text-purple-400",
                                )}
                              >
                                {item.role}
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">
                            Relevance: {(item.score * 100).toFixed(1)}%
                          </span>
                        </div>
                        {item.source === "knowledge" && item.fileName && (
                          <div className="text-xs text-muted-foreground">
                            <span className="font-medium">File:</span>{" "}
                            {extractFileName(item.fileName)}
                          </div>
                        )}
                        {item.source === "documents" && item.fileName && (
                          <div className="text-xs text-muted-foreground">
                            <span className="font-medium">File:</span>{" "}
                            {extractFileName(item.fileName)}
                          </div>
                        )}
                        {item.source === "documents" && (item as any).title && (
                          <div className="text-xs text-muted-foreground">
                            <span className="font-medium">Title:</span>{" "}
                            {(item as any).title}
                          </div>
                        )}
                        {item.source === "knowledge" &&
                          item.knowledgeBaseName && (
                            <div className="text-xs text-muted-foreground">
                              <span className="font-medium">
                                Knowledge Base:
                              </span>{" "}
                              {item.knowledgeBaseName}
                            </div>
                          )}
                        <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                          {item.content}
                        </p>
                      </HoverCardContent>
                    </HoverCard>
                  ))}
                  {result.results.length > 3 && (
                    <span className="text-xs text-muted-foreground px-2 py-1">
                      +{result.results.length - 3} more
                    </span>
                  )}
                </div>
              )}

              {/* Expanded detailed view */}
              {isExpanded && (
                <div
                  className="flex flex-col gap-2 w-full overflow-hidden min-w-0"
                  style={{ maxWidth: "100%", overflowX: "hidden" }}
                >
                  {result.results.map((item, i) => {
                    const truncatedContent =
                      item.content.length > 200
                        ? item.content.slice(0, 200) + "..."
                        : item.content;

                    return (
                      <HoverCard key={i} openDelay={200} closeDelay={0}>
                        <HoverCardTrigger asChild>
                          <div
                            className={cn(
                              "group rounded-lg bg-secondary p-3 text-xs cursor-pointer",
                              "hover:bg-input hover:ring hover:ring-blue-500 transition-all",
                              "overflow-hidden w-full", // Ensure content stays inside
                            )}
                            style={{
                              maxWidth: "100%",
                              overflowX: "hidden",
                              wordBreak: "break-word",
                            }}
                          >
                            <div className="flex flex-col gap-1.5 mb-1 w-full overflow-hidden min-w-0">
                              <div className="flex items-center gap-2 w-full overflow-hidden min-w-0">
                                {item.source === "knowledge" ? (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-500/20 text-green-600 dark:text-green-400 whitespace-nowrap flex-shrink-0">
                                    Knowledge Base
                                  </span>
                                ) : item.source === "documents" ? (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-500/20 text-orange-600 dark:text-orange-400 whitespace-nowrap flex-shrink-0">
                                    Document
                                  </span>
                                ) : (
                                  <span
                                    className={cn(
                                      "px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap flex-shrink-0",
                                      item.role === "user"
                                        ? "bg-blue-500/20 text-blue-600 dark:text-blue-400"
                                        : "bg-purple-500/20 text-purple-600 dark:text-purple-400",
                                    )}
                                  >
                                    {item.role}
                                  </span>
                                )}
                                <span className="text-[10px] text-muted-foreground whitespace-nowrap flex-shrink-0 ml-auto">
                                  {(item.score * 100).toFixed(0)}% match
                                </span>
                              </div>
                              {item.source === "knowledge" && item.fileName && (
                                <div
                                  className="text-[10px] text-muted-foreground w-full break-all"
                                  style={{
                                    wordBreak: "break-all",
                                    overflowWrap: "break-word",
                                  }}
                                >
                                  <span className="font-medium">File:</span>{" "}
                                  {extractFileName(item.fileName)}
                                </div>
                              )}
                              {item.source === "documents" && item.fileName && (
                                <div
                                  className="text-[10px] text-muted-foreground w-full break-all"
                                  style={{
                                    wordBreak: "break-all",
                                    overflowWrap: "break-word",
                                  }}
                                >
                                  <span className="font-medium">File:</span>{" "}
                                  {extractFileName(item.fileName)}
                                </div>
                              )}
                              {item.source === "documents" &&
                                (item as any).title && (
                                  <div
                                    className="text-[10px] text-muted-foreground w-full break-all"
                                    style={{
                                      wordBreak: "break-all",
                                      overflowWrap: "break-word",
                                    }}
                                  >
                                    <span className="font-medium">Title:</span>{" "}
                                    {(item as any).title}
                                  </div>
                                )}
                            </div>
                            <p
                              className="text-muted-foreground line-clamp-2 break-words overflow-hidden w-full"
                              style={{
                                maxWidth: "100%",
                                wordBreak: "break-word",
                                overflowWrap: "break-word",
                              }}
                            >
                              {truncatedContent}
                            </p>
                          </div>
                        </HoverCardTrigger>
                        <HoverCardContent className="flex flex-col gap-2 p-4 max-w-md w-full overflow-hidden">
                          <div className="flex flex-col gap-2 w-full overflow-hidden">
                            <div className="flex items-start gap-2 w-full overflow-hidden">
                              <div className="flex items-center gap-2 flex-1 min-w-0 overflow-hidden">
                                {item.source === "knowledge" ? (
                                  <>
                                    <span className="px-2 py-1 rounded text-xs font-medium bg-green-500/20 text-green-600 dark:text-green-400 whitespace-nowrap flex-shrink-0">
                                      Knowledge Base
                                    </span>
                                    {item.knowledgeBaseName && (
                                      <span className="text-xs text-muted-foreground truncate min-w-0">
                                        {truncateText(
                                          item.knowledgeBaseName,
                                          30,
                                        )}
                                      </span>
                                    )}
                                  </>
                                ) : item.source === "documents" ? (
                                  <>
                                    <span className="px-2 py-1 rounded text-xs font-medium bg-orange-500/20 text-orange-600 dark:text-orange-400 whitespace-nowrap flex-shrink-0">
                                      Document
                                    </span>
                                    {(item as any).title && (
                                      <span className="text-xs text-muted-foreground truncate min-w-0">
                                        {truncateText((item as any).title, 30)}
                                      </span>
                                    )}
                                  </>
                                ) : (
                                  <span
                                    className={cn(
                                      "px-2 py-1 rounded text-xs font-medium whitespace-nowrap flex-shrink-0",
                                      item.role === "user"
                                        ? "bg-blue-500/20 text-blue-600 dark:text-blue-400"
                                        : "bg-purple-500/20 text-purple-600 dark:text-purple-400",
                                    )}
                                  >
                                    {item.role}
                                  </span>
                                )}
                              </div>
                              <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">
                                {(item.score * 100).toFixed(1)}%
                              </span>
                            </div>
                          </div>
                          {item.source === "knowledge" && item.fileName && (
                            <div
                              className="text-xs text-muted-foreground w-full break-all"
                              style={{
                                wordBreak: "break-all",
                                overflowWrap: "break-word",
                              }}
                            >
                              <span className="font-medium">File:</span>{" "}
                              {extractFileName(item.fileName)}
                            </div>
                          )}
                          {item.source === "documents" && item.fileName && (
                            <div
                              className="text-xs text-muted-foreground w-full break-all"
                              style={{
                                wordBreak: "break-all",
                                overflowWrap: "break-word",
                              }}
                            >
                              <span className="font-medium">File:</span>{" "}
                              {extractFileName(item.fileName)}
                            </div>
                          )}
                          {item.source === "documents" &&
                            (item as any).title && (
                              <div className="text-xs text-muted-foreground">
                                <span className="font-medium">Title:</span>{" "}
                                {(item as any).title}
                              </div>
                            )}
                          {item.threadId && (
                            <div className="text-xs text-muted-foreground">
                              <span className="font-medium">Thread:</span>{" "}
                              {item.threadId.slice(0, 8)}...
                            </div>
                          )}
                          {item.createdAt && (
                            <div className="text-xs text-muted-foreground">
                              <span className="font-medium">Date:</span>{" "}
                              {new Date(item.createdAt).toLocaleString()}
                            </div>
                          )}
                          <div className="relative mt-2">
                            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent to-card from-80%" />
                            <p className="text-xs text-muted-foreground max-h-60 overflow-y-auto whitespace-pre-wrap">
                              {item.content}
                            </p>
                          </div>
                        </HoverCardContent>
                      </HoverCard>
                    );
                  })}
                </div>
              )}

              {/* Expand/Collapse button */}
              <Button
                variant="ghost"
                size="sm"
                className="w-fit h-7 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setIsExpanded(!isExpanded)}
              >
                {isExpanded ? (
                  <>
                    <ChevronUpIcon className="size-3 mr-1" />
                    Collapse
                  </>
                ) : (
                  <>
                    <ChevronDownIcon className="size-3 mr-1" />
                    Show all {result.results.length} results
                  </>
                )}
              </Button>

              {result.elapsedMs > 0 && (
                <p className="text-xs text-muted-foreground ml-1">
                  Searched in {result.elapsedMs}ms
                </p>
              )}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t("Chat.Tool.noRelevantContext")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function areEqual(
  { part: prevPart }: RememberContextToolInvocationProps,
  { part: nextPart }: RememberContextToolInvocationProps,
) {
  if (prevPart.state != nextPart.state) return false;
  if (!equal(prevPart.input, nextPart.input)) return false;
  if (
    prevPart.state.startsWith("output") &&
    !equal(prevPart.output, toAny(nextPart).output)
  )
    return false;
  return true;
}

export const RememberContextToolInvocation = memo(
  PureRememberContextToolInvocation,
  areEqual,
);
