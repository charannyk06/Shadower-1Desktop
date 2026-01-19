import { app } from "electron";
import fs from "fs-extra";
import path from "path";
import { randomUUID } from "crypto";

export interface FileMetadata {
  key: string;
  filename: string;
  contentType: string;
  size: number;
  uploadedAt?: Date;
}

export interface UploadOptions {
  filename?: string;
  contentType?: string;
}

export interface UploadResult {
  key: string;
  sourceUrl: string; // file:// URL
  pathname: string; // Absolute file path
  metadata: FileMetadata;
}

type UploadContent = Buffer | string;

/**
 * Local file storage service for Electron
 * Stores files in the app data directory: ~/Library/Application Support/Shadower/files/
 */
export class ElectronFileStorage {
  private static instance: ElectronFileStorage;
  private baseDir: string;
  private uploadsDir: string;
  private fragmentsDir: string;
  private exportsDir: string;
  private sandboxDir: string;

  private constructor() {
    // Base directory for all app data
    this.baseDir = path.join(app.getPath("userData"), "files");

    // Subdirectories for different file types
    this.uploadsDir = path.join(this.baseDir, "uploads");
    this.fragmentsDir = path.join(this.baseDir, "fragments");
    this.exportsDir = path.join(this.baseDir, "exports");
    this.sandboxDir = path.join(this.baseDir, "sandbox");
  }

  static getInstance(): ElectronFileStorage {
    if (!ElectronFileStorage.instance) {
      ElectronFileStorage.instance = new ElectronFileStorage();
    }
    return ElectronFileStorage.instance;
  }

  /**
   * Initialize file storage directories
   */
  async initialize(): Promise<void> {
    await fs.ensureDir(this.uploadsDir);
    await fs.ensureDir(this.fragmentsDir);
    await fs.ensureDir(this.exportsDir);
    await fs.ensureDir(this.sandboxDir);
    console.log("[FileStorage] Initialized at:", this.baseDir);
  }

  /**
   * Sanitize filename to prevent directory traversal attacks
   */
  private sanitizeFilename(filename: string): string {
    // Remove path separators and null bytes
    return filename.replace(/[\/\\]/g, "_").replace(/\0/g, "");
  }

  /**
   * Build unique pathname for a file
   */
  private buildPathname(
    filename: string,
    category: "uploads" | "fragments" | "exports" | "sandbox",
  ): string {
    const safeName = this.sanitizeFilename(filename);
    const id = randomUUID();
    const dir = this[`${category}Dir`];
    return path.join(dir, `${id}-${safeName}`);
  }

  /**
   * Convert file path to file:// URL
   */
  private pathToFileUrl(filePath: string): string {
    // Ensure forward slashes for URLs
    const normalizedPath = filePath.replace(/\\/g, "/");
    return `file://${normalizedPath}`;
  }

  /**
   * Upload file content
   */
  async upload(
    content: UploadContent,
    options: UploadOptions & {
      category?: "uploads" | "fragments" | "exports" | "sandbox";
    } = {},
  ): Promise<UploadResult> {
    const filename = options.filename || "file";
    const category = options.category || "uploads";
    const contentType = options.contentType || "application/octet-stream";

    // Convert content to buffer
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);

    // Build absolute file path
    const absolutePath = this.buildPathname(filename, category);

    // Write file
    await fs.writeFile(absolutePath, buffer);

    // Get file stats
    const stats = await fs.stat(absolutePath);

    const metadata: FileMetadata = {
      key: path.relative(this.baseDir, absolutePath),
      filename: path.basename(absolutePath),
      contentType,
      size: stats.size,
      uploadedAt: new Date(),
    };

    return {
      key: metadata.key,
      sourceUrl: this.pathToFileUrl(absolutePath),
      pathname: absolutePath,
      metadata,
    };
  }

  /**
   * Download file content by key
   */
  async download(key: string): Promise<Buffer> {
    const absolutePath = path.join(this.baseDir, key);

    // Prevent directory traversal
    if (!absolutePath.startsWith(this.baseDir)) {
      throw new Error("Invalid file key: path traversal detected");
    }

    const exists = await fs.pathExists(absolutePath);
    if (!exists) {
      throw new Error(`File not found: ${key}`);
    }

    return fs.readFile(absolutePath);
  }

  /**
   * Delete file by key
   */
  async delete(key: string): Promise<void> {
    const absolutePath = path.join(this.baseDir, key);

    // Prevent directory traversal
    if (!absolutePath.startsWith(this.baseDir)) {
      throw new Error("Invalid file key: path traversal detected");
    }

    const exists = await fs.pathExists(absolutePath);
    if (exists) {
      await fs.unlink(absolutePath);
    }
  }

  /**
   * Check if file exists
   */
  async exists(key: string): Promise<boolean> {
    const absolutePath = path.join(this.baseDir, key);

    // Prevent directory traversal
    if (!absolutePath.startsWith(this.baseDir)) {
      return false;
    }

    return fs.pathExists(absolutePath);
  }

  /**
   * Get file metadata
   */
  async getMetadata(key: string): Promise<FileMetadata | null> {
    const absolutePath = path.join(this.baseDir, key);

    // Prevent directory traversal
    if (!absolutePath.startsWith(this.baseDir)) {
      return null;
    }

    const exists = await fs.pathExists(absolutePath);
    if (!exists) {
      return null;
    }

    const stats = await fs.stat(absolutePath);

    return {
      key,
      filename: path.basename(key),
      contentType: "application/octet-stream", // Could improve by guessing from extension
      size: stats.size,
      uploadedAt: stats.birthtime,
    };
  }

  /**
   * Get file:// source URL
   */
  async getSourceUrl(key: string): Promise<string | null> {
    const absolutePath = path.join(this.baseDir, key);

    // Prevent directory traversal
    if (!absolutePath.startsWith(this.baseDir)) {
      return null;
    }

    const exists = await fs.pathExists(absolutePath);
    if (!exists) {
      return null;
    }

    return this.pathToFileUrl(absolutePath);
  }

  /**
   * Get download URL (same as source URL for local files)
   */
  async getDownloadUrl(key: string): Promise<string | null> {
    return this.getSourceUrl(key);
  }

  /**
   * List all files in a category
   */
  async listFiles(
    category: "uploads" | "fragments" | "exports" | "sandbox",
  ): Promise<FileMetadata[]> {
    const dir = this[`${category}Dir`];
    const exists = await fs.pathExists(dir);

    if (!exists) {
      return [];
    }

    const files = await fs.readdir(dir);
    const metadata: FileMetadata[] = [];

    for (const file of files) {
      const absolutePath = path.join(dir, file);
      const stats = await fs.stat(absolutePath);

      if (stats.isFile()) {
        const key = path.relative(this.baseDir, absolutePath);
        metadata.push({
          key,
          filename: file,
          contentType: "application/octet-stream",
          size: stats.size,
          uploadedAt: stats.birthtime,
        });
      }
    }

    return metadata;
  }

  /**
   * Delete all files in a category
   */
  async clearCategory(
    category: "uploads" | "fragments" | "exports" | "sandbox",
  ): Promise<void> {
    const dir = this[`${category}Dir`];
    const exists = await fs.pathExists(dir);

    if (exists) {
      await fs.emptyDir(dir);
    }
  }

  /**
   * Get storage statistics
   */
  async getStats(): Promise<{
    totalFiles: number;
    totalSize: number;
    categories: Record<string, { files: number; size: number }>;
  }> {
    const categories = ["uploads", "fragments", "exports", "sandbox"] as const;
    const stats = {
      totalFiles: 0,
      totalSize: 0,
      categories: {} as Record<string, { files: number; size: number }>,
    };

    for (const category of categories) {
      const files = await this.listFiles(category);
      const categorySize = files.reduce((sum, file) => sum + file.size, 0);

      stats.categories[category] = {
        files: files.length,
        size: categorySize,
      };

      stats.totalFiles += files.length;
      stats.totalSize += categorySize;
    }

    return stats;
  }
}
