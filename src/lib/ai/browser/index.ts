/**
 * Browser Automation Module
 *
 * Provides browser automation capabilities using Chrome DevTools Protocol.
 * Key features:
 * - Context-based page understanding (no screenshots needed!)
 * - Form detection and filling
 * - Element interaction via reference IDs
 */

// Types
export * from "./types";
export * from "./page-context";

// Services
export { LocalBrowserService } from "./local-browser-service";
