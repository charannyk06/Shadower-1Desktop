/**
 * File Watcher Service
 * 
 * Watches project files for external changes and notifies the ACP agent.
 * Implements P1 Gap #5 from ACP_GAP_ANALYSIS.md
 * 
 * Features:
 * - Watch directories for file changes
 * - Debounce rapid changes
 * - Ignore common non-essential files (node_modules, .git, etc.)
 * - Notify renderer and agent of changes
 * - Track file content hashes to detect real changes
 */

import { watch, FSWatcher } from "chokidar";
import { createHash } from "crypto";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join, relative, basename, extname } from "path";
import { EventEmitter } from "events";
import { BrowserWindow } from "electron";

// Default patterns to ignore
const DEFAULT_IGNORE_PATTERNS = [
  "**/node_modules/**",
  "**/.git/**",
  "**/.svn/**",
  "**/.hg/**",
  "**/dist/**",
  "**/build/**",
  "**/out/**",
  "**/.next/**",
  "**/.nuxt/**",
  "**/.cache/**",
  "**/coverage/**",
  "**/__pycache__/**",
  "**/.pytest_cache/**",
  "**/*.pyc",
  "**/.DS_Store",
  "**/Thumbs.db",
  "**/*.log",
  "**/*.tmp",
  "**/*.temp",
  "**/*.swp",
  "**/*.swo",
  "**/package-lock.json",
  "**/pnpm-lock.yaml",
  "**/yarn.lock",
  "**/composer.lock",
  "**/Gemfile.lock",
  "**/Cargo.lock",
  "**/.env.local",
  "**/.env.*.local",
];

// File extensions to track content changes (text files)
const TEXT_FILE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".yaml", ".yml", ".toml",
  ".md", ".mdx", ".txt", ".rst",
  ".html", ".htm", ".css", ".scss", ".sass", ".less",
  ".py", ".pyw", ".pyi",
  ".rb", ".erb",
  ".go",
  ".rs",
  ".java", ".kt", ".kts",
  ".c", ".cpp", ".h", ".hpp", ".cc", ".cxx",
  ".cs",
  ".php",
  ".swift",
  ".vue", ".svelte",
  ".sql",
  ".sh", ".bash", ".zsh", ".fish",
  ".ps1", ".psm1", ".psd1",
  ".bat", ".cmd",
  ".dockerfile", ".dockerignore",
  ".gitignore", ".gitattributes",
  ".editorconfig",
  ".env", ".env.example",
  ".xml", ".svg",
  ".graphql", ".gql",
  ".prisma",
  ".proto",
]);

/**
 * File change event
 */
export interface FileChangeEvent {
  /** Absolute path to the file */
  path: string;
  /** Relative path from watched directory */
  relativePath: string;
  /** File name */
  filename: string;
  /** Type of change */
  type: "add" | "change" | "unlink" | "addDir" | "unlinkDir";
  /** Whether this is an external change (not from agent) */
  isExternal: boolean;
  /** Session ID if tracked */
  sessionId?: string;
  /** Thread ID if tracked */
  threadId?: string;
  /** File content hash (for change detection) */
  hash?: string;
  /** Previous content hash (if changed) */
  previousHash?: string;
  /** Timestamp of the change */
  timestamp: number;
}

/**
 * Watcher configuration
 */
export interface WatcherConfig {
  /** Directory to watch */
  directory: string;
  /** Session ID to associate changes with */
  sessionId?: string;
  /** Thread ID to associate changes with */
  threadId?: string;
  /** Additional patterns to ignore */
  ignorePatterns?: string[];
  /** Whether to watch subdirectories */
  recursive?: boolean;
  /** Debounce delay in ms */
  debounceMs?: number;
  /** Whether to track content hashes */
  trackHashes?: boolean;
}

/**
 * Active watcher instance
 */
interface ActiveWatcher {
  watcher: FSWatcher;
  config: WatcherConfig;
  fileHashes: Map<string, string>;
  pendingChanges: Map<string, FileChangeEvent>;
  debounceTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * File Watcher Service
 */
export class FileWatcherService extends EventEmitter {
  private watchers: Map<string, ActiveWatcher> = new Map();
  private agentModifiedFiles: Set<string> = new Set();
  private agentModificationTimeout: Map<string, ReturnType<typeof setTimeout>> = new Map();
  
  // How long to consider a file "recently modified by agent" (ms)
  private readonly AGENT_MODIFICATION_WINDOW = 2000;
  
  constructor() {
    super();
  }
  
  /**
   * Start watching a directory
   */
  async startWatching(config: WatcherConfig): Promise<void> {
    const { directory, sessionId, threadId, ignorePatterns = [], recursive = true, debounceMs = 300, trackHashes = true } = config;
    
    // Check if already watching
    if (this.watchers.has(directory)) {
      console.log(`[FileWatcher] Already watching: ${directory}`);
      return;
    }
    
    // Verify directory exists
    if (!existsSync(directory)) {
      throw new Error(`Directory does not exist: ${directory}`);
    }
    
    console.log(`[FileWatcher] Starting watch on: ${directory}`);
    
    // Create chokidar watcher
    const watcher = watch(directory, {
      ignored: [...DEFAULT_IGNORE_PATTERNS, ...ignorePatterns],
      persistent: true,
      ignoreInitial: true, // Don't emit events for existing files
      followSymlinks: false,
      depth: recursive ? undefined : 0,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100,
      },
    });
    
    // Create active watcher state
    const activeWatcher: ActiveWatcher = {
      watcher,
      config: { ...config, debounceMs, trackHashes },
      fileHashes: new Map(),
      pendingChanges: new Map(),
      debounceTimer: null,
    };
    
    // Set up event handlers
    watcher.on("add", (path) => this._handleChange(directory, path, "add", activeWatcher));
    watcher.on("change", (path) => this._handleChange(directory, path, "change", activeWatcher));
    watcher.on("unlink", (path) => this._handleChange(directory, path, "unlink", activeWatcher));
    watcher.on("addDir", (path) => this._handleChange(directory, path, "addDir", activeWatcher));
    watcher.on("unlinkDir", (path) => this._handleChange(directory, path, "unlinkDir", activeWatcher));
    
    watcher.on("error", (error) => {
      console.error(`[FileWatcher] Error watching ${directory}:`, error);
      this.emit("error", { directory, error });
    });
    
    watcher.on("ready", () => {
      console.log(`[FileWatcher] Ready: ${directory}`);
      this.emit("ready", { directory });
    });
    
    this.watchers.set(directory, activeWatcher);
  }
  
  /**
   * Stop watching a directory
   */
  async stopWatching(directory: string): Promise<void> {
    const activeWatcher = this.watchers.get(directory);
    if (!activeWatcher) {
      return;
    }
    
    console.log(`[FileWatcher] Stopping watch on: ${directory}`);
    
    // Clear debounce timer
    if (activeWatcher.debounceTimer) {
      clearTimeout(activeWatcher.debounceTimer);
    }
    
    // Close watcher
    await activeWatcher.watcher.close();
    
    this.watchers.delete(directory);
  }
  
  /**
   * Stop all watchers
   */
  async stopAll(): Promise<void> {
    const directories = Array.from(this.watchers.keys());
    await Promise.all(directories.map((dir) => this.stopWatching(dir)));
  }
  
  /**
   * Mark a file as modified by the agent (to ignore the next change event)
   */
  markAgentModification(filePath: string): void {
    this.agentModifiedFiles.add(filePath);
    
    // Clear any existing timeout
    const existingTimeout = this.agentModificationTimeout.get(filePath);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }
    
    // Set timeout to remove the mark
    const timeout = setTimeout(() => {
      this.agentModifiedFiles.delete(filePath);
      this.agentModificationTimeout.delete(filePath);
    }, this.AGENT_MODIFICATION_WINDOW);
    
    this.agentModificationTimeout.set(filePath, timeout);
  }
  
  /**
   * Check if a file was recently modified by the agent
   */
  isAgentModification(filePath: string): boolean {
    return this.agentModifiedFiles.has(filePath);
  }
  
  /**
   * Handle a file change event
   */
  private async _handleChange(
    directory: string,
    filePath: string,
    type: FileChangeEvent["type"],
    activeWatcher: ActiveWatcher
  ): Promise<void> {
    const { config, fileHashes, pendingChanges, debounceTimer } = activeWatcher;
    
    // Check if this is an agent modification
    const isExternal = !this.isAgentModification(filePath);
    
    // If it's an agent modification, just update the hash and skip
    if (!isExternal) {
      console.log(`[FileWatcher] Ignoring agent modification: ${filePath}`);
      this.agentModifiedFiles.delete(filePath);
      
      // Update hash if tracking
      if (config.trackHashes && type !== "unlink" && type !== "unlinkDir") {
        const hash = await this._computeHash(filePath);
        if (hash) {
          fileHashes.set(filePath, hash);
        }
      }
      return;
    }
    
    // Compute hash for change detection
    let hash: string | undefined;
    let previousHash: string | undefined;
    
    if (config.trackHashes && type !== "unlink" && type !== "unlinkDir") {
      hash = await this._computeHash(filePath);
      previousHash = fileHashes.get(filePath);
      
      // Skip if hash hasn't changed (false positive)
      if (type === "change" && hash && previousHash && hash === previousHash) {
        console.log(`[FileWatcher] Skipping unchanged file: ${filePath}`);
        return;
      }
      
      if (hash) {
        fileHashes.set(filePath, hash);
      }
    } else if (type === "unlink" || type === "unlinkDir") {
      fileHashes.delete(filePath);
    }
    
    // Create change event
    const event: FileChangeEvent = {
      path: filePath,
      relativePath: relative(directory, filePath),
      filename: basename(filePath),
      type,
      isExternal,
      sessionId: config.sessionId,
      threadId: config.threadId,
      hash,
      previousHash,
      timestamp: Date.now(),
    };
    
    // Add to pending changes (debounce)
    pendingChanges.set(filePath, event);
    
    // Clear existing debounce timer
    if (activeWatcher.debounceTimer) {
      clearTimeout(activeWatcher.debounceTimer);
    }
    
    // Set new debounce timer
    activeWatcher.debounceTimer = setTimeout(() => {
      this._flushPendingChanges(directory, activeWatcher);
    }, config.debounceMs || 300);
  }
  
  /**
   * Flush pending changes after debounce
   */
  private _flushPendingChanges(directory: string, activeWatcher: ActiveWatcher): void {
    const { pendingChanges, config } = activeWatcher;
    
    if (pendingChanges.size === 0) {
      return;
    }
    
    const changes = Array.from(pendingChanges.values());
    pendingChanges.clear();
    activeWatcher.debounceTimer = null;
    
    console.log(`[FileWatcher] ${changes.length} external file change(s) in ${directory}`);
    
    // Emit events
    for (const change of changes) {
      this.emit("change", change);
      
      // Also emit to specific type event
      this.emit(change.type, change);
    }
    
    // Emit batch event
    this.emit("changes", {
      directory,
      sessionId: config.sessionId,
      threadId: config.threadId,
      changes,
      timestamp: Date.now(),
    });
    
    // Forward to renderer
    this._forwardToRenderer(changes);
  }
  
  /**
   * Compute MD5 hash of file content
   */
  private async _computeHash(filePath: string): Promise<string | undefined> {
    try {
      // Only hash text files
      const ext = extname(filePath).toLowerCase();
      if (!TEXT_FILE_EXTENSIONS.has(ext)) {
        return undefined;
      }
      
      const content = await readFile(filePath);
      return createHash("md5").update(content).digest("hex");
    } catch {
      return undefined;
    }
  }
  
  /**
   * Forward change events to renderer windows
   */
  private _forwardToRenderer(changes: FileChangeEvent[]): void {
    const windows = BrowserWindow.getAllWindows();
    
    for (const win of windows) {
      try {
        if (!win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
          win.webContents.send("file-watcher:changes", {
            changes,
            timestamp: Date.now(),
          });
        }
      } catch (err) {
        console.error("[FileWatcher] Failed to forward to renderer:", err);
      }
    }
  }
  
  /**
   * Get watched directories
   */
  getWatchedDirectories(): string[] {
    return Array.from(this.watchers.keys());
  }
  
  /**
   * Check if a directory is being watched
   */
  isWatching(directory: string): boolean {
    return this.watchers.has(directory);
  }
  
  /**
   * Get watcher stats
   */
  getStats(): {
    watchedDirectories: number;
    trackedFiles: number;
    pendingChanges: number;
  } {
    let trackedFiles = 0;
    let pendingChanges = 0;
    
    for (const watcher of this.watchers.values()) {
      trackedFiles += watcher.fileHashes.size;
      pendingChanges += watcher.pendingChanges.size;
    }
    
    return {
      watchedDirectories: this.watchers.size,
      trackedFiles,
      pendingChanges,
    };
  }
}

// Singleton instance
let fileWatcherService: FileWatcherService | null = null;

export function getFileWatcherService(): FileWatcherService {
  if (!fileWatcherService) {
    fileWatcherService = new FileWatcherService();
  }
  return fileWatcherService;
}

/**
 * Clean up on app quit
 */
export async function cleanupFileWatcher(): Promise<void> {
  if (fileWatcherService) {
    await fileWatcherService.stopAll();
    fileWatcherService = null;
  }
}
