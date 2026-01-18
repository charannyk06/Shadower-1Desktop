import "load-env";
import { eq } from "drizzle-orm";
import { pgDb as db } from "lib/db/pg/db.pg";
import { SubscriptionTable } from "lib/db/pg/schema.pg";

const userId = process.argv[2];
const newTier = process.argv[3] as "free" | "pro" | "ultra";

if (!userId) {
  console.error("Usage: npx tsx scripts/fix-subscription.ts <userId> [tier]");
  console.error("Example: npx tsx scripts/fix-subscription.ts abc-123 pro");
  console.error(
    "\nThis script shows current subscription state and optionally updates the tier.",
  );
  process.exit(1);
}

console.log(`\nLooking up subscription for user: ${userId}\n`);

try {
  // Get current subscription
  const [existing] = await db
    .select()
    .from(SubscriptionTable)
    .where(eq(SubscriptionTable.userId, userId));

  if (!existing) {
    console.error("No subscription found for this user!");
    process.exit(1);
  }

  console.log("Current subscription state:");
  console.log("━".repeat(50));
  console.log("  User ID:              ", existing.userId);
  console.log("  Tier:                 ", existing.tier);
  console.log("  Status:               ", existing.status);
  console.log(
    "  Stripe Customer ID:   ",
    existing.stripeCustomerId || "(none)",
  );
  console.log(
    "  Stripe Subscription ID:",
    existing.stripeSubscriptionId || "(none)",
  );
  console.log("  Stripe Price ID:      ", existing.stripePriceId || "(none)");
  console.log("  Purchased Tokens:     ", existing.purchasedTokens || "0");
  console.log(
    "  Current Period Start: ",
    existing.currentPeriodStart || "(none)",
  );
  console.log(
    "  Current Period End:   ",
    existing.currentPeriodEnd || "(none)",
  );
  console.log("  Cancel at Period End: ", existing.cancelAtPeriodEnd || false);
  console.log("  Updated At:           ", existing.updatedAt);
  console.log("━".repeat(50));

  if (!newTier) {
    console.log("\nNo tier specified. To update, run:");
    console.log(`  npx tsx scripts/fix-subscription.ts ${userId} pro`);
    process.exit(0);
  }

  if (!["free", "pro", "ultra"].includes(newTier)) {
    console.error(
      `\nInvalid tier: ${newTier}. Must be 'free', 'pro', or 'ultra'.`,
    );
    process.exit(1);
  }

  if (existing.tier === newTier) {
    console.log(
      `\nSubscription is already set to ${newTier}. No changes needed.`,
    );
    process.exit(0);
  }

  console.log(`\nUpdating tier from "${existing.tier}" to "${newTier}"...`);

  const [result] = await db
    .update(SubscriptionTable)
    .set({
      tier: newTier,
      status: "active",
      updatedAt: new Date(),
    })
    .where(eq(SubscriptionTable.userId, userId))
    .returning();

  console.log("\n✓ Subscription updated successfully!");
  console.log("━".repeat(50));
  console.log("  New Tier:   ", result.tier);
  console.log("  New Status: ", result.status);
  console.log("  Updated At: ", result.updatedAt);
  console.log("━".repeat(50));

  process.exit(0);
} catch (error: unknown) {
  const err = error as Error;
  console.error("Failed to fix subscription:", err.message);
  process.exit(1);
}
