"use client";

/**
 * File Upload Hook - Electron Desktop Implementation
 *
 * This hook uses Electron IPC for file uploads to local storage.
 */

import { useCallback, useState } from "react";
import { toast } from "sonner";

// Types
interface UploadOptions {
  filename?: string;
  contentType?: string;
}

interface UploadResult {
  pathname: string;
  url: string;
  contentType?: string;
  size?: number;
}

/**
 * Check if we're running in Electron mode with file support
 */
function isElectronMode(): boolean {
  return (
    typeof window !== "undefined" &&
    window.electronAPI !== undefined &&
    window.electronAPI.files !== undefined
  );
}

/**
 * Hook for uploading files to local storage via Electron IPC.
 *
 * @example
 * ```tsx
 * function FileUpload() {
 *   const { upload, isUploading } = useFileUpload();
 *
 *   const handleFile = async (file: File) => {
 *     const result = await upload(file);
 *     console.log('Local URL:', result.url);
 *   };
 *
 *   return <input type="file" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />;
 * }
 * ```
 */
export function useFileUpload() {
  const [isUploading, setIsUploading] = useState(false);

  const upload = useCallback(
    async (
      file: File,
      uploadOptions: UploadOptions = {},
    ): Promise<UploadResult | undefined> => {
      if (!(file instanceof File)) {
        toast.error("Upload expects a File instance");
        return;
      }

      if (!isElectronMode()) {
        toast.error("File upload is only available in the desktop app");
        return;
      }

      setIsUploading(true);
      try {
        // Convert File to ArrayBuffer then to Buffer-compatible format
        const arrayBuffer = await file.arrayBuffer();
        const content = Buffer.from(arrayBuffer).toString("base64");

        const result = await window.electronAPI.files.upload({
          content, // Base64 encoded
          filename: uploadOptions.filename || file.name,
          contentType: uploadOptions.contentType || file.type,
          category: "uploads",
        });

        if (!result.success) {
          toast.error(result.error || "Upload failed");
          return;
        }

        return {
          pathname: result.key,
          url: result.url,
          contentType: file.type,
          size: file.size,
        };
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Upload failed";
        toast.error(message);
        return;
      } finally {
        setIsUploading(false);
      }
    },
    [],
  );

  return {
    upload,
    isUploading,
  };
}

// Alias for backward compatibility
export const usePresignedUpload = useFileUpload;
