/**
 * Collabora Stubs for Desktop
 *
 * Collabora Online editor is not available in desktop mode.
 * These stubs allow code that references Collabora to compile and run,
 * but always return "not available" status.
 */

/**
 * Check if Collabora is configured (always false in desktop)
 */
export function isCollaboraConfigured(): boolean {
  return false;
}

/**
 * Check if a MIME type is supported by Collabora (always false in desktop)
 */
export function isCollaboraSupported(
  mimeType: string,
  _fileName?: string
): boolean {
  return false;
}

/**
 * Get MIME type from file extension
 */
export function getMimeTypeFromExtension(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  const mimeTypes: Record<string, string> = {
    // Documents
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    doc: "application/msword",
    odt: "application/vnd.oasis.opendocument.text",
    rtf: "application/rtf",
    txt: "text/plain",
    // Spreadsheets
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xls: "application/vnd.ms-excel",
    ods: "application/vnd.oasis.opendocument.spreadsheet",
    csv: "text/csv",
    // Presentations
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ppt: "application/vnd.ms-powerpoint",
    odp: "application/vnd.oasis.opendocument.presentation",
    // PDF
    pdf: "application/pdf",
  };
  return mimeTypes[ext] || "application/octet-stream";
}

/**
 * Generate Collabora editor config (not available in desktop)
 */
export async function generateEditorConfig(
  _storageKey: string,
  _fileName: string,
  _mimeType: string,
  _threadId: string
): Promise<{ success: false; error: string }> {
  return {
    success: false,
    error: "Collabora Online editor is not available in desktop mode",
  };
}

export default {
  isCollaboraConfigured,
  isCollaboraSupported,
  getMimeTypeFromExtension,
  generateEditorConfig,
};
