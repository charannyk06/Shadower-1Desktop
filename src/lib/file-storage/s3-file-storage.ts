/**
 * S3 File Storage Stub - Cloud services removed for local-first architecture
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
 * Creates a stub S3 storage that throws errors
 * AWS S3 is a cloud service not available in local-first mode
 */
export function createS3FileStorage(): FileStorage {
  const notAvailableError = () => {
    throw new Error(
      "S3 storage is not available in local-first mode. " +
        "Please use 'local' storage driver instead by setting FILE_STORAGE_TYPE=local",
    );
  };

  return {
    async upload(
      _buffer: Buffer,
      _options: UploadOptions,
    ): Promise<UploadResult> {
      logger.error(
        "[S3] Upload called but service not available in local-first mode",
      );
      notAvailableError();
      throw new Error("S3 not available");
    },

    async download(_storageKey: string): Promise<Buffer> {
      logger.error(
        "[S3] Download called but service not available in local-first mode",
      );
      notAvailableError();
      throw new FileNotFoundError("S3 not available");
    },

    async delete(_storageKey: string): Promise<void> {
      logger.error(
        "[S3] Delete called but service not available in local-first mode",
      );
      notAvailableError();
    },

    async exists(_storageKey: string): Promise<boolean> {
      logger.warn(
        "[S3] Exists called but service not available in local-first mode",
      );
      return false;
    },

    async getMetadata(storageKey: string) {
      logger.error(
        "[S3] GetMetadata called but service not available in local-first mode",
      );
      notAvailableError();
      throw new FileNotFoundError(`S3 not available for key: ${storageKey}`);
    },

    async createUploadUrl(_options: any): Promise<any> {
      logger.error(
        "[S3] CreateUploadUrl called but service not available in local-first mode",
      );
      notAvailableError();
      return null;
    },

    async getSourceUrl(_key: string): Promise<string> {
      logger.error(
        "[S3] GetSourceUrl called but service not available in local-first mode",
      );
      notAvailableError();
      throw new Error("S3 not available");
    },

    async getDownloadUrl(_key: string): Promise<string> {
      logger.error(
        "[S3] GetDownloadUrl called but service not available in local-first mode",
      );
      notAvailableError();
      throw new Error("S3 not available");
    },
  };
}
