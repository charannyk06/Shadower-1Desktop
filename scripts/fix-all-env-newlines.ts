#!/usr/bin/env npx tsx
/**
 * Fix trailing newlines in all Vercel environment variables
 *
 * This script:
 * 1. Pulls environment variables from Vercel
 * 2. Identifies variables with trailing \n characters
 * 3. Updates them without the trailing newline
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";

/**
 * Resolves npx to an absolute path to avoid PATH security issues.
 * Uses Node.js's execPath to construct the path to npx in the same directory.
 */
function resolveNpxPath(): string {
  // Get the Node.js executable path (e.g., /usr/bin/node or /usr/local/bin/node)
  const nodePath = process.execPath;
  const nodeDir = dirname(nodePath);

  // npx is typically in the same directory as node
  // On Windows it's npx.cmd, on Unix it's npx
  const npxName = process.platform === "win32" ? "npx.cmd" : "npx";
  const npxPath = join(nodeDir, npxName);

  // Verify npx exists, fallback to searching PATH if not found
  if (existsSync(npxPath)) {
    return npxPath;
  }

  // Fallback: use which/where to find npx (still searches PATH but better than nothing)
  const whichCmd = process.platform === "win32" ? "where" : "which";
  const whichResult = spawnSync(whichCmd, [npxName], {
    encoding: "utf-8",
    shell: false,
  });

  if (whichResult.status === 0 && whichResult.stdout) {
    const resolvedPath = whichResult.stdout.trim().split("\n")[0];
    if (resolvedPath && existsSync(resolvedPath)) {
      return resolvedPath;
    }
  }

  // Last resort: return npx and let spawn handle it (with shell: false for safety)
  return npxName;
}

interface EnvVar {
  name: string;
  value: string;
  hasNewline: boolean;
}

/**
 * Parses a Vercel environment file and extracts variables with trailing newlines.
 *
 * @param filePath - Path to the .env file
 * @returns Array of environment variables with metadata
 * @throws Error if file cannot be read
 */
function parseEnvFile(filePath: string): EnvVar[] {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch (error) {
    throw new Error(`Failed to read environment file: ${error}`);
  }

  const vars: EnvVar[] = [];

  const envVarRegex = /^([A-Z_][A-Z0-9_]*)=(.+)$/;
  for (const line of content.split("\n")) {
    // Match env var format: VAR_NAME="value" or VAR_NAME=value
    const match = envVarRegex.exec(line);
    if (match) {
      const name = match[1];
      let value = match[2];

      // Remove surrounding quotes if present
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }

      // Check for trailing \n (escaped newline)
      const hasNewline = value.endsWith(String.raw`\n`);
      if (hasNewline) {
        value = value.slice(0, -2); // Remove \n
      }

      vars.push({ name, value, hasNewline });
    }
  }

  return vars;
}

/**
 * Updates an environment variable in Vercel without trailing newlines.
 * Uses spawn to prevent shell injection vulnerabilities.
 *
 * @param name - Environment variable name (must match /^[A-Z_][A-Z0-9_]*$/)
 * @param value - Environment variable value (will be sanitized)
 * @param environment - Target environment (production, preview, development)
 * @returns true if update succeeded, false otherwise
 */
function updateEnvVar(
  name: string,
  value: string,
  environment: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    // Validate input to prevent injection
    if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) {
      console.error(`Invalid variable name: ${name}`);
      resolve(false);
      return;
    }

    if (!["production", "preview", "development"].includes(environment)) {
      console.error(`Invalid environment: ${environment}`);
      resolve(false);
      return;
    }

    // Use Node.js Readable stream instead of echo to avoid PATH security issues
    // This eliminates the need to search for 'echo' in PATH
    const valueStream = Readable.from([value]);

    // Resolve npx to absolute path to avoid PATH security issues
    const npxPath = resolveNpxPath();

    // Use npx to ensure we use the locally installed vercel CLI
    // Using absolute path prevents PATH manipulation attacks
    const vercelProcess = spawn(
      npxPath,
      ["--yes", "vercel", "env", "add", name, environment, "--force"],
      {
        shell: false, // Explicitly disable shell to prevent PATH manipulation
        stdio: [valueStream, "pipe", "pipe"],
      },
    );

    let errorOutput = "";

    vercelProcess.stderr?.on("data", (data) => {
      errorOutput += data.toString();
    });

    vercelProcess.on("close", (code) => {
      if (code === 0) {
        resolve(true);
      } else {
        console.error(`Failed to update ${name}: ${errorOutput.trim()}`);
        resolve(false);
      }
    });

    vercelProcess.on("error", (error) => {
      console.error(`Failed to execute vercel for ${name}:`, error);
      resolve(false);
    });
  });
}

/**
 * Main function to fix trailing newlines in Vercel environment variables.
 *
 * Usage: npx tsx scripts/fix-all-env-newlines.ts [environment]
 * Environment defaults to "production" if not specified.
 */
async function main(): Promise<void> {
  const environment = process.argv[2] || "production";

  console.log("🔧 Fixing trailing newlines in Vercel environment variables");
  console.log(`Environment: ${environment}`);
  console.log("");

  // Pull current env vars
  const tempFile = ".env.vercel.fix";
  console.log("📥 Pulling current environment variables...");

  try {
    // Resolve npx to absolute path to avoid PATH security issues
    const npxPath = resolveNpxPath();

    // Use npx to ensure we use the locally installed vercel CLI
    // Using absolute path prevents PATH manipulation attacks
    const result = spawnSync(
      npxPath,
      ["--yes", "vercel", "env", "pull", tempFile],
      { stdio: "inherit" },
    );
    if (result.error) {
      throw result.error;
    }
  } catch {
    console.error("❌ Failed to pull environment variables");
    process.exit(1);
  }

  if (!existsSync(tempFile)) {
    console.error("❌ Environment file not found");
    process.exit(1);
  }

  // Parse and find vars with newlines
  const vars = parseEnvFile(tempFile);
  const varsToFix = vars.filter((v) => v.hasNewline);

  if (varsToFix.length === 0) {
    console.log("✅ No variables with trailing newlines found");
    unlinkSync(tempFile);
    return;
  }

  console.log(
    `🔍 Found ${varsToFix.length} variable(s) with trailing newlines:`,
  );
  varsToFix.forEach((v) => {
    console.log(`   - ${v.name}`);
  });
  console.log("");

  console.log("📝 Fixing variables...");
  console.log("");

  let fixed = 0;
  let failed = 0;

  // Process updates sequentially to avoid rate limiting
  for (const envVar of varsToFix) {
    process.stdout.write(`Updating ${envVar.name}... `);
    // eslint-disable-next-line no-await-in-loop
    const success = await updateEnvVar(envVar.name, envVar.value, environment);
    if (success) {
      console.log("✅");
      fixed++;
    } else {
      console.log("❌");
      failed++;
    }
  }

  // Cleanup
  unlinkSync(tempFile);

  console.log("");
  console.log("=".repeat(60));
  console.log(`✅ Fixed: ${fixed}`);
  if (failed > 0) {
    console.log(`❌ Failed: ${failed}`);
  }
  console.log("");

  if (fixed > 0) {
    console.log("📌 Next steps:");
    console.log("   1. Redeploy your application: vercel --prod");
    console.log("   2. Verify the changes took effect");
    console.log("");
  }
}

// Top-level await for better error handling
try {
  await main();
} catch (error) {
  console.error("Error:", error);
  process.exit(1);
}
