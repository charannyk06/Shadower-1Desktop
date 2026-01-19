import { getMonthlyPrice } from "./pricing";

/**
 * OpenMeter Meters Configuration
 *
 * This file documents the meters that need to be created in OpenMeter dashboard.
 * Each meter tracks a specific type of billable usage.
 *
 * To set up in OpenMeter (https://openmeter.cloud):
 * 1. Go to Meters section
 * 2. Create each meter with the configuration below
 * 3. Set up aggregation windows as needed (hourly/daily/monthly)
 */

export const OPENMETER_METERS = {
  /**
   * LLM Token Usage
   * Tracks total tokens consumed across all LLM providers
   */
  llm_tokens: {
    slug: "llm_tokens",
    description: "LLM token usage across all providers",
    aggregation: "SUM",
    valueProperty: "$.totalTokens",
    groupBy: ["model", "provider"],
  },

  /**
   * Image Generation
   * Tracks number of images generated
   */
  image_generation: {
    slug: "image_generation",
    description: "Image generation count",
    aggregation: "SUM",
    valueProperty: "$.imageCount",
    groupBy: ["model", "provider"],
  },

  /**
   * Local Execution
   * Tracks local code execution (free - runs on user's machine)
   */
  local_execution: {
    slug: "local_execution",
    description: "Local code execution count (free)",
    aggregation: "COUNT",
    groupBy: ["language"],
  },

  /**
   * Voice Minutes
   * Tracks voice/realtime usage in minutes
   */
  voice_minutes: {
    slug: "voice_minutes",
    description: "Voice/realtime usage in minutes",
    aggregation: "SUM",
    valueProperty: "$.minutes",
    groupBy: ["model"],
  },

  /**
   * MCP Tool Calls
   * Tracks MCP server tool invocations
   */
  mcp_tool_call: {
    slug: "mcp_tool_call",
    description: "MCP tool call count",
    aggregation: "COUNT",
    groupBy: ["toolName"],
  },

  /**
   * Workflow Execution
   * Tracks workflow runs
   */
  workflow_execution: {
    slug: "workflow_execution",
    description: "Workflow execution count",
    aggregation: "COUNT",
    groupBy: ["workflowId"],
  },
} as const;

/**
 * Stripe Products Configuration
 *
 * Create these products and prices in Stripe Dashboard.
 * Prices are defined in lib/billing/pricing.ts (source of truth).
 *
 * 1. Pro Plan
 *    - Product name: "Pro"
 *    - Price: See SUBSCRIPTION_PRICES.pro.monthly in pricing.ts
 *    - Add price ID to STRIPE_PRICE_PRO_MONTHLY env var
 *
 * 2. Ultra Plan
 *    - Product name: "Ultra"
 *    - Price: See SUBSCRIPTION_PRICES.ultra.monthly in pricing.ts
 *    - Add price ID to STRIPE_PRICE_ULTRA_MONTHLY env var
 */
export const STRIPE_PRODUCTS = {
  pro: {
    name: "Pro",
    description: "Pro subscription tier",
    price: getMonthlyPrice("pro"),
    interval: "month",
  },
  ultra: {
    name: "Ultra",
    description: "Ultra subscription tier",
    price: getMonthlyPrice("ultra"),
    interval: "month",
  },
} as const;
