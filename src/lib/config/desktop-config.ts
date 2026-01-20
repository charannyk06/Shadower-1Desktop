/**
 * Desktop Automation Configuration (Local Terminal)
 *
 * Configuration for local desktop automation using terminal commands.
 * This replaces cloud-based E2B Desktop with local execution.
 *
 * All configuration values can be overridden via environment variables.
 */

export const DesktopConfig = {
  // Session Limits
  session: {
    /** Maximum duration for a desktop session in milliseconds (default: 30 minutes) */
    maxDuration: parseInt(
      import.meta.env.DESKTOP_SESSION_MAX_DURATION_MS || "1800000",
      10,
    ),

    /** Session idle timeout in milliseconds (default: 10 minutes) */
    idleTimeout: parseInt(
      import.meta.env.DESKTOP_SESSION_IDLE_TIMEOUT_MS || "600000",
      10,
    ),

    /** Maximum concurrent sessions per user (default: 5 for local) */
    maxConcurrentPerUser: parseInt(
      import.meta.env.DESKTOP_MAX_CONCURRENT_SESSIONS || "5",
      10,
    ),

    /** Session cleanup interval in milliseconds (default: 1 hour) */
    cleanupInterval: parseInt(
      import.meta.env.DESKTOP_CLEANUP_INTERVAL_MS || "3600000",
      10,
    ),
  },

  // Screenshot Settings
  screenshot: {
    /** Maximum screenshots to store per session (default: 100) */
    maxPerSession: parseInt(
      import.meta.env.DESKTOP_MAX_SCREENSHOTS_PER_SESSION || "100",
      10,
    ),

    /** Screenshot format (png or jpeg) */
    format: (import.meta.env.DESKTOP_SCREENSHOT_FORMAT || "png") as
      | "png"
      | "jpeg",

    /** Screenshot quality for JPEG (0-100, default: 85) */
    quality: parseInt(import.meta.env.DESKTOP_SCREENSHOT_QUALITY || "85", 10),

    /** Thumbnail width for quick preview (default: 400) */
    thumbnailWidth: parseInt(
      import.meta.env.DESKTOP_SCREENSHOT_THUMBNAIL_WIDTH || "400",
      10,
    ),

    /** Screenshot retention period in milliseconds (default: 24 hours) */
    retentionPeriod: parseInt(
      import.meta.env.DESKTOP_SCREENSHOT_RETENTION_MS || "86400000",
      10,
    ),
  },

  // Streaming Settings
  streaming: {
    /** Frame rate for live preview (default: 10 fps) */
    frameRate: parseInt(import.meta.env.DESKTOP_STREAMING_FPS || "10", 10),

    /** Maximum concurrent streaming connections (default: 20) */
    maxConnections: parseInt(
      import.meta.env.DESKTOP_MAX_STREAMING_CONNECTIONS || "20",
      10,
    ),

    /** Stream heartbeat interval in milliseconds (default: 30000) */
    heartbeatInterval: parseInt(
      import.meta.env.DESKTOP_STREAMING_HEARTBEAT_MS || "30000",
      10,
    ),

    /** Connection timeout in milliseconds (default: 60000) */
    connectionTimeout: parseInt(
      import.meta.env.DESKTOP_STREAMING_TIMEOUT_MS || "60000",
      10,
    ),

    /** Screenshot polling interval in milliseconds (default: 2000) */
    pollingInterval: parseInt(
      import.meta.env.DESKTOP_STREAMING_POLL_INTERVAL_MS || "2000",
      10,
    ),
  },

  // Rate Limiting
  rateLimit: {
    /** Rate limit window in milliseconds (default: 1 minute) */
    windowMs: parseInt(
      import.meta.env.DESKTOP_RATE_LIMIT_WINDOW_MS || "60000",
      10,
    ),

    /** Maximum requests per window for session creation (default: 10 for local) */
    maxSessionCreations: parseInt(
      import.meta.env.DESKTOP_RATE_LIMIT_SESSION_CREATIONS || "10",
      10,
    ),

    /** Maximum requests per window for screenshots (default: 60) */
    maxScreenshots: parseInt(
      import.meta.env.DESKTOP_RATE_LIMIT_SCREENSHOTS || "60",
      10,
    ),

    /** Maximum requests per window for actions (default: 120) */
    maxActions: parseInt(
      import.meta.env.DESKTOP_RATE_LIMIT_ACTIONS || "120",
      10,
    ),
  },

  // Local Terminal Settings
  provider: {
    /** Default shell (auto-detected if not set) */
    shell: import.meta.env.DESKTOP_SHELL || "",

    /** Default working directory */
    workingDirectory: import.meta.env.DESKTOP_WORKING_DIR || "",

    /** Command execution timeout in milliseconds (default: 60 seconds) */
    commandTimeout: parseInt(
      import.meta.env.DESKTOP_COMMAND_TIMEOUT_MS || "60000",
      10,
    ),

    /** Action timeout in milliseconds */
    actionTimeout: parseInt(
      import.meta.env.DESKTOP_ACTION_TIMEOUT_MS || "30000",
      10,
    ),
  },

  // Sandbox Settings (for code execution)
  sandbox: {
    /** Sandbox directory (relative to app data) */
    directory: import.meta.env.DESKTOP_SANDBOX_DIR || "sandbox",

    /** Enable file persistence between sessions (default: true for local) */
    enablePersistence: import.meta.env.DESKTOP_SANDBOX_PERSISTENCE !== "false",

    /** Maximum file size in bytes (default: 100MB) */
    maxFileSize: parseInt(
      import.meta.env.DESKTOP_SANDBOX_MAX_FILE_SIZE || "104857600",
      10,
    ),

    /** Allowed languages for code execution */
    allowedLanguages: (
      import.meta.env.DESKTOP_SANDBOX_LANGUAGES ||
      "python,javascript,typescript,bash"
    ).split(","),
  },

  // Mouse/Keyboard Settings
  input: {
    /** Default click delay in milliseconds */
    clickDelay: parseInt(import.meta.env.DESKTOP_CLICK_DELAY_MS || "100", 10),

    /** Default typing delay between characters in milliseconds */
    typeDelay: parseInt(import.meta.env.DESKTOP_TYPE_DELAY_MS || "50", 10),

    /** Double click interval in milliseconds */
    doubleClickInterval: parseInt(
      import.meta.env.DESKTOP_DOUBLE_CLICK_INTERVAL_MS || "500",
      10,
    ),

    /** Drag smoothness (steps between start and end) */
    dragSteps: parseInt(import.meta.env.DESKTOP_DRAG_STEPS || "10", 10),

    /** Scroll amount per scroll action */
    scrollAmount: parseInt(import.meta.env.DESKTOP_SCROLL_AMOUNT || "3", 10),
  },

  // Logging
  logging: {
    /** Enable verbose logging */
    verbose: import.meta.env.DESKTOP_VERBOSE_LOGGING === "true",

    /** Log all input events */
    logInputs: import.meta.env.DESKTOP_LOG_INPUTS !== "false",

    /** Log performance metrics */
    logPerformance: import.meta.env.DESKTOP_LOG_PERFORMANCE === "true",

    /** Log session lifecycle events */
    logLifecycle: import.meta.env.DESKTOP_LOG_LIFECYCLE !== "false",
  },
} as const;

/**
 * Validate desktop configuration
 */
export function validateDesktopConfig(): void {
  const errors: string[] = [];

  if (DesktopConfig.session.maxDuration < 60000) {
    errors.push(
      "DESKTOP_SESSION_MAX_DURATION_MS must be at least 60000 (1 minute)",
    );
  }

  if (
    DesktopConfig.streaming.frameRate < 1 ||
    DesktopConfig.streaming.frameRate > 30
  ) {
    errors.push("DESKTOP_STREAMING_FPS must be between 1 and 30");
  }

  if (errors.length > 0) {
    throw new Error(`Desktop configuration errors:\n${errors.join("\n")}`);
  }
}

/**
 * Check if desktop automation is available
 * For local terminal, this checks if we're in Electron environment
 */
export function isDesktopConfigured(): boolean {
  // In Electron environment, desktop automation is always available
  // via local terminal execution
  return (
    typeof window !== "undefined" &&
    window.electronAPI !== undefined &&
    window.electronAPI.terminal !== undefined
  );
}

export type DesktopConfigType = typeof DesktopConfig;
