#!/usr/bin/env tsx
/**
 * Script to upgrade a user to a specific tier
 *
 * Usage:
 *   pnpm tsx scripts/upgrade-user.ts <email> <tier>
 *
 * Example:
 *   pnpm tsx scripts/upgrade-user.ts admin@test-seed.local ultra
 */

import "load-env";
import { eq } from "drizzle-orm";
import { pgDb as db } from "../src/lib/db/pg/db.pg";
import { UserTable } from "../src/lib/db/pg/schema.pg";
import { subscriptionRepository } from "../src/lib/db/repository";

const email = process.argv[2];
const tier = process.argv[3] as "free" | "pro" | "ultra";

if (!email || !tier) {
  console.error("Usage: pnpm tsx scripts/upgrade-user.ts <email> <tier>");
  console.error(
    "Example: pnpm tsx scripts/upgrade-user.ts admin@test-seed.local ultra",
  );
  console.error("\nValid tiers: free, pro, ultra");
  process.exit(1);
}

if (!["free", "pro", "ultra"].includes(tier)) {
  console.error(`Invalid tier: ${tier}. Must be 'free', 'pro', or 'ultra'.`);
  process.exit(1);
}

async function upgradeUser() {
  console.log(`🔍 Looking up user: ${email}`);

  // Find user by email
  const [user] = await db
    .select()
    .from(UserTable)
    .where(eq(UserTable.email, email))
    .limit(1);

  if (!user) {
    console.error(`❌ User not found: ${email}`);
    process.exit(1);
  }

  console.log(`✅ Found user: ${user.name} (${user.id})`);

  // Get or create subscription
  let subscription = await subscriptionRepository.getByUserId(user.id);

  if (!subscription) {
    console.log(`📝 Creating new subscription record...`);
    subscription = await subscriptionRepository.upsert({
      userId: user.id,
      tier,
      status: "active",
    });
    console.log(`✅ Created subscription with tier: ${tier}`);
  } else {
    console.log(`📊 Current tier: ${subscription.tier}`);

    if (subscription.tier === tier) {
      console.log(`✅ User is already on ${tier} tier`);
      return;
    }

    console.log(`⬆️  Upgrading from ${subscription.tier} to ${tier}...`);
    subscription = await subscriptionRepository.upsert({
      userId: user.id,
      tier,
      status: "active",
    });
    console.log(`✅ Successfully upgraded to ${tier} tier`);
  }

  console.log(`\n🎉 User ${user.name} is now on ${tier} tier!`);
  console.log(`\n📝 Note: Refresh your browser to see the updated tier.`);
}

upgradeUser()
  .then(() => {
    console.log("\n✅ Done!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Error:", error);
    process.exit(1);
  });
