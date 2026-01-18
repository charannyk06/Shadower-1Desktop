import { colorize } from "consola/utils";
import "load-env";

// Ensure environment variables are loaded before importing db module
// This is critical for Vercel builds where env vars need to be explicitly loaded
// Support both POSTGRES_URL and DATABASE_URL for compatibility
if (!process.env.POSTGRES_URL && !process.env.DATABASE_URL) {
  console.error(
    "❌ Neither POSTGRES_URL nor DATABASE_URL environment variable is set.\n" +
      "Please ensure POSTGRES_URL or DATABASE_URL is configured in your Vercel project settings\n" +
      "under Environment Variables for Production, Preview, and Development environments.",
  );
  process.exit(1);
}

// PRODUCTION SAFEGUARD: Warn if connecting to production database
const dbUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL || "";
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

const { runMigrate } = await import("lib/db/pg/migrate.pg");

await runMigrate()
  .then(() => {
    console.info("🚀 DB Migration completed");
    process.exit(0);
  })
  .catch((err) => {
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
You shouldn’t have to do this kind of reset again in future releases.


      `.trim(),
    );

    process.exit(1);
  });
