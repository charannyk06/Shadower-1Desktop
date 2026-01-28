"use client";

import { appStore, resolveWorkingDirectory, useAppStore } from "@/app/store";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  Box,
  ChevronRight,
  FilePlus,
  FolderIcon,
  Loader2,
  Maximize2,
  Minimize2,
  Minus,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { FileTypeIcon } from "./file-type-icon";
import { DiffViewer, SideBySideDiff } from "./diff-viewer";

// Interface for workspace files from API
interface WorkspaceFileMetadata {
  name: string;
  size: number;
  type: string;
  source: "user" | "generated";
  storageKey?: string;
  url?: string;
  uploadedAt: string;
}

// Text-based file extensions that can be edited in the inline viewer
// Using a Set for O(1) lookup performance
const EDITABLE_FILE_EXTENSIONS = new Set([
  // JavaScript/TypeScript
  "js",
  "jsx",
  "ts",
  "tsx",
  "mjs",
  "cjs",
  // Python
  "py",
  // Web
  "css",
  "scss",
  "sass",
  "less",
  "html",
  "htm",
  // Data formats
  "json",
  "yaml",
  "yml",
  "xml",
  "csv",
  // Shell scripts
  "sh",
  "bash",
  "zsh",
  // Systems languages
  "go",
  "rs",
  "rb",
  "php",
  "java",
  "c",
  "cpp",
  "h",
  "hpp",
  "cs",
  // Mobile
  "swift",
  "kt",
  // Other languages
  "scala",
  "r",
  "lua",
  "pl",
  "pm",
  "ex",
  "exs",
  "erl",
  "hrl",
  "clj",
  "cljs",
  "hs",
  "elm",
  // Modern frameworks
  "vue",
  "svelte",
  "astro",
  // GraphQL
  "graphql",
  "gql",
  // Config
  "toml",
  "ini",
  "cfg",
  "conf",
  "env",
  "gitignore",
  "dockerfile",
  "makefile",
  "cmake",
  // Text/Documentation
  "txt",
  "text",
  "md",
  "markdown",
  "rst",
  "log",
  // SQL
  "sql",
]);

/**
 * Check if a file is editable based on its extension
 */
function isEditableFile(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase();
  return ext ? EDITABLE_FILE_EXTENSIONS.has(ext) : false;
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
    globalWorkingDirectory,
    workingDirectoryMode,
    threadWorkingDirectories,
    mutate: appStoreMutate,
    filesVersion,
  } = useAppStore(
    useShallow((state) => ({
      theaterMode: state.theaterMode,
      threadFiles: state.threadFiles,
      currentThreadId: state.currentThreadId,
      globalWorkingDirectory: state.workingDirectory,
      workingDirectoryMode: state.workingDirectoryMode,
      threadWorkingDirectories: state.threadWorkingDirectories,
      mutate: state.mutate,
      filesVersion: state.theaterMode.filesVersion || 0,
    })),
  );

  const workingDirectory = useMemo(
    () =>
      resolveWorkingDirectory(
        {
          workingDirectory: globalWorkingDirectory,
          workingDirectoryMode,
          threadWorkingDirectories,
        },
        currentThreadId,
      ),
    [
      globalWorkingDirectory,
      workingDirectoryMode,
      threadWorkingDirectories,
      currentThreadId,
    ],
  );

  const [activeTab, setActiveTab] = useState<"all-files" | "changes">(
    theaterMode.defaultTab || "all-files",
  );
  const [isMaximized, setIsMaximized] = useState(false);
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFileMetadata[]>(
    [],
  );
  const [workspaceFilesLoading, setWorkspaceFilesLoading] = useState(false);
  const isMobile = useIsMobile();

  // Inline file viewer state
  const [selectedFile, setSelectedFile] = useState<{
    path: string;
    content: string;
    title: string;
    isEditable: boolean;
    storageKey?: string;
  } | null>(null);
  const [editedContent, setEditedContent] = useState<string>("");
  const [isSaving, setIsSaving] = useState(false);

  // Fetch workspace files and working directory files when theater opens
  useEffect(() => {
    // Always fetch when theater is open
    if (!theaterMode.isOpen) {
      return;
    }

    let cancelled = false;
    setWorkspaceFilesLoading(true);

    console.log(
      "[TheaterPanel] Fetching files for thread:",
      currentThreadId,
      "workingDirectory:",
      workingDirectory?.path,
      "version:",
      filesVersion,
    );

    // Use Electron IPC if available - this is an Electron desktop app
    const api =
      typeof window !== "undefined" ? (window as any).electronAPI : null;

    if (!api?.files) {
      console.log(
        "[TheaterPanel] Electron API not available, skipping files fetch",
      );
      setWorkspaceFiles([]);
      setWorkspaceFilesLoading(false);
      return;
    }

    // Fetch both workspace files and working directory files
    const fetchPromises: Promise<any>[] = [];

    // 1. Fetch internal workspace files (from app storage)
    fetchPromises.push(
      api.files.listFiles("workspace").catch((err: Error) => {
        console.error("Failed to load workspace files:", err);
        return [];
      }),
    );

    // 2. Fetch working directory files (the user's selected folder snapshot)
    if (workingDirectory?.path) {
      fetchPromises.push(
        api.files
          .listWorkingDirectory({
            directoryPath: workingDirectory.path,
            maxDepth: 2,
          })
          .then(
            (result: { success: boolean; files: any[]; error?: string }) => {
              if (result.success) {
                return result.files;
              }
              console.error("Failed to load working directory:", result.error);
              return [];
            },
          )
          .catch((err: Error) => {
            console.error("Failed to load working directory files:", err);
            return [];
          }),
      );
    }

    Promise.all(fetchPromises)
      .then(([storageFiles, workingDirFiles = []]) => {
        if (cancelled) return;

        // Filter storage files for this thread
        const filteredStorageFiles = (storageFiles || []).filter(
          (f: any) => !f.threadId || f.threadId === currentThreadId,
        );

        // Transform working directory files to match the expected format
        const transformedWorkingDirFiles = (workingDirFiles || [])
          .filter((f: any) => !f.isDirectory) // Only include files, not directories
          .map((f: any) => ({
            name: f.relativePath || f.name,
            size: f.size,
            type: f.type,
            source: "working-directory" as const,
            url: `file://${f.path}`,
            uploadedAt: f.uploadedAt,
            path: f.path,
          }));

        // Combine both sources
        const allFiles = [
          ...filteredStorageFiles,
          ...transformedWorkingDirFiles,
        ];

        console.log(
          "[TheaterPanel] Received files - storage:",
          filteredStorageFiles.length,
          "workingDir:",
          transformedWorkingDirFiles.length,
        );

        setWorkspaceFiles(allFiles);
      })
      .finally(() => {
        if (!cancelled) setWorkspaceFilesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    theaterMode.isOpen,
    currentThreadId,
    workingDirectory?.path,
    filesVersion,
  ]);

  // Listen for file change events from Electron to track diffs - PER THREAD
  // Registered ONCE — uses threadId from the event payload, not closure state
  useEffect(() => {
    const api =
      typeof window !== "undefined" ? (window as any).electronAPI : null;
    if (!api?.dialog?.onFileChanged) return;

    const cleanup = api.dialog.onFileChanged(
      (data: {
        filePath: string;
        filename: string;
        status: "created" | "modified" | "deleted";
        originalContent: string | null;
        newContent: string;
        timestamp: number;
        threadId?: string;
      }) => {
        // Use threadId from event payload, fall back to current store value
        const threadId = data.threadId || appStore.getState().currentThreadId;
        if (!threadId) {
          console.log("[TheaterPanel] File changed but no thread resolved, skipping");
          return;
        }

        console.log("[TheaterPanel] File changed:", data.filePath, data.status, "for thread:", threadId);

        // Update the store with the file snapshot for diff tracking - PER THREAD
        appStoreMutate((state) => {
          const existingThreadSnapshots = state.theaterMode.threadFileSnapshots || {};
          const existingSnapshots = existingThreadSnapshots[threadId] || {};
          const existingThreadChanges = state.theaterMode.threadSessionChanges || {};
          const existingChanges = existingThreadChanges[threadId] || {
            created: [],
            modified: [],
            deleted: [],
          };

          // Update file snapshots for this thread
          const newSnapshots = {
            ...existingSnapshots,
            [data.filePath]: {
              originalContent:
                existingSnapshots[data.filePath]?.originalContent ??
                data.originalContent ??
                "",
              currentContent: data.newContent,
              status: data.status as "created" | "modified" | "deleted",
              timestamp: data.timestamp,
            },
          };

          // Update session changes for this thread — proper status transitions
          const newChanges = {
            created: existingChanges.created.filter((p: string) => p !== data.filePath),
            modified: existingChanges.modified.filter((p: string) => p !== data.filePath),
            deleted: existingChanges.deleted.filter((p: string) => p !== data.filePath),
          };
          const filePath = data.filePath;
          const wasCreated = existingChanges.created.includes(filePath);

          if (data.status === "created") {
            newChanges.created.push(filePath);
          } else if (data.status === "modified") {
            // If file was originally created in this session, keep it as "created"
            if (wasCreated) {
              newChanges.created.push(filePath);
            } else {
              newChanges.modified.push(filePath);
            }
          } else if (data.status === "deleted") {
            // If file was created in this session then deleted, net zero — don't add anywhere
            if (!wasCreated) {
              newChanges.deleted.push(filePath);
            }
          }

          return {
            theaterMode: {
              ...state.theaterMode,
              threadFileSnapshots: {
                ...existingThreadSnapshots,
                [threadId]: newSnapshots,
              },
              threadSessionChanges: {
                ...existingThreadChanges,
                [threadId]: newChanges,
              },
              filesVersion: (state.theaterMode.filesVersion || 0) + 1,
            },
          };
        });
      },
    );

    return cleanup;
  }, [appStoreMutate]);

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

    const workspaceFileItems = workspaceFiles.map((f) => {
      const storageKey = f.url ? extractStorageKeyFromUrl(f.url) : undefined;

      return {
        _source: "workspace" as const,
        id: `workspace-${f.name}-${f.uploadedAt}`,
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
        workspaceSource: f.source, // 'user' or 'generated'
      };
    });

    // Deduplicate: workspace files may overlap with uploads or artifacts
    const allCombined = [...artifacts, ...uploads, ...workspaceFileItems];
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
    workspaceFiles,
  ]);

  // Count actual file changes for the Changes tab badge
  const changesCount = useMemo(() => {
    const fileSnapshots = currentThreadId
      ? theaterMode.threadFileSnapshots?.[currentThreadId]
      : undefined;
    const sessionChanges = currentThreadId
      ? theaterMode.threadSessionChanges?.[currentThreadId]
      : undefined;

    // Count files from snapshots
    const snapshotCount = fileSnapshots ? Object.keys(fileSnapshots).length : 0;

    // Count files from session changes that aren't already in snapshots
    let additionalCount = 0;
    if (sessionChanges && fileSnapshots) {
      const existingPaths = new Set(Object.keys(fileSnapshots));
      additionalCount =
        sessionChanges.created.filter((p) => !existingPaths.has(p)).length +
        sessionChanges.modified.filter((p) => !existingPaths.has(p)).length +
        sessionChanges.deleted.filter((p) => !existingPaths.has(p)).length;
    } else if (sessionChanges) {
      additionalCount =
        sessionChanges.created.length +
        sessionChanges.modified.length +
        sessionChanges.deleted.length;
    }

    return snapshotCount + additionalCount;
  }, [
    currentThreadId,
    theaterMode.threadFileSnapshots,
    theaterMode.threadSessionChanges,
  ]);

  // Auto-switch logic - respect defaultTab when theater opens
  useEffect(() => {
    if (theaterMode.isOpen && theaterMode.defaultTab) {
      setActiveTab(theaterMode.defaultTab);
    } else if (theaterMode.content) {
      setActiveTab("all-files");
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

  // Open a file in the inline viewer
  const openFileViewer = useCallback(async (item: any) => {
    const filename = item.filename || item.name || item.title || "Untitled";
    let content = item.content || "";

    // Determine if editable using the utility function (O(1) Set lookup)
    const isEditable = isEditableFile(filename);

    // Check if this is a file from the working directory that needs to be read from disk
    // Working directory files have their URL stored in content, not actual file content
    const api =
      typeof window !== "undefined" ? (window as any).electronAPI : null;

    // Get the file path - could be from item.path (working dir files) or extracted from file:// URL
    let filePath: string | null = null;

    if (
      item.path &&
      typeof item.path === "string" &&
      item.path.startsWith("/")
    ) {
      // Direct filesystem path (from working directory listing)
      filePath = item.path;
    } else if (typeof content === "string" && content.startsWith("file://")) {
      // file:// URL - extract the path
      filePath = content.replace("file://", "");
    }

    // If we have a file path and the Electron API is available, read the actual file content
    if (filePath && api?.files?.readTextFile) {
      console.log("[TheaterPanel] Reading file from disk:", filePath);

      // Set loading state with placeholder
      setSelectedFile({
        path: filePath,
        content: "Loading...",
        title: filename,
        isEditable: false, // Disable editing until loaded
        storageKey: item.storageKey,
      });
      setEditedContent("Loading...");

      try {
        const result = await api.files.readTextFile({ filePath });

        if (result.success && result.content !== null) {
          console.log(
            "[TheaterPanel] File read successfully:",
            result.content.length,
            "chars",
          );
          content = result.content;
        } else {
          console.error("[TheaterPanel] Failed to read file:", result.error);
          content = `Error reading file: ${result.error || "Unknown error"}`;
        }
      } catch (error) {
        console.error("[TheaterPanel] Error reading file:", error);
        content = `Error reading file: ${error instanceof Error ? error.message : "Unknown error"}`;
      }
    }

    setSelectedFile({
      path: filePath || item.storageKey || item.url || filename,
      content:
        typeof content === "string"
          ? content
          : JSON.stringify(content, null, 2),
      title: filename,
      isEditable,
      storageKey: item.storageKey,
    });
    setEditedContent(
      typeof content === "string" ? content : JSON.stringify(content, null, 2),
    );
  }, []);

  // Close the inline file viewer
  const closeFileViewer = useCallback(() => {
    setSelectedFile(null);
    setEditedContent("");
  }, []);

  // Save edited file content
  const saveFileContent = useCallback(async () => {
    if (!selectedFile) return;

    setIsSaving(true);
    try {
      const api =
        typeof window !== "undefined" ? (window as any).electronAPI : null;
      if (api?.dialog?.writeToPath && selectedFile.path) {
        // API expects { filePath, content } object - this also triggers file:changed event
        await api.dialog.writeToPath({
          filePath: selectedFile.path,
          content: editedContent,
          threadId: currentThreadId,
        });
        toast.success("File saved");
        setSelectedFile((prev) =>
          prev ? { ...prev, content: editedContent } : null,
        );
      } else {
        toast.error("Cannot save file - no path available");
      }
    } catch (error) {
      console.error("Error saving file:", error);
      toast.error("Failed to save file");
    } finally {
      setIsSaving(false);
    }
  }, [selectedFile, editedContent]);

  if (!theaterMode.isOpen) return null;

  return (
    <div
      className={cn(
        "bg-[#0A0A0A] border-l border-white/10 flex flex-col overflow-hidden h-full",
        isMaximized && "fixed inset-4 z-[100] rounded-lg border",
      )}
    >
      {/* --- Header (Conductor-style) --- */}
      <div className="flex-none h-12 px-4 border-b border-white/10 flex items-center justify-between">
        {/* Conductor-style flat tabs */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setActiveTab("all-files")}
            className={cn(
              "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
              activeTab === "all-files"
                ? "bg-white/10 text-white"
                : "text-white/50 hover:text-white/80 hover:bg-white/5",
            )}
          >
            All files
          </button>
          <button
            onClick={() => setActiveTab("changes")}
            className={cn(
              "px-3 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center gap-2",
              activeTab === "changes"
                ? "bg-white/10 text-white"
                : "text-white/50 hover:text-white/80 hover:bg-white/5",
            )}
          >
            Changes
            {changesCount > 0 && (
              <span className="text-xs text-white/60">{changesCount}</span>
            )}
          </button>
        </div>

        {/* Right side actions */}
        <div className="flex items-center gap-1">
          {!isMobile && (
            <>
              {/* Search icon placeholder */}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-white/50 hover:text-white hover:bg-white/5"
              >
                <Search className="w-4 h-4" />
              </Button>

              {/* Maximize Toggle */}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-white/50 hover:text-white hover:bg-white/5"
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
            className="h-8 w-8 text-white/50 hover:text-white hover:bg-white/5"
            onClick={handleClose}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* --- Content Area (Conductor-style clean) --- */}
      <div className="flex-1 w-full min-h-0 overflow-hidden">
        {activeTab === "all-files" ? (
          <div className="h-full w-full flex flex-col">
            {/* Inline file viewer - shows when a file is selected */}
            {selectedFile ? (
              <div className="h-full flex flex-col">
                {/* File viewer header */}
                <div className="flex items-center justify-between h-10 px-3 border-b border-white/10 flex-shrink-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileTypeIcon filename={selectedFile.title} size={14} />
                    <span className="text-sm text-white/80 truncate">
                      {selectedFile.title}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {selectedFile.isEditable && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={saveFileContent}
                        disabled={isSaving}
                        className="h-7 text-xs text-white/70 hover:text-white hover:bg-white/10"
                      >
                        {isSaving ? (
                          <Loader2 className="w-3 h-3 animate-spin mr-1" />
                        ) : null}
                        Save
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={closeFileViewer}
                      className="h-7 w-7 text-white/50 hover:text-white hover:bg-white/10"
                    >
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
                {/* File content */}
                <div className="flex-1 overflow-auto p-3">
                  {selectedFile.isEditable ? (
                    <textarea
                      value={editedContent}
                      onChange={(e) => setEditedContent(e.target.value)}
                      className="w-full h-full bg-transparent text-sm text-white/90 font-mono resize-none focus:outline-none"
                      spellCheck={false}
                    />
                  ) : (
                    <pre className="text-sm text-white/80 font-mono whitespace-pre-wrap">
                      {selectedFile.content}
                    </pre>
                  )}
                </div>
              </div>
            ) : (
              /* File list - clean Conductor style */
              <div className="flex-1 overflow-y-auto">
                {(() => {
                  if (workspaceFilesLoading) {
                    return (
                      <div className="h-full flex flex-col items-center justify-center text-white/30 gap-3">
                        <Loader2 className="w-6 h-6 animate-spin" />
                        <span className="text-xs text-white/50">
                          Loading...
                        </span>
                      </div>
                    );
                  }
                  if (allItems.length === 0) {
                    return (
                      <div className="h-full flex flex-col items-center justify-center text-white/30 gap-3">
                        <FolderIcon className="w-10 h-10 stroke-1" />
                        <span className="text-sm text-white/50">
                          No files yet
                        </span>
                      </div>
                    );
                  }
                  return null;
                })()}
                {!workspaceFilesLoading && allItems.length > 0 && (
                  <FileExplorer
                    items={allItems}
                    onSelect={(item) => {
                      // Open file in inline viewer
                      openFileViewer(item);
                    }}
                  />
                )}
              </div>
            )}
          </div>
        ) : (
          <ChangesView
            fileSnapshots={currentThreadId ? theaterMode.threadFileSnapshots?.[currentThreadId] : undefined}
            sessionChanges={currentThreadId ? theaterMode.threadSessionChanges?.[currentThreadId] : undefined}
            workingDirectory={workingDirectory}
          />
        )}
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
  // Use a Map<string, node> keyed by full path for O(1) folder lookup
  const folderChildMaps = new Map<string, Map<string, FileTreeNode>>();
  const rootMap = new Map<string, FileTreeNode>();

  for (const item of items) {
    const filename = item.filename || item.name || item.title || "Untitled";
    const pathParts = filename.split("/").filter(Boolean);

    if (pathParts.length === 1) {
      rootMap.set(filename, { name: filename, path: filename, type: "file", item });
      continue;
    }

    let parentMap = rootMap;
    let currentPath = "";

    for (let i = 0; i < pathParts.length; i++) {
      const part = pathParts[i];
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      if (i === pathParts.length - 1) {
        // Leaf file
        parentMap.set(part, { name: part, path: currentPath, type: "file", item });
      } else {
        // Folder — ensure it exists
        if (!parentMap.has(part)) {
          parentMap.set(part, { name: part, path: currentPath, type: "folder", children: [] });
          folderChildMaps.set(currentPath, new Map());
        }
        parentMap = folderChildMaps.get(currentPath)!;
      }
    }
  }

  const sortNodes = (a: FileTreeNode, b: FileTreeNode) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name);
  };

  // Materialize children arrays from the child maps
  function materialize(map: Map<string, FileTreeNode>): FileTreeNode[] {
    return Array.from(map.values())
      .map((node) => {
        if (node.type === "folder") {
          const childMap = folderChildMaps.get(node.path);
          return { ...node, children: childMap ? materialize(childMap) : [] };
        }
        return node;
      })
      .sort(sortNodes);
  }

  return materialize(rootMap);
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
      (i) => i.workspaceSource === "generated" || i._source === "artifact",
    );
    const uploaded = items.filter(
      (i) => i.workspaceSource === "user" || i._source === "upload",
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

// File snapshot interface for tracking changes
interface FileSnapshot {
  originalContent: string;
  currentContent?: string;
  status: "created" | "modified" | "deleted";
  timestamp: number;
}

// Changes view component - VS Code style diff viewer
function ChangesView({
  fileSnapshots,
  sessionChanges,
  workingDirectory,
}: {
  readonly fileSnapshots?: { [filePath: string]: FileSnapshot };
  readonly sessionChanges?: {
    created: string[];
    modified: string[];
    deleted: string[];
  };
  readonly workingDirectory: { path: string; name: string } | null;
}) {
  const [selectedFile, setSelectedFile] = useState<{
    path: string;
    originalContent: string;
    currentContent: string;
    status: "created" | "modified" | "deleted";
  } | null>(null);
  const [isLoadingDiff, setIsLoadingDiff] = useState(false);
  const [diffViewMode, setDiffViewMode] = useState<"unified" | "split">(
    "unified",
  );

  // Combine all changed files from snapshots and sessionChanges
  const changedFiles = useMemo(() => {
    const files: Array<{
      path: string;
      filename: string;
      status: "created" | "modified" | "deleted";
      hasSnapshot: boolean;
    }> = [];

    // Add files from snapshots
    if (fileSnapshots) {
      for (const [path, snapshot] of Object.entries(fileSnapshots)) {
        files.push({
          path,
          filename: path.split("/").pop() || path,
          status: snapshot.status,
          hasSnapshot: true,
        });
      }
    }

    // Add files from sessionChanges that aren't already in snapshots
    if (sessionChanges) {
      const existingPaths = new Set(files.map((f) => f.path));

      for (const path of sessionChanges.created) {
        if (!existingPaths.has(path)) {
          files.push({
            path,
            filename: path.split("/").pop() || path,
            status: "created",
            hasSnapshot: false,
          });
        }
      }

      for (const path of sessionChanges.modified) {
        if (!existingPaths.has(path)) {
          files.push({
            path,
            filename: path.split("/").pop() || path,
            status: "modified",
            hasSnapshot: false,
          });
        }
      }

      for (const path of sessionChanges.deleted) {
        if (!existingPaths.has(path)) {
          files.push({
            path,
            filename: path.split("/").pop() || path,
            status: "deleted",
            hasSnapshot: false,
          });
        }
      }
    }

    // Sort: modified first, then created, then deleted
    return files.sort((a, b) => {
      const order = { modified: 0, created: 1, deleted: 2 };
      return order[a.status] - order[b.status];
    });
  }, [fileSnapshots, sessionChanges]);

  // Stats for the header
  const stats = useMemo(() => {
    let created = 0;
    let modified = 0;
    let deleted = 0;
    for (const file of changedFiles) {
      if (file.status === "created") created++;
      else if (file.status === "modified") modified++;
      else if (file.status === "deleted") deleted++;
    }
    return { created, modified, deleted, total: changedFiles.length };
  }, [changedFiles]);

  // Load diff content when a file is selected
  const handleFileSelect = useCallback(
    async (file: (typeof changedFiles)[0]) => {
      setIsLoadingDiff(true);

      try {
        const api =
          typeof window !== "undefined" ? (window as any).electronAPI : null;

        // Get snapshot data if available
        const snapshot = fileSnapshots?.[file.path];
        let originalContent = snapshot?.originalContent || "";
        let currentContent = snapshot?.currentContent || "";

        // If no current content in snapshot, read from disk
        if (
          !currentContent &&
          file.status !== "deleted" &&
          api?.files?.readTextFile
        ) {
          const filePath = file.path.startsWith("/")
            ? file.path
            : workingDirectory
              ? `${workingDirectory.path}/${file.path}`
              : file.path;

          const result = await api.files.readTextFile({ filePath });
          if (result.success && result.content !== null) {
            currentContent = result.content;
          }
        }

        // For created files, original is empty
        if (file.status === "created") {
          originalContent = "";
        }

        // For deleted files, current is empty
        if (file.status === "deleted") {
          currentContent = "";
        }

        setSelectedFile({
          path: file.path,
          originalContent,
          currentContent,
          status: file.status,
        });
      } catch (error) {
        console.error("[ChangesView] Error loading diff:", error);
        toast.error("Failed to load file diff");
      } finally {
        setIsLoadingDiff(false);
      }
    },
    [fileSnapshots, workingDirectory],
  );

  // If a file is selected, show the diff view
  if (selectedFile) {
    return (
      <div className="h-full flex flex-col">
        {/* Diff header */}
        <div className="flex items-center justify-between h-10 px-3 border-b border-white/10 flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => setSelectedFile(null)}
              className="p-1 text-white/50 hover:text-white hover:bg-white/10 rounded transition-colors"
              aria-label="Back to file list"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <FileTypeIcon
              filename={selectedFile.path.split("/").pop() || ""}
              size={14}
            />
            <span className="text-sm text-white/80 truncate font-mono">
              {selectedFile.path}
            </span>
            <span
              className={cn(
                "text-xs px-1.5 py-0.5 rounded",
                selectedFile.status === "created" &&
                  "bg-green-500/20 text-green-400",
                selectedFile.status === "modified" &&
                  "bg-yellow-500/20 text-yellow-400",
                selectedFile.status === "deleted" &&
                  "bg-red-500/20 text-red-400",
              )}
            >
              {selectedFile.status}
            </span>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {/* View mode toggle */}
            <div className="flex items-center bg-white/5 rounded-md p-0.5">
              <button
                type="button"
                onClick={() => setDiffViewMode("unified")}
                className={cn(
                  "px-2 py-1 text-xs rounded transition-colors",
                  diffViewMode === "unified"
                    ? "bg-white/10 text-white"
                    : "text-white/50 hover:text-white/80",
                )}
              >
                Unified
              </button>
              <button
                type="button"
                onClick={() => setDiffViewMode("split")}
                className={cn(
                  "px-2 py-1 text-xs rounded transition-colors",
                  diffViewMode === "split"
                    ? "bg-white/10 text-white"
                    : "text-white/50 hover:text-white/80",
                )}
              >
                Split
              </button>
            </div>
          </div>
        </div>

        {/* Diff content */}
        <div className="flex-1 overflow-auto p-3">
          {isLoadingDiff ? (
            <div className="h-full flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-white/30" />
            </div>
          ) : diffViewMode === "unified" ? (
            <DiffViewer
              original={selectedFile.originalContent}
              modified={selectedFile.currentContent}
              filename={selectedFile.path.split("/").pop()}
              showLineNumbers
            />
          ) : (
            <SideBySideDiff
              original={selectedFile.originalContent}
              modified={selectedFile.currentContent}
              filename={selectedFile.path.split("/").pop()}
              originalTitle="Before"
              modifiedTitle="After"
            />
          )}
        </div>
      </div>
    );
  }

  // File list view
  return (
    <div className="h-full flex flex-col">
      {/* Stats header */}
      {stats.total > 0 && (
        <div className="px-3 py-2 border-b border-white/10 flex items-center gap-4 text-xs flex-shrink-0">
          <span className="text-white/50">{stats.total} changed files</span>
          {stats.created > 0 && (
            <span className="flex items-center gap-1 text-green-400">
              <Plus className="w-3 h-3" />
              {stats.created} added
            </span>
          )}
          {stats.modified > 0 && (
            <span className="flex items-center gap-1 text-yellow-400">
              <Pencil className="w-3 h-3" />
              {stats.modified} modified
            </span>
          )}
          {stats.deleted > 0 && (
            <span className="flex items-center gap-1 text-red-400">
              <Minus className="w-3 h-3" />
              {stats.deleted} deleted
            </span>
          )}
        </div>
      )}

      {/* File list */}
      <div className="flex-1 overflow-y-auto">
        {changedFiles.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-white/30 gap-3">
            <Box className="w-10 h-10 stroke-1" />
            <span className="text-sm text-white/50">
              No changes in this session
            </span>
            <span className="text-xs text-white/30 max-w-[200px] text-center">
              File changes made during your session will appear here
            </span>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {changedFiles.map((file) => (
              <button
                key={file.path}
                type="button"
                className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/5 cursor-pointer transition-colors text-left"
                onClick={() => handleFileSelect(file)}
              >
                <div className="flex items-center gap-3 min-w-0">
                  {/* Status icon */}
                  <div
                    className={cn(
                      "w-5 h-5 rounded flex items-center justify-center flex-shrink-0",
                      file.status === "created" && "bg-green-500/20",
                      file.status === "modified" && "bg-yellow-500/20",
                      file.status === "deleted" && "bg-red-500/20",
                    )}
                  >
                    {file.status === "created" && (
                      <FilePlus className="w-3 h-3 text-green-400" />
                    )}
                    {file.status === "modified" && (
                      <Pencil className="w-3 h-3 text-yellow-400" />
                    )}
                    {file.status === "deleted" && (
                      <Trash2 className="w-3 h-3 text-red-400" />
                    )}
                  </div>

                  <FileTypeIcon filename={file.filename} size={16} />

                  <div className="flex flex-col min-w-0">
                    <span className="text-sm text-white/80 truncate">
                      {file.filename}
                    </span>
                    {file.path !== file.filename && (
                      <span className="text-xs text-white/40 truncate font-mono">
                        {file.path}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  {/* Status indicator dot */}
                  <div
                    className={cn(
                      "w-2 h-2 rounded-full",
                      file.status === "created" && "bg-green-400",
                      file.status === "modified" && "bg-yellow-400",
                      file.status === "deleted" && "bg-red-400",
                    )}
                  />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
