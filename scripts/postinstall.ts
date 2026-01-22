import { exec } from "child_process";
import { promisify } from "util";
import { FILE_BASED_MCP_CONFIG, IS_DOCKER_ENV, IS_VERCEL_ENV } from "lib/const";
import "load-env";
const execPromise = promisify(exec);

async function runCommand(command: string, description: string) {
  console.log(`Starting: ${description}`);
  try {
    const { stdout, stderr } = await execPromise(command, {
      cwd: process.cwd(),
      env: process.env,
    });

    console.log(`${description} output:`);
    console.log(stdout);

    if (stderr) {
      console.error(`${description} stderr:`);
      console.error(stderr);
    }
    console.log(`${description} finished successfully.`);
  } catch (error: any) {
    console.error(`${description} error:`, error);
    process.exit(1);
  }
}

async function main() {
  if (IS_VERCEL_ENV) {
    if (FILE_BASED_MCP_CONFIG) {
      console.error("File based MCP config is not supported on Vercel.");
      process.exit(1);
    }
    // Database migration moved to build command for better visibility and control
    // See vercel.json buildCommand or package.json build script
    console.log("Running on Vercel, skipping postinstall database migration.");
    console.log("Database migration will run as part of the build command.");
  } else if (IS_DOCKER_ENV) {
    if (FILE_BASED_MCP_CONFIG) {
      console.error("File based MCP config is not supported in Docker.");
      process.exit(1);
    }
  } else {
    console.log(
      "Running in a normal environment, performing initial environment setup.",
    );
    await runCommand("pnpm initial:env", "Initial environment setup");
    await runCommand(
      "pnpm openai-compatiable:init",
      "Initial openAI compatiable config setup",
    );

    // Rebuild native modules for Electron if Electron is installed
    // Use the dedicated rebuild script - non-blocking if it fails
    try {
      const electronPath = require.resolve("electron/package.json");
      if (electronPath) {
        console.log("Rebuilding better-sqlite3 for Electron...");
        try {
          const { stdout, stderr } = await execPromise(
            "node scripts/rebuild-better-sqlite3.js",
            {
              cwd: process.cwd(),
              env: process.env,
            },
          );
          console.log("Rebuild output:", stdout);
          if (stderr) console.warn("Rebuild stderr:", stderr);
          console.log("Rebuild finished successfully.");
        } catch (rebuildError: any) {
          console.warn(
            "Rebuild failed (non-blocking). App will work via Electron IPC:",
            rebuildError.message || rebuildError,
          );
          // Don't throw - allow postinstall to continue
        }
      }
    } catch (error) {
      console.warn(
        "Electron not found, skipping native module rebuild:",
        error,
      );
    }
  }
}

main();
