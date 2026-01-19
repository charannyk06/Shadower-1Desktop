import { z } from "zod";

// Session configuration types
export interface BrowserSessionOptions {
  /** User ID who owns this session (required) */
  userId: string;
  /** Thread ID to associate this session with */
  threadId?: string;
  /** Enable stealth mode for bot detection avoidance */
  stealth?: boolean;
  /** Proxy configuration */
  proxy?: {
    server: string;
    username?: string;
    password?: string;
  };
  /** Geographic location for proxy (e.g., 'us', 'uk', 'de') */
  geoLocation?: string;
  /** Browser viewport dimensions */
  viewport?: {
    width: number;
    height: number;
  };
  /** Enable session recording for replay */
  recording?: boolean;
  /** Session timeout in milliseconds (default: 5 minutes) */
  timeout?: number;
}

// Local provider types
export type LocalBrowserProvider = "chrome-devtools" | "local-terminal";
// Legacy provider types for backwards compatibility
export type LegacyBrowserProvider = "browserbase" | "e2b-desktop";
export type BrowserProvider = LocalBrowserProvider | LegacyBrowserProvider;

export interface BrowserSession {
  id: string;
  sessionId: string;
  status: "active" | "closed" | "error";
  currentUrl?: string;
  replayUrl?: string;
  createdAt: Date;
  provider: BrowserProvider;
}

// Stagehand action results
export interface ActionResult {
  success: boolean;
  message?: string;
  screenshot?: string; // base64
  error?: string;
}

export interface ObservationResult {
  success: boolean;
  elements: ObservedElement[];
  screenshot?: string;
  error?: string;
}

export interface ObservedElement {
  selector: string;
  text?: string;
  attributes?: Record<string, string>;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

// Extraction schemas
export const ExtractionSchema = z.object({
  items: z.array(z.record(z.string(), z.any())).optional(),
  text: z.string().optional(),
  data: z.record(z.string(), z.any()).optional(),
});

export type ExtractionResult = z.infer<typeof ExtractionSchema>;

// Screenshot types
export interface ScreenshotOptions {
  fullPage?: boolean;
  selector?: string;
  format?: "png" | "jpeg";
  quality?: number; // 0-100 for jpeg
  /** Save screenshot to cloud storage */
  saveToStorage?: boolean;
  /** Viewport dimensions for screenshot */
  viewport?: { width: number; height: number };
  /** Additional metadata to store with screenshot */
  metadata?: Record<string, unknown>;
}

export interface ScreenshotResult {
  base64: string;
  width: number;
  height: number;
  format: "png" | "jpeg";
}

// Browser events for streaming
export interface BrowserEvent {
  type: "screenshot" | "navigation" | "action" | "error" | "closed";
  timestamp: Date;
  data: any;
}

// Database types for session persistence
export interface BrowserSessionRecord {
  id: string;
  threadId: string;
  userId: string;
  provider: BrowserProvider;
  sessionId: string;
  status: "active" | "closed" | "error";
  replayUrl?: string;
  screenshots: ScreenshotRecord[];
  createdAt: Date;
  closedAt?: Date;
}

export interface ScreenshotRecord {
  id: string;
  url: string;
  base64?: string;
  timestamp: Date;
  description?: string;
}

// Tool parameter schemas
export const BrowserNavigateParams = z.object({
  url: z.string().url().describe("The URL to navigate to"),
  userId: z.string().describe("User ID who owns this browser session"),
  threadId: z
    .string()
    .describe(
      "Thread ID to find the active session (required for database lookup)",
    ),
  waitFor: z
    .enum(["load", "domcontentloaded", "networkidle"])
    .optional()
    .describe("Wait condition after navigation"),
});

export const BrowserActParams = z.object({
  action: z
    .string()
    .describe(
      'Natural language action to perform, e.g., "click the login button"',
    ),
  timeout: z
    .number()
    .optional()
    .describe("Timeout in milliseconds for the action"),
});

export const BrowserObserveParams = z.object({
  instruction: z
    .string()
    .describe('What to observe on the page, e.g., "find all product prices"'),
});

export const BrowserExtractParams = z.object({
  instruction: z
    .string()
    .describe(
      'What data to extract, e.g., "extract all article titles and links"',
    ),
  schema: z
    .record(z.string(), z.any())
    .optional()
    .describe("Optional Zod schema shape for structured extraction"),
});

export const BrowserScreenshotParams = z.object({
  fullPage: z.boolean().optional().describe("Capture full scrollable page"),
  selector: z
    .string()
    .optional()
    .describe("CSS selector to screenshot specific element"),
});

export const BrowserWaitParams = z.object({
  selector: z.string().optional().describe("CSS selector to wait for"),
  text: z.string().optional().describe("Text to wait for on page"),
  timeout: z.number().optional().describe("Max wait time in milliseconds"),
});

export const BrowserStealthParams = z.object({
  userId: z.string().describe("User ID who owns this browser session"),
  threadId: z
    .string()
    .describe(
      "Thread ID to find the active session (required for database lookup)",
    ),
  enable: z.boolean().describe("Enable or disable stealth mode"),
  proxy: z
    .object({
      country: z.string().optional(),
      type: z.enum(["residential", "datacenter"]).optional(),
    })
    .optional()
    .describe("Proxy configuration for stealth mode"),
});

// Research types
export interface ResearchSource {
  url: string;
  title: string;
  snippet?: string;
  content?: string;
  screenshot?: string;
  visitedAt: Date;
  relevanceScore?: number;
}

export interface ResearchFinding {
  id: string;
  claim: string;
  evidence: string[];
  sources: string[]; // URLs
  confidence: "high" | "medium" | "low";
}

export interface ResearchTask {
  id: string;
  threadId: string;
  userId: string;
  query: string;
  status: "pending" | "researching" | "analyzing" | "completed" | "failed";
  sources: ResearchSource[];
  findings: ResearchFinding[];
  citations: Citation[];
  createdAt: Date;
  completedAt?: Date;
}

export interface Citation {
  id: string;
  title: string;
  url: string;
  author?: string;
  publishedDate?: string;
  accessedDate: string;
}
