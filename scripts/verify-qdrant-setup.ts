#!/usr/bin/env tsx

/**
 * Verify Qdrant Setup
 * Checks that everything is configured correctly
 */

import { QdrantClient } from "@qdrant/js-client-rest";
import { config } from "dotenv";

config();

const COLLECTIONS = {
  DOCUMENTS: process.env.QDRANT_DOCUMENTS_COLLECTION || "documents",
  MESSAGES: process.env.QDRANT_MESSAGES_COLLECTION || "messages",
  KNOWLEDGE_BASE: process.env.QDRANT_KNOWLEDGE_COLLECTION || "knowledge_base",
};

async function main() {
  console.log("🔍 Verifying Qdrant Setup...\n");

  const url = process.env.QDRANT_URL;
  const apiKey = process.env.QDRANT_API_KEY;

  if (!url || !apiKey) {
    console.error("❌ QDRANT_URL or QDRANT_API_KEY not set in .env");
    process.exit(1);
  }

  console.log("✅ Environment variables configured");
  console.log(`   URL: ${url.replace(/\/\/.*@/, "//***@")}\n`);

  const client = new QdrantClient({ url, apiKey });

  try {
    // Test connection
    const collections = await client.getCollections();
    console.log("✅ Connected to Qdrant Cloud\n");

    // Check collections
    console.log("📦 Collections Status:");
    const expectedCollections = [
      COLLECTIONS.DOCUMENTS,
      COLLECTIONS.MESSAGES,
      COLLECTIONS.KNOWLEDGE_BASE,
    ];

    let allExist = true;
    for (const name of expectedCollections) {
      const exists = collections.collections.some((c) => c.name === name);
      if (exists) {
        try {
          const infoResult = await client.getCollection(name);
          const info = (infoResult as any).result || infoResult;
          console.log(`   ✅ ${name} - ${info?.points_count || 0} points`);
        } catch {
          console.log(`   ✅ ${name} - exists`);
        }
      } else {
        console.log(`   ❌ ${name} - NOT FOUND`);
        allExist = false;
      }
    }

    console.log("");
    if (allExist) {
      console.log("🎉 All collections are ready!");
      console.log("\n✅ Setup verification complete!");
      console.log("\nYou can now:");
      console.log("1. Start indexing: POST /api/cron/index-embeddings");
      console.log("2. Test search: POST /api/search/semantic");
    } else {
      console.log("⚠️  Some collections are missing. Run: pnpm qdrant:setup");
      process.exit(1);
    }
  } catch (error: any) {
    console.error("❌ Verification failed:", error.message);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
