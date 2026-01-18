#!/usr/bin/env npx tsx
/**
 * OpenMeter Setup Script
 *
 * This script creates the meters in OpenMeter for usage tracking.
 * Run with: npx tsx scripts/setup-openmeter.ts
 */

const OPENMETER_API_KEY = process.env.OPENMETER_API_KEY;
const OPENMETER_BASE_URL =
  process.env.OPENMETER_BASE_URL || "https://openmeter.cloud";

if (!OPENMETER_API_KEY) {
  console.error("❌ OPENMETER_API_KEY environment variable is required");
  process.exit(1);
}

interface MeterConfig {
  slug: string;
  description: string;
  aggregation: "SUM" | "COUNT" | "AVG" | "MIN" | "MAX";
  valueProperty?: string;
  groupBy?: string[];
}

const METERS: MeterConfig[] = [
  {
    slug: "llm_tokens",
    description: "LLM token usage across all providers",
    aggregation: "SUM",
    valueProperty: "$.totalTokens",
    groupBy: ["model", "provider"],
  },
  {
    slug: "image_generation",
    description: "Image generation count",
    aggregation: "SUM",
    valueProperty: "$.imageCount",
    groupBy: ["model", "provider"],
  },
  {
    slug: "sandbox_execution",
    description: "Code sandbox execution count",
    aggregation: "COUNT",
    groupBy: ["language"],
  },
  {
    slug: "voice_minutes",
    description: "Voice/realtime usage in minutes",
    aggregation: "SUM",
    valueProperty: "$.minutes",
    groupBy: ["model"],
  },
  {
    slug: "mcp_tool_call",
    description: "MCP tool call count",
    aggregation: "COUNT",
    groupBy: ["toolName"],
  },
  {
    slug: "workflow_execution",
    description: "Workflow execution count",
    aggregation: "COUNT",
    groupBy: ["workflowId"],
  },
  {
    slug: "composio_action",
    description: "Composio action execution count",
    aggregation: "COUNT",
    groupBy: ["actionName"],
  },
];

async function createMeter(meter: MeterConfig) {
  const response = await fetch(`${OPENMETER_BASE_URL}/api/v1/meters`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENMETER_API_KEY}`,
    },
    body: JSON.stringify({
      slug: meter.slug,
      description: meter.description,
      eventType: meter.slug,
      aggregation: meter.aggregation,
      ...(meter.aggregation !== "COUNT" && {
        valueProperty: meter.valueProperty || "$.value",
      }),
      groupBy: meter.groupBy
        ? Object.fromEntries(meter.groupBy.map((g) => [g, `$.${g}`]))
        : {},
      windowSize: "HOUR",
    }),
  });

  if (response.status === 409) {
    console.log(`✓ Meter '${meter.slug}' already exists`);
    return true;
  }

  if (!response.ok) {
    const error = await response.text();
    console.error(`❌ Failed to create meter '${meter.slug}':`, error);
    return false;
  }

  console.log(`✓ Created meter '${meter.slug}'`);
  return true;
}

async function listMeters() {
  const response = await fetch(`${OPENMETER_BASE_URL}/api/v1/meters`, {
    headers: {
      Authorization: `Bearer ${OPENMETER_API_KEY}`,
    },
  });

  if (!response.ok) {
    console.error("❌ Failed to list meters:", await response.text());
    return [];
  }

  return response.json();
}

console.log("🚀 Setting up OpenMeter meters...\n");

try {
  // First, list existing meters
  const existingMeters = await listMeters();
  const existingSlugs = new Set(
    existingMeters.map((m: { slug: string }) => m.slug),
  );

  console.log(`Found ${existingMeters.length} existing meters\n`);

  let created = 0;
  let skipped = 0;

  for (const meter of METERS) {
    if (existingSlugs.has(meter.slug)) {
      console.log(`✓ Meter '${meter.slug}' already exists`);
      skipped++;
    } else {
      const success = await createMeter(meter);
      if (success) created++;
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log(`✅ OpenMeter setup complete!`);
  console.log(`   Created: ${created}, Already existed: ${skipped}`);
  console.log("=".repeat(60));

  console.log("\n📊 Your meters are now tracking:");
  for (const meter of METERS) {
    console.log(`   - ${meter.slug}: ${meter.description}`);
  }

  console.log("\n📌 View your usage at: https://openmeter.cloud/meters");
} catch (error) {
  console.error("Setup failed:", error);
  process.exit(1);
}

// Make this file a module for top-level await support
export type { MeterConfig };
