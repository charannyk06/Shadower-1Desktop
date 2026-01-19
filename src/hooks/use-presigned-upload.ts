"use client";

/**
 * File Upload Hook - Local-First Implementation
 *
 * Vercel Blob client upload has been removed for local-first architecture.
 * This hook now uses server-side upload via /api/storage/upload.
 */

import { getStorageInfoAction } from "@/app/api/storage/actions";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";

// Types
interface StorageInfo {
  type: "local" | "vercel-blob" | "s3";
  supportsDirectUpload: boolean;
}

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

// Helpers
function useStorageInfo() {
  const { data, isLoading } = useSWR<StorageInfo>(
    "storage-info-v2",
    getStorageInfoAction,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 60000, // Cache for 1 minute
    },
  );

  return {
    storageType: data?.type || "local",
    supportsDirectUpload: data?.supportsDirectUpload ?? false,
    isLoading,
  };
}

/**
 * Hook for uploading files to storage.
 *
 * Uses server-side upload for local-first architecture.
 * Cloud storage (Vercel Blob, S3) direct uploads have been removed.
 *
 * @example
 * ```tsx
 * function FileUpload() {
 *   const { upload, isUploading } = useFileUpload();
 *
 *   const handleFile = async (file: File) => {
 *     const result = await upload(file);
 *     console.log('Public URL:', result.url);
 *   };
 *
 *   return <input type="file" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />;
 * }
 * ```
 */
export function useFileUpload() {
  const {
    storageType,
    supportsDirectUpload,
    isLoading: isLoadingStorageInfo,
  } = useStorageInfo();
  const [isUploading, setIsUploading] = useState(false);

  const upload = useCallback(
    async (
      file: File,
      _uploadOptions: UploadOptions = {},
    ): Promise<UploadResult | undefined> => {
      if (!(file instanceof File)) {
        toast.error("Upload expects a File instance");
        return;
      }

      // Wait for storage info to load
      if (isLoadingStorageInfo) {
        toast.error("Storage is still loading. Please try again.");
        return;
      }

      setIsUploading(true);
      try {
        // For local-first architecture, always use server upload
        // This works with local file storage
        const formData = new FormData();
        formData.append("file", file);

        const serverUploadResponse = await fetch("/api/storage/upload", {
          method: "POST",
          body: formData,
        });

        if (!serverUploadResponse.ok) {
          const errorBody = await serverUploadResponse.json().catch(() => ({}));

          // Display detailed error with solution if available
          if (errorBody.solution) {
            toast.error(errorBody.error || "Server upload failed", {
              description: errorBody.solution,
              duration: 10000, // Show for 10 seconds
            });
          } else {
            toast.error(errorBody.error || "Server upload failed");
          }
          return;
        }

        const result = await serverUploadResponse.json();

        return {
          pathname: result.key,
          url: result.url,
          contentType: result.metadata?.contentType,
          size: result.metadata?.size,
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
    [storageType, supportsDirectUpload, isLoadingStorageInfo],
  );

  return {
    upload,
    isUploading: isUploading || isLoadingStorageInfo,
  };
}

// Alias for backward compatibility
export const usePresignedUpload = useFileUpload;
