import { app, BrowserWindow, protocol } from "electron";
import path from "path";

// Handle creating/removing shortcuts on Windows when installing/uninstalling
if (require("electron-squirrel-startup")) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;

// Check if we're in development mode
// In Electron dev mode, NODE_ENV might not be set, so check for dev server
const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;
const port = process.env.PORT || 3000;

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
    // In development, load from Next.js dev server
    const devUrl = `http://localhost:${port}`;
    console.log(`[Main] Loading from dev server: ${devUrl}`);
    mainWindow.loadURL(devUrl).catch((error) => {
      console.error("[Main] Failed to load URL:", error);
    });
    // DevTools can be opened manually with Cmd+Option+I (macOS) or Ctrl+Shift+I (Windows/Linux)
    // Uncomment the line below if you want DevTools to open automatically:
    // mainWindow.webContents.openDevTools();

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
    const { ElectronFileStorage } = require("./services/file-storage");
    console.log("[Main] Initializing file storage...");

    const fileStorage = ElectronFileStorage.getInstance();
    await fileStorage.initialize();

    console.log("[Main] File storage initialized successfully");
  } catch (error) {
    console.error("[Main] Failed to initialize file storage:", error);
  }

  // Register IPC handlers
  try {
    const { registerChatHandlers } = require("./ipc/chat");
    const { registerAgentHandlers } = require("./ipc/agents");
    const { registerWorkflowHandlers } = require("./ipc/workflows");
    const { registerMcpHandlers } = require("./ipc/mcp");
    const { registerUserHandlers } = require("./ipc/user");
    const { registerFileHandlers } = require("./ipc/files");
    const { registerAuthHandlers } = require("./ipc/auth");

    registerChatHandlers();
    registerAgentHandlers();
    registerWorkflowHandlers();
    registerMcpHandlers();
    registerUserHandlers();
    registerFileHandlers();
    registerAuthHandlers();

    // Register vector handlers (optional - may fail if DuckDB not available)
    try {
      const { registerVectorHandlers } = require("./ipc/vector");
      registerVectorHandlers();
    } catch (vectorError) {
      console.warn(
        "[Main] Vector handlers not available (non-critical):",
        vectorError instanceof Error ? vectorError.message : vectorError,
      );
    }

    console.log("[Main] IPC handlers registered successfully");
  } catch (error) {
    console.error("[Main] Failed to register IPC handlers:", error);
  }

  createWindow();

  // On macOS, re-create window when dock icon is clicked and no windows are open
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed (except on macOS)
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// macOS: Quit app when user quits via Cmd+Q
app.on("before-quit", () => {
  // Close vector services
  try {
    const { VectorStore } = require("./services/vector-store");
    const vectorStore = VectorStore.getInstance();
    vectorStore.close();
    console.log("[Main] Vector services closed successfully");
  } catch (error) {
    console.error("[Main] Error closing vector services:", error);
  }

  // Close database connection
  try {
    const { closeDatabase } = require("./services/database");
    closeDatabase();
    console.log("[Main] Database closed successfully");
  } catch (error) {
    console.error("[Main] Error closing database:", error);
  }
});

// Handle any uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
  // Log to file in production
  if (!isDev) {
    // TODO: Implement proper error logging to file
  }
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
