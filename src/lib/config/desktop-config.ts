/**
 * Desktop Automation Configuration (E2B Desktop)
 *
 * All configuration values can be overridden via environment variables.
 * This centralizes all magic numbers and makes the system configurable.
 */

export const DesktopConfig = {
  // Session Limits
  session: {
    /** Maximum duration for a desktop sandbox in milliseconds (default: 30 minutes) */
    maxDuration: parseInt(
      process.env.DESKTOP_SESSION_MAX_DURATION_MS || "1800000",
      10,
    ),

    /** Session idle timeout in milliseconds (default: 10 minutes) */
    idleTimeout: parseInt(
      process.env.DESKTOP_SESSION_IDLE_TIMEOUT_MS || "600000",
      10,
    ),

    /** Maximum concurrent sandboxes per user (default: 2) */
    maxConcurrentPerUser: parseInt(
      process.env.DESKTOP_MAX_CONCURRENT_SESSIONS || "2",
      10,
    ),

    /** Maximum sandboxes created per user per hour (default: 5) */
    maxCreationsPerHour: parseInt(
      process.env.DESKTOP_MAX_CREATIONS_PER_HOUR || "5",
      10,
    ),

    /** Session cleanup interval in milliseconds (default: 1 hour) */
    cleanupInterval: parseInt(
      process.env.DESKTOP_CLEANUP_INTERVAL_MS || "3600000",
      10,
    ),

    /** Age threshold for stale session cleanup in milliseconds (default: 2 hours) */
    staleThreshold: parseInt(
      process.env.DESKTOP_STALE_THRESHOLD_MS || "7200000",
      10,
    ),
  },

  // Screenshot Settings
  screenshot: {
    /** Maximum screenshots to store per session (default: 100) */
    maxPerSession: parseInt(
      process.env.DESKTOP_MAX_SCREENSHOTS_PER_SESSION || "100",
      10,
    ),

    /** Screenshot format (png or jpeg) */
    format: (process.env.DESKTOP_SCREENSHOT_FORMAT || "png") as "png" | "jpeg",

    /** Screenshot quality for JPEG (0-100, default: 85) */
    quality: parseInt(process.env.DESKTOP_SCREENSHOT_QUALITY || "85", 10),

    /** Thumbnail width for quick preview (default: 400) */
    thumbnailWidth: parseInt(
      process.env.DESKTOP_SCREENSHOT_THUMBNAIL_WIDTH || "400",
      10,
    ),

    /** Screenshot retention period in milliseconds (default: 24 hours) */
    retentionPeriod: parseInt(
      process.env.DESKTOP_SCREENSHOT_RETENTION_MS || "86400000",
      10,
    ),
  },

  // Streaming Settings
  streaming: {
    /** VNC frame rate (default: 10 fps) */
    frameRate: parseInt(process.env.DESKTOP_STREAMING_FPS || "10", 10),

    /** Maximum concurrent streaming connections (default: 20) */
    maxConnections: parseInt(
      process.env.DESKTOP_MAX_STREAMING_CONNECTIONS || "20",
      10,
    ),

    /** Stream heartbeat interval in milliseconds (default: 30000) */
    heartbeatInterval: parseInt(
      process.env.DESKTOP_STREAMING_HEARTBEAT_MS || "30000",
      10,
    ),

    /** Connection timeout in milliseconds (default: 60000) */
    connectionTimeout: parseInt(
      process.env.DESKTOP_STREAMING_TIMEOUT_MS || "60000",
      10,
    ),

    /** Screenshot polling interval in milliseconds (default: 2000) */
    pollingInterval: parseInt(
      process.env.DESKTOP_STREAMING_POLL_INTERVAL_MS || "2000",
      10,
    ),
  },

  // Rate Limiting
  rateLimit: {
    /** Rate limit window in milliseconds (default: 1 minute) */
    windowMs: parseInt(process.env.DESKTOP_RATE_LIMIT_WINDOW_MS || "60000", 10),

    /** Maximum requests per window for session creation (default: 3) */
    maxSessionCreations: parseInt(
      process.env.DESKTOP_RATE_LIMIT_SESSION_CREATIONS || "3",
      10,
    ),

    /** Maximum requests per window for screenshots (default: 60) */
    maxScreenshots: parseInt(
      process.env.DESKTOP_RATE_LIMIT_SCREENSHOTS || "60",
      10,
    ),

    /** Maximum requests per window for actions (default: 120) */
    maxActions: parseInt(process.env.DESKTOP_RATE_LIMIT_ACTIONS || "120", 10),
  },

  // E2B Provider Settings
  provider: {
    /** E2B API key */
    apiKey: process.env.E2B_API_KEY || "",

    /** Default desktop template */
    template: process.env.E2B_DESKTOP_TEMPLATE || "desktop",

    /** Default screen width */
    screenWidth: parseInt(process.env.E2B_SCREEN_WIDTH || "1024", 10),

    /** Default screen height */
    screenHeight: parseInt(process.env.E2B_SCREEN_HEIGHT || "768", 10),

    /** Action timeout in milliseconds */
    actionTimeout: parseInt(process.env.E2B_ACTION_TIMEOUT_MS || "30000", 10),

    /** Sandbox keep-alive timeout in milliseconds */
    keepAliveTimeout: parseInt(
      process.env.E2B_KEEP_ALIVE_TIMEOUT_MS || "300000",
      10,
    ),
  },

  // Sandbox Settings
  sandbox: {
    /** Memory limit in MB (default: 2048) */
    memoryMb: parseInt(process.env.E2B_SANDBOX_MEMORY_MB || "2048", 10),

    /** CPU cores (default: 2) */
    cpuCores: parseInt(process.env.E2B_SANDBOX_CPU_CORES || "2", 10),

    /** Disk size in GB (default: 10) */
    diskGb: parseInt(process.env.E2B_SANDBOX_DISK_GB || "10", 10),

    /** Enable internet access (default: true) */
    enableInternet: process.env.E2B_SANDBOX_ENABLE_INTERNET !== "false",

    /** Enable file persistence (default: false) */
    enablePersistence: process.env.E2B_SANDBOX_ENABLE_PERSISTENCE === "true",
  },

  // Mouse/Keyboard Settings
  input: {
    /** Default click delay in milliseconds */
    clickDelay: parseInt(process.env.DESKTOP_CLICK_DELAY_MS || "100", 10),

    /** Default typing delay between characters in milliseconds */
    typeDelay: parseInt(process.env.DESKTOP_TYPE_DELAY_MS || "50", 10),

    /** Double click interval in milliseconds */
    doubleClickInterval: parseInt(
      process.env.DESKTOP_DOUBLE_CLICK_INTERVAL_MS || "500",
      10,
    ),

    /** Drag smoothness (steps between start and end) */
    dragSteps: parseInt(process.env.DESKTOP_DRAG_STEPS || "10", 10),

    /** Scroll amount per scroll action */
    scrollAmount: parseInt(process.env.DESKTOP_SCROLL_AMOUNT || "3", 10),
  },

  // Logging
  logging: {
    /** Enable verbose logging */
    verbose: process.env.DESKTOP_VERBOSE_LOGGING === "true",

    /** Log all input events */
    logInputs: process.env.DESKTOP_LOG_INPUTS !== "false",

    /** Log performance metrics */
    logPerformance: process.env.DESKTOP_LOG_PERFORMANCE === "true",

    /** Log sandbox lifecycle events */
    logLifecycle: process.env.DESKTOP_LOG_LIFECYCLE !== "false",
  },

  // Cost Management
  cost: {
    /** Estimated cost per minute in credits */
    creditsPerMinute: parseFloat(process.env.E2B_CREDITS_PER_MINUTE || "0.1"),

    /** User daily credit limit (default: 100) */
    dailyCreditLimit: parseFloat(process.env.E2B_DAILY_CREDIT_LIMIT || "100"),

    /** Warning threshold (percentage of limit, default: 80) */
    warningThreshold: parseFloat(process.env.E2B_WARNING_THRESHOLD || "0.8"),
  },
} as const;

/**
 * Validate desktop configuration
 * Throws if required values are missing or invalid
 */
export function validateDesktopConfig(): void {
  const errors: string[] = [];

  if (!DesktopConfig.provider.apiKey) {
    errors.push("E2B_API_KEY is required for desktop automation");
  }

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

  if (DesktopConfig.sandbox.memoryMb < 512) {
    errors.push("E2B_SANDBOX_MEMORY_MB must be at least 512");
  }

  if (errors.length > 0) {
    throw new Error(`Desktop configuration errors:\n${errors.join("\n")}`);
  }
}

/**
 * Check if desktop automation is properly configured
 */
export function isDesktopConfigured(): boolean {
  return Boolean(DesktopConfig.provider.apiKey);
}

/**
 * Estimate cost for a desktop session
 */
export function estimateSessionCost(durationMs: number): number {
  const minutes = durationMs / 60000;
  return minutes * DesktopConfig.cost.creditsPerMinute;
}

export type DesktopConfigType = typeof DesktopConfig;
