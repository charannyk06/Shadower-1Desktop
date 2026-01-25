import { ipcMain, app } from "electron";
import fs from "fs-extra";
import path from "path";
import os from "os";
import { ElectronFileStorage } from "../services/file-storage";

// File extensions to exclude from listing (build artifacts, dependencies, etc.)
const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  ".cache",
  "__pycache__",
  ".vscode",
  ".idea",
  "coverage",
  ".turbo",
  ".svn",
]);

// File extensions considered editable/relevant
const RELEVANT_EXTENSIONS = new Set([
  // JavaScript/TypeScript
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
  // Python
  ".py",
  // Web
  ".css", ".scss", ".sass", ".less", ".html", ".htm",
  // Data formats
  ".json", ".yaml", ".yml", ".xml", ".csv",
  // Shell scripts
  ".sh", ".bash", ".zsh",
  // Systems languages
  ".go", ".rs", ".rb", ".php", ".java", ".c", ".cpp", ".h", ".hpp", ".cs",
  // Mobile
  ".swift", ".kt",
  // Modern frameworks
  ".vue", ".svelte", ".astro",
  // Config
  ".toml", ".ini", ".cfg", ".conf", ".env",
  // Text/Documentation
  ".txt", ".md", ".markdown", ".rst", ".log",
  // SQL
  ".sql",
  // GraphQL
  ".graphql", ".gql",
]);

/**
 * Check if path is within allowed directories
 */
function isPathAllowed(filePath: string): boolean {
  const resolvedPath = path.resolve(filePath);
  if (filePath.includes("\0")) return false;

  const allowedBases = [
    os.homedir(),
    os.tmpdir(),
    app.getPath("documents"),
    app.getPath("downloads"),
    app.getPath("desktop"),
  ];

  return allowedBases.some((base) => {
    const normalizedBase = path.normalize(base);
    return resolvedPath.startsWith(normalizedBase);
  });
}

/**
 * List files in a directory (non-recursive, returns immediate children)
 */
async function listDirectoryFiles(
  dirPath: string,
  maxDepth: number = 3,
  currentDepth: number = 0
): Promise<Array<{
  name: string;
  path: string;
  relativePath: string;
  size: number;
  type: string;
  isDirectory: boolean;
  modifiedAt: string;
}>> {
  const results: Array<{
    name: string;
    path: string;
    relativePath: string;
    size: number;
    type: string;
    isDirectory: boolean;
    modifiedAt: string;
  }> = [];

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      // Skip hidden files and excluded directories
      if (entry.name.startsWith(".") && entry.name !== ".env") continue;
      if (entry.isDirectory() && EXCLUDED_DIRS.has(entry.name)) continue;

      const fullPath = path.join(dirPath, entry.name);

      try {
        const stats = await fs.stat(fullPath);

        if (entry.isDirectory()) {
          // Add directory entry
          results.push({
            name: entry.name,
            path: fullPath,
            relativePath: entry.name,
            size: 0,
            type: "directory",
            isDirectory: true,
            modifiedAt: stats.mtime.toISOString(),
          });

          // Recursively list contents if within depth limit
          if (currentDepth < maxDepth) {
            const subFiles = await listDirectoryFiles(fullPath, maxDepth, currentDepth + 1);
            for (const subFile of subFiles) {
              results.push({
                ...subFile,
                relativePath: path.join(entry.name, subFile.relativePath),
              });
            }
          }
        } else {
          // Check if file is relevant (code/config files)
          const ext = path.extname(entry.name).toLowerCase();
          const isRelevant = RELEVANT_EXTENSIONS.has(ext) || entry.name === "Makefile" || entry.name === "Dockerfile";

          // Only include relevant files
          if (isRelevant) {
            results.push({
              name: entry.name,
              path: fullPath,
              relativePath: entry.name,
              size: stats.size,
              type: getMimeType(entry.name),
              isDirectory: false,
              modifiedAt: stats.mtime.toISOString(),
            });
          }
        }
      } catch (_err) {
        // Skip files we can't access
        console.warn(`[Files] Skipping inaccessible file: ${fullPath}`);
      }
    }
  } catch (err) {
    console.error(`[Files] Error listing directory ${dirPath}:`, err);
  }

  return results;
}

/**
 * Get MIME type from filename
 */
function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".js": "text/javascript",
    ".jsx": "text/javascript",
    ".ts": "text/typescript",
    ".tsx": "text/typescript",
    ".json": "application/json",
    ".html": "text/html",
    ".css": "text/css",
    ".md": "text/markdown",
    ".py": "text/x-python",
    ".txt": "text/plain",
  };
  return mimeTypes[ext] || "text/plain";
}

/**
 * Register IPC handlers for file storage operations
 */
export function registerFileHandlers() {
  const fileStorage = ElectronFileStorage.getInstance();

  // Upload file
  ipcMain.handle(
    "files:upload",
    async (
      _event,
      data: {
        content: string | Buffer; // Base64 string or Buffer
        filename?: string;
        contentType?: string;
        category?: "uploads" | "fragments" | "exports" | "workspace";
      },
    ) => {
      try {
        // Convert base64 string to buffer if needed
        let buffer: Buffer;
        if (typeof data.content === "string") {
          buffer = Buffer.from(data.content, "base64");
        } else {
          buffer = data.content;
        }

        const result = await fileStorage.upload(buffer, {
          filename: data.filename,
          contentType: data.contentType,
          category: data.category,
        });

        return result;
      } catch (error) {
        console.error("[IPC] Error uploading file:", error);
        throw error;
      }
    },
  );

  // Download file
  ipcMain.handle("files:download", async (_event, key: string) => {
    try {
      const buffer = await fileStorage.download(key);
      // Return as base64 for transfer over IPC
      return buffer.toString("base64");
    } catch (error) {
      console.error("[IPC] Error downloading file:", error);
      throw error;
    }
  });

  // Delete file
  ipcMain.handle("files:delete", async (_event, key: string) => {
    try {
      await fileStorage.delete(key);
      return { success: true };
    } catch (error) {
      console.error("[IPC] Error deleting file:", error);
      throw error;
    }
  });

  // Check if file exists
  ipcMain.handle("files:exists", async (_event, key: string) => {
    try {
      return await fileStorage.exists(key);
    } catch (error) {
      console.error("[IPC] Error checking file existence:", error);
      throw error;
    }
  });

  // Get file metadata
  ipcMain.handle("files:getMetadata", async (_event, key: string) => {
    try {
      return await fileStorage.getMetadata(key);
    } catch (error) {
      console.error("[IPC] Error getting file metadata:", error);
      throw error;
    }
  });

  // Get source URL
  ipcMain.handle("files:getSourceUrl", async (_event, key: string) => {
    try {
      return await fileStorage.getSourceUrl(key);
    } catch (error) {
      console.error("[IPC] Error getting source URL:", error);
      throw error;
    }
  });

  // Get download URL
  ipcMain.handle("files:getDownloadUrl", async (_event, key: string) => {
    try {
      return await fileStorage.getDownloadUrl(key);
    } catch (error) {
      console.error("[IPC] Error getting download URL:", error);
      throw error;
    }
  });

  // List files in category
  ipcMain.handle(
    "files:listFiles",
    async (
      _event,
      category: "uploads" | "fragments" | "exports" | "workspace",
    ) => {
      try {
        return await fileStorage.listFiles(category);
      } catch (error) {
        console.error("[IPC] Error listing files:", error);
        throw error;
      }
    },
  );

  // Clear category
  ipcMain.handle(
    "files:clearCategory",
    async (
      _event,
      category: "uploads" | "fragments" | "exports" | "workspace",
    ) => {
      try {
        await fileStorage.clearCategory(category);
        return { success: true };
      } catch (error) {
        console.error("[IPC] Error clearing category:", error);
        throw error;
      }
    },
  );

  // Get storage statistics
  ipcMain.handle("files:getStats", async () => {
    try {
      return await fileStorage.getStats();
    } catch (error) {
      console.error("[IPC] Error getting storage stats:", error);
      throw error;
    }
  });

  // Read a text file from the filesystem
  ipcMain.handle(
    "files:readTextFile",
    async (
      _event,
      options: {
        filePath: string;
        maxSize?: number; // Max file size in bytes (default 10MB)
      }
    ) => {
      try {
        const { filePath, maxSize = 10 * 1024 * 1024 } = options;

        // Security: Validate the path is within allowed directories
        if (!isPathAllowed(filePath)) {
          console.error("[Files] Path validation failed:", filePath);
          return {
            success: false,
            error: "Path is outside allowed directories",
            content: null,
          };
        }

        // Check if file exists
        const exists = await fs.pathExists(filePath);
        if (!exists) {
          return {
            success: false,
            error: "File does not exist",
            content: null,
          };
        }

        // Check file size
        const stats = await fs.stat(filePath);
        if (stats.size > maxSize) {
          return {
            success: false,
            error: `File too large (${Math.round(stats.size / 1024 / 1024)}MB). Maximum allowed is ${Math.round(maxSize / 1024 / 1024)}MB.`,
            content: null,
          };
        }

        // Read file content
        const content = await fs.readFile(filePath, "utf-8");

        console.log(`[Files] Read text file: ${filePath} (${content.length} chars)`);

        return {
          success: true,
          content,
          size: stats.size,
          modifiedAt: stats.mtime.toISOString(),
        };
      } catch (error) {
        console.error("[IPC] Error reading text file:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
          content: null,
        };
      }
    }
  );

  // List files in a working directory (the user's selected folder)
  ipcMain.handle(
    "files:listWorkingDirectory",
    async (
      _event,
      options: {
        directoryPath: string;
        maxDepth?: number;
      }
    ) => {
      try {
        const { directoryPath, maxDepth = 3 } = options;

        // Security: Validate the path is within allowed directories
        if (!isPathAllowed(directoryPath)) {
          console.error("[Files] Path validation failed:", directoryPath);
          return {
            success: false,
            error: "Path is outside allowed directories",
            files: [],
          };
        }

        // Check if directory exists
        const exists = await fs.pathExists(directoryPath);
        if (!exists) {
          return {
            success: false,
            error: "Directory does not exist",
            files: [],
          };
        }

        // List files
        const files = await listDirectoryFiles(directoryPath, maxDepth);

        console.log(`[Files] Listed ${files.length} files from working directory: ${directoryPath}`);

        return {
          success: true,
          files: files.map((f) => ({
            name: f.name,
            path: f.path,
            relativePath: f.relativePath,
            size: f.size,
            type: f.type,
            isDirectory: f.isDirectory,
            uploadedAt: f.modifiedAt,
            source: "working-directory" as const,
          })),
        };
      } catch (error) {
        console.error("[IPC] Error listing working directory:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
          files: [],
        };
      }
    }
  );

  console.log("[IPC] File handlers registered");
}
