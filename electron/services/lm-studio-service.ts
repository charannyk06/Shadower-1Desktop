/**
 * LM Studio Service
 *
 * Provides health checking and model management for LM Studio.
 * LM Studio uses an OpenAI-compatible API at localhost:1234.
 */

import log from "electron-log/main";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// LM Studio default API URL (OpenAI-compatible)
const DEFAULT_LM_STUDIO_URL = "http://localhost:1234/v1";

// LM Studio installation paths by platform
const LM_STUDIO_PATHS: Record<string, string[]> = {
  darwin: [
    "/Applications/LM Studio.app",
    path.join(os.homedir(), "Applications", "LM Studio.app"),
  ],
  win32: [
    path.join(process.env.LOCALAPPDATA || "", "Programs", "LM Studio", "LM Studio.exe"),
    path.join(process.env.PROGRAMFILES || "", "LM Studio", "LM Studio.exe"),
    path.join(os.homedir(), "AppData", "Local", "Programs", "LM Studio", "LM Studio.exe"),
  ],
};

export interface LMStudioHealth {
  installed: boolean;
  running: boolean;
  version?: string;
  error?: string;
  installPath?: string;
}

export interface LMStudioModel {
  id: string;
  object: string;
  owned_by: string;
}

/**
 * Find LM Studio installation path
 */
export function findLMStudioPath(): string | null {
  const platform = os.platform();
  const paths = LM_STUDIO_PATHS[platform] || [];

  for (const lmStudioPath of paths) {
    try {
      if (fs.existsSync(lmStudioPath)) {
        return lmStudioPath;
      }
    } catch {
      // Ignore errors checking paths
    }
  }

  return null;
}

/**
 * Check if LM Studio is installed
 */
export function isLMStudioInstalled(): { installed: boolean; path?: string } {
  const lmStudioPath = findLMStudioPath();
  return {
    installed: !!lmStudioPath,
    path: lmStudioPath || undefined,
  };
}

/**
 * Check if LM Studio server is running
 */
export async function isLMStudioRunning(
  baseUrl: string = DEFAULT_LM_STUDIO_URL
): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(`${baseUrl}/models`, {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Get comprehensive LM Studio health status
 */
export async function checkLMStudioHealth(
  baseUrl: string = DEFAULT_LM_STUDIO_URL
): Promise<LMStudioHealth> {
  try {
    const installed = isLMStudioInstalled();
    const running = await isLMStudioRunning(baseUrl);

    return {
      installed: installed.installed,
      running,
      installPath: installed.path,
    };
  } catch (error: any) {
    log.error("[LM Studio] Error checking health:", error);
    return {
      installed: false,
      running: false,
      error: error.message,
    };
  }
}

/**
 * Get list of loaded models from LM Studio
 */
export async function getLMStudioModels(
  baseUrl: string = DEFAULT_LM_STUDIO_URL
): Promise<{
  success: boolean;
  models?: LMStudioModel[];
  error?: string;
}> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(`${baseUrl}/models`, {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    const data = (await response.json()) as {
      data: LMStudioModel[];
    };

    return { success: true, models: data.data || [] };
  } catch (error: any) {
    log.error("[LM Studio] Error fetching models:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Test a completion request to LM Studio
 */
export async function testLMStudioConnection(
  baseUrl: string = DEFAULT_LM_STUDIO_URL
): Promise<{ success: boolean; error?: string }> {
  try {
    // First check if we can get models
    const modelsResult = await getLMStudioModels(baseUrl);

    if (!modelsResult.success) {
      return { success: false, error: modelsResult.error };
    }

    if (!modelsResult.models || modelsResult.models.length === 0) {
      return {
        success: false,
        error: "No models loaded. Please load a model in LM Studio first.",
      };
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
