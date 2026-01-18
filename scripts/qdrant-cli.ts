#!/usr/bin/env tsx

/**
 * Qdrant CLI Tool
 *
 * Comprehensive command-line interface for Qdrant Cloud management
 *
 * Usage:
 *   pnpm qdrant:cli status
 *   pnpm qdrant:cli setup
 *   pnpm qdrant:cli test
 *   pnpm qdrant:cli collections
 *   pnpm qdrant:cli collection <name>
 *   pnpm qdrant:cli delete-collection <name>
 */

import { QdrantClient } from "@qdrant/js-client-rest";
import { config } from "dotenv";

config();

const COLLECTIONS = {
  DOCUMENTS: process.env.QDRANT_DOCUMENTS_COLLECTION || "documents",
  MESSAGES: process.env.QDRANT_MESSAGES_COLLECTION || "messages",
  KNOWLEDGE_BASE: process.env.QDRANT_KNOWLEDGE_COLLECTION || "knowledge_base",
} as const;

function getClient(): QdrantClient {
  const url = process.env.QDRANT_URL;
  const apiKey = process.env.QDRANT_API_KEY;

  if (!url || !apiKey) {
    console.error("❌ QDRANT_URL and QDRANT_API_KEY must be set in .env");
    process.exit(1);
  }

  return new QdrantClient({ url, apiKey });
}

async function ensureCollection(
  client: QdrantClient,
  collectionName: string,
  vectorSize: number = 1536,
): Promise<void> {
  try {
    const collections = await client.getCollections();
    const exists = collections.collections.some(
      (c) => c.name === collectionName,
    );

    if (exists) {
      console.log(`   ✓ Collection ${collectionName} already exists`);
      return;
    }

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

async function cmdStatus() {
  console.log("🔍 Qdrant Status Check\n");

  const client = getClient();
  const url = process.env.QDRANT_URL || "";

  console.log("📡 Connection:");
  console.log(`   URL: ${url.replace(/\/\/.*@/, "//***@")}`);

  try {
    await client.getCollections();
    console.log("   Status: ✅ Connected\n");
  } catch (error: any) {
    console.log("   Status: ❌ Connection failed");
    console.log(`   Error: ${error.message}\n`);
    process.exit(1);
  }

  console.log("📦 Collections:");
  const collections = await client.getCollections();
  const expectedCollections = [
    COLLECTIONS.DOCUMENTS,
    COLLECTIONS.MESSAGES,
    COLLECTIONS.KNOWLEDGE_BASE,
  ];

  for (const name of expectedCollections) {
    const exists = collections.collections.some((c) => c.name === name);
    if (exists) {
      try {
        const infoResult = await client.getCollection(name);
        const info = (infoResult as any).result || infoResult;
        console.log(`   ✅ ${name}`);
        console.log(`      Points: ${info?.points_count || 0}`);
        console.log(
          `      Indexed Vectors: ${info?.indexed_vectors_count || 0}`,
        );
      } catch {
        console.log(`   ✅ ${name} (exists)`);
      }
    } else {
      console.log(`   ❌ ${name} - NOT FOUND`);
    }
  }
}

async function cmdSetup() {
  console.log("🚀 Setting up Qdrant Cloud...\n");

  const client = getClient();
  const url = process.env.QDRANT_URL || "";

  console.log("✅ Environment variables configured");
  console.log(`   URL: ${url.replace(/\/\/.*@/, "//***@")}\n`);

  console.log("🔌 Testing connection...");
  try {
    await client.getCollections();
    console.log("✅ Connected to Qdrant Cloud\n");
  } catch (error: any) {
    console.error("❌ Failed to connect:", error.message);
    process.exit(1);
  }

  console.log("📦 Creating collections...");
  const vectorSize = 1536;

  try {
    await ensureCollection(client, COLLECTIONS.DOCUMENTS, vectorSize);
    await ensureCollection(client, COLLECTIONS.MESSAGES, vectorSize);
    await ensureCollection(client, COLLECTIONS.KNOWLEDGE_BASE, vectorSize);
    console.log("✅ All collections ready\n");

    console.log("🔍 Verifying...");
    await cmdStatus();
    console.log("\n🎉 Setup complete!");
  } catch (error: any) {
    console.error("❌ Setup failed:", error.message);
    process.exit(1);
  }
}

async function cmdTest() {
  console.log("🧪 Testing Qdrant Connection...\n");

  const client = getClient();

  try {
    const start = Date.now();
    await client.getCollections();
    const latency = Date.now() - start;

    console.log("✅ Connection successful");
    console.log(`   Latency: ${latency}ms\n`);

    const collections = await client.getCollections();
    console.log(`📦 Found ${collections.collections.length} collection(s)`);
    collections.collections.forEach((c) => {
      console.log(`   - ${c.name}`);
    });
  } catch (error: any) {
    console.error("❌ Connection failed:", error.message);
    process.exit(1);
  }
}

async function cmdCollections() {
  console.log("📦 Qdrant Collections\n");

  const client = getClient();

  try {
    const collections = await client.getCollections();

    if (collections.collections.length === 0) {
      console.log("No collections found.");
      return;
    }

    for (const collection of collections.collections) {
      try {
        const infoResult = await client.getCollection(collection.name);
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

        console.log(`📁 ${collection.name}`);
        console.log(`   Points: ${info?.points_count || 0}`);
        console.log(`   Indexed Vectors: ${info?.indexed_vectors_count || 0}`);
        console.log(`   Vector Size: ${vectorSize} dimensions`);
        console.log(`   Distance: ${distance}`);
        console.log("");
      } catch {
        console.log(`📁 ${collection.name} (unable to get details)`);
      }
    }
  } catch (error: any) {
    console.error("❌ Failed to list collections:", error.message);
    process.exit(1);
  }
}

async function cmdCollectionInfo(name: string) {
  console.log(`📁 Collection: ${name}\n`);

  const client = getClient();

  try {
    const infoResult = await client.getCollection(name);
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

    console.log("Configuration:");
    console.log(`   Vector Size: ${vectorSize} dimensions`);
    console.log(`   Distance Metric: ${distance}`);
    console.log(`   Points: ${info?.points_count || 0}`);
    console.log(`   Indexed Vectors: ${info?.indexed_vectors_count || 0}`);
    console.log(`   Status: ${info?.status || "unknown"}`);

    if (info?.config?.hnsw_config) {
      const hnsw = info.config.hnsw_config;
      console.log("\nHNSW Index:");
      console.log(`   m: ${hnsw.m || "N/A"}`);
      console.log(`   ef_construction: ${hnsw.ef_construction || "N/A"}`);
      console.log(
        `   full_scan_threshold: ${hnsw.full_scan_threshold || "N/A"}`,
      );
    }
  } catch (error: any) {
    console.error(`❌ Failed to get collection info: ${error.message}`);
    process.exit(1);
  }
}

async function cmdDeleteCollection(name: string) {
  console.log(`🗑️  Deleting collection: ${name}\n`);

  const client = getClient();

  try {
    await client.deleteCollection(name);
    console.log(`✅ Collection ${name} deleted successfully`);
  } catch (error: any) {
    console.error(`❌ Failed to delete collection: ${error.message}`);
    process.exit(1);
  }
}

async function main() {
  const command = process.argv[2];
  const arg = process.argv[3];

  switch (command) {
    case "status":
      await cmdStatus();
      break;
    case "setup":
      await cmdSetup();
      break;
    case "test":
      await cmdTest();
      break;
    case "collections":
      await cmdCollections();
      break;
    case "collection":
      if (!arg) {
        console.error("❌ Collection name required");
        console.error("Usage: pnpm qdrant:cli collection <name>");
        process.exit(1);
      }
      await cmdCollectionInfo(arg);
      break;
    case "delete-collection":
      if (!arg) {
        console.error("❌ Collection name required");
        console.error("Usage: pnpm qdrant:cli delete-collection <name>");
        process.exit(1);
      }
      await cmdDeleteCollection(arg);
      break;
    default:
      console.log("Qdrant CLI Tool\n");
      console.log("Usage:");
      console.log(
        "  pnpm qdrant:cli status              - Check connection and collections",
      );
      console.log(
        "  pnpm qdrant:cli setup               - Initialize all collections",
      );
      console.log("  pnpm qdrant:cli test                - Test connection");
      console.log(
        "  pnpm qdrant:cli collections         - List all collections",
      );
      console.log(
        "  pnpm qdrant:cli collection <name>   - Get collection details",
      );
      console.log(
        "  pnpm qdrant:cli delete-collection <name> - Delete a collection",
      );
      process.exit(command ? 1 : 0);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
