/**
 * Collabora WOPI Types
 *
 * TypeScript types for the WOPI (Web Application Open Platform Interface) protocol
 * used by Collabora Online for document editing.
 */

/**
 * WOPI CheckFileInfo response
 * @see https://learn.microsoft.com/en-us/microsoft-365/cloud-storage-partner-program/rest/files/checkfileinfo
 */
export interface WopiFileInfo {
  // Required properties
  BaseFileName: string;
  Size: number;
  OwnerId: string;
  UserId: string;
  Version: string;

  // User info
  UserFriendlyName?: string;
  UserCanWrite: boolean;
  UserCanNotWriteRelative?: boolean;

  // Permissions
  ReadOnly?: boolean;
  RestrictedWebViewOnly?: boolean;
  UserCanRename?: boolean;

  // URLs
  CloseUrl?: string;
  DownloadUrl?: string;
  FileSharingUrl?: string;
  FileUrl?: string;
  HostViewUrl?: string;
  HostEditUrl?: string;
  SignoutUrl?: string;

  // Capabilities
  SupportsCoauth?: boolean;
  SupportsCobalt?: boolean;
  SupportsContainers?: boolean;
  SupportsDeleteFile?: boolean;
  SupportsEcosystem?: boolean;
  SupportsExtendedLockLength?: boolean;
  SupportsFolders?: boolean;
  SupportsGetFileWopiSrc?: boolean;
  SupportsGetLock?: boolean;
  SupportsLocks?: boolean;
  SupportsRename?: boolean;
  SupportsUpdate?: boolean;
  SupportsUserInfo?: boolean;

  // PostMessage
  PostMessageOrigin?: string;
  EditModePostMessage?: boolean;
  EditNotificationPostMessage?: boolean;
  ClosePostMessage?: boolean;
  FileSharingPostMessage?: boolean;

  // Breadcrumb
  BreadcrumbBrandName?: string;
  BreadcrumbBrandUrl?: string;
  BreadcrumbDocName?: string;
  BreadcrumbFolderName?: string;
  BreadcrumbFolderUrl?: string;

  // Other
  LastModifiedTime?: string;
  SHA256?: string;
  UniqueContentId?: string;
}

/**
 * WOPI PutFile response
 */
export interface WopiPutFileResponse {
  LastModifiedTime: string;
  ItemVersion?: string;
}

/**
 * WOPI access token payload
 */
export interface WopiAccessTokenPayload {
  fileId: string;
  odisId: string;
  threadId: string;
  canWrite: boolean;
  exp: number;
  iat: number;
}

/**
 * File metadata for WOPI operations
 */
export interface WopiFileMetadata {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  ownerId: string;
  threadId: string;
  storageUrl: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Collabora editor configuration
 */
export interface CollaboraEditorConfig {
  wopiSrc: string;
  accessToken: string;
  accessTokenTtl: number;
  collaboraUrl: string;
  fileName: string;
  fileType: "document" | "spreadsheet" | "presentation";
  lang?: string;
  closeUrl?: string;
}

/**
 * PostMessage events from Collabora
 */
export type CollaboraPostMessageEvent =
  | {
      MessageId: "App_LoadingStatus";
      Values: { Status: "Document_Loaded" | "Frame_Ready" };
    }
  | { MessageId: "Action_Load_Resp"; Values?: Record<string, unknown> }
  | { MessageId: "UI_Close"; Values?: Record<string, unknown> }
  | { MessageId: "UI_Save"; Values?: { success: boolean } }
  | { MessageId: "Action_Save"; Values?: Record<string, unknown> }
  | { MessageId: "Doc_ModifiedStatus"; Values: { Modified: boolean } }
  | { MessageId: "UI_FileVersions"; Values?: Record<string, unknown> }
  | { MessageId: "Action_Close"; Values?: Record<string, unknown> };

/**
 * Supported file types for Collabora
 */
export const COLLABORA_SUPPORTED_TYPES = {
  // Documents
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "document",
  "application/msword": "document",
  "application/vnd.oasis.opendocument.text": "document",

  // Spreadsheets
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    "spreadsheet",
  "application/vnd.ms-excel": "spreadsheet",
  "application/vnd.oasis.opendocument.spreadsheet": "spreadsheet",

  // Presentations
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "presentation",
  "application/vnd.ms-powerpoint": "presentation",
  "application/vnd.oasis.opendocument.presentation": "presentation",
} as const;

export type CollaboraFileType =
  (typeof COLLABORA_SUPPORTED_TYPES)[keyof typeof COLLABORA_SUPPORTED_TYPES];

/**
 * File extension to MIME type mapping for Collabora
 */
const EXTENSION_TO_MIME: Record<string, string> = {
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/msword",
  ".odt": "application/vnd.oasis.opendocument.text",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
  ".ods": "application/vnd.oasis.opendocument.spreadsheet",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".ppt": "application/vnd.ms-powerpoint",
  ".odp": "application/vnd.oasis.opendocument.presentation",
};

/**
 * Check if a file is supported by Collabora
 * @param mimeType - MIME type of the file
 * @param fileName - Optional file name for extension-based detection
 */
export function isCollaboraSupported(
  mimeType: string,
  fileName?: string,
): boolean {
  // Check MIME type first
  if (mimeType in COLLABORA_SUPPORTED_TYPES) {
    return true;
  }

  // Fall back to extension-based detection
  if (fileName) {
    const ext = fileName.toLowerCase().match(/\.[^.]+$/)?.[0];
    if (ext && ext in EXTENSION_TO_MIME) {
      return true;
    }
  }

  return false;
}

/**
 * Get Collabora file type from MIME type
 */
export function getCollaboraFileType(
  mimeType: string,
): CollaboraFileType | null {
  return (
    (COLLABORA_SUPPORTED_TYPES as Record<string, CollaboraFileType>)[
      mimeType
    ] || null
  );
}
