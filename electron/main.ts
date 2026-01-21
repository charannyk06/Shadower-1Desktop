import {
  app,
  BrowserWindow,
  protocol,
  globalShortcut,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
} from "electron";
import path from "path";
import log from "electron-log/main";

// Static imports for IPC handlers (esbuild will bundle these)
import { registerAuthHandlers } from "./ipc/auth";
import { registerChatHandlers } from "./ipc/chat";
import { registerAgentHandlers } from "./ipc/agents";
import { registerWorkflowHandlers } from "./ipc/workflows";
import { registerMcpHandlers } from "./ipc/mcp";
import { registerUserHandlers } from "./ipc/user";
import { registerFileHandlers } from "./ipc/files";
import { registerTerminalHandlers } from "./ipc/terminal";
import { registerModelsHandlers } from "./ipc/models";
import { registerArchiveHandlers } from "./ipc/archives";
import { registerAIHandlers } from "./ipc/ai";
import { registerVectorHandlers } from "./ipc/vector";
import { registerMemoryHandlers } from "./ipc/memory";
import { registerChromeHandlers } from "./ipc/chrome";

// Static imports for services
import { ElectronAuthService } from "./services/auth";
import { ElectronFileStorage } from "./services/file-storage";
import { closeVectorStore } from "./services/vector-store";
import { closeEmbeddingService } from "./services/embedding";
import { closeDatabase } from "./services/database";

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
      sandbox: true, // Additional security
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
    mainWindow.loadFile(path.join(__dirname, "../out/index.html"));
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
      `Failed to initialize database. The app cannot continue.\n\nError: ${error instanceof Error ? error.message : String(error)}`
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
  registerHandler("Workflow", registerWorkflowHandlers);
  registerHandler("MCP", registerMcpHandlers);
  registerHandler("User", registerUserHandlers);
  registerHandler("File", registerFileHandlers);
  registerHandler("Terminal", registerTerminalHandlers);
  registerHandler("Models", registerModelsHandlers);
  registerHandler("Archive", registerArchiveHandlers);
  registerHandler("AI", registerAIHandlers);
  registerHandler("Chrome", registerChromeHandlers);

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

  log.info("[Main] IPC handler registration completed");

  createWindow();

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

  // On macOS, re-create window when dock icon is clicked and no windows are open
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

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
