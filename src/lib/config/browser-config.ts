/**
 * Browser Automation Configuration
 *
 * Configuration for local Chrome DevTools Protocol (CDP) browser automation.
 * This replaces cloud-based Browserbase with local Chrome control.
 *
 * All configuration values can be overridden via environment variables.
 */

export const BrowserConfig = {
  // Session Limits
  session: {
    /** Maximum duration for a browser session in milliseconds (default: 30 minutes) */
    maxDuration: parseInt(
      import.meta.env.BROWSER_SESSION_MAX_DURATION_MS || "1800000",
      10,
    ),

    /** Session idle timeout in milliseconds (default: 10 minutes) */
    idleTimeout: parseInt(
      import.meta.env.BROWSER_SESSION_IDLE_TIMEOUT_MS || "600000",
      10,
    ),

    /** Maximum concurrent sessions per user (default: 3) */
    maxConcurrentPerUser: parseInt(
      import.meta.env.BROWSER_MAX_CONCURRENT_SESSIONS || "3",
      10,
    ),

    /** Session cleanup interval in milliseconds (default: 1 hour) */
    cleanupInterval: parseInt(
      import.meta.env.BROWSER_CLEANUP_INTERVAL_MS || "3600000",
      10,
    ),
  },

  // Screenshot Settings
  screenshot: {
    /** Maximum screenshots to store per session (default: 50) */
    maxPerSession: parseInt(
      import.meta.env.BROWSER_MAX_SCREENSHOTS_PER_SESSION || "50",
      10,
    ),

    /** Screenshot quality for JPEG (0-100, default: 80) */
    quality: parseInt(import.meta.env.BROWSER_SCREENSHOT_QUALITY || "80", 10),

    /** Maximum screenshot width in pixels (default: 1920) */
    maxWidth: parseInt(
      import.meta.env.BROWSER_SCREENSHOT_MAX_WIDTH || "1920",
      10,
    ),

    /** Thumbnail width for quick preview (default: 320) */
    thumbnailWidth: parseInt(
      import.meta.env.BROWSER_SCREENSHOT_THUMBNAIL_WIDTH || "320",
      10,
    ),

    /** Screenshot retention period in milliseconds (default: 24 hours) */
    retentionPeriod: parseInt(
      import.meta.env.BROWSER_SCREENSHOT_RETENTION_MS || "86400000",
      10,
    ),
  },

  // Streaming Settings
  streaming: {
    /** SSE polling interval in milliseconds (default: 3000) */
    pollingInterval: parseInt(
      import.meta.env.BROWSER_STREAMING_POLL_INTERVAL_MS || "3000",
      10,
    ),

    /** Maximum concurrent streaming connections (default: 50) */
    maxConnections: parseInt(
      import.meta.env.BROWSER_MAX_STREAMING_CONNECTIONS || "50",
      10,
    ),

    /** Stream heartbeat interval in milliseconds (default: 30000) */
    heartbeatInterval: parseInt(
      import.meta.env.BROWSER_STREAMING_HEARTBEAT_MS || "30000",
      10,
    ),

    /** Connection timeout in milliseconds (default: 60000) */
    connectionTimeout: parseInt(
      import.meta.env.BROWSER_STREAMING_TIMEOUT_MS || "60000",
      10,
    ),
  },

  // Rate Limiting
  rateLimit: {
    /** Rate limit window in milliseconds (default: 1 minute) */
    windowMs: parseInt(
      import.meta.env.BROWSER_RATE_LIMIT_WINDOW_MS || "60000",
      10,
    ),

    /** Maximum requests per window for session creation (default: 5) */
    maxSessionCreations: parseInt(
      import.meta.env.BROWSER_RATE_LIMIT_SESSION_CREATIONS || "5",
      10,
    ),

    /** Maximum requests per window for screenshots (default: 30) */
    maxScreenshots: parseInt(
      import.meta.env.BROWSER_RATE_LIMIT_SCREENSHOTS || "30",
      10,
    ),

    /** Maximum requests per window for actions (default: 60) */
    maxActions: parseInt(
      import.meta.env.BROWSER_RATE_LIMIT_ACTIONS || "60",
      10,
    ),
  },

  // Security
  security: {
    /** URL schemes that are blocked (default: file, javascript, data) */
    blockedSchemes: (
      import.meta.env.BROWSER_BLOCKED_SCHEMES || "javascript,data,vbscript"
    ).split(","),

    /** IP ranges that are blocked (internal networks) - disabled for local use */
    blockedIpRanges: [] as string[],

    /** Domains that are always allowed (empty means allow all non-blocked) */
    allowedDomains: (import.meta.env.BROWSER_ALLOWED_DOMAINS || "")
      .split(",")
      .filter(Boolean),

    /** Domains that are always blocked */
    blockedDomains: (import.meta.env.BROWSER_BLOCKED_DOMAINS || "")
      .split(",")
      .filter(Boolean),

    /** Enable strict mode (blocks unknown domains if allowedDomains is set) */
    strictMode: import.meta.env.BROWSER_STRICT_MODE === "true",
  },

  // Chrome DevTools Protocol (CDP) Settings
  provider: {
    /** Chrome DevTools debugging port (default: 9222) */
    debuggingPort: parseInt(
      import.meta.env.CHROME_DEBUGGING_PORT || "9222",
      10,
    ),

    /** Chrome executable path (auto-detected if not set) */
    executablePath: import.meta.env.CHROME_EXECUTABLE_PATH || "",

    /** Default viewport width */
    viewportWidth: parseInt(
      import.meta.env.CHROME_VIEWPORT_WIDTH || "1280",
      10,
    ),

    /** Default viewport height */
    viewportHeight: parseInt(
      import.meta.env.CHROME_VIEWPORT_HEIGHT || "720",
      10,
    ),

    /** Navigation timeout in milliseconds */
    navigationTimeout: parseInt(
      import.meta.env.CHROME_NAVIGATION_TIMEOUT_MS || "30000",
      10,
    ),

    /** Action timeout in milliseconds */
    actionTimeout: parseInt(
      import.meta.env.CHROME_ACTION_TIMEOUT_MS || "10000",
      10,
    ),

    /** Whether to use headless mode (default: false for local) */
    headless: import.meta.env.CHROME_HEADLESS === "true",
  },

  // Logging
  logging: {
    /** Enable verbose logging */
    verbose: import.meta.env.BROWSER_VERBOSE_LOGGING === "true",

    /** Log all navigation events */
    logNavigation: import.meta.env.BROWSER_LOG_NAVIGATION !== "false",

    /** Log all action events */
    logActions: import.meta.env.BROWSER_LOG_ACTIONS !== "false",

    /** Log performance metrics */
    logPerformance: import.meta.env.BROWSER_LOG_PERFORMANCE === "true",
  },
} as const;

/**
 * Validate browser configuration
 * For local Chrome DevTools, we just need to ensure the port is valid
 */
export function validateBrowserConfig(): void {
  const errors: string[] = [];

  if (
    BrowserConfig.provider.debuggingPort < 1 ||
    BrowserConfig.provider.debuggingPort > 65535
  ) {
    errors.push("CHROME_DEBUGGING_PORT must be between 1 and 65535");
  }

  if (BrowserConfig.session.maxDuration < 60000) {
    errors.push(
      "BROWSER_SESSION_MAX_DURATION_MS must be at least 60000 (1 minute)",
    );
  }

  if (
    BrowserConfig.screenshot.quality < 1 ||
    BrowserConfig.screenshot.quality > 100
  ) {
    errors.push("BROWSER_SCREENSHOT_QUALITY must be between 1 and 100");
  }

  if (errors.length > 0) {
    throw new Error(`Browser configuration errors:\n${errors.join("\n")}`);
  }
}

/**
 * Check if browser automation is available
 * For local Chrome DevTools, this checks if we're in Electron environment
 */
export function isBrowserConfigured(): boolean {
  // In Electron environment, browser automation is always available
  // via Chrome DevTools Protocol
  return (
    typeof window !== "undefined" &&
    window.electronAPI !== undefined &&
    window.electronAPI.chrome !== undefined
  );
}

/**
 * Get instructions for launching Chrome with debugging enabled
 */
export function getChromeDebugInstructions(): string {
  const port = BrowserConfig.provider.debuggingPort;
  const platform = typeof process !== "undefined" ? process.platform : "darwin";

  const commands: Record<string, string> = {
    darwin: `/Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=${port}`,
    win32: `"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=${port}`,
    linux: `google-chrome --remote-debugging-port=${port}`,
  };

  return commands[platform] || `chrome --remote-debugging-port=${port}`;
}

export type BrowserConfigType = typeof BrowserConfig;
