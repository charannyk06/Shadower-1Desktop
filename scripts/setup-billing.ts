#!/usr/bin/env npx tsx
/**
 * Billing Setup Script
 *
 * This script sets up Stripe products and prices for billing.
 *
 * For TEST mode (local development):
 *   STRIPE_SECRET_KEY=sk_test_xxx npx tsx scripts/setup-billing.ts
 *
 * For LIVE mode (production):
 *   STRIPE_SECRET_KEY=sk_live_xxx npx tsx scripts/setup-billing.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import Stripe from "stripe";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

function isTestMode(key: string): boolean {
  return key.startsWith("sk_test_");
}

function isLiveMode(key: string): boolean {
  return key.startsWith("sk_live_");
}

async function promptForKey(): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("\n📋 To get your Stripe secret key:");
  console.log("   TEST mode: https://dashboard.stripe.com/test/apikeys");
  console.log("   LIVE mode: https://dashboard.stripe.com/apikeys\n");

  return new Promise((resolve) => {
    rl.question("Enter your Stripe secret key: ", (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function promptYesNo(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

async function findOrCreateProduct(
  stripe: Stripe,
  existingProducts: Stripe.Product[],
  name: string,
  description: string,
  tier: string,
): Promise<string> {
  const existing = existingProducts.find((p) => p.name === name);
  if (existing) {
    console.log(`   ✓ ${name} product exists:`, existing.id);
    return existing.id;
  }

  const newProduct = await stripe.products.create({
    name,
    description,
    metadata: { tier },
  });
  console.log(`   ✓ Created ${name} product:`, newProduct.id);
  return newProduct.id;
}

async function findOrCreatePrice(
  stripe: Stripe,
  existingPrices: Stripe.Price[],
  productId: string,
  amount: number,
  tier: string,
): Promise<string> {
  const existing = existingPrices.find(
    (p) =>
      p.product === productId &&
      p.unit_amount === amount &&
      p.recurring?.interval === "month",
  );

  if (existing) {
    console.log(`   ✓ ${tier} price exists:`, existing.id);
    return existing.id;
  }

  const newPrice = await stripe.prices.create({
    product: productId,
    unit_amount: amount,
    currency: "usd",
    recurring: { interval: "month" },
    metadata: { tier },
  });
  console.log(
    `   ✓ Created ${tier} price:`,
    newPrice.id,
    `($${(amount / 100).toFixed(2)}/month)`,
  );
  return newPrice.id;
}

async function updateEnvFile(
  secretKey: string,
  proPriceId: string,
  ultraPriceId: string,
) {
  const envPath = path.join(process.cwd(), ".env");

  if (!fs.existsSync(envPath)) {
    console.log("\n❌ .env file not found");
    return;
  }

  let envContent = fs.readFileSync(envPath, "utf-8");

  const updates: Record<string, string> = {
    STRIPE_SECRET_KEY: secretKey,
    STRIPE_PRICE_PRO_MONTHLY: proPriceId,
    STRIPE_PRICE_ULTRA_MONTHLY: ultraPriceId,
  };

  for (const [key, value] of Object.entries(updates)) {
    const regex = new RegExp(`^${key}=.*$`, "m");
    if (regex.test(envContent)) {
      envContent = envContent.replace(regex, `${key}=${value}`);
    }
  }

  fs.writeFileSync(envPath, envContent);
  console.log("\n✅ Updated .env file!");
}

function printNextSteps(isTest: boolean) {
  console.log("\n" + "=".repeat(60));
  console.log("📌 NEXT STEPS:");
  console.log("=".repeat(60));

  if (isTest) {
    console.log("\n1. Get your TEST publishable key from:");
    console.log("   https://dashboard.stripe.com/test/apikeys\n");
    console.log("2. For webhook testing locally, run:");
    console.log(
      "   stripe listen --forward-to localhost:3000/api/billing/webhook\n",
    );
    console.log("3. Use test card: 4242 4242 4242 4242");
    console.log("   Any future expiry date, any 3-digit CVC\n");
  } else {
    console.log("\n1. Create a webhook in Stripe Dashboard pointing to:");
    console.log("   https://your-domain.com/api/billing/webhook\n");
    console.log("   Events to listen for:");
    console.log("   - checkout.session.completed");
    console.log("   - customer.subscription.created");
    console.log("   - customer.subscription.updated");
    console.log("   - customer.subscription.deleted");
    console.log("   - invoice.payment_failed\n");
  }

  console.log("🎉 Done!\n");
}

// Main script
console.log("🚀 Stripe Billing Setup Script\n");

let secretKey = STRIPE_SECRET_KEY;

if (!secretKey) {
  secretKey = await promptForKey();
}

if (!secretKey) {
  console.error("❌ Stripe secret key is required");
  process.exit(1);
}

if (!isTestMode(secretKey) && !isLiveMode(secretKey)) {
  console.error("❌ Invalid key format. Must start with sk_test_ or sk_live_");
  process.exit(1);
}

const mode = isTestMode(secretKey) ? "TEST" : "LIVE";
console.log(`📌 Running in ${mode} mode\n`);

if (isLiveMode(secretKey)) {
  console.log("⚠️  WARNING: You are using LIVE keys!");
  console.log(
    "   This will create real products in your production account.\n",
  );
  const proceed = await promptYesNo("Continue? (y/n): ");
  if (!proceed) {
    console.log("Aborted.");
    process.exit(0);
  }
}

const stripe = new Stripe(secretKey);

try {
  // Check for existing products
  console.log("🔍 Checking for existing products...\n");
  const existingProducts = await stripe.products.list({ limit: 100 });

  const proProductId = await findOrCreateProduct(
    stripe,
    existingProducts.data,
    "Pro",
    "Pro subscription tier - 2M tokens/month, 100 images, 200 sandbox runs",
    "pro",
  );

  const ultraProductId = await findOrCreateProduct(
    stripe,
    existingProducts.data,
    "Ultra",
    "Ultra subscription tier - 10M tokens/month, 500 images, 1000 sandbox runs",
    "ultra",
  );

  // Get existing prices
  console.log("\n🔍 Checking for existing prices...\n");
  const existingPrices = await stripe.prices.list({
    limit: 100,
    active: true,
  });

  const proPriceId = await findOrCreatePrice(
    stripe,
    existingPrices.data,
    proProductId,
    1999,
    "Pro",
  );

  const ultraPriceId = await findOrCreatePrice(
    stripe,
    existingPrices.data,
    ultraProductId,
    4999,
    "Ultra",
  );

  console.log("\n" + "=".repeat(60));
  console.log(`✅ Stripe ${mode} mode setup complete!`);
  console.log("=".repeat(60));

  console.log("\n📝 Environment variables:\n");
  console.log(`STRIPE_SECRET_KEY=${secretKey}`);
  console.log(`STRIPE_PRICE_PRO_MONTHLY=${proPriceId}`);
  console.log(`STRIPE_PRICE_ULTRA_MONTHLY=${ultraPriceId}`);

  // Auto-update .env for test mode
  if (isTestMode(secretKey)) {
    console.log("\n");
    const updateEnv = await promptYesNo(
      "Update local .env with these values? (y/n): ",
    );

    if (updateEnv) {
      await updateEnvFile(secretKey, proPriceId, ultraPriceId);
    }
  }

  printNextSteps(isTestMode(secretKey));
} catch (error: unknown) {
  const err = error as Error;
  console.error("❌ Error:", err.message);
  process.exit(1);
}
