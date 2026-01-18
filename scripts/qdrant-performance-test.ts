#!/usr/bin/env tsx

/**
 * Qdrant Performance Test Suite
 *
 * Tests:
 * 1. Connection latency
 * 2. Collection creation speed
 * 3. Embedding generation speed
 * 4. Batch upsert throughput
 * 5. Search latency (cold & warm)
 * 6. Cache hit performance
 *
 * Run: pnpm qdrant:perf-test
 */

import { openai } from "@ai-sdk/openai";
import { QdrantClient } from "@qdrant/js-client-rest";
import { embed, embedMany } from "ai";
import { config } from "dotenv";

config();

const TEST_COLLECTION = "performance_test";
const VECTOR_SIZE = 1536;

interface TestResult {
  name: string;
  latencyMs: number;
  throughput?: number;
  status: "pass" | "fail";
  details?: string;
}

const results: TestResult[] = [];

function getClient(): QdrantClient {
  const url = process.env.QDRANT_URL;
  const apiKey = process.env.QDRANT_API_KEY;

  if (!url) {
    console.error("❌ QDRANT_URL must be set");
    process.exit(1);
  }

  return new QdrantClient({
    url,
    apiKey: apiKey || undefined,
    timeout: 5000,
  });
}

async function testConnectionLatency(client: QdrantClient): Promise<void> {
  console.log("\n🔌 Testing Connection Latency...");

  const iterations = 5;
  const latencies: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await client.getCollections();
    latencies.push(performance.now() - start);
  }

  const avgLatency = Math.round(
    latencies.reduce((a, b) => a + b, 0) / iterations,
  );
  const minLatency = Math.round(Math.min(...latencies));
  const maxLatency = Math.round(Math.max(...latencies));

  console.log(
    `   Average: ${avgLatency}ms | Min: ${minLatency}ms | Max: ${maxLatency}ms`,
  );

  results.push({
    name: "Connection Latency",
    latencyMs: avgLatency,
    status: avgLatency < 100 ? "pass" : "fail",
    details: `Min: ${minLatency}ms, Max: ${maxLatency}ms`,
  });
}

async function testCollectionCreation(client: QdrantClient): Promise<void> {
  console.log("\n📦 Testing Collection Creation...");

  // Delete if exists
  try {
    await client.deleteCollection(TEST_COLLECTION);
  } catch {}

  const start = performance.now();
  await client.createCollection(TEST_COLLECTION, {
    vectors: {
      size: VECTOR_SIZE,
      distance: "Cosine",
      on_disk: false,
    },
    hnsw_config: {
      m: 32,
      ef_construction: 200,
    },
    optimizers_config: {
      indexing_threshold: 10000,
    },
  });
  const latency = Math.round(performance.now() - start);

  console.log(`   Collection created in ${latency}ms`);

  results.push({
    name: "Collection Creation",
    latencyMs: latency,
    status: latency < 500 ? "pass" : "fail",
  });
}

async function testEmbeddingGeneration(): Promise<number[]> {
  console.log("\n🧠 Testing Embedding Generation...");

  const testText =
    "This is a test sentence for measuring embedding generation performance.";

  // Single embedding
  const singleStart = performance.now();
  const { embedding } = await embed({
    model: openai.embedding("text-embedding-3-small"),
    value: testText,
  });
  const singleLatency = Math.round(performance.now() - singleStart);
  console.log(`   Single embedding: ${singleLatency}ms`);

  // Batch embeddings
  const batchTexts = Array(10)
    .fill(null)
    .map(
      (_, i) =>
        `Test sentence number ${i + 1} for batch embedding performance testing.`,
    );

  const batchStart = performance.now();
  await embedMany({
    model: openai.embedding("text-embedding-3-small"),
    values: batchTexts,
  });
  const batchLatency = Math.round(performance.now() - batchStart);
  const perEmbedding = Math.round(batchLatency / 10);
  console.log(
    `   Batch (10 embeddings): ${batchLatency}ms (${perEmbedding}ms/each)`,
  );

  results.push({
    name: "Single Embedding",
    latencyMs: singleLatency,
    status: singleLatency < 500 ? "pass" : "fail",
  });

  results.push({
    name: "Batch Embedding (10)",
    latencyMs: batchLatency,
    throughput: 10000 / batchLatency,
    status: batchLatency < 2000 ? "pass" : "fail",
    details: `${perEmbedding}ms per embedding`,
  });

  return embedding;
}

async function testUpsertPerformance(
  client: QdrantClient,
  baseVector: number[],
): Promise<void> {
  console.log("\n⬆️  Testing Upsert Performance...");

  // Generate test vectors (slight variations of base)
  const generateVector = (seed: number): number[] => {
    return baseVector.map((v, i) => v + Math.sin(seed + i) * 0.01);
  };

  // Test single upsert
  const singleStart = performance.now();
  await client.upsert(TEST_COLLECTION, {
    wait: true,
    points: [
      {
        id: "single-test",
        vector: baseVector,
        payload: { test: true },
      },
    ],
  });
  const singleLatency = Math.round(performance.now() - singleStart);
  console.log(`   Single upsert: ${singleLatency}ms`);

  // Test batch upsert (100 points)
  const batchPoints = Array(100)
    .fill(null)
    .map((_, i) => ({
      id: `batch-${i}`,
      vector: generateVector(i),
      payload: { index: i, test: true },
    }));

  const batchStart = performance.now();
  await client.upsert(TEST_COLLECTION, {
    wait: true,
    points: batchPoints,
  });
  const batchLatency = Math.round(performance.now() - batchStart);
  const throughput = Math.round((100 / batchLatency) * 1000);
  console.log(
    `   Batch upsert (100 points): ${batchLatency}ms (${throughput} points/sec)`,
  );

  results.push({
    name: "Single Upsert",
    latencyMs: singleLatency,
    status: singleLatency < 50 ? "pass" : "fail",
  });

  results.push({
    name: "Batch Upsert (100)",
    latencyMs: batchLatency,
    throughput,
    status: throughput > 500 ? "pass" : "fail",
    details: `${throughput} points/sec`,
  });
}

async function testSearchPerformance(
  client: QdrantClient,
  queryVector: number[],
): Promise<void> {
  console.log("\n🔍 Testing Search Performance...");

  // Cold search (first query)
  const coldStart = performance.now();
  await client.search(TEST_COLLECTION, {
    vector: queryVector,
    limit: 10,
    score_threshold: 0.5,
    with_payload: true,
  });
  const coldLatency = Math.round(performance.now() - coldStart);
  console.log(`   Cold search: ${coldLatency}ms`);

  // Warm search (subsequent queries)
  const warmLatencies: number[] = [];
  for (let i = 0; i < 10; i++) {
    const start = performance.now();
    await client.search(TEST_COLLECTION, {
      vector: queryVector,
      limit: 10,
      score_threshold: 0.5,
      with_payload: true,
    });
    warmLatencies.push(performance.now() - start);
  }
  const avgWarmLatency = Math.round(
    warmLatencies.reduce((a, b) => a + b, 0) / 10,
  );
  const minWarmLatency = Math.round(Math.min(...warmLatencies));
  console.log(
    `   Warm search (avg of 10): ${avgWarmLatency}ms | Min: ${minWarmLatency}ms`,
  );

  // Search with filter
  const filterStart = performance.now();
  await client.search(TEST_COLLECTION, {
    vector: queryVector,
    limit: 10,
    filter: {
      must: [{ key: "test", match: { value: true } }],
    },
    with_payload: true,
  });
  const filterLatency = Math.round(performance.now() - filterStart);
  console.log(`   Filtered search: ${filterLatency}ms`);

  results.push({
    name: "Cold Search",
    latencyMs: coldLatency,
    status: coldLatency < 50 ? "pass" : "fail",
  });

  results.push({
    name: "Warm Search (avg)",
    latencyMs: avgWarmLatency,
    status: avgWarmLatency < 20 ? "pass" : "fail",
    details: `Min: ${minWarmLatency}ms`,
  });

  results.push({
    name: "Filtered Search",
    latencyMs: filterLatency,
    status: filterLatency < 50 ? "pass" : "fail",
  });
}

async function cleanup(client: QdrantClient): Promise<void> {
  console.log("\n🧹 Cleaning up...");
  try {
    await client.deleteCollection(TEST_COLLECTION);
    console.log(`   Deleted test collection: ${TEST_COLLECTION}`);
  } catch {}
}

function printSummary(): void {
  console.log("\n" + "=".repeat(60));
  console.log("📊 PERFORMANCE TEST SUMMARY");
  console.log("=".repeat(60));

  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;

  console.log(`\n${passed}/${results.length} tests passed\n`);

  for (const result of results) {
    const icon = result.status === "pass" ? "✅" : "❌";
    let line = `${icon} ${result.name}: ${result.latencyMs}ms`;
    if (result.throughput) {
      line += ` (${result.throughput.toFixed(1)} ops/sec)`;
    }
    if (result.details) {
      line += ` - ${result.details}`;
    }
    console.log(line);
  }

  console.log("\n" + "=".repeat(60));

  // Performance targets
  console.log("\n📈 PERFORMANCE TARGETS:");
  console.log("   Connection Latency: < 100ms");
  console.log("   Collection Creation: < 500ms");
  console.log("   Single Embedding: < 500ms");
  console.log("   Batch Upsert: > 500 points/sec");
  console.log("   Cold Search: < 50ms");
  console.log("   Warm Search: < 20ms");

  if (failed > 0) {
    console.log(`\n⚠️  ${failed} test(s) did not meet performance targets`);
    process.exit(1);
  } else {
    console.log("\n🎉 All tests passed! Your Qdrant setup is blazing fast!");
  }
}

async function main(): Promise<void> {
  console.log("🚀 Qdrant Performance Test Suite");
  console.log("=".repeat(60));

  const url = process.env.QDRANT_URL;
  console.log(`\nTarget: ${url}`);
  console.log(`Embedding Model: text-embedding-3-small`);
  console.log(`Vector Size: ${VECTOR_SIZE}`);

  const client = getClient();

  try {
    await testConnectionLatency(client);
    await testCollectionCreation(client);
    const embedding = await testEmbeddingGeneration();
    await testUpsertPerformance(client, embedding);
    await testSearchPerformance(client, embedding);
    await cleanup(client);
    printSummary();
  } catch (error) {
    console.error("\n❌ Test failed:", error);
    await cleanup(client);
    process.exit(1);
  }
}

main();
