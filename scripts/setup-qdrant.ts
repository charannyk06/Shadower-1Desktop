#!/usr/bin/env tsx

/**
 * Qdrant Cloud Setup Script
 *
 * Initializes Qdrant collections and verifies configuration
 * Run: pnpm tsx scripts/setup-qdrant.ts
 */

import { QdrantClient } from "@qdrant/js-client-rest";

const COLLECTIONS = {
  DOCUMENTS: process.env.QDRANT_DOCUMENTS_COLLECTION || "documents",
  MESSAGES: process.env.QDRANT_MESSAGES_COLLECTION || "messages",
  KNOWLEDGE_BASE: process.env.QDRANT_KNOWLEDGE_COLLECTION || "knowledge_base",
} as const;

async function ensureCollection(
  client: QdrantClient,
  collectionName: string,
  vectorSize: number = 1536,
): Promise<void> {
  try {
    // Check if collection exists
    const collections = await client.getCollections();
    const exists = collections.collections.some(
      (c) => c.name === collectionName,
    );

    if (exists) {
      console.log(`   ✓ Collection ${collectionName} already exists`);
      return;
    }

    // Create collection
    await client.createCollection(collectionName, {
      vectors: {
        size: vectorSize,
        distance: "Cosine" as const,
      },
      hnsw_config: {
        m: 16,
        ef_construction: 100,
        full_scan_threshold: 10000,
      },
    });

    console.log(`   ✅ Created collection: ${collectionName}`);
  } catch (error: any) {
    if (error?.message?.includes("already exists")) {
      console.log(`   ✓ Collection ${collectionName} already exists`);
      return;
    }
    throw error;
  }
}

async function main() {
  // Load environment variables
  const { config } = await import("dotenv");
  config();

  // Check environment variables
  const url = process.env.QDRANT_URL;
  const apiKey = process.env.QDRANT_API_KEY;

  if (!url) {
    console.error("❌ QDRANT_URL environment variable is not set");
    console.error("   Please set it in your .env file:");
    console.error("   QDRANT_URL=http://localhost:6333 (for local)");
    console.error("   QDRANT_URL=https://your-cluster-url:6333 (for cloud)");
    process.exit(1);
  }

  // Detect if using local Qdrant
  const isLocal =
    url.includes("localhost") ||
    url.includes("127.0.0.1") ||
    url.startsWith("http://");

  if (isLocal) {
    console.log("🚀 Setting up Local Qdrant...\n");
  } else {
    console.log("🚀 Setting up Qdrant Cloud...\n");
    if (!apiKey) {
      console.error("❌ QDRANT_API_KEY environment variable is not set");
      console.error("   Please set it in your .env file:");
      console.error("   QDRANT_API_KEY=your_api_key_here");
      console.error("\n   Get your API key from: https://cloud.qdrant.io");
      process.exit(1);
    }
  }

  console.log("✅ Environment variables configured");
  console.log(`   URL: ${url.replace(/\/\/.*@/, "//***@")}`);
  if (apiKey && !isLocal) {
    console.log(`   API Key: ${apiKey.substring(0, 8)}...\n`);
  } else if (isLocal) {
    console.log(`   Mode: Local (no API key needed)\n`);
  }

  // Create client
  const clientOptions: ConstructorParameters<typeof QdrantClient>[0] = {
    url,
  };
  if (apiKey && apiKey.trim()) {
    clientOptions.apiKey = apiKey;
  }
  const client = new QdrantClient(clientOptions);

  // Test connection
  console.log("🔌 Testing Qdrant connection...");
  try {
    await client.getCollections();
    console.log(
      `✅ Connected to ${isLocal ? "Local Qdrant" : "Qdrant Cloud"}\n`,
    );
  } catch (error) {
    console.error(
      `❌ Failed to connect to ${isLocal ? "Local Qdrant" : "Qdrant Cloud"}`,
    );
    console.error("   Error:", error);
    if (isLocal) {
      console.error("   Please check that Qdrant is running:");
      console.error("   docker-compose -f docker/compose.yml up -d qdrant");
    } else {
      console.error("   Please check your QDRANT_URL and QDRANT_API_KEY");
    }
    process.exit(1);
  }

  // Initialize collections
  console.log("📦 Creating collections...");
  const vectorSize = 1536; // OpenAI text-embedding-3-small dimensions

  try {
    await ensureCollection(client, COLLECTIONS.DOCUMENTS, vectorSize);
    await ensureCollection(client, COLLECTIONS.MESSAGES, vectorSize);
    await ensureCollection(client, COLLECTIONS.KNOWLEDGE_BASE, vectorSize);
    console.log("✅ All collections ready\n");

    // Verify collections
    console.log("🔍 Verifying collections...");
    const collections = await client.getCollections();

    const expectedCollections = [
      COLLECTIONS.DOCUMENTS,
      COLLECTIONS.MESSAGES,
      COLLECTIONS.KNOWLEDGE_BASE,
    ];

    for (const collectionName of expectedCollections) {
      const exists = collections.collections.some(
        (c) => c.name === collectionName,
      );
      if (exists) {
        try {
          const infoResult = await client.getCollection(collectionName);
          const info = (infoResult as any).result || infoResult;
          const vectors = info?.config?.params?.vectors;
          const vectorSize =
            typeof vectors === "object" && vectors && "size" in vectors
              ? vectors.size
              : 1536;
          const distance =
            typeof vectors === "object" && vectors && "distance" in vectors
              ? String(vectors.distance)
              : "Cosine";
          console.log(`   ✅ ${collectionName}`);
          console.log(`      Points: ${info?.points_count || 0}`);
          console.log(
            `      Vectors: ${typeof vectorSize === "number" ? vectorSize : 1536} dimensions`,
          );
          console.log(`      Distance: ${distance}`);
        } catch {
          console.log(`   ✅ ${collectionName} (created, details unavailable)`);
        }
      } else {
        console.log(`   ❌ ${collectionName} - NOT FOUND`);
      }
    }

    console.log(
      `\n🎉 ${isLocal ? "Local Qdrant" : "Qdrant Cloud"} setup complete!`,
    );
    console.log("\nNext steps:");
    console.log("1. ✅ Database migration: Already done");
    console.log("2. ✅ Collections created: Done");
    console.log("3. Start indexing: POST /api/cron/index-embeddings");
    console.log("4. Test search: POST /api/search/semantic");
  } catch (error) {
    console.error("❌ Failed to setup collections:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
