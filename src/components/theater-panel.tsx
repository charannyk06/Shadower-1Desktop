"use client";

import { useAppStore } from "@/app/store";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { useThreadFileUploader } from "@/hooks/use-thread-file-uploader";
import {
  type OfficeFileType,
  convertOfficeFileToHtml,
  detectOfficeFileType,
} from "@/lib/office-file-converter";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  Box,
  ChevronRight,
  Download,
  ExternalLink,
  FileIcon,
  FolderIcon,
  Layout,
  Loader2,
  Maximize2,
  Minimize2,
  Search,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { FileTypeIcon } from "./file-type-icon";
import { BrowserPreview } from "./theater/browser-preview";
import { DesktopPreview } from "./theater/desktop-preview";

// Interface for sandbox files from API
interface SandboxFileMetadata {
  name: string;
  size: number;
  type: string;
  source: "user" | "generated";
  storageKey?: string;
  url?: string;
  uploadedAt: string;
}

// Helper functions to reduce cognitive complexity
function deduplicateArtifacts(artifacts: any[]): any[] {
  const seen = new Map<string, any>();
  const uniqueArtifacts: any[] = [];

  artifacts.forEach((a, index) => {
    const keys = [
      a.filename,
      a.id,
      a.url,
      a.name,
      a.title,
      `index-${index}`,
    ].filter(Boolean);

    const alreadySeen = keys.some((key) => key && seen.has(key));

    if (!alreadySeen) {
      uniqueArtifacts.push(a);
      keys.forEach((key) => {
        if (key) seen.set(key, a);
      });
    }
  });

  return uniqueArtifacts;
}

function processArtifactContent(artifact: any): string {
  let content =
    artifact.url || artifact.content || artifact.value || artifact.data;

  if (
    artifact.data &&
    artifact.mediaType &&
    typeof content === "string" &&
    !content.startsWith("http") &&
    !content.startsWith("data:") &&
    !content.startsWith("blob:") &&
    !content.startsWith("/")
  ) {
    content = `data:${artifact.mediaType};base64,${artifact.data}`;
  }

  return content;
}

function getArtifactDisplayName(artifact: any): string {
  return (
    artifact.filename ||
    artifact.name ||
    artifact.title ||
    (artifact.url ? artifact.url.split("/").pop() : undefined) ||
    (artifact.content &&
    typeof artifact.content === "string" &&
    artifact.content.length < 50
      ? artifact.content
      : undefined) ||
    "Untitled"
  );
}

function processArtifacts(uniqueArtifacts: any[]): any[] {
  return uniqueArtifacts.map((a) => {
    const content = processArtifactContent(a);
    const displayName = getArtifactDisplayName(a);

    return {
      ...a,
      _source: "artifact",
      id: a.id || `art-${crypto.randomUUID()}`,
      createdAt: a.createdAt || new Date().toISOString(),
      content,
      filename: a.filename || displayName,
      name: a.name || displayName,
      title: a.title || displayName,
    };
  });
}

function extractStorageKeyFromUrl(url: string): string | undefined {
  try {
    const urlObj = new URL(url);
    return urlObj.pathname.slice(1);
  } catch {
    return url;
  }
}

export function TheaterPanel() {
  const {
    theaterMode,
    threadFiles,
    currentThreadId,
    mutate: appStoreMutate,
    filesVersion,
  } = useAppStore(
    useShallow((state) => ({
      theaterMode: state.theaterMode,
      threadFiles: state.threadFiles,
      currentThreadId: state.currentThreadId,
      mutate: state.mutate,
      filesVersion: state.theaterMode.filesVersion || 0,
    })),
  );

  const [activeTab, setActiveTab] = useState<"preview" | "files">(
    theaterMode.defaultTab || "preview",
  );
  const [isMaximized, setIsMaximized] = useState(false);
  const [sandboxFiles, setSandboxFiles] = useState<SandboxFileMetadata[]>([]);
  const [sandboxFilesLoading, setSandboxFilesLoading] = useState(false);
  const { uploadFiles } = useThreadFileUploader(currentThreadId || undefined);
  const isMobile = useIsMobile();

  // Fetch sandbox files from API when theater opens, thread changes, or sandbox files version changes
  useEffect(() => {
    if (!currentThreadId) {
      setSandboxFiles([]);
      return;
    }

    // Always fetch when theater is open
    // This ensures we get the latest files every time the panel is opened
    if (!theaterMode.isOpen) {
      return;
    }

    let cancelled = false;
    setSandboxFilesLoading(true);

    console.log(
      "[TheaterPanel] Fetching sandbox files for thread:",
      currentThreadId,
      "version:",
      filesVersion,
    );

    // Use Electron IPC if available - this is an Electron desktop app
    const api =
      typeof window !== "undefined" ? (window as any).electronAPI : null;

    if (api?.files?.listFiles) {
      // Use IPC to list sandbox files
      api.files
        .listFiles("sandbox")
        .then((files: any[]) => {
          if (cancelled) return;
          // Filter files for this thread (if they have thread metadata)
          const threadFiles = files.filter(
            (f: any) => !f.threadId || f.threadId === currentThreadId,
          );
          console.log(
            "[TheaterPanel] Received sandbox files via IPC:",
            threadFiles.length,
          );
          setSandboxFiles(threadFiles);
        })
        .catch((err: Error) => {
          if (cancelled) return;
          console.error("Failed to load sandbox files via IPC:", err);
          setSandboxFiles([]);
        })
        .finally(() => {
          if (!cancelled) setSandboxFilesLoading(false);
        });
    } else {
      // No Electron API available - just return empty array
      // In Electron desktop app, HTTP endpoints require auth that's handled via IPC
      console.log(
        "[TheaterPanel] Electron API not available, skipping sandbox files fetch",
      );
      setSandboxFiles([]);
      setSandboxFilesLoading(false);
    }

    return () => {
      cancelled = true;
    };
  }, [theaterMode.isOpen, currentThreadId, filesVersion]);

  const isUploading = useMemo(() => {
    const files = threadFiles[currentThreadId || ""] || [];
    return files.some((f) => f.isUploading);
  }, [threadFiles, currentThreadId]);

  // Combine Artifacts + Uploaded Files
  const allItems = useMemo(() => {
    const threadArtifacts = theaterMode.threadArtifacts || {};
    const currentThreadArtifacts = threadArtifacts[currentThreadId || ""] || [];

    const allArtifacts = [
      ...currentThreadArtifacts,
      ...(theaterMode.executionArtifacts || []),
    ];

    const uniqueArtifacts = deduplicateArtifacts(allArtifacts);
    const artifacts = processArtifacts(uniqueArtifacts);

    const uploads = (threadFiles[currentThreadId || ""] || []).map((u) => ({
      ...u,
      _source: "upload",
      title: u.name,
      type: u.mimeType?.startsWith("image") ? "image" : "file",
      content: u.url,
      createdAt: new Date().toISOString(),
    }));

    const sandboxFileItems = sandboxFiles.map((f) => {
      const storageKey = f.url ? extractStorageKeyFromUrl(f.url) : undefined;

      return {
        _source: "sandbox" as const,
        id: `sandbox-${f.name}-${f.uploadedAt}`,
        title: f.name,
        name: f.name,
        filename: f.name,
        type: f.type?.startsWith("image") ? "image" : "file",
        content: f.url,
        url: f.url,
        storageKey,
        size: f.size,
        mimeType: f.type, // Include mimeType for Collabora support
        createdAt: f.uploadedAt,
        sandboxSource: f.source, // 'user' or 'generated'
      };
    });

    // Deduplicate: sandbox files may overlap with uploads or artifacts
    const allCombined = [...artifacts, ...uploads, ...sandboxFileItems];
    const seenNames = new Set<string>();
    const deduplicated = allCombined.filter((item) => {
      const name = item.filename || item.name || item.title;
      if (!name || seenNames.has(name)) return false;
      seenNames.add(name);
      return true;
    });

    return deduplicated;
  }, [
    theaterMode.threadArtifacts,
    theaterMode.executionArtifacts,
    threadFiles,
    currentThreadId,
    sandboxFiles,
  ]);

  // Auto-switch logic - respect defaultTab when theater opens
  useEffect(() => {
    if (theaterMode.isOpen && theaterMode.defaultTab) {
      setActiveTab(theaterMode.defaultTab);
    } else if (theaterMode.content) {
      setActiveTab("preview");
    }
  }, [theaterMode.isOpen, theaterMode.defaultTab, theaterMode.content]);

  // Merge executionArtifacts into thread-scoped threadArtifacts when theater mode opens
  useEffect(() => {
    if (
      theaterMode.isOpen &&
      theaterMode.executionArtifacts &&
      theaterMode.executionArtifacts.length > 0 &&
      currentThreadId
    ) {
      appStoreMutate((state) => {
        const threadArtifacts = state.theaterMode.threadArtifacts || {};
        const existing = threadArtifacts[currentThreadId] || [];
        const executionArtifacts = theaterMode.executionArtifacts || [];

        // Deduplicate and merge
        const seen = new Set<string>();
        const merged = [...existing];

        executionArtifacts.forEach((art: any) => {
          const key = art.filename || art.id || art.url || art.content;
          if (key && !seen.has(key)) {
            seen.add(key);
            const exists = existing.some(
              (e: any) => (e.filename || e.id || e.url || e.content) === key,
            );
            if (!exists) {
              merged.push(art);
            }
          }
        });

        return {
          theaterMode: {
            ...state.theaterMode,
            threadArtifacts: {
              ...threadArtifacts,
              [currentThreadId]: merged,
            },
          },
        };
      });
    }
  }, [
    theaterMode.isOpen,
    theaterMode.executionArtifacts,
    appStoreMutate,
    currentThreadId,
  ]);

  const handleClose = () => {
    appStoreMutate((state) => ({
      theaterMode: { ...state.theaterMode, isOpen: false },
    }));
  };

  const handleDownloadCurrent = () => {
    const c = theaterMode.content;
    if (!c) return;

    const title = theaterMode.title || "download";
    const isUrl =
      typeof c === "string" &&
      (c.startsWith("http") ||
        c.startsWith("blob:") ||
        c.startsWith("data:") ||
        c.startsWith("/"));

    const link = document.createElement("a");
    if (isUrl) {
      link.href = c;
    } else {
      // Fallback for text content
      const blob = new Blob([typeof c === "string" ? c : JSON.stringify(c)], {
        type: "text/plain",
      });
      link.href = URL.createObjectURL(blob);
    }
    link.download = title;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) {
      await uploadFiles(Array.from(e.target.files));
      toast.success("Files uploaded");
      setActiveTab("files");
    }
  };

  if (!theaterMode.isOpen) return null;

  return (
    <div
      className={cn(
        "bg-[#0A0A0A]/95 backdrop-blur-2xl flex flex-col overflow-hidden relative shadow-[0_32px_64px_-12px_rgba(0,0,0,0.5)] border border-white/5 ring-1 ring-white/5 transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]",
        (() => {
          if (isMaximized) {
            return "fixed inset-4 z-[100] rounded-[24px] md:rounded-[24px]";
          }
          if (isMobile) {
            return "h-full w-full rounded-lg";
          }
          return "h-full w-full rounded-[40px] md:rounded-[40px]";
        })(),
      )}
    >
      {/* Hidden File Input */}
      <input
        type="file"
        multiple
        className="hidden"
        ref={fileInputRef}
        onChange={onFileChange}
      />

      {/* --- Ambient Glows --- */}
      <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-white/10 to-transparent z-20" />
      <div className="absolute top-0 right-0 w-[1px] h-full bg-gradient-to-b from-transparent via-white/5 to-transparent z-20" />

      {/* --- Header --- */}
      <div
        className={cn(
          "flex-none border-b border-white/5 bg-white/5 relative z-30",
          isMobile ? "h-auto min-h-12 px-2 py-2" : "h-14 px-4",
          "flex items-center justify-between",
        )}
      >
        <div className="flex items-center gap-3 min-w-0 flex-1 pr-4">
          <div className="flex items-center justify-center rounded-full bg-black/40 border border-white/10 shadow-inner flex-shrink-0 p-2 xl:gap-2.5 xl:px-3 xl:py-1.5 xl:justify-start">
            <Box className="w-4 h-4 xl:w-3.5 xl:h-3.5 text-primary/80 flex-shrink-0" />
            <span className="hidden xl:inline text-xs font-medium tracking-wide bg-gradient-to-r from-white/90 to-white/60 bg-clip-text text-transparent uppercase whitespace-nowrap">
              Theater Mode
            </span>
          </div>
          {theaterMode.title && !isMobile && (
            <>
              <div className="h-4 w-[1px] bg-white/10 flex-shrink-0" />
              <span className="text-sm font-medium text-white/70 truncate max-w-[200px]">
                {theaterMode.title}
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-3 flex-shrink-0">
          {/* Tab Switcher */}
          <div
            className={cn(
              "flex items-center rounded-full bg-black/40 border border-white/10",
              isMobile ? "p-0.5 gap-0.5" : "p-1 gap-1.5",
            )}
          >
            <button
              onClick={() => setActiveTab("preview")}
              className={cn(
                "rounded-full text-xs font-medium transition-all duration-300 relative overflow-visible whitespace-nowrap",
                isMobile ? "px-2 py-1" : "px-4 py-1.5",
                activeTab === "preview"
                  ? "text-black shadow-[0_0_15px_rgba(255,255,255,0.3)]"
                  : "text-white/50 hover:text-white/80",
              )}
            >
              {activeTab === "preview" && (
                <motion.div
                  layoutId="activeTab"
                  className="absolute inset-0 bg-white rounded-full z-0"
                  transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                />
              )}
              <span className="relative z-10 flex items-center gap-2">
                {!isMobile && <Layout className="w-3 h-3 flex-shrink-0" />}
                <span className={isMobile ? "text-[10px]" : ""}>Preview</span>
              </span>
            </button>
            <button
              onClick={() => setActiveTab("files")}
              className={cn(
                "rounded-full text-xs font-medium transition-all duration-300 relative overflow-visible whitespace-nowrap",
                isMobile ? "px-2 py-1" : "px-4 py-1.5",
                activeTab === "files"
                  ? "text-black shadow-[0_0_15px_rgba(255,255,255,0.3)]"
                  : "text-white/50 hover:text-white/80",
              )}
            >
              {activeTab === "files" && (
                <motion.div
                  layoutId="activeTab"
                  className="absolute inset-0 bg-white rounded-full z-0"
                  transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                />
              )}
              <span className="relative z-10 flex items-center gap-2">
                {!isMobile && <Box className="w-3 h-3 flex-shrink-0" />}
                <span className={isMobile ? "text-[10px]" : ""}>
                  {isMobile ? `Files` : `Files (${allItems.length})`}
                </span>
              </span>
            </button>
          </div>

          {!isMobile && (
            <>
              <div className="h-4 w-[1px] bg-white/10 mx-2" />

              {/* Open in New Tab Button - for app/iframe previews */}
              {activeTab === "preview" &&
                theaterMode.type === "app" &&
                theaterMode.content && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-full hover:bg-white/10 text-white/50 hover:text-white"
                    onClick={() => {
                      const url =
                        typeof theaterMode.content === "string"
                          ? theaterMode.content
                          : theaterMode.content?.url;
                      if (url) {
                        window.open(url, "_blank", "noopener,noreferrer");
                      }
                    }}
                    title="Open in New Tab"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </Button>
                )}

              {/* Download Button */}
              {activeTab === "files" && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-full hover:bg-white/10 text-white/50 hover:text-white"
                  onClick={handleDownloadCurrent}
                  title="Download Current File"
                >
                  <Download className="w-4 h-4" />
                </Button>
              )}

              {/* Maximize Toggle */}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full hover:bg-white/10 text-white/50 hover:text-white"
                onClick={() => setIsMaximized(!isMaximized)}
              >
                {isMaximized ? (
                  <Minimize2 className="w-4 h-4" />
                ) : (
                  <Maximize2 className="w-4 h-4" />
                )}
              </Button>
            </>
          )}

          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "rounded-full hover:bg-white/10 text-white/50 hover:text-white",
              isMobile ? "h-7 w-7" : "h-8 w-8",
            )}
            onClick={handleClose}
          >
            <X className={isMobile ? "w-3.5 h-3.5" : "w-4 h-4"} />
          </Button>
        </div>
      </div>

      {/* --- Content Area --- */}
      <div className="flex-1 w-full min-h-0 bg-[#0E0E0E] relative z-10">
        <AnimatePresence mode="wait">
          {activeTab === "preview" ? (
            <motion.div
              key="preview"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.3 }}
              className={cn("h-full w-full", isMobile ? "p-2" : "p-4")}
            >
              <PreviewContent
                theaterMode={theaterMode}
                threadId={currentThreadId}
              />
            </motion.div>
          ) : (
            <motion.div
              key="files"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
              className={cn("h-full w-full", isMobile ? "p-2" : "p-4")}
            >
              <div
                className={cn(
                  "h-full w-full overflow-hidden border border-white/10 bg-[#0A0A0A] flex flex-col relative",
                  isMobile ? "rounded-lg" : "rounded-2xl",
                )}
              >
                <div
                  className={cn(
                    "border-b border-white/5 flex items-center justify-between bg-white/5",
                    isMobile ? "h-10 px-2" : "h-12 px-4",
                  )}
                >
                  <span
                    className={cn(
                      "font-medium text-white/50 uppercase tracking-widest",
                      isMobile ? "text-[10px]" : "text-xs",
                    )}
                  >
                    Workspace Files
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className={cn(
                      "border border-white/10 hover:bg-white/10 text-white/70",
                      isMobile ? "h-6 text-[10px] px-2" : "h-7 text-xs",
                    )}
                    onClick={handleUploadClick}
                    disabled={isUploading}
                  >
                    {isUploading ? (
                      <Loader2
                        className={cn(
                          "animate-spin",
                          isMobile ? "w-2.5 h-2.5 mr-0.5" : "w-3 h-3 mr-1",
                        )}
                      />
                    ) : (
                      <Upload
                        className={cn(
                          isMobile ? "w-2.5 h-2.5 mr-0.5" : "w-3 h-3 mr-1",
                        )}
                      />
                    )}
                    Upload
                  </Button>
                </div>
                <div
                  className={cn(
                    "flex-1 overflow-y-auto custom-scrollbar",
                    isMobile ? "p-2" : "p-4",
                  )}
                >
                  {(() => {
                    if (sandboxFilesLoading) {
                      return (
                        <div className="h-full flex flex-col items-center justify-center text-white/30 gap-4">
                          <Loader2 className="w-8 h-8 animate-spin" />
                          <span className="text-xs font-mono uppercase tracking-widest">
                            Loading Files...
                          </span>
                        </div>
                      );
                    }
                    if (allItems.length === 0) {
                      return (
                        <div className="h-full flex flex-col items-center justify-center text-white/20 gap-4">
                          <Box className="w-12 h-12 stroke-1" />
                          <span className="text-xs font-mono uppercase tracking-widest">
                            No Artifacts / Files
                          </span>
                        </div>
                      );
                    }
                    return null;
                  })()}
                  {!sandboxFilesLoading && allItems.length > 0 && (
                    <FileExplorer
                      items={allItems}
                      onSelect={(item) => {
                        // Auto-detect types based on filename/name
                        const n = (
                          item.filename ||
                          item.name ||
                          ""
                        ).toLowerCase();
                        const isHtml = n.match(/\.(html|htm|svg)$/);
                        const isPdf = n.endsWith(".pdf");
                        const isOffice = n.match(
                          /\.(docx|doc|pptx|ppt|xlsx|xls)$/,
                        );
                        const isCode = n.match(
                          /\.(js|jsx|ts|tsx|py|css|scss|sass|less|json|yaml|yml|xml|sql|sh|bash|zsh|go|rs|rb|php|java|c|cpp|h|hpp|cs|swift|kt|scala|r|lua|pl|pm|ex|exs|erl|hrl|clj|cljs|hs|elm|vue|svelte|astro|graphql|gql|toml|ini|cfg|conf|env|gitignore|dockerfile|makefile|cmake|gradle|maven|gemfile|cargo|package|requirements|pipfile|poetry)$/,
                        );
                        const isText = n.match(
                          /\.(txt|text|md|markdown|rst|log|csv)$/,
                        );

                        // Determine file type
                        let fileType:
                          | "image"
                          | "pdf"
                          | "office"
                          | "app"
                          | "chart"
                          | "file" = "file";
                        if (item.type === "image") {
                          fileType = "image";
                        } else if (isPdf) {
                          fileType = "pdf";
                        } else if (isOffice) {
                          fileType = "office";
                        } else if (item.type === "app" || isHtml) {
                          fileType = "app";
                        } else if (isCode || isText) {
                          fileType = "file";
                        }

                        appStoreMutate((state) => ({
                          theaterMode: {
                            ...state.theaterMode,
                            content: item.content || item.url,
                            type: fileType,
                            title: item.title || item.name || item.filename,
                            defaultTab: "preview", // Override defaultTab when clicking a file
                            // Store file metadata for Collabora editing
                            fileMetadata: {
                              storageKey: item.storageKey,
                              name: item.name || item.filename || item.title,
                              size: item.size,
                              mimeType:
                                item.mimeType || item.mediaType || item.type,
                            },
                          },
                        }));
                      }}
                    />
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function PreviewContent({
  theaterMode,
  threadId,
}: {
  readonly theaterMode: any;
  threadId?: string | null;
}) {
  const {
    type,
    content,
    title,
    browserSession,
    desktopSession,
    researchTask,
    fileMetadata,
  } = theaterMode;
  const [officeHtml, setOfficeHtml] = useState<string | null>(null);
  const [officeLoading, setOfficeLoading] = useState(false);
  const [officeError, setOfficeError] = useState<string | null>(null);
  const [textFileContent, setTextFileContent] = useState<string | null>(null);
  const [textFileLoading, setTextFileLoading] = useState(false);
  const [htmlContent, setHtmlContent] = useState<string | null>(null);
  const [htmlLoading, setHtmlLoading] = useState(false);
  const [_pdfError, _setPdfError] = useState(false);
  const [pdfError, setPdfError] = useState(false);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);

  // Robustly extract content string for code/text views
  const textContent = useMemo(() => {
    if (!content) return "";
    if (typeof content === "string") return content;
    if (content.content && typeof content.content === "string")
      return content.content;
    if (content.text && typeof content.text === "string") return content.text;
    return JSON.stringify(content, null, 2);
  }, [content]);

  // Robustly extract URL for app/image views
  const urlContent = useMemo(() => {
    if (!content) return undefined;
    const c =
      typeof content === "string" ? content : content.url || content.content;

    if (typeof c === "string") {
      const trimmed = c.trim();
      if (
        trimmed.startsWith("http") ||
        trimmed.startsWith("blob:") ||
        trimmed.startsWith("data:") ||
        trimmed.startsWith("/")
      ) {
        return trimmed;
      }
    }
    return undefined;
  }, [content]);

  // Detect office file type from title/filename
  const officeFileType = useMemo((): OfficeFileType | null => {
    if (type !== "office") return null;
    return detectOfficeFileType(title || urlContent);
  }, [type, title, urlContent]);

  // Convert local office files to HTML (including PPTX)
  useEffect(() => {
    let cancelled = false;

    if (type === "office" && urlContent && officeFileType) {
      // Reset state and start conversion for all office file types (including PPTX)
      setOfficeHtml(null);
      setOfficeError(null);
      setOfficeLoading(true);

      // Perform conversion for all office file types
      convertOfficeFileToHtml(urlContent, officeFileType, {
        maxSize: 50 * 1024 * 1024, // 50MB
        timeout: 30000, // 30 seconds
      })
        .then((result) => {
          // Prevent state updates if component unmounted or content changed
          if (cancelled) return;

          if (result.success && result.html) {
            setOfficeHtml(result.html);
            setOfficeError(null);
          } else {
            setOfficeError(result.error || "Failed to convert office file");
            setOfficeHtml(null);
          }
        })
        .catch((error) => {
          // Prevent state updates if component unmounted or content changed
          if (cancelled) return;

          console.error("Office file conversion error:", error);
          setOfficeError(
            error instanceof Error
              ? error.message
              : "Failed to convert office file",
          );
          setOfficeHtml(null);
        })
        .finally(() => {
          if (!cancelled) {
            setOfficeLoading(false);
          }
        });
    } else {
      // Not an office file - reset state
      setOfficeHtml(null);
      setOfficeError(null);
      setOfficeLoading(false);
    }

    // Cleanup function to prevent race conditions
    return () => {
      cancelled = true;
    };
  }, [type, urlContent, officeFileType]);

  // Fetch HTML content from URLs (especially blob storage) to avoid download issues
  useEffect(() => {
    let cancelled = false;

    // Check if textContent is actually HTML or just a URL string
    const isTextContentJustUrl =
      textContent &&
      (textContent.startsWith("http://") ||
        textContent.startsWith("https://") ||
        textContent.startsWith("blob:") ||
        textContent.startsWith("data:"));

    // Always fetch HTML content from external URLs to ensure proper rendering
    // This prevents download issues (Vercel Blob sets Content-Disposition: attachment)
    // and allows us to inject CSP meta tags for script execution
    if (
      type === "app" &&
      urlContent &&
      (!textContent || isTextContentJustUrl) &&
      (urlContent.startsWith("http://") || urlContent.startsWith("https://")) &&
      (title?.toLowerCase().endsWith(".html") ||
        title?.toLowerCase().endsWith(".htm") ||
        title?.toLowerCase().endsWith(".svg") ||
        urlContent.includes(".html") ||
        urlContent.includes(".htm") ||
        urlContent.includes(".svg"))
    ) {
      setHtmlLoading(true);
      setHtmlContent(null);

      // In desktop mode, we fetch directly - CORS is not an issue
      const fetchUrl = urlContent;

      fetch(fetchUrl)
        .then((res) => {
          if (cancelled) return;
          if (!res.ok) throw new Error(`Failed to fetch: ${res.statusText}`);
          return res.text();
        })
        .then((html) => {
          if (cancelled) return;
          if (!html) {
            setHtmlContent(null);
            setHtmlLoading(false);
            return;
          }

          // Don't inject CSP meta tag - it breaks script execution in srcDoc iframes
          // because 'self' has no meaning when origin is null (srcDoc context)
          // The iframe sandbox attribute already provides security isolation
          setHtmlContent(html);
          setHtmlLoading(false);
        })
        .catch((error) => {
          if (cancelled) return;
          console.error("Failed to fetch HTML content:", error);
          setHtmlContent(null);
          setHtmlLoading(false);
        });
    } else if (type !== "app" || !urlContent) {
      // Reset state if not an app type or no URL
      setHtmlContent(null);
      setHtmlLoading(false);
    }

    return () => {
      cancelled = true;
    };
  }, [type, urlContent, title, textContent]);

  // Fetch text/code file content from URL if needed
  useEffect(() => {
    let cancelled = false;

    // Check if it's a text file that needs fetching
    const isTextFile =
      title?.toLowerCase().endsWith(".txt") ||
      title?.toLowerCase().endsWith(".text") ||
      title?.toLowerCase().endsWith(".md") ||
      title?.toLowerCase().endsWith(".markdown");

    // Check if this is a code or text type that needs content fetching
    const needsContentFetch =
      type === "code" || type === "text" || (type === "file" && isTextFile);

    // Check if URL is fetchable (absolute or relative)
    const isFetchableUrl =
      urlContent &&
      (urlContent.startsWith("http://") ||
        urlContent.startsWith("https://") ||
        urlContent.startsWith("/"));

    // Fetch if it's a text/code file with URL and we don't have content yet
    if (
      needsContentFetch &&
      isFetchableUrl &&
      (!textContent || textContent.length === 0 || textContent === urlContent)
    ) {
      setTextFileLoading(true);
      setTextFileContent(null);

      // In desktop mode, we fetch directly - CORS is not an issue
      // Fetch the text content
      fetch(urlContent)
        .then((res) => {
          if (cancelled) return;
          if (!res.ok) throw new Error(`Failed to fetch: ${res.statusText}`);
          return res.text();
        })
        .then((text) => {
          if (cancelled) return;
          setTextFileContent(text || null);
          setTextFileLoading(false);
        })
        .catch((error) => {
          if (cancelled) return;
          console.error("Failed to fetch text/code file:", error);
          setTextFileContent(null);
          setTextFileLoading(false);
        });
    } else if (!needsContentFetch) {
      // Reset state if not a text/code file
      setTextFileContent(null);
      setTextFileLoading(false);
    }

    return () => {
      cancelled = true;
    };
  }, [type, urlContent, title, textContent]);

  // Fetch PDF as blob to bypass Content-Disposition: attachment from Vercel Blob Storage
  useEffect(() => {
    let cancelled = false;

    if (
      type === "pdf" &&
      urlContent &&
      (urlContent.startsWith("http://") || urlContent.startsWith("https://")) &&
      !urlContent.startsWith("blob:")
    ) {
      setPdfLoading(true);
      setPdfBlobUrl(null);
      setPdfError(false);

      // In desktop mode, we fetch directly - CORS is not an issue
      const fetchUrl = urlContent;

      fetch(fetchUrl)
        .then((res) => {
          if (cancelled) return;
          if (!res.ok)
            throw new Error(`Failed to fetch PDF: ${res.statusText}`);
          return res.blob();
        })
        .then((blob) => {
          if (cancelled || !blob) return;
          const blobUrl = URL.createObjectURL(blob);
          setPdfBlobUrl(blobUrl);
          setPdfLoading(false);
        })
        .catch((error) => {
          if (cancelled) return;
          console.error("Failed to fetch PDF:", error);
          setPdfBlobUrl(null);
          setPdfLoading(false);
          setPdfError(true);
        });
    } else if (type !== "pdf") {
      // Cleanup blob URL when switching away from PDF
      if (pdfBlobUrl) {
        URL.revokeObjectURL(pdfBlobUrl);
        setPdfBlobUrl(null);
      }
      setPdfLoading(false);
    }

    return () => {
      cancelled = true;
    };
  }, [type, urlContent]);

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (pdfBlobUrl) {
        URL.revokeObjectURL(pdfBlobUrl);
      }
    };
  }, [pdfBlobUrl]);

  // Browser preview - uses browserSession state instead of content
  if (type === "browser" && browserSession?.sessionId) {
    return (
      <BrowserPreview
        sessionId={browserSession.sessionId}
        provider={browserSession.provider}
        initialUrl={browserSession.currentUrl}
        replayUrl={browserSession.replayUrl}
        className="h-full w-full"
      />
    );
  }

  // Desktop preview - uses desktopSession state from local terminal
  if (type === "desktop" && desktopSession?.sessionId) {
    return (
      <DesktopPreview
        sessionId={desktopSession.sessionId}
        streamUrl={desktopSession.streamUrl}
        authKey={desktopSession.authKey}
        className="h-full w-full"
      />
    );
  }

  // Research progress placeholder - will be implemented with research agent
  if (type === "research" && researchTask?.taskId) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center text-white/30 gap-4">
        <div className="w-24 h-24 rounded-3xl bg-white/5 flex items-center justify-center border border-white/5 relative overflow-hidden">
          <Search className="w-10 h-10 opacity-50" />
        </div>
        <p className="font-mono text-xs tracking-widest uppercase">
          Research In Progress
        </p>
        <p className="text-xs text-white/20">{researchTask.query}</p>
        <p className="text-xs text-white/40">Status: {researchTask.status}</p>
      </div>
    );
  }

  if (!content) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center text-white/30 gap-4">
        <div className="w-24 h-24 rounded-3xl bg-white/5 flex items-center justify-center border border-white/5 relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-tr from-primary/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
          <Box className="w-10 h-10 opacity-50" />
        </div>
        <p className="font-mono text-xs tracking-widest uppercase">
          No Content Selected
        </p>
      </div>
    );
  }

  if (type === "image" && urlContent) {
    return (
      <div className="h-full w-full flex items-center justify-center relative rounded-2xl overflow-hidden border border-white/10 bg-black/20 group">
        <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-20" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={urlContent}
          alt="Preview"
          className="object-contain max-h-full max-w-full p-4 transition-transform duration-500 group-hover:scale-105"
        />
      </div>
    );
  }

  if (type === "pdf" && urlContent) {
    // Use blob URL if available (fetched to bypass Content-Disposition: attachment)
    const pdfSrc = pdfBlobUrl || urlContent;

    return (
      <div className="h-full w-full rounded-2xl overflow-hidden border border-white/10 bg-white relative shadow-2xl flex flex-col">
        <div className="h-8 bg-[#f0f0f0] border-b border-gray-200 flex items-center px-4 justify-between">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
            <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
          </div>
          <div className="text-[10px] text-gray-400 font-mono">PDF Preview</div>
          <a
            href={urlContent}
            download={title || "file.pdf"}
            className="text-gray-400 hover:text-black transition-colors"
            title="Download PDF"
          >
            <Download className="w-3.5 h-3.5" />
          </a>
        </div>
        <div className="flex-1 w-full bg-white relative">
          {pdfLoading ? (
            <div className="h-full w-full flex flex-col items-center justify-center text-gray-500 gap-4">
              <Loader2 className="w-12 h-12 animate-spin opacity-50" />
              <p className="text-sm">Loading PDF...</p>
            </div>
          ) : pdfError ? (
            <div className="h-full w-full flex flex-col items-center justify-center text-gray-500 gap-4">
              <AlertCircle className="w-12 h-12 opacity-50" />
              <div className="text-center space-y-2">
                <p className="font-medium">Failed to load PDF</p>
                <p className="text-xs opacity-70">
                  The PDF cannot be displayed in the browser
                </p>
                <a
                  href={urlContent}
                  download={title || "file.pdf"}
                  className="text-xs text-primary hover:underline flex items-center gap-1 justify-center mt-4"
                >
                  <Download className="w-3 h-3" />
                  Download PDF
                </a>
              </div>
            </div>
          ) : (
            <iframe
              src={pdfSrc}
              className="w-full h-full border-0"
              title="PDF Preview"
              allow="fullscreen"
            />
          )}
        </div>
      </div>
    );
  }

  if (type === "office" && urlContent) {
    const isRemote =
      urlContent.startsWith("http") &&
      !urlContent.startsWith("http://localhost");

    // Fallback: Remote files use Google Docs Viewer
    if (isRemote) {
      return (
        <div className="h-full w-full rounded-2xl overflow-hidden border border-white/10 bg-white relative shadow-2xl flex flex-col">
          <div className="h-8 bg-[#f0f0f0] border-b border-gray-200 flex items-center px-4 justify-between">
            <div className="flex gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
              <div className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
              <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
            </div>
            <div className="text-[10px] text-gray-400 font-mono">
              Office Preview (Fallback)
            </div>
            <div className="flex items-center gap-2">
              <a
                href={urlContent}
                download={title || "file"}
                className="text-gray-400 hover:text-black transition-colors"
                title="Download original file"
              >
                <Download className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
          <div className="flex-1 w-full bg-white relative">
{/* SECURITY: Using allow-same-origin is required for Google Docs viewer to work */}
            <iframe
              src={`https://docs.google.com/gview?url=${encodeURIComponent(urlContent)}&embedded=true`}
              className="w-full h-full border-none"
              title="Office Preview"
              sandbox="allow-scripts allow-forms"
              referrerPolicy="no-referrer"
              onError={(e) => {
                console.error("Office preview load error:", e);
              }}
            />
          </div>
        </div>
      );
    }

    // Local files: Use client-side conversion
    // Show loading state
    if (officeLoading) {
      return (
        <div className="h-full w-full flex flex-col items-center justify-center text-white/50 gap-4">
          <Loader2 className="w-12 h-12 animate-spin opacity-50" />
          <div className="text-center space-y-2">
            <p className="font-medium">Converting office file...</p>
            <p className="text-xs opacity-50">
              {officeFileType === "docx" && "Converting Word document to HTML"}
              {officeFileType === "xlsx" &&
                "Converting Excel spreadsheet to HTML"}
              {officeFileType === "pptx" && "Preparing preview"}
            </p>
          </div>
        </div>
      );
    }

    // Show error state
    if (officeError) {
      return (
        <div className="h-full w-full flex flex-col items-center justify-center text-white/50 gap-4">
          <div className="flex flex-col items-center gap-3">
            <AlertCircle className="w-12 h-12 opacity-50" />
            <div className="text-center space-y-2 max-w-md">
              <p className="font-medium">Preview unavailable</p>
              <p className="text-xs opacity-70">{officeError}</p>
              <div className="flex items-center gap-2 justify-center mt-4">
                <a
                  href={urlContent}
                  download={title || "file"}
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                >
                  <Download className="w-3 h-3" />
                  Download to view
                </a>
              </div>
            </div>
          </div>
        </div>
      );
    }

    // Show converted HTML
    if (officeHtml) {
      return (
        <div className="h-full w-full rounded-2xl overflow-hidden border border-border bg-background relative shadow-2xl flex flex-col">
          <div className="h-8 bg-muted border-b border-border flex items-center px-4 justify-between">
            <span className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">
              {officeFileType === "docx" && "Document Preview"}
              {officeFileType === "xlsx" && "Spreadsheet Preview"}
              {officeFileType === "pptx" && "Presentation Preview"}
            </span>
            <div className="flex items-center gap-2">
              <a
                href={urlContent}
                download={title || "file"}
                className="text-muted-foreground hover:text-foreground transition-colors"
                title="Download original file"
              >
                <Download className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
          <div className="flex-1 overflow-auto bg-background p-6">
            {/*
              Security Note: HTML is generated by trusted libraries (mammoth.js for DOCX, SheetJS for XLSX)
              which produce safe HTML without scripts. Content is from user's own files, not external sources.
              Both libraries sanitize their output and do not include executable code.
            */}
            <div
              dangerouslySetInnerHTML={{ __html: officeHtml }}
              className="office-preview-content"
              style={{
                maxWidth: "100%",
                margin: "0 auto",
              }}
            />
          </div>
        </div>
      );
    }

    // PPTX preview (now supported)
    if (officeFileType === "pptx") {
      // Show loading state
      if (officeLoading) {
        return (
          <div className="h-full w-full flex flex-col items-center justify-center text-white/50 gap-4">
            <Loader2 className="w-12 h-12 animate-spin opacity-50" />
            <div className="text-center space-y-2">
              <p className="font-medium">Loading PowerPoint preview...</p>
              <p className="text-xs opacity-50">
                Converting presentation to preview format
              </p>
            </div>
          </div>
        );
      }

      // Show error state
      if (officeError) {
        return (
          <div className="h-full w-full flex flex-col items-center justify-center text-white/50 gap-4">
            <div className="flex flex-col items-center gap-3">
              <AlertCircle className="w-12 h-12 opacity-50" />
              <div className="text-center space-y-2 max-w-md">
                <p className="font-medium">Preview unavailable</p>
                <p className="text-xs opacity-70">{officeError}</p>
                <div className="flex items-center gap-2 justify-center mt-4">
                  <a
                    href={urlContent}
                    download={title || "file"}
                    className="text-xs text-primary hover:underline flex items-center gap-1"
                  >
                    <Download className="w-3 h-3" />
                    Download to view
                  </a>
                </div>
              </div>
            </div>
          </div>
        );
      }

      // Show converted HTML preview
      if (officeHtml) {
        return (
          <div className="h-full w-full rounded-2xl overflow-hidden border border-border bg-background relative shadow-2xl flex flex-col">
            <div className="h-8 bg-muted border-b border-border flex items-center px-4 justify-between">
              <span className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">
                PowerPoint Preview
              </span>
              <a
                href={urlContent}
                download={title || "file"}
                className="text-muted-foreground hover:text-foreground transition-colors"
                title="Download original file"
              >
                <Download className="w-3.5 h-3.5" />
              </a>
            </div>
            <div className="flex-1 overflow-auto bg-background p-6">
              {/*
                Security Note: HTML is generated by trusted libraries or Office Online Viewer
                Content is from user's own files, not external sources.
              */}
              <div
                dangerouslySetInnerHTML={{ __html: officeHtml }}
                className="office-preview-content"
                style={{
                  maxWidth: "100%",
                  margin: "0 auto",
                }}
              />
            </div>
          </div>
        );
      }

      // Fallback: Show download option while loading
      return (
        <div className="h-full w-full flex flex-col items-center justify-center text-white/50 gap-4">
          <FileIcon className="w-16 h-16 opacity-30" />
          <div className="text-center space-y-2">
            <p className="font-medium">Preparing PowerPoint preview...</p>
            <p className="text-xs opacity-50">
              Please wait while we load the presentation
            </p>
            <div className="flex items-center gap-2 justify-center mt-4">
              <a
                href={urlContent}
                download={title || "file"}
                className="text-xs text-primary hover:underline flex items-center gap-1"
              >
                <Download className="w-3 h-3" />
                Download to view
              </a>
            </div>
          </div>
        </div>
      );
    }

    // Unknown office file type fallback
    return (
      <div className="h-full w-full flex flex-col items-center justify-center text-white/50 gap-4">
        <FileIcon className="w-16 h-16 opacity-30" />
        <div className="text-center space-y-2">
          <p className="font-medium">
            Preview not available for local Office files
          </p>
          <div className="flex items-center gap-2 justify-center">
            <a
              href={urlContent}
              download={title || "file"}
              className="text-xs text-primary hover:underline"
            >
              Download
            </a>
            <span className="text-xs opacity-50">to view</span>
          </div>
        </div>
      </div>
    );
  }

  if (type === "app") {
    // Always use srcDoc for HTML content to ensure proper rendering
    // Priority: htmlContent (fetched with CSP fix) > textContent (if it's actual HTML, not a URL) > urlContent (fallback to src)
    // IMPORTANT: Don't use textContent if it's just a URL string - that would render the URL as text
    const isTextContentActualHtml =
      textContent &&
      !textContent.startsWith("http://") &&
      !textContent.startsWith("https://") &&
      !textContent.startsWith("blob:") &&
      !textContent.startsWith("data:") &&
      (textContent.includes("<") || textContent.includes(">"));
    const iframeContent =
      htmlContent || (isTextContentActualHtml ? textContent : null);
    const useSrcDoc = !!iframeContent;
    const iframeSrc = useSrcDoc ? undefined : urlContent;

    return (
      <div className="h-full w-full rounded-2xl overflow-hidden border border-white/10 bg-white relative shadow-2xl flex flex-col">
        <div className="h-8 bg-[#f0f0f0] border-b border-gray-200 flex items-center px-4 justify-between">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
            <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
          </div>
          <div className="text-[10px] text-gray-400 font-mono">
            App Preview Mode
          </div>
        </div>
        <div className="flex-1 w-full bg-white relative">
          {htmlLoading ? (
            <div className="h-full w-full flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : (
            <iframe
              srcDoc={useSrcDoc ? iframeContent : undefined}
              src={iframeSrc}
              className="w-full h-full border-none"
              title="App Preview"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock"
              // Note: allow-scripts + allow-same-origin is needed for app previews to work properly.
              // The iframe sandbox provides security isolation for user-generated content.
            />
          )}
        </div>
      </div>
    );
  }

  // Code and text file preview - uses existing textFileContent state from useEffect above
  if (type === "code" || type === "text") {
    const displayContent =
      textFileContent ||
      (textContent && !textContent.startsWith("http") ? textContent : null);
    const viewerTitle = type === "code" ? "code_viewer" : "text_viewer";

    if (textFileLoading) {
      return (
        <div className="h-full w-full flex flex-col items-center justify-center text-white/50 gap-4">
          <Loader2 className="w-12 h-12 animate-spin opacity-50" />
          <p className="font-medium">
            Loading {type === "code" ? "code" : "text file"}...
          </p>
        </div>
      );
    }

    return (
      <div className="h-full w-full rounded-2xl overflow-hidden border border-white/10 bg-[#0F0F0F] relative flex flex-col shadow-2xl">
        <div className="h-8 bg-[#151515] border-b border-white/5 flex items-center px-4 gap-2 justify-between">
          <div className="flex gap-2 items-center">
            <div className="flex gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500/20" />
              <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/20" />
              <div className="w-2.5 h-2.5 rounded-full bg-green-500/20" />
            </div>
            <span className="text-xs text-white/30 font-mono ml-2">
              {title || viewerTitle}
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-white/30 hover:text-white"
            onClick={() => {
              const blob = new Blob([displayContent || ""], {
                type: "text/plain",
              });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = title || (type === "code" ? "code.txt" : "file.txt");
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            <Download className="w-3.5 h-3.5" />
          </Button>
        </div>
        <div className="flex-1 w-full overflow-auto p-4 font-mono text-sm text-white/90 custom-scrollbar bg-[#0a0a0a]">
          <pre className="whitespace-pre-wrap break-words leading-relaxed">
            {displayContent || "No content available"}
          </pre>
        </div>
      </div>
    );
  }

  if (type === "file" && urlContent) {
    // Check if it's a zip/archive file - these can't be previewed in iframes
    const isArchiveFile = title
      ?.toLowerCase()
      .match(/\.(zip|rar|7z|tar|gz|bz2|xz|z|tar\.gz|tar\.bz2)$/);

    if (isArchiveFile) {
      // Show download message for archive files
      return (
        <div className="h-full w-full flex flex-col items-center justify-center text-white/50 gap-4">
          <FileIcon className="w-16 h-16 opacity-30" />
          <div className="text-center space-y-2 max-w-md">
            <p className="font-medium">Archive files cannot be previewed</p>
            <p className="text-xs opacity-70">
              Please download the file to extract and view its contents
            </p>
            <div className="flex items-center gap-2 justify-center mt-4">
              <Button
                variant="default"
                size="sm"
                onClick={() => {
                  const a = document.createElement("a");
                  a.href = urlContent;
                  a.download = title || "archive.zip";
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                }}
                className="gap-2"
              >
                <Download className="w-4 h-4" />
                Download {title || "Archive"}
              </Button>
            </div>
          </div>
        </div>
      );
    }

    // Check if it's a text file - render content directly with proper styling
    const isTextFile =
      title?.toLowerCase().endsWith(".txt") ||
      title?.toLowerCase().endsWith(".text") ||
      title?.toLowerCase().endsWith(".md") ||
      title?.toLowerCase().endsWith(".markdown");

    // Use fetched content or existing textContent
    const displayText = textFileContent || textContent;

    if (isTextFile) {
      // Show loading state
      if (textFileLoading) {
        return (
          <div className="h-full w-full flex flex-col items-center justify-center text-white/50 gap-4">
            <Loader2 className="w-12 h-12 animate-spin opacity-50" />
            <div className="text-center space-y-2">
              <p className="font-medium">Loading text file...</p>
            </div>
          </div>
        );
      }

      // Render text content directly with proper dark theme styling
      if (displayText) {
        return (
          <div className="h-full w-full rounded-2xl overflow-hidden border border-white/10 bg-[#0F0F0F] relative flex flex-col shadow-2xl">
            <div className="h-8 bg-[#151515] border-b border-white/5 flex items-center px-4 gap-2 justify-between">
              <div className="flex gap-2 items-center">
                <div className="flex gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500/20" />
                  <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/20" />
                  <div className="w-2.5 h-2.5 rounded-full bg-green-500/20" />
                </div>
                <span className="text-xs text-white/30 font-mono ml-2">
                  text_viewer
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-white/30 hover:text-white"
                onClick={() => {
                  const blob = new Blob([displayText], { type: "text/plain" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = title || "file.txt";
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                <Download className="w-3.5 h-3.5" />
              </Button>
            </div>
            <div className="flex-1 w-full overflow-auto p-4 font-mono text-sm text-white/90 custom-scrollbar">
              <pre className="whitespace-pre-wrap break-words">
                {displayText}
              </pre>
            </div>
          </div>
        );
      }
    }

    // For other file types, use iframe with proper structure
    return (
      <div className="h-full w-full rounded-2xl overflow-hidden border border-white/10 bg-white relative shadow-2xl flex flex-col">
        <div className="h-8 bg-[#f0f0f0] border-b border-gray-200 flex items-center px-4 justify-between">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
            <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
          </div>
          <span className="text-[10px] text-gray-400 font-mono uppercase tracking-wider">
            File Preview
          </span>
          <a
            href={urlContent}
            download={title || undefined}
            className="text-gray-400 hover:text-black transition-colors"
            onClick={(e) => {
              // Only download on explicit click, not on iframe load
              e.stopPropagation();
            }}
            title="Download file"
          >
            <Download className="w-3.5 h-3.5" />
          </a>
        </div>
        <div className="flex-1 w-full bg-white relative">
          {/* SECURITY: Removed allow-same-origin when allow-scripts is present */}
          <iframe
            src={urlContent}
            className="w-full h-full border-none bg-white"
            title="File Preview"
            sandbox="allow-scripts allow-forms allow-popups"
            referrerPolicy="no-referrer"
            onError={(e) => {
              console.error("File preview load error:", e);
            }}
          />
        </div>
      </div>
    );
  }

  // Fallback / Code view
  return (
    <div className="h-full w-full rounded-2xl overflow-hidden border border-white/10 bg-[#0F0F0F] relative flex flex-col shadow-2xl">
      <div className="h-8 bg-[#151515] border-b border-white/5 flex items-center px-4 gap-2 justify-between">
        <div className="flex gap-2 items-center">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500/20" />
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/20" />
            <div className="w-2.5 h-2.5 rounded-full bg-green-500/20" />
          </div>
          <span className="text-xs text-white/30 font-mono ml-2">
            code_viewer
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-white/30 hover:text-white"
          onClick={() => {
            const blob = new Blob([textContent], { type: "text/plain" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "code.txt";
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          <Download className="w-3.5 h-3.5" />
        </Button>
      </div>
      <div className="flex-1 w-full overflow-auto p-4 font-mono text-sm text-white/70 custom-scrollbar">
        <pre className="whitespace-pre-wrap break-all">{textContent}</pre>
      </div>
    </div>
  );
}

// Tree node interface for file tree structure
interface FileTreeNode {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: FileTreeNode[];
  item?: any; // Original item data for files
}

// Build tree structure from flat file list
function buildFileTree(items: any[]): FileTreeNode[] {
  const root: { [key: string]: FileTreeNode } = {};

  items.forEach((item) => {
    const filename = item.filename || item.name || item.title || "Untitled";
    // Check if file has a path structure (e.g., "folder/subfolder/file.js")
    const pathParts = filename.split("/").filter(Boolean);

    if (pathParts.length === 1) {
      // Root level file
      root[filename] = {
        name: filename,
        path: filename,
        type: "file",
        item,
      };
    } else {
      // File in subdirectory - build folder structure
      let currentLevel = root;
      let currentPath = "";

      pathParts.forEach((part, index) => {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        const isLastPart = index === pathParts.length - 1;

        if (isLastPart) {
          // This is the file
          if (!currentLevel[part]) {
            currentLevel[part] = {
              name: part,
              path: currentPath,
              type: "file",
              item,
            };
          }
        } else {
          // This is a folder
          if (!currentLevel[part]) {
            currentLevel[part] = {
              name: part,
              path: currentPath,
              type: "folder",
              children: [],
            };
          }
          // Navigate into the folder's children
          currentLevel[part].children ??= [];
          // Convert children array to object for easier lookup
          const childrenObj: { [key: string]: FileTreeNode } = {};
          currentLevel[part].children.forEach((child) => {
            childrenObj[child.name] = child;
          });
          currentLevel = childrenObj as any;
          // We'll rebuild the children array at the end
        }
      });
    }
  });

  // Convert root object to sorted array (folders first, then files)
  const toSortedArray = (obj: {
    [key: string]: FileTreeNode;
  }): FileTreeNode[] => {
    return Object.values(obj).sort((a, b) => {
      // Folders first
      if (a.type === "folder" && b.type === "file") return -1;
      if (a.type === "file" && b.type === "folder") return 1;
      // Then alphabetically
      return a.name.localeCompare(b.name);
    });
  };

  return toSortedArray(root);
}

// Single file/folder row component
function FileTreeItem({
  node,
  depth,
  onSelect,
  expandedFolders,
  toggleFolder,
}: {
  readonly node: FileTreeNode;
  readonly depth: number;
  readonly onSelect: (item: any) => void;
  readonly expandedFolders: Set<string>;
  readonly toggleFolder: (path: string) => void;
}) {
  const isExpanded = expandedFolders.has(node.path);
  const paddingLeft = depth * 12 + 8;

  if (node.type === "folder") {
    return (
      <>
        <button
          type="button"
          aria-label={`${isExpanded ? "Collapse" : "Expand"} folder ${node.name}`}
          aria-expanded={isExpanded}
          className="flex items-center gap-1.5 py-1 px-2 hover:bg-white/5 cursor-pointer rounded text-white/70 hover:text-white/90 transition-colors w-full text-left"
          style={{ paddingLeft }}
          onClick={() => toggleFolder(node.path)}
        >
          <ChevronRight
            className={cn(
              "w-3 h-3 text-white/40 transition-transform flex-shrink-0",
              isExpanded && "rotate-90",
            )}
          />
          <FolderIcon className="w-4 h-4 text-yellow-500/80 flex-shrink-0" />
          <span className="text-xs truncate">{node.name}</span>
        </button>
        {isExpanded && node.children && (
          <div>
            {node.children.map((child) => (
              <FileTreeItem
                key={child.path}
                node={child}
                depth={depth + 1}
                onSelect={onSelect}
                expandedFolders={expandedFolders}
                toggleFolder={toggleFolder}
              />
            ))}
          </div>
        )}
      </>
    );
  }

  // File item
  return (
    <button
      type="button"
      aria-label={`Select file ${node.name}`}
      className="flex items-center gap-1.5 py-1 px-2 hover:bg-white/5 cursor-pointer rounded text-white/60 hover:text-white/90 transition-colors group w-full text-left"
      style={{ paddingLeft: paddingLeft + 16 }}
      onClick={() => node.item && onSelect(node.item)}
      disabled={!node.item}
    >
      <FileTypeIcon filename={node.name} size={14} className="flex-shrink-0" />
      <span className="text-xs truncate flex-1">{node.name}</span>
    </button>
  );
}

// Compact file explorer component (Cursor/Windsurf style)
function FileExplorer({
  items,
  onSelect,
}: {
  readonly items: any[];
  readonly onSelect: (item: any) => void;
}) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(),
  );
  const [searchQuery, setSearchQuery] = useState("");

  const toggleFolder = useCallback((path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  // Filter items based on search
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items;
    const query = searchQuery.toLowerCase();
    return items.filter((item) => {
      const name = (
        item.filename ||
        item.name ||
        item.title ||
        ""
      ).toLowerCase();
      return name.includes(query);
    });
  }, [items, searchQuery]);

  // Build tree structure
  const fileTree = useMemo(() => buildFileTree(filteredItems), [filteredItems]);

  // Group files by source for quick access
  const groupedBySource = useMemo(() => {
    const generated = items.filter(
      (i) => i.sandboxSource === "generated" || i._source === "artifact",
    );
    const uploaded = items.filter(
      (i) => i.sandboxSource === "user" || i._source === "upload",
    );
    return { generated, uploaded };
  }, [items]);

  return (
    <div className="h-full flex flex-col">
      {/* Search bar */}
      <div className="px-2 pb-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
          <input
            type="text"
            placeholder="Search files..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-md pl-7 pr-3 py-1.5 text-xs text-white/90 placeholder:text-white/30 focus:outline-none focus:border-white/20"
          />
        </div>
      </div>

      {/* File counts */}
      <div className="px-3 pb-2 flex items-center gap-3 text-[10px] text-white/40">
        <span>{items.length} files</span>
        {groupedBySource.generated.length > 0 && (
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500/60" />
            {groupedBySource.generated.length} generated
          </span>
        )}
        {groupedBySource.uploaded.length > 0 && (
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500/60" />
            {groupedBySource.uploaded.length} uploaded
          </span>
        )}
      </div>

      {/* File tree */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-1">
        {fileTree.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-white/30 gap-2">
            <Box className="w-8 h-8 stroke-1" />
            <span className="text-xs">No files found</span>
          </div>
        ) : (
          <div className="py-1">
            {fileTree.map((node) => (
              <FileTreeItem
                key={node.path}
                node={node}
                depth={0}
                onSelect={onSelect}
                expandedFolders={expandedFolders}
                toggleFolder={toggleFolder}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
