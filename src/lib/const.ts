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

declare const EdgeRuntime: any;
export const IS_EDGE_RUNTIME = typeof EdgeRuntime !== "undefined";

export const PROMPT_PASTE_MAX_LENGTH = 1000;

export const IS_VERCEL_ENV = getEnv("VITE_VERCEL", "VERCEL") === "1";
export const IS_DOCKER_ENV =
  getEnv("VITE_DOCKER_BUILD", "DOCKER_BUILD") === "1";

export const IS_MCP_SERVER_REMOTE_ONLY = IS_VERCEL_ENV;
export const FILE_BASED_MCP_CONFIG =
  getEnv("VITE_FILE_BASED_MCP_CONFIG", "FILE_BASED_MCP_CONFIG") === "true";

export const COOKIE_KEY_SIDEBAR_STATE = "sidebar:state";
export const COOKIE_KEY_LOCALE = "i18n:locale";

export const BASE_URL = (() => {
  const betterAuthUrl = getEnv("VITE_BETTER_AUTH_URL", "BETTER_AUTH_URL");
  if (betterAuthUrl) return betterAuthUrl;

  if (IS_VERCEL_ENV) {
    const vercelEnv = getEnv("VITE_VERCEL_ENV", "VERCEL_ENV");
    const productionUrl = getEnv(
      "VITE_VERCEL_PROJECT_PRODUCTION_URL",
      "VERCEL_PROJECT_PRODUCTION_URL",
    );
    const vercelUrl = getEnv("VITE_VERCEL_URL", "VERCEL_URL");

    const vercelDomain =
      (vercelEnv === "production" ? productionUrl : vercelUrl) || vercelUrl;

    if (vercelDomain) return `https://${vercelDomain}`;
  }

  const port = getEnv("VITE_PORT", "PORT") || "3000";
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

export const SUPPORTED_LOCALES = [
  {
    code: "en",
    name: "English 🇺🇸",
  },
  {
    code: "ko",
    name: "Korean 🇰🇷",
  },

  {
    code: "es",
    name: "Spanish 🇪🇸",
  },
  {
    code: "fr",
    name: "French 🇫🇷",
  },
  {
    code: "ja",
    name: "Japanese 🇯🇵",
  },
  {
    code: "zh",
    name: "Chinese 🇨🇳",
  },
  {
    code: "no",
    name: "Norwegian 🇳🇴",
  },
];

export const BACKGROUND_COLORS = [
  "oklch(87% 0 0)",
  "oklch(20.5% 0 0)",
  "oklch(80.8% 0.114 19.571)",
  "oklch(83.7% 0.128 66.29)",
  "oklch(84.5% 0.143 164.978)",
  "oklch(82.8% 0.111 230.318)",
  "oklch(78.5% 0.115 274.713)",
  "oklch(81% 0.117 11.638)",
  "oklch(81% 0.117 11.638)",
];

export const EMOJI_DATA = [
  "https://cdn.jsdelivr.net/npm/emoji-datasource-apple/img/apple/64/1f604.png",
  "https://cdn.jsdelivr.net/npm/emoji-datasource-apple/img/apple/64/1f603.png",
  "https://cdn.jsdelivr.net/npm/emoji-datasource-apple/img/apple/64/1f602.png",
  "https://cdn.jsdelivr.net/npm/emoji-datasource-apple/img/apple/64/1f601.png",
  "https://cdn.jsdelivr.net/npm/emoji-datasource-apple/img/apple/64/1f600.png",
];
