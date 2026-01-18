/**
 * Client-side logging utility that sends logs to server-side endpoint
 * This ensures logs appear in Vercel logs instead of browser console
 */

type LogLevel = "info" | "warn" | "error" | "debug";

/**
 * Send log to server-side endpoint
 * Silently fails if logging endpoint is unavailable
 */
async function logToServer(
  level: LogLevel,
  message: string,
  data?: any,
): Promise<void> {
  // Only send logs in production or when explicitly enabled
  if (
    process.env.NODE_ENV === "production" ||
    process.env.NEXT_PUBLIC_ENABLE_CLIENT_LOGGING === "true"
  ) {
    try {
      await fetch("/api/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level, message, data }),
      });
    } catch {
      // Silently fail - don't break the app if logging fails
    }
  }
}

/**
 * Client-side logger that sends logs to server
 */
export const clientLogger = {
  info: (message: string, data?: any) => {
    logToServer("info", message, data);
  },
  warn: (message: string, data?: any) => {
    logToServer("warn", message, data);
  },
  error: (message: string, data?: any) => {
    logToServer("error", message, data);
  },
  debug: (message: string, data?: any) => {
    logToServer("debug", message, data);
  },
};
