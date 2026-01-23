#!/usr/bin/env node
/**
 * Rebuild better-sqlite3 for Electron
 * Uses node-gyp directly with Electron headers for better compatibility
 */

import { execSync } from "child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");

// Find better-sqlite3 package directory
function findBetterSqlite3Path() {
  // Try multiple possible locations - prioritize pnpm structure
  const possiblePaths = [];

  // First try pnpm paths (more reliable)
  const pnpmDir = join(rootDir, "node_modules", ".pnpm");
  if (existsSync(pnpmDir)) {
    try {
      const entries = readdirSync(pnpmDir);
      for (const entry of entries) {
        if (entry.startsWith("better-sqlite3@")) {
          const path = join(pnpmDir, entry, "node_modules", "better-sqlite3");
          if (existsSync(path) && existsSync(join(path, "binding.gyp"))) {
            possiblePaths.push(path);
          }
        }
      }
    } catch (_e) {
      // Ignore errors
    }
  }

  // Fallback to regular node_modules
  const regularPath = join(rootDir, "node_modules", "better-sqlite3");
  if (existsSync(regularPath) && existsSync(join(regularPath, "binding.gyp"))) {
    possiblePaths.push(regularPath);
  }

  if (possiblePaths.length === 0) {
    throw new Error("Could not find better-sqlite3 package directory");
  }

  // Return the first valid path (prefer pnpm structure)
  return possiblePaths[0];
}

// Get Electron version
function getElectronVersion() {
  try {
    const electronPackagePath = join(rootDir, "node_modules", "electron", "package.json");
    
    if (!existsSync(electronPackagePath)) {
      // Try pnpm structure
      const pnpmDir = join(rootDir, "node_modules", ".pnpm");
      if (existsSync(pnpmDir)) {
        const entries = readdirSync(pnpmDir);
        for (const entry of entries) {
          if (entry.startsWith("electron@")) {
            const path = join(pnpmDir, entry, "node_modules", "electron", "package.json");
            if (existsSync(path)) {
              const electronPackage = JSON.parse(readFileSync(path, "utf-8"));
              return electronPackage.version;
            }
          }
        }
      }
      throw new Error("Electron package.json not found");
    }
    
    const electronPackage = JSON.parse(readFileSync(electronPackagePath, "utf-8"));
    return electronPackage.version;
  } catch (error) {
    throw new Error(`Could not find Electron package: ${error.message}`);
  }
}

// Detect architecture
function getArchitecture() {
  const arch = process.arch;
  if (arch === "arm64" || arch === "x64") {
    return arch === "arm64" ? "arm64" : "x64";
  }
  return "x64"; // default
}

// Check if rebuild is already done and valid
function isRebuildValid(betterSqlite3Path, _electronVersion) {
  const buildPath = join(betterSqlite3Path, "build", "Release", "better_sqlite3.node");
  if (existsSync(buildPath)) {
    try {
      const stats = statSync(buildPath);
      // If file exists and is not empty, consider it valid
      if (stats.size > 0) {
        console.log("[Rebuild] Found existing build, checking if rebuild is needed...");
        return true; // Assume it's valid if it exists
      }
    } catch (_e) {
      // Ignore errors
    }
  }
  return false;
}

async function main() {
  try {
    console.log("[Rebuild] Finding better-sqlite3...");
    const betterSqlite3Path = findBetterSqlite3Path();
    console.log(`[Rebuild] Found at: ${betterSqlite3Path}`);

    console.log("[Rebuild] Getting Electron version...");
    const electronVersion = getElectronVersion();
    console.log(`[Rebuild] Electron version: ${electronVersion}`);

    const arch = getArchitecture();
    console.log(`[Rebuild] Architecture: ${arch}`);

    // Check if rebuild is already done
    if (isRebuildValid(betterSqlite3Path, electronVersion)) {
      console.log("[Rebuild] ⚡ Existing build found, skipping rebuild");
      console.log("[Rebuild] ✅ better-sqlite3 is ready for Electron");
      process.exit(0);
      return;
    }

    console.log("[Rebuild] Starting rebuild...");
    const command = `npx node-gyp rebuild --release --target=${electronVersion} --dist-url=https://electronjs.org/headers --arch=${arch}`;
    
    let rebuildSucceeded = false;
    let lastError = null;

    // Try primary method
    try {
      execSync(command, {
        cwd: betterSqlite3Path,
        stdio: "inherit",
        env: {
          ...process.env,
          CXXFLAGS: "-std=c++20",
        },
      });
      rebuildSucceeded = true;
      console.log("[Rebuild] ✅ Successfully rebuilt better-sqlite3 for Electron");
    } catch (rebuildError) {
      lastError = rebuildError;
      console.warn("[Rebuild] First attempt failed, retrying without arch flag...");
      
      // Try fallback without arch flag
      try {
        const fallbackCommand = `npx node-gyp rebuild --release --target=${electronVersion} --dist-url=https://electronjs.org/headers`;
        
        execSync(fallbackCommand, {
          cwd: betterSqlite3Path,
          stdio: "inherit",
          env: {
            ...process.env,
            CXXFLAGS: "-std=c++20",
          },
        });
        rebuildSucceeded = true;
        console.log("[Rebuild] ✅ Successfully rebuilt better-sqlite3 for Electron (fallback method)");
      } catch (fallbackError) {
        lastError = fallbackError;
        console.warn("[Rebuild] Fallback also failed, trying one more time with verbose output...");
        
        // Last attempt with verbose output for debugging
        try {
          execSync(fallbackCommand, {
            cwd: betterSqlite3Path,
            stdio: "inherit",
            env: {
              ...process.env,
              CXXFLAGS: "-std=c++20",
              npm_config_loglevel: "verbose",
            },
          });
          rebuildSucceeded = true;
          console.log("[Rebuild] ✅ Successfully rebuilt better-sqlite3 for Electron (verbose method)");
        } catch (finalError) {
          lastError = finalError;
        }
      }
    }

    if (!rebuildSucceeded) {
      throw new Error(`Rebuild failed after all attempts: ${lastError?.message || "Unknown error"}`);
    }

    // Verify the build was successful
    const buildPath = join(betterSqlite3Path, "build", "Release", "better_sqlite3.node");
    if (!existsSync(buildPath)) {
      throw new Error("Rebuild completed but output file not found");
    }

    const stats = statSync(buildPath);
    if (stats.size === 0) {
      throw new Error("Rebuild completed but output file is empty");
    }

    console.log(`[Rebuild] ✅ Verified: better_sqlite3.node exists (${stats.size} bytes)`);
  } catch (error) {
    console.error("[Rebuild] ❌ Failed to rebuild better-sqlite3:", error.message);
    if (error.stack) {
      console.error("[Rebuild] Stack:", error.stack);
    }
    // Exit with error so user knows something went wrong
    process.exit(1);
  }
}

main();
