#!/usr/bin/env tsx
/**
 * Test memory/remember context functionality
 */

import { config } from "dotenv";
config();

async function main() {
  console.log("🧪 Testing Memory/Remember Context...\n");

  if (!process.env.QDRANT_URL) {
    console.error("❌ QDRANT_URL not set");
    process.exit(1);
  }

  if (!process.env.OPENAI_API_KEY) {
    console.error("❌ OPENAI_API_KEY not set (needed for embeddings)");
    process.exit(1);
  }

  try {
    // Dynamic import after env vars are loaded
    const { semanticSearch } = await import(
      "lib/vector-search/vector-search-service"
    );
    const { getQdrantClient } = await import("lib/vector-search/qdrant-client");

    // Test connection
    console.log("🔌 Testing Qdrant connection...");
    const client = getQdrantClient();
    const collections = await client.getCollections();
    console.log(
      `✅ Connected! Found ${collections.collections.length} collections\n`,
    );

    // Check messages collection
    const messagesCollection = collections.collections.find(
      (c) => c.name === "messages",
    );
    if (messagesCollection) {
      const info = await client.getCollection("messages");
      const pointsCount =
        (info as any).result?.points_count || (info as any).points_count || 0;
      console.log(`📊 Messages collection: ${pointsCount} points\n`);
    }

    // Test search with a generic query
    console.log("🔍 Testing semantic search...");
    const testQuery = "test";
    const results = await semanticSearch(testQuery, "messages", {
      limit: 5,
      scoreThreshold: 0.1, // Very low threshold to see if anything matches
      useCache: false,
    });

    console.log(`\n✅ Search completed!`);
    console.log(`   Query: "${testQuery}"`);
    console.log(`   Results: ${results.length}`);

    if (results.length > 0) {
      console.log(`\n   Top result:`);
      console.log(`   - Score: ${(results[0].score * 100).toFixed(1)}%`);
      const content = String(results[0].payload.content || "");
      console.log(`   - Content: ${content.substring(0, 100)}...`);
      console.log(`   - Payload:`, JSON.stringify(results[0].payload, null, 2));
    } else {
      console.log(`\n   ⚠️  No results found. This could mean:`);
      console.log(`   1. No messages are indexed yet`);
      console.log(`   2. The query doesn't match any indexed content`);
      console.log(`   3. The score threshold is too high`);
    }
  } catch (error: any) {
    console.error("❌ Error:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main().catch(console.error);
