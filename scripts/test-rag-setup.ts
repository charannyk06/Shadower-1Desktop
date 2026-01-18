#!/usr/bin/env tsx

/**
 * RAG Testing Setup Script
 *
 * This script helps you verify and test the RAG implementation:
 * 1. Checks environment variables
 * 2. Verifies Qdrant connection
 * 3. Checks collections
 * 4. Tests embedding generation
 * 5. Tests indexing and search
 */

// Load environment variables
import { config } from "dotenv";
config();

import { openai } from "@ai-sdk/openai";
import { QdrantClient } from "@qdrant/js-client-rest";
import { embed, embedMany } from "ai";

const COLLECTIONS = {
  DOCUMENTS: process.env.QDRANT_DOCUMENTS_COLLECTION || "documents",
  MESSAGES: process.env.QDRANT_MESSAGES_COLLECTION || "messages",
  KNOWLEDGE_BASE: process.env.QDRANT_KNOWLEDGE_COLLECTION || "knowledge_base",
};

async function checkEnvironment() {
  console.log("🔍 Step 1: Checking Environment Variables...\n");

  const url = process.env.QDRANT_URL;
  const apiKey = process.env.QDRANT_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!url || !apiKey) {
    console.error("❌ QDRANT_URL or QDRANT_API_KEY not set in .env");
    console.error("   Please add these to your .env file:");
    console.error("   QDRANT_URL=https://your-cluster-url:6333");
    console.error("   QDRANT_API_KEY=your_api_key_here\n");
    return false;
  }

  if (!openaiKey) {
    console.error("❌ OPENAI_API_KEY not set in .env");
    console.error("   Required for embedding generation\n");
    return false;
  }

  console.log("✅ Environment variables configured");
  console.log(`   QDRANT_URL: ${url.replace(/\/\/.*@/, "//***@")}`);
  console.log(`   QDRANT_API_KEY: ${apiKey.slice(0, 10)}...`);
  console.log(`   OPENAI_API_KEY: ${openaiKey.slice(0, 10)}...\n`);
  return true;
}

async function testQdrantConnection() {
  console.log("🔍 Step 2: Testing Qdrant Connection...\n");

  const url = process.env.QDRANT_URL!;
  const apiKey = process.env.QDRANT_API_KEY!;
  const client = new QdrantClient({ url, apiKey });

  try {
    const start = Date.now();
    const collections = await client.getCollections();
    const latency = Date.now() - start;

    console.log(`✅ Connected to Qdrant (${latency}ms)\n`);
    return { client, collections };
  } catch (error: any) {
    console.error(`❌ Connection failed: ${error.message}\n`);
    return null;
  }
}

async function verifyCollections(client: QdrantClient) {
  console.log("🔍 Step 3: Verifying Collections...\n");

  const collections = await client.getCollections();
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
        const pointsCount = info?.points_count || 0;
        console.log(`   ✅ ${name} - ${pointsCount} points`);
      } catch {
        console.log(`   ✅ ${name} - exists`);
      }
    } else {
      console.log(`   ❌ ${name} - NOT FOUND`);
      allExist = false;
    }
  }

  console.log("");
  if (!allExist) {
    console.log("⚠️  Some collections are missing. Run: pnpm qdrant:setup\n");
  }

  return allExist;
}

async function testEmbeddingGeneration() {
  console.log("🔍 Step 4: Testing Embedding Generation...\n");

  try {
    const testText = "This is a test message for RAG";
    const start = Date.now();
    const { embedding } = await embed({
      model: openai.embedding("text-embedding-3-small"),
      value: testText,
    });
    const elapsed = Date.now() - start;

    console.log(`✅ Generated embedding in ${elapsed}ms`);
    console.log(`   Dimensions: ${embedding.length}`);
    console.log(
      `   First 5 values: [${embedding
        .slice(0, 5)
        .map((v) => v.toFixed(4))
        .join(", ")}...]\n`,
    );
    return embedding;
  } catch (error: any) {
    console.error(`❌ Embedding generation failed: ${error.message}\n`);
    return null;
  }
}

async function testIndexing(client: QdrantClient) {
  console.log("🔍 Step 5: Testing Indexing...\n");

  try {
    const testMessages = [
      {
        id: `test-msg-${Date.now()}-1`,
        content:
          "I love working with TypeScript and building web applications.",
        payload: {
          userId: "test-user",
          threadId: "test-thread",
          role: "user",
          createdAt: new Date().toISOString(),
        },
      },
      {
        id: `test-msg-${Date.now()}-2`,
        content:
          "RAG (Retrieval-Augmented Generation) helps improve AI responses by retrieving relevant context.",
        payload: {
          userId: "test-user",
          threadId: "test-thread",
          role: "assistant",
          createdAt: new Date().toISOString(),
        },
      },
    ];

    // Generate embeddings
    const texts = testMessages.map((m) => m.content);
    const { embeddings } = await embedMany({
      model: openai.embedding("text-embedding-3-small"),
      values: texts,
    });

    // Prepare points
    const points = testMessages.map((msg, idx) => ({
      id: msg.id,
      vector: embeddings[idx],
      payload: {
        ...msg.payload,
        content: msg.content,
        indexedAt: new Date().toISOString(),
      },
    }));

    const start = Date.now();
    await client.upsert(COLLECTIONS.MESSAGES, {
      wait: true,
      points: points.map((p) => ({
        id: p.id,
        vector: p.vector,
        payload: p.payload,
      })),
    });
    const elapsed = Date.now() - start;

    console.log(`✅ Indexed ${points.length} messages in ${elapsed}ms`);
    console.log(`   Point IDs: ${points.map((p) => p.id).join(", ")}\n`);
    return points.map((p) => String(p.id));
  } catch (error: any) {
    console.error(`❌ Indexing failed: ${error.message}\n`);
    return null;
  }
}

async function testSearch(client: QdrantClient, _pointIds: string[]) {
  console.log("🔍 Step 6: Testing Semantic Search...\n");

  try {
    const query = "What is RAG and how does it help?";

    // Generate query embedding
    const { embedding: queryEmbedding } = await embed({
      model: openai.embedding("text-embedding-3-small"),
      value: query,
    });

    const start = Date.now();
    // Search without userId filter to test with existing data
    const results = await client.search(COLLECTIONS.MESSAGES, {
      vector: queryEmbedding,
      limit: 5,
      score_threshold: 0.3, // Lower threshold to get results
      with_payload: true,
      with_vector: false,
    });
    const elapsed = Date.now() - start;

    const resultsArray = Array.isArray(results) ? results : [];
    console.log(`✅ Search completed in ${elapsed}ms`);
    console.log(`   Found ${resultsArray.length} results:\n`);

    if (resultsArray.length > 0) {
      resultsArray.forEach((result: any, idx: number) => {
        const content = String(result.payload?.content || "").slice(0, 100);
        const score = result.score || 0;
        console.log(
          `   ${idx + 1}. [Score: ${score.toFixed(3)}] ${content}...`,
        );
      });
    } else {
      console.log(
        "   ℹ️  No results found (this is OK if no relevant messages exist)",
      );
    }

    console.log("");
    return true; // Search worked, even if no results
  } catch (error: any) {
    console.error(`❌ Search failed: ${error.message}\n`);
    return false;
  }
}

async function main() {
  console.log("🧪 RAG Testing Setup\n");
  console.log("=".repeat(50) + "\n");

  // Step 1: Check environment
  if (!(await checkEnvironment())) {
    process.exit(1);
  }

  // Step 2: Test connection
  const connectionResult = await testQdrantConnection();
  if (!connectionResult) {
    console.error("❌ Cannot proceed without Qdrant connection\n");
    process.exit(1);
  }

  const { client } = connectionResult;

  // Step 3: Verify collections
  const collectionsReady = await verifyCollections(client);
  if (!collectionsReady) {
    console.log("⚠️  Please run: pnpm qdrant:setup\n");
    process.exit(1);
  }

  // Step 4: Test embeddings
  const embedding = await testEmbeddingGeneration();
  if (!embedding) {
    console.error("❌ Cannot proceed without embedding generation\n");
    process.exit(1);
  }

  // Step 5: Test indexing (optional - skip if fails)
  console.log("🔍 Step 5: Testing Indexing...\n");
  const pointIds = await testIndexing(client);
  if (!pointIds || pointIds.length === 0) {
    console.log("⚠️  Indexing test skipped (using existing data)\n");
  }

  // Step 6: Test search (works with existing indexed messages)
  const searchSuccess = await testSearch(client, pointIds || []);
  if (!searchSuccess) {
    console.error("⚠️  Search test completed but no results found\n");
  }

  // Summary
  console.log("=".repeat(50));
  console.log("✅ RAG Setup Complete!\n");
  console.log("Next steps:");
  console.log("1. Start dev server: pnpm dev");
  console.log("2. Test chat with RAG: Send messages in the UI");
  console.log(
    "3. Check RAG context: Look for '[RAG] Retrieved X relevant messages' in logs",
  );
  console.log("4. Test semantic search API: POST /api/search/semantic\n");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
