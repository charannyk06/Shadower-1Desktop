import { ipcMain, dialog, shell, BrowserWindow, app } from "electron";
import path from "path";
import os from "os";
import fs from "fs-extra";

/**
 * Validate that a file path is within allowed directories
 * Prevents path traversal attacks by ensuring paths are within:
 * - User's home directory
 * - System temp directory
 * - App's documents directory
 *
 * @param filePath - The path to validate
 * @returns true if the path is allowed, false otherwise
 */
function isPathAllowed(filePath: string): boolean {
  const resolvedPath = path.resolve(filePath);

  // Check for null bytes (path traversal attack vector)
  if (filePath.includes("\0")) {
    return false;
  }

  // Allowed base directories
  const allowedBases = [
    os.homedir(),
    os.tmpdir(),
    app.getPath("documents"),
    app.getPath("downloads"),
    app.getPath("desktop"),
  ];

  // Check if the resolved path starts with any allowed base
  return allowedBases.some((base) => {
    const normalizedBase = path.normalize(base);
    return resolvedPath.startsWith(normalizedBase);
  });
}

/**
 * Register dialog-related IPC handlers
 * Handles directory picking and opening directories in system file manager
 */
export function registerDialogHandlers() {
  // Open directory picker dialog
  ipcMain.handle(
    "dialog:openDirectory",
    async (
      _event,
      options?: {
        title?: string;
        defaultPath?: string;
        buttonLabel?: string;
      },
    ) => {
      try {
        const mainWindow = BrowserWindow.getFocusedWindow();

        const result = await dialog.showOpenDialog(
          mainWindow || (undefined as any),
          {
            title: options?.title || "Select Working Directory",
            defaultPath: options?.defaultPath || os.homedir(),
            buttonLabel: options?.buttonLabel || "Select",
            properties: ["openDirectory", "createDirectory"],
          },
        );

        if (result.canceled || result.filePaths.length === 0) {
          return { success: false, canceled: true };
        }

        const selectedPath = result.filePaths[0];

        return {
          success: true,
          canceled: false,
          path: selectedPath,
          name: path.basename(selectedPath),
        };
      } catch (error) {
        console.error("[Dialog] Error opening directory dialog:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  );

  // Open directory in system file manager (Finder on macOS, Explorer on Windows, etc.)
  ipcMain.handle(
    "dialog:openInFileManager",
    async (_event, directoryPath: string) => {
      try {
        // Input validation: Ensure directoryPath is a valid string
        if (
          !directoryPath ||
          typeof directoryPath !== "string" ||
          directoryPath.trim() === ""
        ) {
          console.error(
            "[Dialog] Invalid directory path provided:",
            directoryPath,
          );
          return { success: false, error: "Invalid directory path provided" };
        }

        // Security: Validate the path is within allowed directories
        if (!isPathAllowed(directoryPath)) {
          console.error("[Dialog] Path validation failed:", directoryPath);
          return {
            success: false,
            error: "Path is outside allowed directories.",
          };
        }

        // shell.openPath opens the directory in the system's default file manager
        const error = await shell.openPath(directoryPath);

        if (error) {
          return { success: false, error };
        }

        return { success: true };
      } catch (error) {
        console.error("[Dialog] Error opening in file manager:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  );

  // Reveal file/directory in file manager (highlights it)
  ipcMain.handle(
    "dialog:showInFileManager",
    async (_event, filePath: string) => {
      try {
        // Security: Validate the path is within allowed directories
        if (!isPathAllowed(filePath)) {
          console.error("[Dialog] Path validation failed:", filePath);
          return {
            success: false,
            error: "Path is outside allowed directories.",
          };
        }

        shell.showItemInFolder(filePath);
        return { success: true };
      } catch (error) {
        console.error("[Dialog] Error showing in file manager:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  );

  // Open file in default system application (Word, Excel, etc.)
  ipcMain.handle("shell:openPath", async (_event, filePath: string) => {
    try {
      // Security: Validate the path is within allowed directories
      if (!isPathAllowed(filePath)) {
        console.error("[Shell] Path validation failed:", filePath);
        return {
          success: false,
          error: "Path is outside allowed directories.",
        };
      }

      const error = await shell.openPath(filePath);
      if (error) {
        return { success: false, error };
      }
      return { success: true };
    } catch (error) {
      console.error("[Shell] Error opening file:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

  // Save file dialog - allows user to choose where to save a file
  ipcMain.handle(
    "dialog:saveFile",
    async (
      _event,
      options: {
        filename: string;
        content: string; // base64 encoded content
        defaultPath?: string;
        filters?: { name: string; extensions: string[] }[];
      },
    ) => {
      try {
        const mainWindow = BrowserWindow.getFocusedWindow();

        // Determine default path
        const ext = path.extname(options.filename).toLowerCase();
        const defaultFilters: { name: string; extensions: string[] }[] = [];

        if (ext === ".docx") {
          defaultFilters.push({ name: "Word Documents", extensions: ["docx"] });
        } else if (ext === ".xlsx") {
          defaultFilters.push({
            name: "Excel Spreadsheets",
            extensions: ["xlsx"],
          });
        } else if (ext === ".pptx") {
          defaultFilters.push({
            name: "PowerPoint Presentations",
            extensions: ["pptx"],
          });
        } else if (ext === ".pdf") {
          defaultFilters.push({ name: "PDF Documents", extensions: ["pdf"] });
        }
        defaultFilters.push({ name: "All Files", extensions: ["*"] });

        const result = await dialog.showSaveDialog(
          mainWindow || (undefined as any),
          {
            title: "Save Document",
            defaultPath:
              options.defaultPath ||
              path.join(app.getPath("documents"), options.filename),
            filters: options.filters || defaultFilters,
          },
        );

        if (result.canceled || !result.filePath) {
          return { success: false, canceled: true };
        }

        // Write the file
        const buffer = Buffer.from(options.content, "base64");
        await fs.writeFile(result.filePath, buffer);

        return {
          success: true,
          canceled: false,
          path: result.filePath,
          filename: path.basename(result.filePath),
        };
      } catch (error) {
        console.error("[Dialog] Error saving file:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  );

  // Write file to a specific path (for saving to working directory)
  ipcMain.handle(
    "files:writeToPath",
    async (
      _event,
      options: {
        filePath: string;
        content: string; // base64 encoded content
        trackChange?: boolean; // Whether to track this change in the session
      },
    ) => {
      try {
        // Security: Validate the path is within allowed directories
        if (!isPathAllowed(options.filePath)) {
          console.error(
            "[Files] Path validation failed - path outside allowed directories:",
            options.filePath,
          );
          return {
            success: false,
            error:
              "Path is outside allowed directories. Files can only be saved within your home directory.",
          };
        }

        // Check if file exists and read original content for diff tracking
        let originalContent: string | null = null;
        let isNewFile = false;
        try {
          const existingBuffer = await fs.readFile(options.filePath);
          originalContent = existingBuffer.toString("utf-8");
        } catch {
          // File doesn't exist, it's a new file
          isNewFile = true;
        }

        // Ensure the directory exists
        await fs.ensureDir(path.dirname(options.filePath));

        // Write the file
        const buffer = Buffer.from(options.content, "base64");
        const newContent = buffer.toString("utf-8");
        await fs.writeFile(options.filePath, buffer);

        // Emit file change event for diff tracking
        const fileChangeEvent = {
          filePath: options.filePath,
          filename: path.basename(options.filePath),
          status: isNewFile ? "created" : "modified",
          originalContent: originalContent,
          newContent: newContent,
          timestamp: Date.now(),
        };

        // Send to all renderer windows
        const { BrowserWindow } = require("electron");
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) {
            win.webContents.send("file:changed", fileChangeEvent);
          }
        }

        return {
          success: true,
          path: options.filePath,
          filename: path.basename(options.filePath),
          isNewFile,
          originalContent,
          newContent,
        };
      } catch (error) {
        console.error("[Files] Error writing file:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  );

  console.log("[Dialog] Dialog handlers registered");
}
