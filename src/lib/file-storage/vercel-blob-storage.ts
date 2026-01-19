/**
 * Vercel Blob Storage Stub - Cloud services removed for local-first architecture
 *
 * This file provides stub exports for compatibility with existing code.
 * File storage is handled locally in Electron.
 */

import logger from "logger";
import { FileNotFoundError } from "lib/errors";
import type {
  FileStorage,
  UploadOptions,
  UploadResult,
} from "./file-storage.interface";

/**
 * Creates a stub Vercel Blob storage that throws errors
 * Vercel Blob is a cloud service not available in local-first mode
 */
export function createVercelBlobStorage(): FileStorage {
  const notAvailableError = () => {
    throw new Error(
      "Vercel Blob storage is not available in local-first mode. " +
        "Please use 'local' storage driver instead by setting FILE_STORAGE_TYPE=local",
    );
  };

  return {
    async upload(
      _buffer: Buffer,
      _options: UploadOptions,
    ): Promise<UploadResult> {
      logger.error(
        "[Vercel Blob] Upload called but service not available in local-first mode",
      );
      notAvailableError();
      // TypeScript needs this even though notAvailableError throws
      throw new Error("Vercel Blob not available");
    },

    async download(_storageKey: string): Promise<Buffer> {
      logger.error(
        "[Vercel Blob] Download called but service not available in local-first mode",
      );
      notAvailableError();
      throw new FileNotFoundError("Vercel Blob not available");
    },

    async delete(_storageKey: string): Promise<void> {
      logger.error(
        "[Vercel Blob] Delete called but service not available in local-first mode",
      );
      notAvailableError();
    },

    async exists(_storageKey: string): Promise<boolean> {
      logger.warn(
        "[Vercel Blob] Exists called but service not available in local-first mode",
      );
      return false;
    },

    async getMetadata(storageKey: string) {
      logger.error(
        "[Vercel Blob] GetMetadata called but service not available in local-first mode",
      );
      notAvailableError();
      throw new FileNotFoundError(
        `Vercel Blob not available for key: ${storageKey}`,
      );
    },

    async getSourceUrl(_key: string): Promise<string | null> {
      logger.error(
        "[Vercel Blob] GetSourceUrl called but service not available in local-first mode",
      );
      notAvailableError();
      throw new Error("Vercel Blob not available");
    },
  };
}
