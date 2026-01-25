/**
 * Ollama Service
 *
 * Provides installation, health checking, and service management for Ollama.
 * Supports both macOS and Windows platforms.
 */

import log from "electron-log/main";
import { spawn, ChildProcess, exec } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { app } from "electron";
import { createWriteStream } from "fs";

// Ollama download URLs
const OLLAMA_DOWNLOADS: Record<string, string> = {
  "darwin-arm64": "https://ollama.com/download/Ollama-darwin.zip",
  "darwin-x64": "https://ollama.com/download/Ollama-darwin.zip",
  "win32-x64": "https://ollama.com/download/OllamaSetup.exe",
};

// Ollama installation paths by platform
const OLLAMA_PATHS: Record<string, string[]> = {
  darwin: [
    "/Applications/Ollama.app/Contents/Resources/ollama",
    "/usr/local/bin/ollama",
    path.join(os.homedir(), ".ollama", "ollama"),
  ],
  win32: [
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Ollama", "ollama.exe"),
    path.join(process.env.PROGRAMFILES || "", "Ollama", "ollama.exe"),
    path.join(os.homedir(), "AppData", "Local", "Programs", "Ollama", "ollama.exe"),
  ],
};

// Default Ollama API URL
const DEFAULT_OLLAMA_URL = "http://localhost:11434";

// Track the Ollama serve process if we started it
let ollamaServeProcess: ChildProcess | null = null;

// ============================================
// HEALTH CHECK CACHING
// Prevents excessive API calls during rapid UI refreshes
// ============================================
interface CachedHealthResult {
  health: OllamaHealth;
  timestamp: number;
}
let cachedHealth: CachedHealthResult | null = null;
let healthCheckInFlight: Promise<OllamaHealth> | null = null;
const HEALTH_CACHE_TTL_MS = 3000; // 3 seconds

// ============================================
// PERFORMANCE ENVIRONMENT VARIABLES
// These dramatically improve local model speed!
// ============================================
const OLLAMA_PERFORMANCE_ENV = {
  // Enable Flash Attention - reduces memory, faster with large contexts
  OLLAMA_FLASH_ATTENTION: "1",
  // Keep models loaded longer (24 hours) - prevents reload latency
  OLLAMA_KEEP_ALIVE: "24h",
  // Max concurrent loaded models (adjust based on RAM)
  OLLAMA_MAX_LOADED_MODELS: "2",
  // Parallel requests per model (4 is good balance)
  OLLAMA_NUM_PARALLEL: "4",
  // Max queued requests before rejection
  OLLAMA_MAX_QUEUE: "512",
};

export interface OllamaHealth {
  installed: boolean;
  running: boolean;
  version?: string;
  error?: string;
  installPath?: string;
}

export interface InstallProgress {
  stage: "downloading" | "extracting" | "installing" | "complete" | "error";
  percent: number;
  message: string;
}

/**
 * Find the Ollama executable path
 */
export function findOllamaPath(): string | null {
  const platform = os.platform();
  const paths = OLLAMA_PATHS[platform] || [];

  for (const ollamaPath of paths) {
    try {
      if (fs.existsSync(ollamaPath)) {
        return ollamaPath;
      }
    } catch {
      // Ignore errors checking paths
    }
  }

  return null;
}

/**
 * Check if Ollama is installed
 */
export async function isOllamaInstalled(): Promise<{
  installed: boolean;
  path?: string;
  version?: string;
}> {
  // First check known paths
  const ollamaPath = findOllamaPath();

  if (ollamaPath) {
    // Try to get version
    try {
      const version = await getOllamaVersion(ollamaPath);
      return { installed: true, path: ollamaPath, version };
    } catch {
      return { installed: true, path: ollamaPath };
    }
  }

  // Try running ollama from PATH
  return new Promise((resolve) => {
    exec("ollama --version", (error, stdout) => {
      if (error) {
        resolve({ installed: false });
      } else {
        const version = stdout.trim().replace("ollama version ", "");
        resolve({ installed: true, version });
      }
    });
  });
}

/**
 * Get Ollama version from executable path
 */
function getOllamaVersion(execPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(`"${execPath}" --version`, (error, stdout) => {
      if (error) {
        reject(error);
      } else {
        const version = stdout.trim().replace("ollama version ", "");
        resolve(version);
      }
    });
  });
}

/**
 * Check if Ollama service is running
 * PERFORMANCE OPTIMIZED: Reduced timeout to 1.5s for faster feedback
 */
export async function isOllamaRunning(
  baseUrl: string = DEFAULT_OLLAMA_URL
): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(1500), // REDUCED: 1.5s timeout (was 3s)
      headers: { "Connection": "keep-alive" },
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Get comprehensive Ollama health status with caching
 *
 * Features:
 * - Returns cached result if within TTL (3 seconds default)
 * - Deduplicates concurrent requests (only one in-flight at a time)
 * - Graceful fallback on errors
 */
export async function checkOllamaHealth(
  baseUrl: string = DEFAULT_OLLAMA_URL,
  options: { forceRefresh?: boolean } = {}
): Promise<OllamaHealth> {
  const now = Date.now();

  // Return cached result if valid and not forcing refresh
  if (!options.forceRefresh && cachedHealth &&
      (now - cachedHealth.timestamp < HEALTH_CACHE_TTL_MS)) {
    log.debug("[Ollama] Health check returning cached result");
    return cachedHealth.health;
  }

  // If a check is already in flight, wait for it (deduplication)
  if (healthCheckInFlight) {
    log.debug("[Ollama] Health check already in flight, waiting...");
    return healthCheckInFlight;
  }

  // Perform actual health check
  healthCheckInFlight = performHealthCheck(baseUrl);

  try {
    const health = await healthCheckInFlight;
    cachedHealth = { health, timestamp: Date.now() };
    return health;
  } finally {
    healthCheckInFlight = null;
  }
}

/**
 * Internal: Actually performs the health check
 */
async function performHealthCheck(baseUrl: string): Promise<OllamaHealth> {
  try {
    // Run both checks in parallel for speed
    const [installed, running] = await Promise.all([
      isOllamaInstalled(),
      isOllamaRunning(baseUrl),
    ]);

    return {
      installed: installed.installed,
      running,
      version: installed.version,
      installPath: installed.path,
    };
  } catch (error: any) {
    log.error("[Ollama] Error checking health:", error);
    return {
      installed: false,
      running: false,
      error: error.message,
    };
  }
}

/**
 * Invalidate health cache (call after starting/stopping Ollama)
 */
export function invalidateHealthCache(): void {
  cachedHealth = null;
  log.info("[Ollama] Health cache invalidated");
}

/**
 * Start Ollama service
 */
export async function startOllamaService(): Promise<{
  success: boolean;
  message: string;
}> {
  // Invalidate cache before starting
  invalidateHealthCache();

  // Check if already running
  if (await isOllamaRunning()) {
    return { success: true, message: "Ollama is already running" };
  }

  const installed = await isOllamaInstalled();
  if (!installed.installed) {
    return { success: false, message: "Ollama is not installed" };
  }

  const platform = os.platform();

  try {
    if (platform === "darwin") {
      // On macOS, try opening the Ollama app first
      const ollamaApp = "/Applications/Ollama.app";
      if (fs.existsSync(ollamaApp)) {
        log.info("[Ollama] Opening Ollama.app on macOS");
        exec(`open "${ollamaApp}"`);

        // Wait for service to start
        await waitForOllama();
        return { success: true, message: "Ollama started via app" };
      }

      // Otherwise try running ollama serve directly
      const ollamaPath = installed.path || "ollama";
      log.info(`[Ollama] Starting ollama serve from: ${ollamaPath}`);
      log.info(`[Ollama] Performance ENV: FLASH_ATTENTION=1, KEEP_ALIVE=24h, NUM_PARALLEL=4`);

      ollamaServeProcess = spawn(ollamaPath, ["serve"], {
        detached: true,
        stdio: "ignore",
        env: {
          ...process.env,
          ...OLLAMA_PERFORMANCE_ENV, // Apply performance optimizations
        },
      });
      ollamaServeProcess.unref();
    } else if (platform === "win32") {
      // On Windows, try starting via the Ollama app
      const ollamaPath = installed.path;
      if (ollamaPath && fs.existsSync(ollamaPath)) {
        log.info(`[Ollama] Starting ollama serve on Windows: ${ollamaPath}`);

        // On Windows, start the app which should start the service
        const ollamaDir = path.dirname(ollamaPath);
        const ollamaApp = path.join(ollamaDir, "ollama app.exe");

        if (fs.existsSync(ollamaApp)) {
          // Set performance env vars for Windows app
          const envStr = Object.entries(OLLAMA_PERFORMANCE_ENV)
            .map(([k, v]) => `set ${k}=${v}`)
            .join(" && ");
          exec(`${envStr} && "${ollamaApp}"`);
        } else {
          // Fall back to starting serve directly with performance env
          log.info(`[Ollama] Performance ENV: FLASH_ATTENTION=1, KEEP_ALIVE=24h, NUM_PARALLEL=4`);
          ollamaServeProcess = spawn(ollamaPath, ["serve"], {
            detached: true,
            env: {
              ...process.env,
              ...OLLAMA_PERFORMANCE_ENV,
            },
            stdio: "ignore",
            shell: true,
          });
          ollamaServeProcess.unref();
        }
      } else {
        return { success: false, message: "Ollama executable not found" };
      }
    }

    // Wait for service to start
    const started = await waitForOllama();
    if (started) {
      // Invalidate cache after successful start
      invalidateHealthCache();
      return { success: true, message: "Ollama service started successfully" };
    } else {
      return { success: false, message: "Ollama service failed to start within timeout" };
    }
  } catch (error: any) {
    log.error("[Ollama] Error starting service:", error);
    return { success: false, message: error.message };
  }
}

/**
 * Wait for Ollama service to become available
 */
async function waitForOllama(
  maxWaitMs: number = 30000,
  checkIntervalMs: number = 500
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    if (await isOllamaRunning()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, checkIntervalMs));
  }

  return false;
}

/**
 * Stop Ollama service (if we started it)
 */
export function stopOllamaService(): void {
  // Invalidate cache when stopping
  invalidateHealthCache();

  if (ollamaServeProcess) {
    log.info("[Ollama] Stopping Ollama serve process");
    try {
      ollamaServeProcess.kill("SIGTERM");
    } catch (error) {
      log.warn("[Ollama] Error stopping Ollama process:", error);
    }
    ollamaServeProcess = null;
  }
}

/**
 * Install Ollama automatically
 */
export async function installOllama(
  onProgress?: (progress: InstallProgress) => void
): Promise<{ success: boolean; message: string }> {
  const platform = os.platform();
  const arch = os.arch();
  const downloadKey = `${platform}-${arch}`;

  const downloadUrl = OLLAMA_DOWNLOADS[downloadKey];
  if (!downloadUrl) {
    return {
      success: false,
      message: `Unsupported platform: ${platform} ${arch}`,
    };
  }

  const tempDir = path.join(app.getPath("temp"), "ollama-install");

  try {
    // Create temp directory
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    onProgress?.({
      stage: "downloading",
      percent: 0,
      message: "Starting download...",
    });

    if (platform === "darwin") {
      return await installOllamaMacOS(downloadUrl, tempDir, onProgress);
    } else if (platform === "win32") {
      return await installOllamaWindows(downloadUrl, tempDir, onProgress);
    } else {
      return { success: false, message: `Unsupported platform: ${platform}` };
    }
  } catch (error: any) {
    log.error("[Ollama] Installation error:", error);
    onProgress?.({
      stage: "error",
      percent: 0,
      message: error.message,
    });
    return { success: false, message: error.message };
  } finally {
    // Clean up temp directory
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Install Ollama on macOS
 */
async function installOllamaMacOS(
  downloadUrl: string,
  tempDir: string,
  onProgress?: (progress: InstallProgress) => void
): Promise<{ success: boolean; message: string }> {
  const zipPath = path.join(tempDir, "Ollama.zip");

  // Download the zip file
  log.info(`[Ollama] Downloading from: ${downloadUrl}`);
  await downloadFile(downloadUrl, zipPath, (percent) => {
    onProgress?.({
      stage: "downloading",
      percent,
      message: `Downloading Ollama... ${percent}%`,
    });
  });

  onProgress?.({
    stage: "extracting",
    percent: 0,
    message: "Extracting Ollama...",
  });

  // Extract the zip
  const extractDir = path.join(tempDir, "extracted");
  if (!fs.existsSync(extractDir)) {
    fs.mkdirSync(extractDir, { recursive: true });
  }

  await new Promise<void>((resolve, reject) => {
    exec(`unzip -o "${zipPath}" -d "${extractDir}"`, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });

  onProgress?.({
    stage: "installing",
    percent: 50,
    message: "Installing Ollama...",
  });

  // Move to Applications
  const sourcePath = path.join(extractDir, "Ollama.app");
  const destPath = "/Applications/Ollama.app";

  if (fs.existsSync(sourcePath)) {
    // Remove existing installation
    if (fs.existsSync(destPath)) {
      await new Promise<void>((resolve, reject) => {
        exec(`rm -rf "${destPath}"`, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }

    // Copy new version
    await new Promise<void>((resolve, reject) => {
      exec(`cp -R "${sourcePath}" "${destPath}"`, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    onProgress?.({
      stage: "complete",
      percent: 100,
      message: "Ollama installed successfully!",
    });

    log.info("[Ollama] Installation complete on macOS");
    return { success: true, message: "Ollama installed successfully" };
  } else {
    return { success: false, message: "Ollama.app not found in download" };
  }
}

/**
 * Install Ollama on Windows
 */
async function installOllamaWindows(
  downloadUrl: string,
  tempDir: string,
  onProgress?: (progress: InstallProgress) => void
): Promise<{ success: boolean; message: string }> {
  const installerPath = path.join(tempDir, "OllamaSetup.exe");

  // Download the installer
  log.info(`[Ollama] Downloading from: ${downloadUrl}`);
  await downloadFile(downloadUrl, installerPath, (percent) => {
    onProgress?.({
      stage: "downloading",
      percent,
      message: `Downloading Ollama... ${percent}%`,
    });
  });

  onProgress?.({
    stage: "installing",
    percent: 50,
    message: "Running installer... This may take a moment.",
  });

  // Run silent installer
  await new Promise<void>((resolve, reject) => {
    exec(`"${installerPath}" /S`, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });

  // Wait a bit for installation to complete
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Verify installation
  const installed = await isOllamaInstalled();
  if (installed.installed) {
    onProgress?.({
      stage: "complete",
      percent: 100,
      message: "Ollama installed successfully!",
    });

    log.info("[Ollama] Installation complete on Windows");
    return { success: true, message: "Ollama installed successfully" };
  } else {
    return { success: false, message: "Installation verification failed" };
  }
}

/**
 * Download a file with progress
 */
async function downloadFile(
  url: string,
  destPath: string,
  onProgress?: (percent: number) => void
): Promise<void> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
  }

  const contentLength = response.headers.get("content-length");
  const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;
  let downloadedBytes = 0;

  const fileStream = createWriteStream(destPath);

  if (response.body) {
    const reader = response.body.getReader();

    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      downloadedBytes += value.length;
      fileStream.write(Buffer.from(value));

      if (totalBytes > 0 && onProgress) {
        const percent = Math.round((downloadedBytes / totalBytes) * 100);
        onProgress(percent);
      }
    }

    fileStream.end();

    // Wait for file to be fully written
    await new Promise<void>((resolve, reject) => {
      fileStream.on("finish", resolve);
      fileStream.on("error", reject);
    });
  }
}

/**
 * Get list of installed models from Ollama
 * PERFORMANCE OPTIMIZED: Reduced timeout to 3s for faster feedback
 */
export async function getOllamaModels(
  baseUrl: string = DEFAULT_OLLAMA_URL
): Promise<{
  success: boolean;
  models?: Array<{
    name: string;
    size: number;
    modified_at: string;
    details?: {
      parameter_size?: string;
      family?: string;
      quantization_level?: string;
    };
  }>;
  error?: string;
}> {
  try {
    const response = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(3000), // REDUCED: 3s timeout (was 10s)
      headers: { "Connection": "keep-alive" },
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    const data = (await response.json()) as {
      models: Array<{
        name: string;
        size: number;
        modified_at: string;
        details?: {
          parameter_size?: string;
          family?: string;
          quantization_level?: string;
        };
      }>;
    };

    return { success: true, models: data.models };
  } catch (error: any) {
    log.error("[Ollama] Error fetching models:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Get detailed information about a specific model
 * PERFORMANCE OPTIMIZED: Reduced timeout to 3s for faster feedback
 */
export async function showOllamaModel(
  modelName: string,
  baseUrl: string = DEFAULT_OLLAMA_URL
): Promise<{
  success: boolean;
  model?: any;
  error?: string;
}> {
  try {
    const response = await fetch(`${baseUrl}/api/show`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Connection": "keep-alive",
      },
      body: JSON.stringify({ name: modelName }),
      signal: AbortSignal.timeout(3000), // REDUCED: 3s timeout (was 10s)
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    const data = await response.json();
    return { success: true, model: data };
  } catch (error: any) {
    log.error("[Ollama] Error showing model:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Fetch available models from Ollama's library
 * Uses the unofficial Ollama registry API
 */
export async function getOllamaLibraryModels(): Promise<{
  success: boolean;
  models?: Array<{
    name: string;
    description: string;
    tags?: string[];
    pulls?: number;
    updated?: string;
  }>;
  error?: string;
}> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    // Ollama's registry API endpoint
    const response = await fetch(
      "https://ollama.com/api/models?sort=popular",
      {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
        },
      }
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      log.warn(`[Ollama] Library API returned ${response.status}`);
      return { success: false, error: `HTTP ${response.status}` };
    }

    const data = (await response.json()) as {
      models?: Array<{
        name: string;
        description?: string;
        tags?: string[];
        pulls?: number;
        updated?: string;
      }>;
    };

    // Transform and filter to recommended models for tool calling
    const models = (data.models || []).map((m) => ({
      name: m.name,
      description: m.description || "",
      tags: m.tags || [],
      pulls: m.pulls,
      updated: m.updated,
    }));

    return { success: true, models };
  } catch (error: any) {
    log.error("[Ollama] Error fetching library models:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Search Ollama library for models
 */
export async function searchOllamaLibrary(
  query: string
): Promise<{
  success: boolean;
  models?: Array<{
    name: string;
    description: string;
    tags?: string[];
  }>;
  error?: string;
}> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(
      `https://ollama.com/api/models/search?q=${encodeURIComponent(query)}`,
      {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
        },
      }
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    const data = (await response.json()) as {
      models?: Array<{
        name: string;
        description?: string;
        tags?: string[];
      }>;
    };

    const models = (data.models || []).map((m) => ({
      name: m.name,
      description: m.description || "",
      tags: m.tags || [],
    }));

    return { success: true, models };
  } catch (error: any) {
    log.error("[Ollama] Error searching library:", error);
    return { success: false, error: error.message };
  }
}

// Clean up on app quit
app.on("before-quit", () => {
  stopOllamaService();
});

app.on("will-quit", () => {
  stopOllamaService();
});
