import { IS_VERCEL_ENV } from "lib/const";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Skip PostgreSQL migrations in Electron mode (uses SQLite instead)
    // Also skip if POSTGRES_URL is not properly configured (for Electron dev)
    const isElectronBuild = process.env.ELECTRON_BUILD === "true";
    const hasPostgresUrl =
      process.env.POSTGRES_URL &&
      process.env.POSTGRES_URL !==
        "postgres://your_username:your_password@localhost:5432/your_database_name" &&
      !process.env.POSTGRES_URL.includes("your_username");

    // Run migrations at runtime if POSTGRES_URL or DATABASE_URL is available and valid
    // This handles cases where migrations couldn't run during build
    if (
      !isElectronBuild &&
      hasPostgresUrl &&
      (process.env.POSTGRES_URL || process.env.DATABASE_URL)
    ) {
      try {
        const runMigrate = await import("./lib/db/pg/migrate.pg").then(
          (m) => m.runMigrate,
        );
        await runMigrate().catch((e) => {
          console.error("❌ Runtime migration failed:", e);
          // Don't exit on Vercel - let the app start even if migrations fail
          // Migrations will be retried on next deployment
          if (!IS_VERCEL_ENV) {
            process.exit(1);
          }
        });
      } catch (error) {
        console.warn("⚠️ Could not run migrations at runtime:", error);
        // Continue execution - migrations may have already run during build
      }
    } else if (isElectronBuild) {
      console.log(
        "ℹ️ Skipping PostgreSQL migrations (Electron mode - using SQLite)",
      );
    }

    if (!IS_VERCEL_ENV) {
      const initMCPManager = await import("./lib/ai/mcp/mcp-manager").then(
        (m) => m.initMCPManager,
      );
      await initMCPManager();
    }
  }
}
