/**
 * ACP (Agent Client Protocol) Components
 * 
 * This module exports all ACP-related UI components for easy importing.
 */

// Permission dialog
export { PermissionDialog } from "./permission-dialog";

// Terminal panel with xterm.js integration (P0 Gap #2)
export {
  TerminalPanel,
  useTerminalData,
  type TerminalPanelProps,
} from "./terminal-panel";

// Session browser for listing/resuming past sessions (P1 Gap #5)
export {
  SessionBrowser,
  useSessionPersistence,
  type SessionBrowserProps,
  type PersistedSession,
} from "./session-browser";

// Context window indicator showing token usage (P1 Gap #6)
export {
  ContextIndicator,
  useContextTracking,
  type ContextIndicatorProps,
  type ContextBreakdown,
} from "./context-indicator";
