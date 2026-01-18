#!/usr/bin/env tsx

/**
 * Create vector_index table directly
 * Run: pnpm tsx scripts/create-vector-index-table.ts
 */

import { config } from "dotenv";
import pg from "pg";

config();

const { Client } = pg;

async function main() {
  const dbUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL;

  if (!dbUrl) {
    console.error("❌ POSTGRES_URL or DATABASE_URL not set");
    process.exit(1);
  }

  console.log("🔧 Creating vector_index table...\n");

  const client = new Client({ connectionString: dbUrl });

  try {
    await client.connect();
    console.log("✅ Connected to database\n");

    // Check if table exists
    const checkResult = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'vector_index'
      );
    `);

    if (checkResult.rows[0].exists) {
      console.log("✅ vector_index table already exists");
      await client.end();
      return;
    }

    // Create table
    await client.query(`
      CREATE TABLE "vector_index" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "qdrant_point_id" uuid NOT NULL UNIQUE,
        "collection_name" varchar(50) NOT NULL,
        "entity_type" varchar NOT NULL,
        "entity_id" text NOT NULL,
        "user_id" uuid,
        "metadata" json,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
    `);

    // Add foreign key
    await client.query(`
      ALTER TABLE "vector_index"
      ADD CONSTRAINT "vector_index_user_id_user_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "public"."user"("id")
      ON DELETE cascade ON UPDATE no action;
    `);

    // Create indexes
    await client.query(`
      CREATE INDEX "vector_index_qdrant_point_idx"
      ON "vector_index" USING btree ("qdrant_point_id");
    `);

    await client.query(`
      CREATE INDEX "vector_index_entity_idx"
      ON "vector_index" USING btree ("entity_type", "entity_id");
    `);

    await client.query(`
      CREATE INDEX "vector_index_user_idx"
      ON "vector_index" USING btree ("user_id");
    `);

    await client.query(`
      CREATE INDEX "vector_index_collection_idx"
      ON "vector_index" USING btree ("collection_name");
    `);

    console.log("✅ vector_index table created successfully!");
    console.log("✅ Indexes created");
    console.log("✅ Foreign key constraint added\n");
  } catch (error: any) {
    if (error.message?.includes("already exists")) {
      console.log("✅ vector_index table already exists");
    } else {
      console.error("❌ Error creating table:", error.message);
      process.exit(1);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
