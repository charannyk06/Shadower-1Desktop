import { IS_VERCEL_ENV } from "lib/const";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Run migrations at runtime if POSTGRES_URL or DATABASE_URL is available
    // This handles cases where migrations couldn't run during build
    if (process.env.POSTGRES_URL || process.env.DATABASE_URL) {
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
    }

    if (!IS_VERCEL_ENV) {
      const initMCPManager = await import("./lib/ai/mcp/mcp-manager").then(
        (m) => m.initMCPManager,
      );
      await initMCPManager();
    }
  }
}
