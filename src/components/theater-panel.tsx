"use client";

import { useAppStore } from "@/app/store";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import {
  Box,
  ChevronRight,
  FolderIcon,
  Loader2,
  Maximize2,
  Minimize2,
  Search,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { FileTypeIcon } from "./file-type-icon";

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
  "js", "jsx", "ts", "tsx", "mjs", "cjs",
  // Python
  "py",
  // Web
  "css", "scss", "sass", "less", "html", "htm",
  // Data formats
  "json", "yaml", "yml", "xml", "csv",
  // Shell scripts
  "sh", "bash", "zsh",
  // Systems languages
  "go", "rs", "rb", "php", "java", "c", "cpp", "h", "hpp", "cs",
  // Mobile
  "swift", "kt",
  // Other languages
  "scala", "r", "lua", "pl", "pm", "ex", "exs", "erl", "hrl", "clj", "cljs", "hs", "elm",
  // Modern frameworks
  "vue", "svelte", "astro",
  // GraphQL
  "graphql", "gql",
  // Config
  "toml", "ini", "cfg", "conf", "env", "gitignore", "dockerfile", "makefile", "cmake",
  // Text/Documentation
  "txt", "text", "md", "markdown", "rst", "log",
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

  const [activeTab, setActiveTab] = useState<"all-files" | "changes">(
    theaterMode.defaultTab || "all-files",
  );
  const [isMaximized, setIsMaximized] = useState(false);
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFileMetadata[]>([]);
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

  // Fetch workspace files from API when theater opens, thread changes, or files version changes
  useEffect(() => {
    if (!currentThreadId) {
      setWorkspaceFiles([]);
      return;
    }

    // Always fetch when theater is open
    // This ensures we get the latest files every time the panel is opened
    if (!theaterMode.isOpen) {
      return;
    }

    let cancelled = false;
    setWorkspaceFilesLoading(true);

    console.log(
      "[TheaterPanel] Fetching workspace files for thread:",
      currentThreadId,
      "version:",
      filesVersion,
    );

    // Use Electron IPC if available - this is an Electron desktop app
    const api =
      typeof window !== "undefined" ? (window as any).electronAPI : null;

    if (api?.files?.listFiles) {
      // Use IPC to list workspace files
      api.files
        .listFiles("workspace")
        .then((files: any[]) => {
          if (cancelled) return;
          // Filter files for this thread (if they have thread metadata)
          const threadFiles = files.filter(
            (f: any) => !f.threadId || f.threadId === currentThreadId,
          );
          console.log(
            "[TheaterPanel] Received workspace files via IPC:",
            threadFiles.length,
          );
          setWorkspaceFiles(threadFiles);
        })
        .catch((err: Error) => {
          if (cancelled) return;
          console.error("Failed to load workspace files via IPC:", err);
          setWorkspaceFiles([]);
        })
        .finally(() => {
          if (!cancelled) setWorkspaceFilesLoading(false);
        });
    } else {
      // No Electron API available - just return empty array
      // In Electron desktop app, HTTP endpoints require auth that's handled via IPC
      console.log(
        "[TheaterPanel] Electron API not available, skipping workspace files fetch",
      );
      setWorkspaceFiles([]);
      setWorkspaceFilesLoading(false);
    }

    return () => {
      cancelled = true;
    };
  }, [theaterMode.isOpen, currentThreadId, filesVersion]);

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
    const content = item.content || "";

    // Determine if editable using the utility function (O(1) Set lookup)
    const isEditable = isEditableFile(filename);

    setSelectedFile({
      path: item.storageKey || item.url || filename,
      content: typeof content === "string" ? content : JSON.stringify(content, null, 2),
      title: filename,
      isEditable,
      storageKey: item.storageKey,
    });
    setEditedContent(typeof content === "string" ? content : JSON.stringify(content, null, 2));
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
      const api = typeof window !== "undefined" ? (window as any).electronAPI : null;
      if (api?.dialog?.writeToPath && selectedFile.path) {
        await api.dialog.writeToPath(selectedFile.path, editedContent);
        toast.success("File saved");
        setSelectedFile((prev) => prev ? { ...prev, content: editedContent } : null);
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
                : "text-white/50 hover:text-white/80 hover:bg-white/5"
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
                : "text-white/50 hover:text-white/80 hover:bg-white/5"
            )}
          >
            Changes
            {allItems.length > 0 && (
              <span className="text-xs text-white/60">{allItems.length}</span>
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
                    <span className="text-sm text-white/80 truncate">{selectedFile.title}</span>
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
                        <span className="text-xs text-white/50">Loading...</span>
                      </div>
                    );
                  }
                  if (allItems.length === 0) {
                    return (
                      <div className="h-full flex flex-col items-center justify-center text-white/30 gap-3">
                        <FolderIcon className="w-10 h-10 stroke-1" />
                        <span className="text-sm text-white/50">No files yet</span>
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
          <div className="h-full w-full flex flex-col">
            {/* Changes tab - shows git status + session changes */}
            <div className="flex-1 overflow-y-auto">
              {allItems.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-white/30 gap-3">
                  <Box className="w-10 h-10 stroke-1" />
                  <span className="text-sm text-white/50">No changes</span>
                </div>
              ) : (
                <div className="divide-y divide-white/5">
                  {allItems.map((item, idx) => (
                    <div
                      key={item.id || idx}
                      className="flex items-center justify-between px-4 py-2.5 hover:bg-white/5 cursor-pointer transition-colors"
                      onClick={() => {
                        // Open file in inline viewer and switch to All files tab
                        openFileViewer(item);
                        setActiveTab("all-files");
                      }}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <FileTypeIcon
                          filename={item.filename || item.name}
                          size={16}
                        />
                        <span className="text-sm text-white/80 truncate">
                          {item.filename || item.name || item.title}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {/* Status indicator - yellow for modified */}
                        <div className="w-2 h-2 rounded-sm bg-yellow-500/80" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
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
