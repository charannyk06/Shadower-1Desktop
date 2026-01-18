import fs from "node:fs/promises";
import path from "node:path";
import { FileNotFoundError } from "lib/errors";
import { generateUUID } from "lib/utils";
import type {
  FileMetadata,
  FileStorage,
  UploadOptions,
} from "./file-storage.interface";
import { sanitizeFilename, toBuffer } from "./storage-utils";

const UPLOADS_DIR = path.join(process.cwd(), "public", "uploads");

// Ensure directory exists
const ensureDir = async () => {
  try {
    await fs.access(UPLOADS_DIR);
  } catch {
    await fs.mkdir(UPLOADS_DIR, { recursive: true });
  }
};

const buildPathname = (filename: string) => {
  const safeName = sanitizeFilename(filename);
  const id = generateUUID();
  // e.g. uploads/uuid-filename.ext (relative to public)
  return path.join("uploads", `${id}-${safeName}`);
};

export const createLocalFileStorage = (): FileStorage => {
  return {
    async upload(content, options: UploadOptions = {}) {
      await ensureDir();
      const buffer = await toBuffer(content);
      const filename = options.filename ?? "file";

      // Relative path for URL (uploads/...)
      const relativePath = buildPathname(filename);
      // Absolute path for saving
      const absolutePath = path.join(process.cwd(), "public", relativePath);

      await fs.writeFile(absolutePath, buffer);

      const metadata: FileMetadata = {
        key: relativePath,
        filename: path.basename(relativePath),
        contentType: options.contentType || "application/octet-stream",
        size: buffer.byteLength,
        uploadedAt: new Date(),
      };

      return {
        key: relativePath,
        sourceUrl: `/${relativePath}`, // Served from public
        metadata,
      };
    },

    // Local storage doesn't support presigned URLs, use fallback
    async createUploadUrl() {
      return null;
    },

    async download(key) {
      const absolutePath = path.join(process.cwd(), "public", key);
      try {
        return await fs.readFile(absolutePath);
      } catch (error: any) {
        if (error.code === "ENOENT") {
          throw new FileNotFoundError(key);
        }
        throw error;
      }
    },

    async delete(key) {
      const absolutePath = path.join(process.cwd(), "public", key);
      try {
        await fs.unlink(absolutePath);
      } catch (error: any) {
        if (error.code !== "ENOENT") throw error;
      }
    },

    async exists(key) {
      const absolutePath = path.join(process.cwd(), "public", key);
      try {
        await fs.access(absolutePath);
        return true;
      } catch {
        return false;
      }
    },

    async getMetadata(key) {
      const absolutePath = path.join(process.cwd(), "public", key);
      try {
        const stats = await fs.stat(absolutePath);
        return {
          key,
          filename: path.basename(key),
          contentType: "application/octet-stream", // Hard to know from fs stats, maybe guess from extension?
          size: stats.size,
          uploadedAt: stats.birthtime,
        };
      } catch (error: any) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
    },

    async getSourceUrl(key) {
      const exists = await this.exists(key);
      if (!exists) return null;
      return `/${key}`;
    },

    async getDownloadUrl(key) {
      return this.getSourceUrl(key);
    },
  };
};
