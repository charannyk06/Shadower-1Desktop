import { ipcMain } from "electron";
import { ElectronFileStorage } from "../services/file-storage";

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

  console.log("[IPC] File handlers registered");
}
