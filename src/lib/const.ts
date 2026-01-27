// Helper to safely access import.meta.env (only available in Vite/browser context)
const getViteEnv = (): Record<string, unknown> | undefined => {
  try {
    // @ts-ignore - import.meta.env is Vite-specific
    if (
      typeof import.meta !== "undefined" &&
      typeof import.meta.env === "object"
    ) {
      // @ts-ignore
      return import.meta.env;
    }
  } catch {
    // import.meta not available (Node.js/CommonJS context)
  }
  return undefined;
};

// Helper to get environment variables in both Vite and Node.js contexts
const getEnv = (viteKey: string, nodeKey?: string): string | undefined => {
  // Check for Vite environment (browser/renderer)
  const viteEnv = getViteEnv();
  if (viteEnv) {
    return viteEnv[viteKey] as string | undefined;
  }
  // Fallback to Node.js environment (Electron main process)
  if (typeof process !== "undefined" && process.env) {
    return process.env[nodeKey || viteKey.replace("VITE_", "")];
  }
  return undefined;
};

// Check if we're in development mode
const checkIsDev = (): boolean => {
  const viteEnv = getViteEnv();
  if (viteEnv) {
    return viteEnv.DEV === true;
  }
  if (typeof process !== "undefined" && process.env) {
    return process.env.NODE_ENV !== "production";
  }
  return false;
};

export const IS_DEV = checkIsDev();
export const IS_BROWSER = typeof window !== "undefined";

export const PROMPT_PASTE_MAX_LENGTH = 1000;

export const FILE_BASED_MCP_CONFIG =
  getEnv("VITE_FILE_BASED_MCP_CONFIG", "FILE_BASED_MCP_CONFIG") === "true";

export const IS_VERCEL_ENV =
  typeof process !== "undefined" &&
  process.env &&
  (process.env.VERCEL === "1" || process.env.VERCEL_ENV !== undefined);

export const IS_DOCKER_ENV =
  typeof process !== "undefined" &&
  process.env &&
  (process.env.DOCKER === "1" ||
    process.env.IS_DOCKER === "true" ||
    Boolean(process.env.DOCKER_CONTAINER));

export const COOKIE_KEY_SIDEBAR_STATE = "sidebar:state";

// Electron-only: BASE_URL for local development
export const BASE_URL = (() => {
  const betterAuthUrl = getEnv("VITE_BETTER_AUTH_URL", "BETTER_AUTH_URL");
  if (betterAuthUrl) return betterAuthUrl;

  const port = getEnv("VITE_PORT", "PORT") || "5173";
  return `http://localhost:${port}`;
})().replace(/\/+$/, "");

export const BASE_THEMES = [
  "default",
  "zinc",
  "slate",
  "stone",
  "gray",
  "blue",
  "orange",
  "pink",
  "bubblegum-pop",
  "cyberpunk-neon",
  "retro-arcade",
  "tropical-paradise",
  "steampunk-cogs",
  "neon-synthwave",
  "pastel-kawaii",
  "space-odyssey",
  "vintage-vinyl",
  "misty-harbor",
  "zen-garden",
];

export const OAUTH_REQUIRED_CODE = "OAUTH_REQUIRED";

export const BACKGROUND_COLORS = [
  "oklch(87% 0 0)", // Light gray
  "oklch(20.5% 0 0)", // Dark gray
  "oklch(80.8% 0.114 19.571)", // Orange/Coral
  "oklch(83.7% 0.128 66.29)", // Yellow/Gold
  "oklch(84.5% 0.143 164.978)", // Green/Teal
  "oklch(82.8% 0.111 230.318)", // Light Blue
  "oklch(78.5% 0.115 274.713)", // Purple
  "oklch(81% 0.117 11.638)", // Pink/Salmon
  "oklch(75% 0.15 330)", // Magenta/Pink
];

export const EMOJI_DATA = [
  "https://cdn.jsdelivr.net/npm/emoji-datasource-apple/img/apple/64/1f604.png",
  "https://cdn.jsdelivr.net/npm/emoji-datasource-apple/img/apple/64/1f603.png",
  "https://cdn.jsdelivr.net/npm/emoji-datasource-apple/img/apple/64/1f602.png",
  "https://cdn.jsdelivr.net/npm/emoji-datasource-apple/img/apple/64/1f601.png",
  "https://cdn.jsdelivr.net/npm/emoji-datasource-apple/img/apple/64/1f600.png",
];
