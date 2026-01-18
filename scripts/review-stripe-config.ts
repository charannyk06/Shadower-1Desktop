#!/usr/bin/env npx tsx
/**
 * Stripe Configuration Review Script
 *
 * Reviews the current Stripe configuration and identifies TEST vs LIVE mode issues.
 * Uses the .env.vercel.production file if available, or prompts to pull it.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

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

interface StripeConfig {
  name: string;
  value: string;
  isTestMode: boolean;
  needsUpdate: boolean;
}

function analyzeStripeVar(
  name: string,
  value: string,
): {
  isTestMode: boolean;
  needsUpdate: boolean;
} {
  if (name === "STRIPE_SECRET_KEY") {
    const isTest = value.startsWith("sk_test_");
    const isLive = value.startsWith("sk_live_");
    return {
      isTestMode: isTest,
      needsUpdate: isTest || !isLive,
    };
  }

  if (name === "STRIPE_PUBLISHABLE_KEY") {
    const isTest = value.startsWith("pk_test_");
    const isLive = value.startsWith("pk_live_");
    return {
      isTestMode: isTest,
      needsUpdate: isTest || !isLive,
    };
  }

  if (name === "STRIPE_WEBHOOK_SECRET") {
    // Webhook secrets don't indicate test/live in the secret itself
    // But if we're in production and seeing test mode, it likely needs update
    return {
      isTestMode: false, // Can't determine from secret
      needsUpdate: false, // User needs to verify this manually
    };
  }

  // Price IDs - can't determine test/live from format alone
  return {
    isTestMode: false,
    needsUpdate: false,
  };
}

/**
 * Pulls environment variables from Vercel if file doesn't exist
 */
function ensureEnvFile(envFile: string): void {
  if (!existsSync(envFile)) {
    console.log("📥 Pulling production environment variables...");
    try {
      // Resolve npx to absolute path to avoid PATH security issues
      const npxPath = resolveNpxPath();

      // Use npx to ensure we use the locally installed vercel CLI
      // Using absolute path prevents PATH manipulation attacks
      const result = spawnSync(
        npxPath,
        ["--yes", "vercel", "env", "pull", envFile],
        { stdio: "inherit" },
      );
      if (result.error) {
        throw result.error;
      }
    } catch {
      console.error("❌ Failed to pull environment variables");
      console.error(
        "   Please run: npx vercel env pull .env.vercel.production",
      );
      process.exit(1);
    }
  }
}

/**
 * Parses Stripe environment variables from content
 */
function parseStripeVars(content: string): StripeConfig[] {
  const stripeVars: StripeConfig[] = [];
  const stripeVarRegex = /^STRIPE_(\w+)="?(.+?)"?$/;

  for (const line of content.split("\n")) {
    const match = stripeVarRegex.exec(line);
    if (match) {
      const name = `STRIPE_${match[1]}`;
      const value = match[2].replaceAll(String.raw`\n`, "").trim();
      const analysis = analyzeStripeVar(name, value);

      stripeVars.push({
        name,
        value: value.length > 30 ? value.substring(0, 30) + "..." : value,
        isTestMode: analysis.isTestMode,
        needsUpdate: analysis.needsUpdate,
      });
    }
  }

  return stripeVars;
}

/**
 * Displays configuration status for each Stripe variable
 */
function displayConfigStatus(stripeVars: StripeConfig[]): {
  hasTestMode: boolean;
  varsToUpdate: StripeConfig[];
} {
  console.log("📋 Current Production Configuration:");
  console.log("-".repeat(70));

  let hasTestMode = false;
  const varsToUpdate: StripeConfig[] = [];

  for (const config of stripeVars) {
    let status: string;
    if (config.isTestMode) {
      status = "⚠️  TEST MODE";
    } else if (config.needsUpdate) {
      status = "⚠️  NEEDS REVIEW";
    } else {
      status = "✅ OK";
    }

    console.log(`${status} ${config.name}`);
    console.log(`   Value: ${config.value}`);

    if (config.isTestMode || config.needsUpdate) {
      hasTestMode = true;
      if (config.isTestMode) {
        varsToUpdate.push(config);
      }
    }
    console.log("");
  }

  return { hasTestMode, varsToUpdate };
}

/**
 * Displays instructions for fixing TEST mode issues
 */
function displayFixInstructions(varsToUpdate: StripeConfig[]): void {
  console.log("⚠️  CRITICAL ISSUE DETECTED:");
  console.log("   Production environment is using TEST mode Stripe keys!");
  console.log("");
  console.log("📝 Variables that need to be updated:");
  console.log("");

  for (const config of varsToUpdate) {
    console.log(`   ❌ ${config.name}`);
    console.log(`      Current: ${config.value}`);
    console.log(
      `      Should be: ${config.name.replaceAll("TEST", "LIVE")} key`,
    );
    console.log("");
  }

  console.log("🔧 To fix this, update using Vercel CLI:");
  console.log("");
  console.log("   For each variable above, run:");
  console.log("   vercel env add <VAR_NAME> production");
  console.log("   # Then paste your LIVE mode value");
  console.log("");
  console.log("   Example:");
  console.log("   vercel env add STRIPE_SECRET_KEY production");
  console.log("   # Paste: sk_live_...");
  console.log("");

  console.log("📌 Or use the interactive script:");
  console.log("   ./scripts/update-stripe-live-keys.sh");
  console.log("");

  console.log("🔗 Get LIVE keys from Stripe Dashboard:");
  console.log("   - API Keys: https://dashboard.stripe.com/apikeys");
  console.log("   - Webhooks: https://dashboard.stripe.com/webhooks");
  console.log(
    "   - Products/Prices: Create in LIVE mode or use setup-billing.ts",
  );
  console.log("");

  console.log("⚠️  IMPORTANT:");
  console.log("   1. Create LIVE mode products/prices first (if not exist)");
  console.log(
    "   2. Set up LIVE webhook endpoint pointing to your production URL",
  );
  console.log("   3. Get the webhook signing secret from LIVE webhook");
  console.log("   4. Update all Stripe env vars in Vercel");
  console.log("   5. Redeploy your application");
  console.log("");
}

function main(): void {
  console.log("🔍 Stripe Payment Configuration Review");
  console.log("=".repeat(70));
  console.log("");

  const envFile = ".env.vercel.production";
  ensureEnvFile(envFile);

  // Read and parse env file
  const content = readFileSync(envFile, "utf-8");
  const stripeVars = parseStripeVars(content);

  if (stripeVars.length === 0) {
    console.log("❌ No Stripe environment variables found");
    process.exit(1);
  }

  const { hasTestMode, varsToUpdate } = displayConfigStatus(stripeVars);

  console.log("=".repeat(70));
  console.log("");

  if (hasTestMode) {
    displayFixInstructions(varsToUpdate);
    process.exit(1);
  } else {
    console.log(
      "✅ All Stripe environment variables appear to be configured correctly!",
    );
    console.log("   Production is using LIVE mode keys");
    console.log("");
  }
}

try {
  main();
} catch (error) {
  console.error("Error:", error);
  process.exit(1);
}
