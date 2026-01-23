/**
 * Enhanced Browser Service using agent-browser's BrowserManager
 *
 * Provides AI-optimized browser automation with:
 * - Snapshot/ref system for deterministic element selection
 * - CDP connection support (for existing Chrome instances)
 * - User browser mode - connect to user's real Chrome with cookies/sessions
 * - Session management
 * - Streaming capability
 * - Stealth mode for bot detection bypass
 * - Navigation retry with exponential backoff
 * - CAPTCHA detection
 */

import { BrowserManager } from "agent-browser/dist/browser.js";
import type { RefMap } from "agent-browser/dist/snapshot.js";
import log from "electron-log/main";
import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as http from "http";
import { app } from "electron";

// Default CDP port for user browser connection
const DEFAULT_CDP_PORT = 9222;

// Track spawned Chrome processes for cleanup
const spawnedChromeProcesses: Map<number, { pid: number; port: number }> = new Map();

/**
 * Clean up all spawned Chrome processes
 * Call this on app shutdown to ensure no orphaned Chrome processes
 */
export function cleanupSpawnedChromeProcesses(): void {
  log.info(`[Browser] Cleaning up ${spawnedChromeProcesses.size} spawned Chrome processes`);
  for (const [pid] of spawnedChromeProcesses) {
    try {
      process.kill(pid, "SIGTERM");
      log.info(`[Browser] Sent SIGTERM to Chrome process PID ${pid}`);
    } catch (err: any) {
      // Process may already be terminated
      if (err.code !== "ESRCH") {
        log.warn(`[Browser] Failed to kill Chrome process PID ${pid}:`, err.message);
      }
    }
  }
  spawnedChromeProcesses.clear();
}

// Register cleanup on app shutdown
app.on("before-quit", () => {
  log.info("[Browser] App quitting - cleaning up Chrome processes");
  cleanupSpawnedChromeProcesses();
});

app.on("will-quit", () => {
  cleanupSpawnedChromeProcesses();
});

// Chrome executable paths by platform
const CHROME_PATHS: Record<string, string[]> = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ],
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  ],
  linux: [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ],
};

// Chrome user data directory paths by platform (where cookies/sessions are stored)
const CHROME_USER_DATA_PATHS: Record<string, string> = {
  darwin: path.join(os.homedir(), "Library", "Application Support", "Google", "Chrome"),
  win32: path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "User Data"),
  linux: path.join(os.homedir(), ".config", "google-chrome"),
};

/**
 * Find Chrome executable path
 */
function findChromePath(): string | null {
  const platform = os.platform();
  const paths = CHROME_PATHS[platform] || [];

  for (const chromePath of paths) {
    try {
      if (fs.existsSync(chromePath)) {
        return chromePath;
      }
    } catch {
      // Continue to next path
    }
  }

  return null;
}

/**
 * Get user's Chrome profile directory
 */
function getUserChromeProfilePath(): string | null {
  const platform = os.platform();
  const userDataPath = CHROME_USER_DATA_PATHS[platform];

  if (userDataPath && fs.existsSync(userDataPath)) {
    return userDataPath;
  }

  return null;
}

/**
 * Check if Chrome is already running with CDP on a given port
 */
async function checkCdpAvailable(port: number): Promise<string | null> {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/json/version",
        method: "GET",
        timeout: 2000,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            resolve(json.webSocketDebuggerUrl || null);
          } catch {
            resolve(null);
          }
        });
      }
    );

    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });

    req.end();
  });
}

/**
 * Check if Chrome has at least one page ready (for CDP connection)
 * agent-browser requires at least one page with a URL to connect
 */
async function checkCdpHasPages(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/json/list",
        method: "GET",
        timeout: 2000,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const pages = JSON.parse(data);
            // Check if there's at least one page with a URL
            const hasValidPage = Array.isArray(pages) && pages.some(
              (p: { url?: string; type?: string }) =>
                p.type === "page" && p.url && p.url.length > 0
            );
            resolve(hasValidPage);
          } catch {
            resolve(false);
          }
        });
      }
    );

    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });

    req.end();
  });
}

/**
 * Check if Chrome is running (without CDP) by checking for lock file
 */
function isChromeRunning(): boolean {
  const platform = os.platform();
  const userDataPath = CHROME_USER_DATA_PATHS[platform];

  if (!userDataPath) return false;

  // Check for Chrome's lock files
  const lockFiles = [
    path.join(userDataPath, "SingletonLock"),
    path.join(userDataPath, "lockfile"),
  ];

  for (const lockFile of lockFiles) {
    try {
      if (fs.existsSync(lockFile)) {
        return true;
      }
    } catch {
      // Continue
    }
  }

  return false;
}

/**
 * Launch Chrome with user's REAL profile + remote debugging enabled
 * This preserves all cookies, sessions, and browsing history!
 *
 * @param port - CDP port for remote debugging (default: 9222)
 * @param chromePath - Custom path to Chrome executable
 * @param useSeparateProfile - Use a separate profile to allow launching when main Chrome is running
 */
async function launchChromeWithUserProfile(
  port: number = DEFAULT_CDP_PORT,
  chromePath?: string,
  useSeparateProfile: boolean = false
): Promise<{ wsUrl: string; process: ReturnType<typeof spawn> } | null> {
  const execPath = chromePath || findChromePath();

  if (!execPath) {
    log.error("[Browser] Chrome not found on system!");
    throw new Error(
      "Chrome not found. Please install Google Chrome to use browser automation."
    );
  }

  // Check if Chrome is already running (without CDP)
  if (isChromeRunning() && !useSeparateProfile) {
    log.warn("[Browser] Chrome is already running without CDP enabled");
    throw new Error(
      "Chrome is already running without remote debugging enabled.\n\n" +
      "Options to fix this:\n" +
      "1. Close ALL Chrome windows and try again (recommended - preserves cookies)\n" +
      "2. Keep Chrome open and use a separate profile by passing useSeparateProfile: true\n" +
      "3. Manually start Chrome with: --remote-debugging-port=9222"
    );
  }

  // Determine which profile to use
  let profileDir: string | null = null;

  if (useSeparateProfile) {
    // Use a separate profile directory for automation when user wants to keep their Chrome open
    profileDir = path.join(os.tmpdir(), `chrome-automation-${port}`);
    log.info(`[Browser] Using SEPARATE PROFILE to allow running alongside main Chrome`);
    log.info(`[Browser] Note: Cookies and sessions from your main Chrome will NOT be available`);
  } else {
    // Use the user's REAL Chrome profile
    profileDir = getUserChromeProfilePath();
    if (!profileDir) {
      log.warn("[Browser] User's Chrome profile not found, using temp profile");
    }
  }

  log.info(`[Browser] Launching Chrome on port ${port}...`);
  log.info(`[Browser] Profile: ${useSeparateProfile ? "separate automation profile" : (profileDir || "temp")}`);

  const args = [
    `--remote-debugging-port=${port}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
  ];

  // Add user-data-dir if using a separate profile OR if no user profile found
  if (useSeparateProfile) {
    args.push(`--user-data-dir=${profileDir}`);
    log.info("[Browser] Using separate profile - cookies/sessions will NOT be shared with main Chrome");
  } else if (!profileDir) {
    const tempDir = path.join(os.tmpdir(), `chrome-cdp-${port}`);
    args.push(`--user-data-dir=${tempDir}`);
    log.warn("[Browser] Using temp profile - cookies/sessions will NOT be preserved");
  }
  // When profileDir exists and NOT useSeparateProfile, we DON'T add --user-data-dir
  // This lets Chrome use the default profile automatically

  const chromeProcess = spawn(execPath, args, {
    detached: true,
    stdio: "ignore",
  });

  chromeProcess.unref();

  // Track the spawned process for cleanup
  if (chromeProcess.pid) {
    spawnedChromeProcesses.set(chromeProcess.pid, { pid: chromeProcess.pid, port });
    log.info(`[Browser] Tracking Chrome process PID ${chromeProcess.pid} for cleanup`);
  }

  // Wait for Chrome to start and CDP to be available
  log.info("[Browser] Waiting for Chrome to start...");
  let wsUrl: string | null = null;

  // Phase 1: Wait for CDP endpoint to be available
  for (let i = 0; i < 30; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    wsUrl = await checkCdpAvailable(port);
    if (wsUrl) {
      log.info(`[Browser] Chrome CDP endpoint ready at ${wsUrl}`);
      break;
    }
  }

  if (!wsUrl) {
    log.error("[Browser] Chrome started but CDP not responding");
    throw new Error(
      "Chrome started but remote debugging is not responding. " +
      "Try closing Chrome completely and running again."
    );
  }

  // Phase 2: Wait for Chrome to have at least one page ready
  // agent-browser requires at least one page with a URL to connect
  log.info("[Browser] Waiting for Chrome to initialize pages...");
  for (let i = 0; i < 20; i++) {
    const hasPages = await checkCdpHasPages(port);
    if (hasPages) {
      log.info("[Browser] Chrome has pages ready!");
      log.info("[Browser] USER'S REAL BROWSER is now connected with all cookies/sessions!");
      return { wsUrl, process: chromeProcess };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  // Even if no pages detected, try to proceed - the page might be initializing
  log.warn("[Browser] Could not detect pages, proceeding anyway...");
  return { wsUrl, process: chromeProcess };
}

/**
 * Get or launch Chrome with CDP - uses user's REAL browser
 * This is CDP-ONLY mode - no fallbacks!
 *
 * @param port - CDP port for remote debugging
 * @param chromePath - Custom path to Chrome executable
 * @param useSeparateProfile - Use a separate profile to allow launching when main Chrome is running
 */
async function getOrLaunchChromeWithCdp(
  port: number = DEFAULT_CDP_PORT,
  chromePath?: string,
  useSeparateProfile: boolean = false
): Promise<string> {
  // PRIORITY 1: Check if Chrome is already running with CDP
  log.info(`[Browser] Checking for existing Chrome CDP on port ${port}...`);
  const existingWsUrl = await checkCdpAvailable(port);

  if (existingWsUrl) {
    log.info(`[Browser] Found existing Chrome CDP at ${existingWsUrl}`);
    log.info("[Browser] Connected to user's running Chrome browser!");
    return existingWsUrl;
  }

  // PRIORITY 2: Launch Chrome with user's profile + CDP (or separate profile if requested)
  const profileMode = useSeparateProfile ? "separate automation profile" : "user's profile";
  log.info(`[Browser] No existing Chrome with CDP found. Launching Chrome with ${profileMode}...`);
  const result = await launchChromeWithUserProfile(port, chromePath, useSeparateProfile);

  if (!result?.wsUrl) {
    throw new Error(
      "Failed to launch Chrome with CDP. " +
      "Please ensure Chrome is installed and try again."
    );
  }

  return result.wsUrl;
}

// Page type from agent-browser's BrowserManager
type Page = ReturnType<BrowserManager["getPage"]>;

// NOTE: Stealth args and user agent rotation are NOT NEEDED in CDP-only mode
// because we're using the user's REAL Chrome browser, which has no automation fingerprints.
// The user's browser already has their real plugins, fonts, languages, etc.

// CAPTCHA and block detection patterns
const CAPTCHA_SELECTORS = [
  'iframe[src*="recaptcha"]',
  'iframe[src*="hcaptcha"]',
  'iframe[src*="captcha"]',
  ".cf-challenge-running",
  "#challenge-form",
  '[class*="captcha"]',
  '[id*="captcha"]',
  ".g-recaptcha",
  ".h-captcha",
  "#cf-wrapper",
  ".cf-browser-verification",
  "#challenge-running",
  ".challenge-running",
  // Google specific
  'form[action*="/sorry/"]',
  '#captcha-form',
  'div[aria-label*="CAPTCHA"]',
];

// URL patterns that indicate blocking/CAPTCHA
const BLOCK_URL_PATTERNS = [
  "/sorry/",           // Google CAPTCHA
  "/challenge/",       // Generic challenge pages
  "captcha",           // CAPTCHA in URL
  "/blocked",          // Blocked pages
  "/verify",           // Verification pages
  "ipv4.google.com/sorry", // Google sorry page
  "consent.google.com",    // Google consent (sometimes blocks)
];

// Title patterns that indicate blocking
const BLOCK_TITLE_PATTERNS = [
  "captcha",
  "security check",
  "just a moment",
  "verify you are human",
  "attention required",
  "access denied",
  "blocked",
  "unusual traffic",
  "automated queries",
  "sorry",
  "before you continue",
];

// Session tracking
interface BrowserSession {
  id: string;
  manager: BrowserManager;
  createdAt: Date;
  stealth: boolean;
  /** Whether this session is connected to the user's real browser via CDP */
  userBrowser: boolean;
  /** CDP WebSocket URL if connected via CDP */
  cdpUrl?: string;
}

// Launch options - CDP-ONLY mode
export interface LaunchOptions {
  /**
   * CDP port for Chrome remote debugging (default: 9222)
   * The browser service will connect to an existing Chrome instance on this port,
   * or launch Chrome with remote debugging enabled on this port.
   */
  cdpPort?: number;
  /** Custom Chrome executable path */
  executablePath?: string;
  /** Viewport dimensions */
  viewport?: { width: number; height: number };
  /**
   * Use a separate Chrome profile instead of the user's default profile.
   * This allows launching Chrome even when the user's main Chrome is already running.
   * Note: Using a separate profile means cookies/sessions will NOT be shared.
   * Default: false (use user's real profile for cookie/session preservation)
   */
  useSeparateProfile?: boolean;
  // NOTE: headless, userAgent, args, stealth, and useUserBrowser are REMOVED
  // because we ONLY use the user's real Chrome via CDP now.
  // This preserves cookies/sessions and avoids bot detection completely.
}

// Navigation options
export interface NavigateOptions {
  /** When to consider navigation complete */
  waitUntil?: "load" | "domcontentloaded" | "networkidle";
  /** Navigation timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Number of retries on failure (default: 2) */
  retries?: number;
  /** Session ID */
  sessionId?: string;
}

// Navigation result
export interface NavigateResult {
  url: string;
  title: string;
  /** Whether a CAPTCHA/block was detected on the page */
  captchaDetected?: boolean;
  /** Type of CAPTCHA/block if detected */
  captchaType?: string;
  /** Whether the navigation was blocked by bot detection */
  blocked?: boolean;
  /** Suggested alternative actions when blocked */
  suggestion?: string;
}

// Snapshot options
export interface SnapshotOptions {
  /** Only include interactive elements (buttons, links, inputs) */
  interactive?: boolean;
  /** Maximum depth of tree to include */
  maxDepth?: number;
  /** Remove structural elements without meaningful content */
  compact?: boolean;
  /** CSS selector to scope the snapshot */
  selector?: string;
}

// Action types
export type BrowserAction =
  | {
      type: "click";
      selector: string;
      button?: "left" | "right";
      clickCount?: number;
    }
  | { type: "fill"; selector: string; value: string }
  | { type: "type"; selector: string; text: string; delay?: number }
  | { type: "press"; key: string; selector?: string }
  | { type: "hover"; selector: string }
  | { type: "select"; selector: string; values: string | string[] }
  | { type: "check"; selector: string }
  | { type: "uncheck"; selector: string }
  | { type: "screenshot"; fullPage?: boolean; path?: string }
  | {
      type: "scroll";
      direction?: "up" | "down";
      amount?: number;
      selector?: string;
    };

/**
 * Enhanced Browser Service Singleton
 */
export class EnhancedBrowserService {
  private static instance: EnhancedBrowserService;
  private static cleanupRegistered = false;
  private sessions: Map<string, BrowserSession> = new Map();
  private activeSessionId: string | null = null;

  static getInstance(): EnhancedBrowserService {
    if (!EnhancedBrowserService.instance) {
      EnhancedBrowserService.instance = new EnhancedBrowserService();

      // Register cleanup handlers once on first instance creation
      if (!EnhancedBrowserService.cleanupRegistered) {
        EnhancedBrowserService.cleanupRegistered = true;
        registerBrowserCleanup();
      }
    }
    return EnhancedBrowserService.instance;
  }

  /**
   * Create a new browser session using the user's REAL Chrome browser via CDP.
   *
   * CDP-ONLY MODE - NO FALLBACKS!
   *
   * This connects to or launches Chrome with remote debugging enabled,
   * preserving the user's cookies, sessions, and browsing history.
   * This is the ONLY way to avoid bot detection since it's a REAL browser.
   *
   * @throws Error if Chrome is not available or CDP connection fails
   */
  async createSession(options: LaunchOptions = {}): Promise<{
    sessionId: string;
    url?: string;
    title?: string;
    stealth?: boolean;
    userBrowser: true; // Always true now - CDP only
    cdpUrl?: string;
  }> {
    const manager = new BrowserManager();
    const cdpPort = options.cdpPort ?? DEFAULT_CDP_PORT;

    log.info("[Browser] CDP-ONLY MODE: Connecting to user's Chrome browser...");
    log.info("[Browser] This preserves all cookies, sessions, and avoids ALL bot detection!");

    try {
      // Get or launch Chrome with CDP - this will THROW if it fails (no fallbacks!)
      const cdpWsUrl = await getOrLaunchChromeWithCdp(
        cdpPort,
        options.executablePath,
        options.useSeparateProfile ?? false
      );

      log.info(`[Browser] CDP WebSocket URL: ${cdpWsUrl}`);
      log.info(`[Browser] Connecting via agent-browser on port ${cdpPort}...`);

      // Connect to user's Chrome via CDP with retry
      // Sometimes the first connection attempt fails if Chrome is still initializing
      let lastError: Error | null = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await manager.launch({
            headless: false, // User's browser is always visible
            cdpPort: cdpPort,
            viewport: options.viewport ?? { width: 1280, height: 720 },
          } as any);
          lastError = null;
          break; // Success!
        } catch (err) {
          lastError = err as Error;
          log.warn(`[Browser] CDP connection attempt ${attempt}/3 failed: ${lastError.message}`);
          if (attempt < 3) {
            // Wait before retry with exponential backoff
            await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
          }
        }
      }

      if (lastError) {
        throw lastError;
      }

      log.info("[Browser] Successfully connected to user's Chrome via CDP!");

      const sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const session: BrowserSession = {
        id: sessionId,
        manager,
        createdAt: new Date(),
        stealth: false, // No stealth needed - it's the user's real browser!
        userBrowser: true,
        cdpUrl: cdpWsUrl,
      };

      this.sessions.set(sessionId, session);
      this.activeSessionId = sessionId;

      // Get current page
      const page = manager.getPage();
      const url = page.url();
      const title = await page.title().catch(() => "");

      log.info(`[Browser] Session created: ${sessionId}`);
      log.info("[Browser] Using USER'S REAL BROWSER - no bot detection possible!");
      log.info(`[Browser] Current URL: ${url}`);

      return {
        sessionId,
        url,
        title,
        stealth: false, // Not needed with real browser
        userBrowser: true,
        cdpUrl: cdpWsUrl,
      };
    } catch (error) {
      await manager.close().catch(() => {});

      const message = error instanceof Error ? error.message : String(error);

      // Provide helpful error messages
      if (message.includes("Chrome not found")) {
        throw new Error(
          "BROWSER ERROR: Google Chrome is not installed.\n\n" +
          "Please install Chrome from: https://www.google.com/chrome\n\n" +
          "After installing, try again."
        );
      }

      if (message.includes("already running")) {
        throw new Error(
          "BROWSER ERROR: Chrome is already running without remote debugging.\n\n" +
          "To fix this:\n" +
          "1. Close ALL Chrome windows completely\n" +
          "2. Try again - Chrome will be launched with debugging enabled\n\n" +
          "OR manually start Chrome with debugging:\n" +
          `  chrome --remote-debugging-port=${cdpPort}`
        );
      }

      if (message.includes("CDP") || message.includes("remote debugging")) {
        throw new Error(
          `BROWSER ERROR: Failed to connect to Chrome CDP on port ${cdpPort}.\n\n` +
          "To fix this:\n" +
          "1. Close all Chrome windows\n" +
          "2. Try again\n\n" +
          "If the problem persists, manually start Chrome:\n" +
          `  chrome --remote-debugging-port=${cdpPort}`
        );
      }

      throw error;
    }
  }

  // NOTE: injectStealthScripts has been removed since we're in CDP-only mode.
  // The user's real Chrome browser has no automation fingerprints, so stealth
  // scripts are not needed and would only potentially cause issues.

  /**
   * Get a session by ID (or active session if not specified)
   */
  private getSession(sessionId?: string): BrowserSession {
    const id = sessionId ?? this.activeSessionId;
    if (!id) {
      throw new Error("No browser session active. Call createSession first.");
    }

    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(`Session not found: ${id}`);
    }

    return session;
  }

  /**
   * Navigate to a URL with retry logic and CAPTCHA detection
   */
  async navigate(
    url: string,
    options?: NavigateOptions
  ): Promise<NavigateResult> {
    const session = this.getSession(options?.sessionId);
    const page = session.manager.getPage();

    const timeout = options?.timeout ?? 30000;
    const maxRetries = options?.retries ?? 2;
    const waitUntil = options?.waitUntil ?? "domcontentloaded"; // Changed from "load" for better reliability

    // NOTE: No stealth scripts needed - we're using the user's REAL Chrome browser!
    // The user's browser has no automation fingerprints.

    return this.navigateWithRetry(page, url, { waitUntil, timeout }, maxRetries);
  }

  /**
   * Navigate with retry logic and exponential backoff
   */
  private async navigateWithRetry(
    page: Page,
    url: string,
    options: { waitUntil: "load" | "domcontentloaded" | "networkidle"; timeout: number },
    maxRetries: number
  ): Promise<NavigateResult> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        log.debug(`[Browser] Navigation attempt ${attempt + 1}/${maxRetries + 1} to ${url}`);

        await page.goto(url, {
          waitUntil: options.waitUntil,
          timeout: options.timeout,
        });

        // Check for CAPTCHA/block after navigation
        const captchaResult = await this.detectCaptcha(page);

        const result: NavigateResult = {
          url: page.url(),
          title: await page.title().catch(() => ""),
        };

        if (captchaResult.detected) {
          result.captchaDetected = true;
          result.captchaType = captchaResult.type;
          result.blocked = true;
          result.suggestion = this.getSuggestionForBlock(captchaResult.type, url);
          log.warn(`[Browser] BLOCKED (${captchaResult.type}) on ${url}`);
        }

        return result;
      } catch (error) {
        lastError = error as Error;
        const message = lastError.message;

        log.warn(`[Browser] Navigation attempt ${attempt + 1} failed: ${message}`);

        // Don't retry on non-retryable errors
        if (this.isNonRetryableError(message)) {
          throw lastError;
        }

        // Exponential backoff before retry
        if (attempt < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
          log.debug(`[Browser] Waiting ${delay}ms before retry...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError;
  }

  /**
   * Check if error is non-retryable
   */
  private isNonRetryableError(message: string): boolean {
    return (
      message.includes("net::ERR_NAME_NOT_RESOLVED") ||
      message.includes("net::ERR_CONNECTION_REFUSED") ||
      message.includes("net::ERR_INTERNET_DISCONNECTED") ||
      message.includes("net::ERR_CERT") ||
      message.includes("invalid URL")
    );
  }

  /**
   * Get suggestion for handling a blocked page
   */
  private getSuggestionForBlock(blockType: string | undefined, originalUrl: string): string {
    const urlLower = originalUrl.toLowerCase();
    const isGoogleSearch = urlLower.includes("google.com/search") || urlLower.includes("google.com/sorry");
    const isLinkedIn = urlLower.includes("linkedin.com");
    const isBing = urlLower.includes("bing.com");

    // Extract search query if it's a search URL
    let searchQuery = "";
    try {
      const url = new URL(originalUrl);
      searchQuery = url.searchParams.get("q") || url.searchParams.get("query") || "";
    } catch {
      // Not a valid URL
    }

    if (blockType === "google-captcha" || isGoogleSearch) {
      if (searchQuery) {
        return `Google is blocking automated searches. Try these alternatives:
1. DuckDuckGo: https://duckduckgo.com/?q=${encodeURIComponent(searchQuery)}
2. Bing: https://www.bing.com/search?q=${encodeURIComponent(searchQuery)}
3. Brave Search: https://search.brave.com/search?q=${encodeURIComponent(searchQuery)}
4. Wait 5-10 minutes and retry with a new browser session`;
      }
      return "Google is blocking. Use DuckDuckGo, Bing, or Brave Search instead.";
    }

    if (isLinkedIn) {
      return "LinkedIn requires login for most searches. Consider using the LinkedIn API or searching via Google/Bing with 'site:linkedin.com' query.";
    }

    if (isBing) {
      if (searchQuery) {
        return `Bing may be rate-limiting. Try DuckDuckGo: https://duckduckgo.com/?q=${encodeURIComponent(searchQuery)}`;
      }
      return "Bing may be rate-limiting. Try DuckDuckGo instead.";
    }

    if (blockType === "cloudflare") {
      return "Site is protected by Cloudflare. Try: 1) Wait 10-30 seconds for challenge to complete, 2) Use a different network/IP, 3) Access via a different search engine to find cached content.";
    }

    if (blockType === "recaptcha" || blockType === "hcaptcha" || blockType === "captcha") {
      return "CAPTCHA detected. Cannot bypass automatically. Try: 1) Use an alternative site, 2) Use a search engine to find the information elsewhere, 3) Access the site manually if critical.";
    }

    return "Page appears to be blocked. Try using an alternative source or waiting before retrying.";
  }

  /**
   * Safe execution wrapper to handle "Execution context was destroyed" errors
   * This happens when the page navigates mid-operation
   */
  private async withSafeExecution<T>(
    page: Page,
    operation: () => Promise<T>,
    retryCount = 1
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // Retry on execution context errors
      if (message.includes("Execution context was destroyed") && retryCount > 0) {
        log.debug("[Browser] Execution context destroyed, waiting for page to stabilize...");

        // Wait for page to stabilize
        await page.waitForLoadState("domcontentloaded").catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 500));

        return this.withSafeExecution(page, operation, retryCount - 1);
      }

      // Retry on target closed errors (page navigated away)
      if (message.includes("Target closed") && retryCount > 0) {
        log.debug("[Browser] Target closed, attempting recovery...");
        await new Promise((resolve) => setTimeout(resolve, 500));
        return this.withSafeExecution(page, operation, retryCount - 1);
      }

      throw error;
    }
  }

  /**
   * Detect CAPTCHA on the current page
   */
  private async detectCaptcha(page: Page): Promise<{ detected: boolean; type?: string }> {
    try {
      const currentUrl = page.url().toLowerCase();
      const title = await page.title().catch(() => "");
      const titleLower = title.toLowerCase();

      // 1. Check URL patterns for blocking (most reliable for Google)
      for (const pattern of BLOCK_URL_PATTERNS) {
        if (currentUrl.includes(pattern)) {
          let type = "blocked";
          if (pattern.includes("sorry") || pattern.includes("google")) type = "google-captcha";
          else if (pattern.includes("captcha")) type = "captcha";
          else if (pattern.includes("challenge") || pattern.includes("verify")) type = "challenge";

          log.warn(`[Browser] Block detected via URL pattern: ${pattern}`);
          return { detected: true, type };
        }
      }

      // 2. Check page title for blocking indicators
      for (const pattern of BLOCK_TITLE_PATTERNS) {
        if (titleLower.includes(pattern)) {
          let type = "blocked";
          if (pattern.includes("captcha")) type = "captcha";
          else if (pattern === "sorry" || titleLower.includes("unusual traffic")) type = "google-captcha";
          else if (pattern.includes("cloudflare") || pattern === "just a moment") type = "cloudflare";

          log.warn(`[Browser] Block detected via title pattern: ${pattern} (title: "${title}")`);
          return { detected: true, type };
        }
      }

      // 3. Check for CAPTCHA selectors on page
      for (const selector of CAPTCHA_SELECTORS) {
        const element = await page.$(selector).catch(() => null);
        if (element) {
          let type = "unknown";
          if (selector.includes("recaptcha")) type = "recaptcha";
          else if (selector.includes("hcaptcha")) type = "hcaptcha";
          else if (selector.includes("cf-") || selector.includes("challenge")) type = "cloudflare";
          else if (selector.includes("captcha")) type = "captcha";
          else if (selector.includes("sorry")) type = "google-captcha";

          log.warn(`[Browser] CAPTCHA detected via selector: ${selector}`);
          return { detected: true, type };
        }
      }

      // 4. Check page body for blocking text
      const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 1500) || "").catch(() => "");
      const bodyLower = bodyText.toLowerCase();

      const blockingPhrases = [
        "checking your browser",
        "please wait while we verify",
        "enable javascript and cookies",
        "unusual traffic from your computer",
        "automated queries",
        "our systems have detected unusual traffic",
        "to continue, please type the characters",
        "are you a robot",
        "prove you're not a robot",
        "before you continue",
        "security check",
        "detected unusual activity",
        "verify you are human",
        "complete the security check",
      ];

      for (const phrase of blockingPhrases) {
        if (bodyLower.includes(phrase)) {
          let type = "blocked";
          if (phrase.includes("unusual traffic") || phrase.includes("automated queries")) {
            type = "google-captcha";
          } else if (phrase.includes("cloudflare") || phrase.includes("checking your browser")) {
            type = "cloudflare";
          }

          log.warn(`[Browser] Block detected via body text: "${phrase}"`);
          return { detected: true, type };
        }
      }

      return { detected: false };
    } catch (error) {
      log.debug("[Browser] CAPTCHA detection error:", error);
      return { detected: false };
    }
  }

  /**
   * Get AI-optimized snapshot with element refs
   *
   * Example output:
   * ```
   * - heading "Example Domain" [ref=e1] [level=1]
   * - paragraph: Some text content
   * - button "Submit" [ref=e2]
   * - textbox "Email" [ref=e3]
   * ```
   *
   * Use refs with click, fill, etc: `click('@e2')` or `fill('@e3', 'test@email.com')`
   */
  async getSnapshot(options?: SnapshotOptions & { sessionId?: string }): Promise<{
    tree: string;
    refs: RefMap;
    stats: { lines: number; chars: number; refs: number; interactive: number };
  }> {
    const session = this.getSession(options?.sessionId);
    const snapshot = await session.manager.getSnapshot({
      interactive: options?.interactive,
      maxDepth: options?.maxDepth,
      compact: options?.compact,
      selector: options?.selector,
    });

    // Calculate stats
    const lines = snapshot.tree.split("\n").length;
    const chars = snapshot.tree.length;
    const refCount = Object.keys(snapshot.refs).length;
    const interactive = Object.values(snapshot.refs).filter((r) =>
      ["button", "link", "textbox", "checkbox", "radio", "combobox"].includes(r.role)
    ).length;

    return {
      tree: snapshot.tree,
      refs: snapshot.refs,
      stats: { lines, chars, refs: refCount, interactive },
    };
  }

  /**
   * Execute a browser action
   * Supports both refs (@e1) and CSS selectors
   * Wrapped with safe execution to handle context destruction
   */
  async executeAction(
    action: BrowserAction,
    options?: { sessionId?: string }
  ): Promise<{ success: boolean; data?: unknown }> {
    const session = this.getSession(options?.sessionId);
    const manager = session.manager;
    const page = manager.getPage();

    // Wrap the entire action execution in safe execution
    return this.withSafeExecution(page, async () => {
      try {
        switch (action.type) {
          case "click": {
            const locator = manager.getLocator(action.selector);
            await locator.click({
              button: action.button,
              clickCount: action.clickCount,
            });
            return { success: true };
          }

          case "fill": {
            const locator = manager.getLocator(action.selector);
            await locator.fill(action.value);
            return { success: true };
          }

          case "type": {
            const locator = manager.getLocator(action.selector);
            await locator.pressSequentially(action.text, { delay: action.delay });
            return { success: true };
          }

          case "press": {
            if (action.selector) {
              await page.press(action.selector, action.key);
            } else {
              await page.keyboard.press(action.key);
            }
            return { success: true };
          }

          case "hover": {
            const locator = manager.getLocator(action.selector);
            await locator.hover();
            return { success: true };
          }

          case "select": {
            const locator = manager.getLocator(action.selector);
            const values = Array.isArray(action.values)
              ? action.values
              : [action.values];
            await locator.selectOption(values);
            return { success: true, data: { selected: values } };
          }

          case "check": {
            const locator = manager.getLocator(action.selector);
            await locator.check();
            return { success: true };
          }

          case "uncheck": {
            const locator = manager.getLocator(action.selector);
            await locator.uncheck();
            return { success: true };
          }

          case "screenshot": {
            const buffer = await page.screenshot({
              fullPage: action.fullPage,
              path: action.path,
            });
            return {
              success: true,
              data: action.path
                ? { path: action.path }
                : { base64: buffer.toString("base64") },
            };
          }

          case "scroll": {
            if (action.selector) {
              await page.locator(action.selector).scrollIntoViewIfNeeded();
            } else {
              const amount = action.amount ?? 500;
              const delta = action.direction === "up" ? -amount : amount;
              await page.evaluate(`window.scrollBy(0, ${delta})`);
            }
            return { success: true };
          }

          default:
            throw new Error(`Unknown action type: ${(action as BrowserAction).type}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        // Convert to AI-friendly error messages
        if (message.includes("strict mode violation")) {
          throw new Error(
            `Selector "${(action as { selector?: string }).selector}" matched multiple elements. ` +
              `Run 'getSnapshot()' to get updated refs.`
          );
        }
        if (message.includes("intercepts pointer events")) {
          throw new Error(
            `Element is blocked by another element (likely a modal or overlay). ` +
              `Try dismissing any modals/cookie banners first.`
          );
        }
        if (message.includes("waiting for") || message.includes("Timeout")) {
          throw new Error(
            `Element "${(action as { selector?: string }).selector}" not found. ` +
              `Run 'getSnapshot()' to see current page elements.`
          );
        }

        throw error;
      }
    });
  }

  /**
   * Evaluate JavaScript in the page context
   */
  async evaluate(
    script: string,
    options?: { sessionId?: string }
  ): Promise<unknown> {
    const session = this.getSession(options?.sessionId);
    const page = session.manager.getPage();
    return page.evaluate(script);
  }

  /**
   * Wait for element or load state
   */
  async wait(options: {
    selector?: string;
    state?: "visible" | "hidden" | "attached" | "detached";
    timeout?: number;
    loadState?: "load" | "domcontentloaded" | "networkidle";
    sessionId?: string;
  }): Promise<{ success: boolean }> {
    const session = this.getSession(options.sessionId);
    const page = session.manager.getPage();

    if (options.selector) {
      await page.waitForSelector(options.selector, {
        state: options.state ?? "visible",
        timeout: options.timeout,
      });
    } else if (options.loadState) {
      await page.waitForLoadState(options.loadState);
    } else {
      await page.waitForLoadState("load");
    }

    return { success: true };
  }

  /**
   * Get page content (HTML)
   */
  async getContent(options?: {
    selector?: string;
    sessionId?: string;
  }): Promise<string> {
    const session = this.getSession(options?.sessionId);
    const page = session.manager.getPage();

    if (options?.selector) {
      return page.locator(options.selector).innerHTML();
    }
    return page.content();
  }

  /**
   * Get current URL
   */
  async getUrl(sessionId?: string): Promise<string> {
    const session = this.getSession(sessionId);
    return session.manager.getPage().url();
  }

  /**
   * Get page title
   */
  async getTitle(sessionId?: string): Promise<string> {
    const session = this.getSession(sessionId);
    return session.manager.getPage().title();
  }

  /**
   * Go back in history
   */
  async goBack(sessionId?: string): Promise<{ url: string }> {
    const session = this.getSession(sessionId);
    const page = session.manager.getPage();
    await page.goBack();
    return { url: page.url() };
  }

  /**
   * Go forward in history
   */
  async goForward(sessionId?: string): Promise<{ url: string }> {
    const session = this.getSession(sessionId);
    const page = session.manager.getPage();
    await page.goForward();
    return { url: page.url() };
  }

  /**
   * Reload page
   */
  async reload(sessionId?: string): Promise<{ url: string }> {
    const session = this.getSession(sessionId);
    const page = session.manager.getPage();
    await page.reload();
    return { url: page.url() };
  }

  /**
   * List all active sessions
   */
  listSessions(): Array<{ id: string; createdAt: Date; isActive: boolean }> {
    return Array.from(this.sessions.entries()).map(([id, session]) => ({
      id,
      createdAt: session.createdAt,
      isActive: id === this.activeSessionId,
    }));
  }

  /**
   * Switch to a different session
   */
  switchSession(sessionId: string): void {
    if (!this.sessions.has(sessionId)) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    this.activeSessionId = sessionId;
  }

  /**
   * Close a session
   */
  async closeSession(sessionId?: string): Promise<void> {
    const id = sessionId ?? this.activeSessionId;
    if (!id) return;

    const session = this.sessions.get(id);
    if (session) {
      await session.manager.close();
      this.sessions.delete(id);
      log.info(`[Browser] Session closed: ${id}`);

      if (this.activeSessionId === id) {
        // Switch to another session if available
        const remaining = Array.from(this.sessions.keys());
        this.activeSessionId = remaining.length > 0 ? remaining[0] : null;
      }
    }
  }

  /**
   * Close all sessions
   */
  async closeAllSessions(): Promise<void> {
    for (const [id, session] of this.sessions) {
      await session.manager.close().catch(() => {});
      log.info(`[Browser] Session closed: ${id}`);
    }
    this.sessions.clear();
    this.activeSessionId = null;
  }
}

// Export singleton instance getter
export const getBrowserService = () => EnhancedBrowserService.getInstance();

/**
 * Cleanup all spawned Chrome processes
 * Called when the app is quitting
 */
export function cleanupChromeProcesses(): void {
  log.info(`[Browser] Cleaning up ${spawnedChromeProcesses.size} spawned Chrome processes...`);

  for (const [pid, info] of spawnedChromeProcesses) {
    try {
      // Check if process is still running before trying to kill
      process.kill(pid, 0); // This throws if process doesn't exist

      // Process exists, try to terminate gracefully
      log.info(`[Browser] Terminating Chrome process PID ${pid} (port ${info.port})`);

      if (os.platform() === "win32") {
        // On Windows, use taskkill
        spawn("taskkill", ["/PID", pid.toString(), "/F"], { detached: true, stdio: "ignore" });
      } else {
        // On macOS/Linux, send SIGTERM
        process.kill(pid, "SIGTERM");
      }

      spawnedChromeProcesses.delete(pid);
    } catch {
      // Process doesn't exist or we can't access it - remove from tracking
      log.debug(`[Browser] Chrome process PID ${pid} already terminated or inaccessible`);
      spawnedChromeProcesses.delete(pid);
    }
  }

  log.info("[Browser] Chrome process cleanup complete");
}

/**
 * Register cleanup handler with Electron app lifecycle
 * This ensures Chrome processes are cleaned up when the app quits
 */
export function registerBrowserCleanup(): void {
  // Only register once
  if ((app as any).__browserCleanupRegistered) {
    return;
  }

  app.on("before-quit", () => {
    log.info("[Browser] App quitting - cleaning up browser resources");
    cleanupChromeProcesses();
    EnhancedBrowserService.getInstance().closeAllSessions().catch(() => {});
  });

  app.on("will-quit", () => {
    // Last chance cleanup
    cleanupChromeProcesses();
  });

  (app as any).__browserCleanupRegistered = true;
  log.info("[Browser] Registered cleanup handlers for Chrome processes");
}
