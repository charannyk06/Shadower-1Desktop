import ExportError from "@/components/export/error";

/**
 * Share Page - Not Available in Desktop Mode
 *
 * In the Electron desktop app, shared links are not supported
 * since the app runs locally without a web server.
 *
 * This page shows an error message indicating the feature
 * is not available in desktop mode.
 */
export default function SharePage() {
  return (
    <ExportError message="Shared links are not available in the desktop app. This feature requires the web version of Shadower." />
  );
}
