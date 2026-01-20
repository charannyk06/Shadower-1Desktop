"use client";

import ExportError from "@/components/export/error";

/**
 * Export Preview Page - Not Available in Desktop Mode
 *
 * In the Electron desktop app, chat exports are saved as local files
 * (JSON or Markdown) rather than being shared via web links.
 *
 * This page is kept for compatibility but shows an error message
 * indicating the feature is not available in desktop mode.
 */
export default function ExportPage() {
  return (
    <ExportError message="Web export links are not available in the desktop app. Chats can be exported locally as JSON or Markdown files." />
  );
}
