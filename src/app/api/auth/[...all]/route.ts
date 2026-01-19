import { NextRequest, NextResponse } from "next/server";

// Check Electron mode BEFORE any imports that might initialize better-auth
const checkElectronModeEarly = (): boolean => {
  if (process.env.ELECTRON_BUILD === "true") {
    return true;
  }
  try {
    const { sqliteDb } = require("lib/db/sqlite/db.sqlite");
    void sqliteDb.select;
    return false;
  } catch (error: any) {
    const errorMsg = error?.message || String(error) || "";
    if (
      errorMsg.includes(
        "SQLite is not available in Next.js when running in Electron dev mode",
      ) ||
      errorMsg.includes("NODE_MODULE_VERSION") ||
      errorMsg.includes("was compiled against a different Node.js version")
    ) {
      return true;
    }
    return false;
  }
};

// Only import auth if NOT in Electron mode
const IS_ELECTRON_MODE = checkElectronModeEarly();

// Lazy import auth to prevent initialization in Electron mode
let auth: any = null;
let toNextJsHandler: any = null;

const getAuth = () => {
  if (IS_ELECTRON_MODE) {
    return null;
  }
  if (auth) return auth;
  try {
    auth = require("auth/server").auth;
    toNextJsHandler = require("better-auth/next-js").toNextJsHandler;
  } catch (error) {
    console.error("[Auth Route] Failed to import auth:", error);
  }
  return auth;
};

// Helper to check if we're in Electron dev mode
// Use the early check result, but allow rechecking
const isElectronDevMode = (): boolean => {
  // Use the early check first
  if (IS_ELECTRON_MODE) {
    return true;
  }

  // Recheck to be sure
  return checkElectronModeEarly();
};

// In Electron mode, bypass better-auth and return success for sign-in
const handleElectronAuth = async (
  request: NextRequest,
  segments?: string[],
) => {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // Parse route segments - the catch-all route [...all] captures everything after /api/auth/
  // segments will be like ["sign-in", "email"] or ["session"]
  const _routePath =
    segments?.join("/") || pathname.replace("/api/auth/", "") || "";
  const _firstSegment =
    segments?.[0] || pathname.split("/api/auth/")[1]?.split("/")[0] || "";

  // Create local user session response
  const localUserSession = {
    data: {
      user: {
        id: "local-user",
        email: "local@shadower.app",
        name: "Local User",
        image: null,
        emailVerified: true,
        role: "admin",
      },
      session: {
        id: "local-session",
        expiresAt: new Date(
          Date.now() + 365 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        token: "local-token",
        userId: "local-user",
      },
    },
  };

  // For ANY auth endpoint in Electron mode, return local user session
  // This ensures all auth requests work without better-auth
  return NextResponse.json(localUserSession);
};

// Only initialize better-auth handlers if NOT in Electron mode
// This prevents better-auth from trying to use the database adapter
let normalHandlers: ReturnType<typeof toNextJsHandler> | null = null;
let handlersInitialized = false;

const getNormalHandlers = () => {
  // Never initialize in Electron mode - check first
  if (isElectronDevMode()) {
    return null;
  }

  // If already tried to initialize and failed, don't try again
  if (handlersInitialized && !normalHandlers) {
    return null;
  }

  if (!normalHandlers && !handlersInitialized) {
    handlersInitialized = true;
    try {
      // Double-check we're not in Electron mode before initializing
      if (isElectronDevMode()) {
        return null;
      }

      // Lazy load auth and handler
      const authInstance = getAuth();
      if (!authInstance || !toNextJsHandler) {
        return null;
      }

      normalHandlers = toNextJsHandler(authInstance.handler);
    } catch (error: any) {
      console.error(
        "[Auth Route] Failed to initialize better-auth handlers:",
        error,
      );
      // If error is related to database, we're probably in Electron mode
      const errorMsg = error?.message || String(error) || "";
      if (
        errorMsg.includes("SQLite") ||
        errorMsg.includes("database") ||
        errorMsg.includes("select")
      ) {
        _isElectronDevMode = true; // Force Electron mode
      }
      return null;
    }
  }
  return normalHandlers;
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ all?: string[] }> },
) {
  // Always check Electron mode first - ALWAYS use Electron handler if detected
  const isElectron = isElectronDevMode();

  if (isElectron) {
    const resolvedParams = await params;
    return handleElectronAuth(request, resolvedParams.all);
  }

  // Only try to get normal handlers if NOT in Electron mode
  // But if initialization fails, fall back to Electron handler
  try {
    const handlers = getNormalHandlers();
    if (!handlers) {
      // Fallback: handlers not available, use Electron handler
      const resolvedParams = await params;
      return handleElectronAuth(request, resolvedParams.all);
    }
    return handlers.GET(request);
  } catch (error: any) {
    // If any error occurs, fall back to Electron handler
    console.error(
      "[Auth Route] Error in GET handler, using Electron fallback:",
      error,
    );
    const resolvedParams = await params;
    return handleElectronAuth(request, resolvedParams.all);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ all?: string[] }> },
) {
  // Always check Electron mode first - ALWAYS use Electron handler if detected
  const isElectron = isElectronDevMode();

  if (isElectron) {
    const resolvedParams = await params;
    return handleElectronAuth(request, resolvedParams.all);
  }

  // Only try to get normal handlers if NOT in Electron mode
  // But if initialization fails, fall back to Electron handler
  try {
    const handlers = getNormalHandlers();
    if (!handlers) {
      // Fallback: handlers not available, use Electron handler
      const resolvedParams = await params;
      return handleElectronAuth(request, resolvedParams.all);
    }
    return handlers.POST(request);
  } catch (error: any) {
    // If any error occurs, fall back to Electron handler
    console.error(
      "[Auth Route] Error in POST handler, using Electron fallback:",
      error,
    );
    const resolvedParams = await params;
    return handleElectronAuth(request, resolvedParams.all);
  }
}
