/**
 * Browser Automation Configuration
 *
 * All configuration values can be overridden via environment variables.
 * This centralizes all magic numbers and makes the system configurable.
 */

export const BrowserConfig = {
  // Session Limits
  session: {
    /** Maximum duration for a browser session in milliseconds (default: 30 minutes) */
    maxDuration: parseInt(
      process.env.BROWSER_SESSION_MAX_DURATION_MS || "1800000",
      10,
    ),

    /** Session idle timeout in milliseconds (default: 10 minutes) */
    idleTimeout: parseInt(
      process.env.BROWSER_SESSION_IDLE_TIMEOUT_MS || "600000",
      10,
    ),

    /** Maximum concurrent sessions per user (default: 3) */
    maxConcurrentPerUser: parseInt(
      process.env.BROWSER_MAX_CONCURRENT_SESSIONS || "3",
      10,
    ),

    /** Maximum sessions created per user per hour (default: 10) */
    maxCreationsPerHour: parseInt(
      process.env.BROWSER_MAX_CREATIONS_PER_HOUR || "10",
      10,
    ),

    /** Session cleanup interval in milliseconds (default: 1 hour) */
    cleanupInterval: parseInt(
      process.env.BROWSER_CLEANUP_INTERVAL_MS || "3600000",
      10,
    ),

    /** Age threshold for stale session cleanup in milliseconds (default: 2 hours) */
    staleThreshold: parseInt(
      process.env.BROWSER_STALE_THRESHOLD_MS || "7200000",
      10,
    ),
  },

  // Screenshot Settings
  screenshot: {
    /** Maximum screenshots to store per session (default: 50) */
    maxPerSession: parseInt(
      process.env.BROWSER_MAX_SCREENSHOTS_PER_SESSION || "50",
      10,
    ),

    /** Screenshot quality for JPEG (0-100, default: 80) */
    quality: parseInt(process.env.BROWSER_SCREENSHOT_QUALITY || "80", 10),

    /** Maximum screenshot width in pixels (default: 1920) */
    maxWidth: parseInt(process.env.BROWSER_SCREENSHOT_MAX_WIDTH || "1920", 10),

    /** Thumbnail width for quick preview (default: 320) */
    thumbnailWidth: parseInt(
      process.env.BROWSER_SCREENSHOT_THUMBNAIL_WIDTH || "320",
      10,
    ),

    /** Screenshot retention period in milliseconds (default: 24 hours) */
    retentionPeriod: parseInt(
      process.env.BROWSER_SCREENSHOT_RETENTION_MS || "86400000",
      10,
    ),
  },

  // Streaming Settings
  streaming: {
    /** SSE polling interval in milliseconds (default: 3000) */
    pollingInterval: parseInt(
      process.env.BROWSER_STREAMING_POLL_INTERVAL_MS || "3000",
      10,
    ),

    /** Maximum concurrent streaming connections (default: 50) */
    maxConnections: parseInt(
      process.env.BROWSER_MAX_STREAMING_CONNECTIONS || "50",
      10,
    ),

    /** Stream heartbeat interval in milliseconds (default: 30000) */
    heartbeatInterval: parseInt(
      process.env.BROWSER_STREAMING_HEARTBEAT_MS || "30000",
      10,
    ),

    /** Connection timeout in milliseconds (default: 60000) */
    connectionTimeout: parseInt(
      process.env.BROWSER_STREAMING_TIMEOUT_MS || "60000",
      10,
    ),
  },

  // Rate Limiting
  rateLimit: {
    /** Rate limit window in milliseconds (default: 1 minute) */
    windowMs: parseInt(process.env.BROWSER_RATE_LIMIT_WINDOW_MS || "60000", 10),

    /** Maximum requests per window for session creation (default: 5) */
    maxSessionCreations: parseInt(
      process.env.BROWSER_RATE_LIMIT_SESSION_CREATIONS || "5",
      10,
    ),

    /** Maximum requests per window for screenshots (default: 30) */
    maxScreenshots: parseInt(
      process.env.BROWSER_RATE_LIMIT_SCREENSHOTS || "30",
      10,
    ),

    /** Maximum requests per window for actions (default: 60) */
    maxActions: parseInt(process.env.BROWSER_RATE_LIMIT_ACTIONS || "60", 10),
  },

  // Security
  security: {
    /** URL schemes that are blocked (default: file, javascript, data) */
    blockedSchemes: (
      process.env.BROWSER_BLOCKED_SCHEMES || "file,javascript,data,vbscript"
    ).split(","),

    /** IP ranges that are blocked (internal networks) */
    blockedIpRanges: [
      "10.0.0.0/8",
      "172.16.0.0/12",
      "192.168.0.0/16",
      "127.0.0.0/8",
      "169.254.0.0/16",
      "::1/128",
      "fc00::/7",
      "fe80::/10",
    ],

    /** Domains that are always allowed (empty means allow all non-blocked) */
    allowedDomains: (process.env.BROWSER_ALLOWED_DOMAINS || "")
      .split(",")
      .filter(Boolean),

    /** Domains that are always blocked */
    blockedDomains: (process.env.BROWSER_BLOCKED_DOMAINS || "")
      .split(",")
      .filter(Boolean),

    /** Enable strict mode (blocks unknown domains if allowedDomains is set) */
    strictMode: process.env.BROWSER_STRICT_MODE === "true",
  },

  // Browserbase Provider Settings
  provider: {
    /** Browserbase API key */
    apiKey: process.env.BROWSERBASE_API_KEY || "",

    /** Browserbase project ID */
    projectId: process.env.BROWSERBASE_PROJECT_ID || "",

    /** OpenAI API key for Stagehand AI operations (act, observe, extract) - Primary */
    openaiApiKey: process.env.OPENAI_API_KEY || "",

    /** Google API key for Stagehand AI operations (fallback if OpenAI not set) */
    googleApiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || "",

    /** Default model for Stagehand AI operations (OpenAI GPT-5.2) */
    stagehandModel: (process.env.STAGEHAND_MODEL || "openai/gpt-5.2") as string,

    /** Default browser type */
    browserType: (process.env.BROWSERBASE_BROWSER_TYPE || "chromium") as
      | "chromium"
      | "firefox",

    /** Enable stealth mode by default */
    stealthByDefault: process.env.BROWSERBASE_STEALTH_DEFAULT === "true",

    /** Default viewport width */
    viewportWidth: parseInt(
      process.env.BROWSERBASE_VIEWPORT_WIDTH || "1280",
      10,
    ),

    /** Default viewport height */
    viewportHeight: parseInt(
      process.env.BROWSERBASE_VIEWPORT_HEIGHT || "720",
      10,
    ),

    /** Navigation timeout in milliseconds */
    navigationTimeout: parseInt(
      process.env.BROWSERBASE_NAVIGATION_TIMEOUT_MS || "30000",
      10,
    ),

    /** Action timeout in milliseconds */
    actionTimeout: parseInt(
      process.env.BROWSERBASE_ACTION_TIMEOUT_MS || "10000",
      10,
    ),
  },

  // Logging
  logging: {
    /** Enable verbose logging */
    verbose: process.env.BROWSER_VERBOSE_LOGGING === "true",

    /** Log all navigation events */
    logNavigation: process.env.BROWSER_LOG_NAVIGATION !== "false",

    /** Log all action events */
    logActions: process.env.BROWSER_LOG_ACTIONS !== "false",

    /** Log performance metrics */
    logPerformance: process.env.BROWSER_LOG_PERFORMANCE === "true",
  },
} as const;

/**
 * Validate browser configuration
 * Throws if required values are missing or invalid
 */
export function validateBrowserConfig(): void {
  const errors: string[] = [];

  if (!BrowserConfig.provider.apiKey) {
    errors.push("BROWSERBASE_API_KEY is required");
  }

  if (!BrowserConfig.provider.projectId) {
    errors.push("BROWSERBASE_PROJECT_ID is required");
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
 * Check if browser automation is properly configured
 */
export function isBrowserConfigured(): boolean {
  return Boolean(
    BrowserConfig.provider.apiKey && BrowserConfig.provider.projectId,
  );
}

export type BrowserConfigType = typeof BrowserConfig;
