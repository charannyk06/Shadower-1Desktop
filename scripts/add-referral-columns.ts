import dotenv from "dotenv";
import { Pool } from "pg";

dotenv.config();

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
});

try {
  console.log("Adding referral columns...");

  // Add columns
  await pool.query(`
    ALTER TABLE "user"
    ADD COLUMN IF NOT EXISTS referral_code VARCHAR(20),
    ADD COLUMN IF NOT EXISTS referred_by_id UUID REFERENCES "user"(id),
    ADD COLUMN IF NOT EXISTS total_referrals INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_referral_bonus TEXT NOT NULL DEFAULT '0'
  `);
  console.log("✓ Added referral columns");

  // Add unique index for non-null referral codes
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS user_referral_code_unique
    ON "user" (referral_code)
    WHERE referral_code IS NOT NULL
  `);
  console.log("✓ Added unique constraint for referral_code");

  // Check if referral table exists
  const tableCheck = await pool.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_name = 'referral'
    )
  `);

  if (tableCheck.rows[0].exists) {
    console.log("✓ Referral table already exists");
  } else {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS referral (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        referrer_id UUID NOT NULL REFERENCES "user"(id),
        referee_id UUID NOT NULL REFERENCES "user"(id),
        referral_code VARCHAR(20) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        referrer_bonus TEXT DEFAULT '0',
        referee_bonus TEXT DEFAULT '0',
        completed_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    console.log("✓ Created referral table");
  }

  console.log("\n✅ Migration completed successfully!");
} catch (error) {
  console.error("Migration failed:", error);
  process.exit(1);
} finally {
  await pool.end();
}
