import {
  app,
  BrowserWindow,
  protocol,
  globalShortcut,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
  session,
  systemPreferences,
} from "electron";
import path from "path";
import log from "electron-log/main";

// Static imports for IPC handlers (esbuild will bundle these)
import { registerAuthHandlers } from "./ipc/auth";
import { registerChatHandlers } from "./ipc/chat";
import { registerAgentHandlers } from "./ipc/agents";
import { registerMcpHandlers } from "./ipc/mcp";
import { registerUserHandlers } from "./ipc/user";
import { registerFileHandlers } from "./ipc/files";
import { registerTerminalHandlers } from "./ipc/terminal";
import { registerModelsHandlers } from "./ipc/models";
import { registerAIHandlers } from "./ipc/ai";
import { registerVectorHandlers } from "./ipc/vector";
import { registerMemoryHandlers } from "./ipc/memory";
import { registerBrowserHandlers } from "./ipc/browser";
import { registerDialogHandlers } from "./ipc/dialog";
import { registerKnowledgeHandlers } from "./ipc/knowledge";
import { registerVoiceHandlers } from "./ipc/voice";
import { registerMeetingHandlers } from "./ipc/meeting";
import { registerACPHandlers, cleanupACPAgents } from "./ipc/acp";
import { registerCloudLicenseHandlers } from "./ipc/cloud-license";

// Static imports for services
import { ElectronAuthService } from "./services/auth";
import { ElectronFileStorage } from "./services/file-storage";
import { closeVectorStore } from "./services/vector-store";
import { closeEmbeddingService } from "./services/embedding";
import { closeDatabase } from "./services/database";
import { getTelemetryService } from "./services/telemetry";

// Auto-updater (only imported in production to avoid dev mode issues)
import { autoUpdater } from "electron-updater";

// Configure electron-log
log.initialize({ preload: true });
log.transports.file.level = "info";
log.transports.file.maxSize = 10 * 1024 * 1024; // 10MB
log.transports.console.level = "debug";

// Override console methods to use electron-log
Object.assign(console, log.functions);

log.info("[Main] Starting Shadower Desktop...");

// Handle creating/removing shortcuts on Windows when installing/uninstalling
if (require("electron-squirrel-startup")) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

// Check if we're in development mode
// In Electron dev mode, NODE_ENV might not be set, so check for dev server
const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;
const port = process.env.PORT || 5173;

function createWindow() {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: "#0a0a0a", // Dark background to match Shadower theme
    titleBarStyle: "hiddenInset", // macOS-style hidden title bar
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false, // Security best practice
      contextIsolation: true, // Security best practice
      sandbox: false, // Disabled to allow getUserMedia/getDisplayMedia for Meeting Minutes
      webSecurity: true,
    },
  });

  // Load the app
  if (isDev) {
    // In development, load from Vite dev server
    const devUrl = `http://localhost:${port}`;
    console.log(`[Main] Loading from dev server: ${devUrl}`);
    mainWindow.loadURL(devUrl).catch((error) => {
      console.error("[Main] Failed to load URL:", error);
    });
    // DevTools can be opened manually with Cmd+Option+I (macOS) or Ctrl+Shift+I (Windows/Linux)
    // Open DevTools automatically in dev mode to debug issues
    mainWindow.webContents.openDevTools();

    // Log when page finishes loading
    mainWindow.webContents.on("did-finish-load", () => {
      console.log("[Main] Page finished loading");
    });

    // Log any errors
    mainWindow.webContents.on(
      "did-fail-load",
      (_event, errorCode, errorDescription) => {
        console.error(
          `[Main] Failed to load: ${errorCode} - ${errorDescription}`,
        );
      },
    );
  } else {
    // In production, load from static export
    // __dirname is dist-electron/electron, so go up 2 levels to reach app root
    mainWindow.loadFile(path.join(__dirname, "../../out/index.html"));
  }

  // Handle window closed
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Handle navigation - prevent external navigation for security
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const parsedUrl = new URL(url);

    // Allow localhost navigation in dev mode
    if (isDev && parsedUrl.host === `localhost:${port}`) {
      return;
    }

    // Allow file protocol in production
    if (!isDev && parsedUrl.protocol === "file:") {
      return;
    }

    // Block all other navigation attempts
    event.preventDefault();
  });

  // Handle external links - open in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Open external links in default browser
    if (url.startsWith("http://") || url.startsWith("https://")) {
      require("electron").shell.openExternal(url);
    }
    return { action: "deny" };
  });
}

// App lifecycle events
app.whenReady().then(async () => {
  // Register file protocol for local file access
  protocol.registerFileProtocol("file", (request, callback) => {
    const pathname = decodeURI(request.url.replace("file:///", ""));
    callback(pathname);
  });

  // Initialize database
  try {
    const {
      initializeDatabase,
      runMigrations,
      createDefaultUser,
    } = require("./services/database");
    console.log("[Main] Initializing database...");
    initializeDatabase();
    console.log("[Main] Running migrations...");
    runMigrations();
    await createDefaultUser();
    console.log("[Main] Database initialized successfully");
  } catch (error) {
    console.error("[Main] Failed to initialize database:", error);
    // Database is critical - show error dialog and quit
    const { dialog } = require("electron");
    dialog.showErrorBox(
      "Database Error",
      `Failed to initialize database. The app cannot continue.\n\nError: ${error instanceof Error ? error.message : String(error)}`,
    );
    app.quit();
    return;
  }

  // Initialize vector services (optional - may not be available)
  // Skip for now if DuckDB causes crashes - initialize lazily when needed
  try {
    // Try to load vector services - if DuckDB isn't available, this will fail gracefully
    const vectorStoreModule = require("./services/vector-store");
    const embeddingModule = require("./services/embedding");

    // Initialize asynchronously after window is created to prevent blocking
    setImmediate(async () => {
      try {
        console.log("[Main] Initializing vector services...");
        const vectorStore = vectorStoreModule.VectorStore.getInstance();
        const embeddingService =
          embeddingModule.LocalEmbeddingService.getInstance();

        await vectorStore.initialize().catch((err: Error) => {
          console.warn(
            "[Main] Vector store initialization failed (non-critical):",
            err.message,
          );
        });
        await embeddingService.initialize().catch((err: Error) => {
          console.warn(
            "[Main] Embedding service initialization failed (non-critical):",
            err.message,
          );
        });

        console.log("[Main] Vector services initialization completed");
      } catch (error) {
        console.warn(
          "[Main] Vector services initialization error (non-critical):",
          error,
        );
      }
    });
  } catch (error) {
    console.warn("[Main] Vector services not available (non-critical):", error);
  }

  // Initialize file storage
  try {
    console.log("[Main] Initializing file storage...");
    const fileStorage = ElectronFileStorage.getInstance();
    await fileStorage.initialize();
    console.log("[Main] File storage initialized successfully");
  } catch (error) {
    console.error("[Main] Failed to initialize file storage:", error);
  }

  // Initialize auth service (must be done before registering handlers)
  try {
    const authService = ElectronAuthService.getInstance();
    await authService.initialize();
    console.log("[Main] Auth service initialized");
  } catch (error) {
    console.error("[Main] Failed to initialize auth service:", error);
  }

  // Register IPC handlers - each handler is registered independently to prevent
  // one failure from blocking all handlers
  const registerHandler = (name: string, registerFn: () => void) => {
    try {
      registerFn();
      console.log(`[Main] ${name} handlers registered`);
    } catch (error) {
      console.error(`[Main] Failed to register ${name} handlers:`, error);
    }
  };

  // Register all IPC handlers using static imports (bundled by esbuild)
  registerHandler("Auth", registerAuthHandlers);
  registerHandler("Chat", registerChatHandlers);
  registerHandler("Agent", registerAgentHandlers);
  registerHandler("MCP", registerMcpHandlers);
  registerHandler("User", registerUserHandlers);
  registerHandler("File", registerFileHandlers);
  registerHandler("Terminal", registerTerminalHandlers);
  registerHandler("Models", registerModelsHandlers);
  registerHandler("AI", registerAIHandlers);
  registerHandler("Browser", registerBrowserHandlers);
  registerHandler("Dialog", registerDialogHandlers);

  // Voice handlers (OpenAI Realtime + Local STT/TTS)
  try {
    const authService = ElectronAuthService.getInstance();
    registerVoiceHandlers(authService);
    console.log("[Main] Voice handlers registered");
  } catch (voiceError) {
    log.warn(
      "[Main] Voice handlers registration failed (non-critical):",
      voiceError instanceof Error ? voiceError.message : voiceError,
    );
  }

  // Vector handlers are optional (may fail if DuckDB not available)
  try {
    registerVectorHandlers();
    console.log("[Main] Vector handlers registered");
  } catch (vectorError) {
    log.warn(
      "[Main] Vector handlers not available (non-critical):",
      vectorError instanceof Error ? vectorError.message : vectorError,
    );
  }

  // Memory handlers (semantic search over past conversations)
  try {
    registerMemoryHandlers();
    console.log("[Main] Memory handlers registered");
  } catch (memoryError) {
    log.warn(
      "[Main] Memory handlers not available (non-critical):",
      memoryError instanceof Error ? memoryError.message : memoryError,
    );
  }

  // Meeting handlers (recording, transcription, and summarization)
  try {
    registerMeetingHandlers();
    console.log("[Main] Meeting handlers registered");
  } catch (meetingError) {
    log.warn(
      "[Main] Meeting handlers not available (non-critical):",
      meetingError instanceof Error ? meetingError.message : meetingError,
    );
  }

  // Knowledge handlers (full RAG system with document management)
  try {
    registerKnowledgeHandlers();
    console.log("[Main] Knowledge handlers registered");

    // DIAGNOSTIC: Check vector store state at startup
    setTimeout(async () => {
      try {
        const { getVectorStore } = await import("./services/vector-store");
        const { getEmbeddingService } = await import("./services/embedding");

        const vectorStore = getVectorStore();
        const embeddingService = getEmbeddingService();

        await vectorStore.initialize();
        await embeddingService.initialize();

        const stats = await vectorStore.getStats();
        const embeddingAvailable = embeddingService.isAvailable();

        console.log(`[DIAG] ========== RAG SYSTEM STATUS ==========`);
        console.log(
          `[DIAG] Vector Store Available: ${vectorStore.isAvailable()}`,
        );
        console.log(
          `[DIAG] Embedding Service Available: ${embeddingAvailable}`,
        );
        console.log(`[DIAG] Indexed Messages: ${stats.messages}`);
        console.log(`[DIAG] Indexed Documents: ${stats.documents}`);
        if (stats.documents === 0) {
          console.log(
            `[DIAG] ⚠️ NO DOCUMENTS INDEXED - RAG will not find any knowledge base content!`,
          );
        }
        console.log(`[DIAG] ==========================================`);
      } catch (diagError) {
        console.error("[DIAG] Failed to get RAG system status:", diagError);
      }
    }, 3000); // Check after 3 seconds to let services initialize
  } catch (knowledgeError) {
    log.warn(
      "[Main] Knowledge handlers not available (non-critical):",
      knowledgeError instanceof Error ? knowledgeError.message : knowledgeError,
    );
  }

  // ACP handlers (Agent Client Protocol - external coding agents)
  try {
    registerACPHandlers();
    console.log("[Main] ACP handlers registered");
  } catch (acpError) {
    log.warn(
      "[Main] ACP handlers not available (non-critical):",
      acpError instanceof Error ? acpError.message : acpError,
    );
  }

  // Cloud License handlers (Shadower cloud authentication and license validation)
  try {
    registerCloudLicenseHandlers();
    console.log("[Main] Cloud License handlers registered");
  } catch (cloudError) {
    log.warn(
      "[Main] Cloud License handlers not available (non-critical):",
      cloudError instanceof Error ? cloudError.message : cloudError,
    );
  }

  log.info("[Main] IPC handler registration completed");

  createWindow();

  // ============================================
  // MEDIA PERMISSIONS - Required for Meeting Minutes
  // ============================================
  // Set up permission handler for media access (microphone, screen capture)
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      const allowedPermissions = [
        "media",
        "microphone",
        "camera",
        "display-capture",
        "mediaKeySystem",
      ];

      if (allowedPermissions.includes(permission)) {
        log.info(`[Main] Granting permission: ${permission}`);
        callback(true);
      } else {
        log.warn(`[Main] Denying permission: ${permission}`);
        callback(false);
      }
    }
  );

  // Check permission handler (for checking existing permissions)
  session.defaultSession.setPermissionCheckHandler(
    (_webContents, permission, _requestingOrigin) => {
      const allowedPermissions = [
        "media",
        "microphone",
        "camera",
        "display-capture",
        "mediaKeySystem",
      ];
      return allowedPermissions.includes(permission);
    }
  );

  // macOS: Request microphone permission at startup if not already granted
  if (process.platform === "darwin") {
    const micStatus = systemPreferences.getMediaAccessStatus("microphone");
    log.info(`[Main] Microphone access status: ${micStatus}`);

    // ALWAYS try to request if not granted (even if "denied" - TCC reset might have occurred)
    if (micStatus !== "granted") {
      log.info("[Main] Requesting microphone access...");
      systemPreferences
        .askForMediaAccess("microphone")
        .then((granted) => {
          log.info(`[Main] Microphone access ${granted ? "granted" : "denied"}`);
        })
        .catch((err) => {
          log.error("[Main] Failed to request microphone access:", err);
        });
    }

    const screenStatus = systemPreferences.getMediaAccessStatus("screen");
    log.info(`[Main] Screen recording access status: ${screenStatus}`);

    // Note: Screen recording cannot be requested programmatically on macOS
    // It requires user to manually enable in System Preferences
    // We'll guide users to do this when they try to use Meeting Minutes
  }

  log.info("[Main] Media permissions configured");

  // Initialize system tray
  try {
    initializeSystemTray();
    log.info("[Main] System tray initialized successfully");
  } catch (error) {
    log.error("[Main] Failed to initialize system tray:", error);
  }

  // Register global keyboard shortcuts
  try {
    registerGlobalShortcuts();
    log.info("[Main] Global shortcuts registered successfully");
  } catch (error) {
    log.error("[Main] Failed to register global shortcuts:", error);
  }

  // ============================================
  // TELEMETRY - Track anonymous user count
  // ============================================
  try {
    const telemetry = getTelemetryService();
    telemetry.trackAppOpen();
    log.info("[Main] Telemetry initialized");
  } catch (error) {
    log.warn("[Main] Telemetry initialization failed (non-critical):", error);
  }

  // ============================================
  // AUTO-UPDATER (Production only)
  // Checks GitHub Releases for new versions
  // ============================================
  if (!isDev) {
    initializeAutoUpdater();
  }

  // ============================================
  // MODEL LIMITS CACHE WARMUP (PERFORMANCE)
  // Pre-fetch model context limits from all providers
  // so first message doesn't block on API fetches
  // ============================================
  try {
    const { warmModelLimitsCache } = await import(
      "../src/lib/ai/dynamic-models/model-service"
    );
    // Fire and forget - don't await, let it run in background
    warmModelLimitsCache().catch((err) => {
      log.warn("[Main] Model limits cache warmup failed (non-critical):", err);
    });
    log.info("[Main] Model limits cache warmup started");
  } catch (error) {
    log.warn("[Main] Model limits cache warmup skipped:", error);
  }

  // ============================================
  // AUTOMATIC OLLAMA DETECTION (ZERO-CONFIG)
  // Auto-detect Ollama and register models without
  // requiring manual user configuration.
  // Supports both local and remote (OLLAMA_BASE_URL) instances.
  // ============================================
  try {
    autoDetectAndRegisterOllama();
  } catch (error) {
    log.warn("[Main] Ollama auto-detection skipped:", error);
  }

  // ============================================
  // AUTOMATIC ACP AGENT DETECTION (ZERO-CONFIG)
  // Auto-detect installed ACP agents (Claude Code, Codex, Gemini CLI)
  // so they appear in the model selector without manual configuration.
  // ============================================
  try {
    autoDetectACPAgents();
  } catch (error) {
    log.warn("[Main] ACP agent auto-detection skipped:", error);
  }

  // ============================================
  // AUTOMATIC OLLAMA MODEL WARMUP (PERFORMANCE)
  // Pre-load the last-used Ollama model into memory
  // so first chat is instant (no model loading delay)
  // ============================================
  try {
    warmupLastUsedOllamaModel();
  } catch (error) {
    log.warn("[Main] Ollama warmup skipped:", error);
  }

  // On macOS, re-create window when dock icon is clicked and no windows are open
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

/**
 * Auto-detect Ollama at startup and register models automatically.
 * This enables "zero-config" Ollama support - users don't need to manually
 * configure anything. If Ollama is running, models appear automatically.
 *
 * Supports both local (localhost:11434) and remote (OLLAMA_BASE_URL) instances.
 */
async function autoDetectAndRegisterOllama() {
  // Delay detection to not block app startup
  setTimeout(async () => {
    try {
      const ollamaService = await import("./services/ollama-service");
      const { getDatabase, schema } = await import("./services/database");
      const { ElectronAuthService } = await import("./services/auth");
      const { eq, and } = await import("drizzle-orm");
      const { localModelSupportsTools } = await import(
        "../src/lib/ai/providers/capabilities"
      );

      log.info("[Main] Running Ollama auto-detection...");

      // Get current user
      const authService = ElectronAuthService.getInstance();
      const user = await authService.getCurrentUser();

      if (!user) {
        log.info("[Main] No user logged in - skipping Ollama auto-detection");
        return;
      }

      // Run auto-detection
      const result = await ollamaService.autoDetectOllamaModels();

      if (!result.detected || result.models.length === 0) {
        log.info(
          `[Main] Ollama not detected or no models available (running: ${result.running})`,
        );
        return;
      }

      log.info(
        `[Main] Auto-detected ${result.models.length} Ollama models (remote: ${result.isRemote})`,
      );

      const db = getDatabase();

      // Auto-create Ollama provider config if it doesn't exist
      const [existingProvider] = await db
        .select()
        .from(schema.ProviderConfigTable)
        .where(
          and(
            eq(schema.ProviderConfigTable.userId, user.id),
            eq(schema.ProviderConfigTable.providerId, "ollama"),
          ),
        )
        .limit(1);

      if (!existingProvider) {
        log.info(
          "[Main] Auto-registering Ollama provider (first-time detection)",
        );
        await db.insert(schema.ProviderConfigTable).values({
          name: "Ollama",
          providerId: "ollama",
          type: "local",
          baseUrl: result.baseUrl,
          authType: "none",
          enabled: true,
          status: "connected",
          lastTestedAt: new Date(),
          userId: user.id,
        });
      } else if (
        !existingProvider.enabled ||
        existingProvider.status !== "connected"
      ) {
        // Re-enable if it was disabled or mark as connected
        await db
          .update(schema.ProviderConfigTable)
          .set({
            enabled: true,
            status: "connected",
            baseUrl: result.baseUrl,
            lastTestedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(schema.ProviderConfigTable.id, existingProvider.id));
      }

      // Sync models to LocalModelTable
      for (const model of result.models) {
        const [existing] = await db
          .select()
          .from(schema.LocalModelTable)
          .where(
            and(
              eq(schema.LocalModelTable.userId, user.id),
              eq(schema.LocalModelTable.providerId, "ollama"),
              eq(schema.LocalModelTable.name, model.name),
            ),
          )
          .limit(1);

        const isVision =
          model.name.includes("vision") ||
          model.name.includes("llava") ||
          /-vl[:\-]/i.test(model.name) ||
          model.name.endsWith("-vl");

        if (!existing) {
          await db.insert(schema.LocalModelTable).values({
            name: model.name,
            displayName: model.name,
            providerId: "ollama",
            size: model.size,
            family: model.details?.family,
            status: "available",
            isVision,
            isToolCallSupported: localModelSupportsTools(model.name),
            userId: user.id,
          });
        } else {
          // Update existing model
          await db
            .update(schema.LocalModelTable)
            .set({
              size: model.size,
              family: model.details?.family,
              status: "available",
              isToolCallSupported: localModelSupportsTools(model.name),
              updatedAt: new Date(),
            })
            .where(eq(schema.LocalModelTable.id, existing.id));
        }
      }

      log.info(
        `[Main] Ollama auto-detection complete: ${result.models.length} models registered`,
      );

      // Mark auto-detection as complete
      ollamaService.markAutoDetectionRan();
    } catch (error) {
      // Non-critical - don't fail app startup
      log.warn(
        "[Main] Ollama auto-detection failed (non-critical):",
        error instanceof Error ? error.message : error,
      );
    }
  }, 2000); // Wait 2 seconds after app start to not block UI
}

/**
 * Auto-detect ACP agents (Claude Code, Codex, Gemini CLI) at startup.
 * This enables "zero-config" ACP support - if agents are installed,
 * they automatically appear in the model selector.
 */
async function autoDetectACPAgents() {
  // Delay detection to not block app startup
  setTimeout(async () => {
    try {
      const { getACPAgentManager } = await import("./services/acp-agent-service");
      const { BrowserWindow } = await import("electron");

      log.info("[Main] Running ACP agent auto-detection...");

      const acpManager = getACPAgentManager();

      // Force refresh to detect newly installed agents
      const agents = await acpManager.detectInstalledAgents(true);

      // Count installed agents
      const installedAgents = agents.filter((a) => a.installed);

      if (installedAgents.length > 0) {
        log.info(
          `[Main] Auto-detected ${installedAgents.length} ACP agent(s): ${installedAgents.map((a) => a.id).join(", ")}`,
        );

        // Notify renderer windows of available agents
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) {
            win.webContents.send("acp:agents-detected", {
              agents: installedAgents,
              timestamp: Date.now(),
            });
          }
        }
      } else {
        log.info("[Main] No ACP agents detected");
      }

      // Log detailed status for debugging
      for (const agent of agents) {
        log.debug(
          `[Main] ACP Agent ${agent.id}: installed=${agent.installed}, authenticated=${agent.authenticated}, version=${agent.version || "N/A"}`,
        );
      }
    } catch (error) {
      // Non-critical - don't fail app startup
      log.warn(
        "[Main] ACP agent auto-detection failed (non-critical):",
        error instanceof Error ? error.message : error,
      );
    }
  }, 2000); // Wait 2 seconds after app start to not block UI (same as Ollama)
}

/**
 * Initialize auto-updater for production builds.
 * Checks GitHub Releases for new versions and handles the update lifecycle.
 */
function initializeAutoUpdater() {
  // Log current version info
  const currentVersion = app.getVersion();
  log.info(`[Updater] App version: ${currentVersion}`);
  log.info(`[Updater] App packaged: ${app.isPackaged}`);
  log.info(`[Updater] Platform: ${process.platform}`);

  // Configure auto-updater
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  // Log the feed URL for debugging
  try {
    const feedURL = autoUpdater.getFeedURL();
    log.info(`[Updater] Feed URL: ${JSON.stringify(feedURL)}`);
  } catch (e) {
    log.info(`[Updater] Could not get feed URL: ${e}`);
  }

  // Check for updates after a short delay to not block startup
  setTimeout(() => {
    log.info("[Updater] Checking for updates...");
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      // Suppress 404 errors (repo not found / no releases yet)
      if (err.message?.includes("404") || err.message?.includes("Not Found")) {
        log.info("[Updater] No releases found yet (this is normal for new apps)");
        return;
      }
      log.warn("[Updater] Update check failed:", err);
    });
  }, 5000);

  // Send startup info to renderer when page is ready
  const sendStartupInfo = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      log.info("[Updater] Sending startup info to renderer");
      mainWindow.webContents.send("update:startup", {
        version: currentVersion,
        isPackaged: app.isPackaged,
        platform: process.platform,
      });
    }
  };

  // Wait for page to finish loading before sending
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.webContents.isLoading()) {
      mainWindow.webContents.once("did-finish-load", sendStartupInfo);
    } else {
      // Page already loaded, send immediately
      sendStartupInfo();
    }
  }

  // Event handlers
  autoUpdater.on("checking-for-update", () => {
    log.info("[Updater] Checking for updates...");
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("update:checking", {});
    }
  });

  autoUpdater.on("update-available", (info) => {
    log.info("[Updater] Update available:", info.version);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("update:available", {
        version: info.version,
        releaseNotes: info.releaseNotes,
        releaseDate: info.releaseDate,
      });
    }
  });

  autoUpdater.on("update-not-available", (info) => {
    log.info("[Updater] No updates available. Current version:", info.version);
    // Notify renderer that app is up to date
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("update:upToDate", {
        version: info.version,
      });
    }
  });

  autoUpdater.on("download-progress", (progress) => {
    log.info(
      `[Updater] Download progress: ${progress.percent.toFixed(1)}% (${(progress.transferred / 1024 / 1024).toFixed(1)}MB / ${(progress.total / 1024 / 1024).toFixed(1)}MB)`,
    );
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("update:progress", {
        percent: progress.percent,
        transferred: progress.transferred,
        total: progress.total,
        bytesPerSecond: progress.bytesPerSecond,
      });
    }
  });

  autoUpdater.on("update-downloaded", (info) => {
    log.info("[Updater] Update downloaded:", info.version);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("update:downloaded", {
        version: info.version,
        releaseNotes: info.releaseNotes,
        releaseDate: info.releaseDate,
      });
    }

    // Track update via telemetry
    try {
      const telemetry = getTelemetryService();
      telemetry.trackUpdateInstalled(info.version);
    } catch (_e) {
      // Ignore telemetry errors
    }
  });

  autoUpdater.on("error", (err) => {
    // Suppress 404 errors (repo not found / no releases yet)
    if (err.message?.includes("404") || err.message?.includes("Not Found")) {
      log.info("[Updater] No releases found yet (this is normal for new apps)");
      return;
    }
    log.error("[Updater] Error:", err);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("update:error", {
        message: err.message,
      });
    }
  });

  log.info("[Updater] Auto-updater initialized");
}

// IPC handlers for update control
ipcMain.handle("update:check", async () => {
  try {
    const result = await autoUpdater.checkForUpdates();
    return {
      updateAvailable: result?.updateInfo?.version !== app.getVersion(),
      version: result?.updateInfo?.version,
    };
  } catch (error) {
    log.error("[Updater] Manual check failed:", error);
    return { updateAvailable: false, error: String(error) };
  }
});

ipcMain.handle("update:install", () => {
  log.info("[Updater] User requested install - quitting and installing...");
  autoUpdater.quitAndInstall(false, true);
});

ipcMain.handle("update:getStatus", () => {
  return {
    currentVersion: app.getVersion(),
    isDev,
  };
});

/**
 * Warmup an Ollama model on app startup if Ollama provider is configured
 * This pre-loads a model into memory so first chat is instant
 */
async function warmupLastUsedOllamaModel() {
  // Delay warmup to not block app startup (run after auto-detection)
  setTimeout(async () => {
    try {
      const { getDatabase, schema } = await import("./services/database");
      const db = getDatabase();
      const { eq } = await import("drizzle-orm");

      // Check if Ollama provider is configured and enabled
      const [providerConfig] = await db
        .select()
        .from(schema.ProviderConfigTable)
        .where(eq(schema.ProviderConfigTable.providerId, "ollama"))
        .limit(1);

      if (!providerConfig || !providerConfig.enabled) {
        log.info(
          "[Main] Ollama provider not configured or disabled - skipping warmup",
        );
        return;
      }

      const baseUrl = providerConfig?.baseUrl || "http://localhost:11434";

      // Get the first available local model for this provider to use for warmup
      const [localModel] = await db
        .select()
        .from(schema.LocalModelTable)
        .where(eq(schema.LocalModelTable.providerId, "ollama"))
        .limit(1);

      if (!localModel) {
        log.info("[Main] No Ollama models found in database - skipping warmup");
        return;
      }

      log.info(`[Main] Warming up Ollama model: ${localModel.name}`);

      // Send warmup request (keep_alive: "10m" keeps model loaded for 10 minutes)
      const startTime = Date.now();
      const response = await fetch(`${baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: localModel.name,
          prompt: "", // Empty prompt - just load model
          stream: false,
          keep_alive: "10m", // Keep loaded for 10 minutes (safer than indefinite)
          options: {
            num_predict: 1,
            num_ctx: 512, // Minimal context for warmup
            num_batch: 64, // Small batch for safety
          },
        }),
        signal: AbortSignal.timeout(180000), // 3 minute timeout for large models
      });

      if (response.ok) {
        const elapsed = Date.now() - startTime;
        log.info(
          `[Main] Ollama model ${localModel.name} warmed up in ${elapsed}ms - ready for instant responses!`,
        );
      } else {
        log.warn(`[Main] Ollama warmup returned status ${response.status}`);
      }
    } catch (error) {
      // Non-critical - don't fail app startup
      log.warn(
        "[Main] Ollama warmup failed (non-critical):",
        error instanceof Error ? error.message : error,
      );
    }
  }, 5000); // Wait 5 seconds after app start (after auto-detection)
}

/**
 * Initialize system tray with context menu
 */
function initializeSystemTray() {
  // Create tray icon (use template for macOS dark mode support)
  const iconPath = isDev
    ? path.join(__dirname, "../resources/tray-icon.png")
    : path.join(process.resourcesPath, "resources/tray-icon.png");

  // Create a simple 16x16 icon if the file doesn't exist
  let trayIcon: Electron.NativeImage;
  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) {
      throw new Error("Icon is empty");
    }
  } catch {
    // Create a simple colored square as fallback
    trayIcon = nativeImage.createEmpty();
    log.warn("[Main] Using fallback tray icon");
  }

  // Resize for tray (16x16 on most platforms, 22x22 on some Linux)
  if (!trayIcon.isEmpty()) {
    trayIcon = trayIcon.resize({ width: 16, height: 16 });
  }

  tray = new Tray(trayIcon);
  tray.setToolTip("Shadower - AI Agent Orchestration");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Open Shadower",
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow();
        }
      },
    },
    {
      label: "New Chat",
      accelerator: "CmdOrCtrl+N",
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.webContents.send("shortcut:newChat");
        }
      },
    },
    { type: "separator" },
    {
      label: "Quick Actions",
      submenu: [
        {
          label: "Take Screenshot",
          click: async () => {
            if (mainWindow) {
              mainWindow.webContents.send("shortcut:screenshot");
            }
          },
        },
        {
          label: "Toggle Voice Mode",
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send("shortcut:voiceMode");
            }
          },
        },
      ],
    },
    { type: "separator" },
    {
      label: "Settings",
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.webContents.send("shortcut:settings");
        }
      },
    },
    { type: "separator" },
    {
      label: "Quit Shadower",
      accelerator: "CmdOrCtrl+Q",
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  // On Windows/Linux, clicking the tray icon opens the window
  tray.on("click", () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
}

/**
 * Register global keyboard shortcuts
 */
function registerGlobalShortcuts() {
  // Toggle app visibility: Ctrl/Cmd + Shift + Space
  globalShortcut.register("CommandOrControl+Shift+Space", () => {
    log.debug("[Main] Global shortcut: Toggle visibility");
    if (mainWindow) {
      if (mainWindow.isVisible() && mainWindow.isFocused()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    } else {
      createWindow();
    }
  });

  // Quick chat: Ctrl/Cmd + Shift + C
  globalShortcut.register("CommandOrControl+Shift+C", () => {
    log.debug("[Main] Global shortcut: Quick chat");
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send("shortcut:quickChat");
    } else {
      createWindow();
    }
  });

  // Screenshot to chat: Ctrl/Cmd + Shift + S
  globalShortcut.register("CommandOrControl+Shift+S", () => {
    log.debug("[Main] Global shortcut: Screenshot to chat");
    if (mainWindow) {
      mainWindow.webContents.send("shortcut:screenshotToChat");
    }
  });
}

// Handle shortcut-related IPC
ipcMain.on("app:quit", () => {
  app.quit();
});

ipcMain.handle("app:getVersion", () => {
  return app.getVersion();
});

ipcMain.handle("app:getPath", (_event, name: string) => {
  return app.getPath(name as any);
});

// Quit when all windows are closed (except on macOS)
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Unregister shortcuts when app is quitting
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  log.info("[Main] Global shortcuts unregistered");
});

// macOS: Quit app when user quits via Cmd+Q
app.on("before-quit", async () => {
  // Stop all ACP agents
  try {
    await cleanupACPAgents();
    console.log("[Main] ACP agents stopped successfully");
  } catch (error) {
    console.error("[Main] Error stopping ACP agents:", error);
  }

  // Close vector services
  try {
    closeVectorStore();
    closeEmbeddingService();
    console.log("[Main] Vector services closed successfully");
  } catch (error) {
    console.error("[Main] Error closing vector services:", error);
  }

  // Close database connection
  try {
    closeDatabase();
    console.log("[Main] Database closed successfully");
  } catch (error) {
    console.error("[Main] Error closing database:", error);
  }
});

// Handle any uncaught exceptions
process.on("uncaughtException", (error) => {
  log.error("Uncaught exception:", error);
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  log.error("Unhandled rejection at:", promise, "reason:", reason);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  app.quit();
});

process.on("SIGINT", () => {
  app.quit();
});

// Disable GPU acceleration if needed for compatibility
// app.disableHardwareAcceleration();

// Set app user model ID for Windows
if (process.platform === "win32") {
  app.setAppUserModelId("com.shadower.desktop");
}

// Development-only: Enable hot reload for Electron
if (isDev) {
  try {
    require("electron-reloader")(module, {
      debug: true,
      watchRenderer: false, // Next.js handles renderer hot reload
    });
  } catch {
    // electron-reloader not installed in dev mode
  }
}
