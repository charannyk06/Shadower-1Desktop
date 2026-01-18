/**
 * Collabora Online Integration
 *
 * This module provides integration with Collabora Online (CODE) for
 * in-browser document editing via the WOPI protocol.
 *
 * Setup Requirements:
 * 1. Collabora CODE running on a server (Docker recommended)
 * 2. Environment variables:
 *    - NEXT_PUBLIC_COLLABORA_URL: URL of Collabora server (e.g., https://collabora.yourdomain.com)
 *    - WOPI_SECRET: Secret key for signing access tokens
 *    - NEXT_PUBLIC_APP_URL: Your app's URL (for WOPI callbacks)
 *
 * Usage:
 * ```typescript
 * import { generateEditorConfig, isCollaboraConfigured } from '@/lib/collabora';
 *
 * if (isCollaboraConfigured()) {
 *   const config = await generateEditorConfig(fileId, fileName, mimeType, userId, threadId);
 *   // Use config.collaboraUrl in an iframe
 * }
 * ```
 */

// Types
export type {
  WopiFileInfo,
  WopiPutFileResponse,
  WopiAccessTokenPayload,
  WopiFileMetadata,
  CollaboraEditorConfig,
  CollaboraPostMessageEvent,
  CollaboraFileType,
} from "./types";

export {
  COLLABORA_SUPPORTED_TYPES,
  isCollaboraSupported,
  getCollaboraFileType,
} from "./types";

// Access token management
export {
  generateWopiAccessToken,
  validateWopiAccessToken,
  extractAccessToken,
  validateWopiRequest,
} from "./access-token";

// WOPI helpers
export {
  getCollaboraUrl,
  getAppBaseUrl,
  buildWopiSrc,
  parseWopiFileId,
  buildCollaboraEditorUrl,
  generateEditorConfig,
  buildCheckFileInfo,
  validateWopiProof,
  getFileExtension,
  getMimeTypeFromExtension,
  isCollaboraConfigured,
} from "./wopi";
