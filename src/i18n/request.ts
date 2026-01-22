/**
 * Next.js i18n request config
 *
 * Note: This file is stubbed for Electron builds since next-intl/server
 * is not available in client-side environments. The actual i18n configuration
 * is handled via react-i18next in src/lib/i18n.ts
 */

// Export a no-op default for compatibility
export default function getRequestConfig() {
  return {
    locale: "en",
    messages: {},
  };
}
