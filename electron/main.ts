import { app, BrowserWindow, protocol } from 'electron';
import path from 'path';

// Handle creating/removing shortcuts on Windows when installing/uninstalling
if (require('electron-squirrel-startup')) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;

const isDev = process.env.NODE_ENV === 'development';
const port = process.env.PORT || 3000;

function createWindow() {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#0a0a0a', // Dark background to match Shadower theme
    titleBarStyle: 'hiddenInset', // macOS-style hidden title bar
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false, // Security best practice
      contextIsolation: true, // Security best practice
      sandbox: true, // Additional security
      webSecurity: true,
    },
  });

  // Load the app
  if (isDev) {
    // In development, load from Next.js dev server
    mainWindow.loadURL(`http://localhost:${port}`);
    // Open DevTools in development
    mainWindow.webContents.openDevTools();
  } else {
    // In production, load from static export
    mainWindow.loadFile(path.join(__dirname, '../out/index.html'));
  }

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Handle navigation - prevent external navigation for security
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const parsedUrl = new URL(url);

    // Allow localhost navigation in dev mode
    if (isDev && parsedUrl.host === `localhost:${port}`) {
      return;
    }

    // Allow file protocol in production
    if (!isDev && parsedUrl.protocol === 'file:') {
      return;
    }

    // Block all other navigation attempts
    event.preventDefault();
  });

  // Handle external links - open in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Open external links in default browser
    if (url.startsWith('http://') || url.startsWith('https://')) {
      require('electron').shell.openExternal(url);
    }
    return { action: 'deny' };
  });
}

// App lifecycle events
app.whenReady().then(() => {
  // Register file protocol for local file access
  protocol.registerFileProtocol('file', (request, callback) => {
    const pathname = decodeURI(request.url.replace('file:///', ''));
    callback(pathname);
  });

  createWindow();

  // On macOS, re-create window when dock icon is clicked and no windows are open
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// macOS: Quit app when user quits via Cmd+Q
app.on('before-quit', () => {
  // Cleanup tasks if needed
});

// Handle any uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  // Log to file in production
  if (!isDev) {
    // TODO: Implement proper error logging to file
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  app.quit();
});

process.on('SIGINT', () => {
  app.quit();
});

// Disable GPU acceleration if needed for compatibility
// app.disableHardwareAcceleration();

// Set app user model ID for Windows
if (process.platform === 'win32') {
  app.setAppUserModelId('com.shadower.desktop');
}

// Development-only: Enable hot reload for Electron
if (isDev) {
  try {
    require('electron-reloader')(module, {
      debug: true,
      watchRenderer: false, // Next.js handles renderer hot reload
    });
  } catch {
    // electron-reloader not installed in dev mode
  }
}
