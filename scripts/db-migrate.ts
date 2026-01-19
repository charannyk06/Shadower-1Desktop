import { colorize } from "consola/utils";
import "load-env";

// Check if we're in local-first/Electron mode (no PostgreSQL needed)
const isLocalFirst =
  process.env.LOCAL_FIRST === "true" ||
  process.env.USE_SQLITE === "true" ||
  process.env.ELECTRON === "true";

// In local-first mode, skip PostgreSQL migrations
if (isLocalFirst) {
  console.info("🏠 Local-first mode detected - skipping PostgreSQL migrations");
  console.info("📦 SQLite database will be initialized on first run");
  process.exit(0);
}

// Get database URL
const dbUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL || "";

// Check if we have a valid database URL (not just set but actually valid)
const isValidDbUrl =
  dbUrl &&
  dbUrl.length > 10 &&
  (dbUrl.startsWith("postgres://") || dbUrl.startsWith("postgresql://"));

// For local development without a valid PostgreSQL URL, use SQLite
if (!isValidDbUrl) {
  console.info("ℹ️  No valid POSTGRES_URL or DATABASE_URL found");
  console.info("🏠 Using local-first mode - skipping PostgreSQL migrations");
  console.info("📦 SQLite database will be initialized on first run");
  process.exit(0);
}

// Check if connecting to localhost (likely no database running)
const isLocalhost =
  dbUrl.includes("localhost") ||
  dbUrl.includes("127.0.0.1") ||
  dbUrl.includes("::1");

// For localhost without explicit opt-in, skip migrations (assume local-first mode)
if (isLocalhost) {
  // Only run migrations if explicitly requested
  if (process.env.RUN_PG_MIGRATIONS !== "true") {
    console.info(
      "ℹ️  Localhost database URL detected but RUN_PG_MIGRATIONS not set",
    );
    console.info("🏠 Skipping PostgreSQL migrations for local-first mode");
    console.info("📦 SQLite database will be initialized on first run");
    console.info(
      "   (Set RUN_PG_MIGRATIONS=true to run PostgreSQL migrations)",
    );
    process.exit(0);
  }
}

// PRODUCTION SAFEGUARD: Warn if connecting to production database
const isProductionDb =
  dbUrl.includes("neon.tech") ||
  dbUrl.includes("supabase.co") ||
  dbUrl.includes(".aws") ||
  dbUrl.includes(".azure") ||
  process.env.NODE_ENV === "production" ||
  process.env.VERCEL_ENV === "production";

if (isProductionDb) {
  console.warn(
    colorize(
      "yellow",
      "⚠️  WARNING: Connecting to what appears to be a PRODUCTION database!",
    ),
  );
  console.warn(
    colorize(
      "yellow",
      "   Migrations will be blocked if users exist in the database.",
    ),
  );
}

// Try to run PostgreSQL migrations
try {
  const { runMigrate } = await import("lib/db/pg/migrate.pg");

  await runMigrate();
  console.info("🚀 DB Migration completed");
  process.exit(0);
} catch (err: any) {
  // Check if it's a connection error (from the wrapper error message)
  const errMessage = err?.message || String(err);
  const isConnectionError =
    err?.code === "ECONNREFUSED" ||
    errMessage.includes("ECONNREFUSED") ||
    errMessage.includes("connection refused") ||
    errMessage.includes("Database connection failed");

  if (isConnectionError) {
    console.warn(
      colorize("yellow", "⚠️  Could not connect to PostgreSQL database"),
    );
    console.info(
      "🏠 Falling back to local-first mode - SQLite will be used instead",
    );
    process.exit(0);
  }

  // Other errors should be reported
  console.error(err);

  console.warn(
    `
      ${colorize("red", "🚨 Migration failed due to incompatible schema.")}

❗️DB Migration failed – incompatible schema detected.

This version introduces a complete rework of the database schema.
As a result, your existing database structure may no longer be compatible.

**To resolve this:**

1. Drop all existing tables in your database.
2. Then run the following command to apply the latest schema:


${colorize("green", "pnpm db:migrate")}

**Note:** This schema overhaul lays the foundation for more stable updates moving forward.
You shouldn't have to do this kind of reset again in future releases.


      `.trim(),
  );

  process.exit(1);
}
