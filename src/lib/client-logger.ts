/**
 * Client-side logging utility for Desktop (Electron)
 *
 * In desktop mode, logs go to console instead of server endpoint.
 * No HTTP fallbacks - desktop only.
 */

type LogLevel = "info" | "warn" | "error" | "debug";

/**
 * Log to console (desktop mode)
 * In desktop mode, we use console logging instead of sending to server
 */
function logLocally(level: LogLevel, message: string, data?: any): void {
  const prefix = `[Client:${level.toUpperCase()}]`;

  switch (level) {
    case "info":
      console.info(prefix, message, data !== undefined ? data : "");
      break;
    case "warn":
      console.warn(prefix, message, data !== undefined ? data : "");
      break;
    case "error":
      console.error(prefix, message, data !== undefined ? data : "");
      break;
    case "debug":
      console.debug(prefix, message, data !== undefined ? data : "");
      break;
  }
}

/**
 * Client-side logger - Desktop Only (Console)
 */
export const clientLogger = {
  info: (message: string, data?: any) => {
    logLocally("info", message, data);
  },
  warn: (message: string, data?: any) => {
    logLocally("warn", message, data);
  },
  error: (message: string, data?: any) => {
    logLocally("error", message, data);
  },
  debug: (message: string, data?: any) => {
    logLocally("debug", message, data);
  },
};
