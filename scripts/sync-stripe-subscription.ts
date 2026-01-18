import "load-env";
import { eq } from "drizzle-orm";
import { pgDb as db } from "lib/db/pg/db.pg";
import { SubscriptionTable } from "lib/db/pg/schema.pg";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "");

function getTierFromPriceId(priceId: string): "free" | "pro" | "ultra" {
  if (priceId === process.env.STRIPE_PRICE_PRO_MONTHLY) return "pro";
  if (priceId === process.env.STRIPE_PRICE_ULTRA_MONTHLY) return "ultra";
  return "free";
}

const userId = process.argv[2];

if (!userId) {
  console.error("Usage: npx tsx scripts/sync-stripe-subscription.ts <userId>");
  process.exit(1);
}

console.log(`\nSyncing Stripe subscription for user: ${userId}\n`);

try {
  // Get current subscription from DB
  const [existing] = await db
    .select()
    .from(SubscriptionTable)
    .where(eq(SubscriptionTable.userId, userId));

  if (!existing) {
    console.error("No subscription found for this user!");
    process.exit(1);
  }

  if (!existing.stripeCustomerId) {
    console.error("No Stripe customer ID found!");
    process.exit(1);
  }

  console.log("Stripe Customer ID:", existing.stripeCustomerId);

  // Fetch subscriptions from Stripe
  const subscriptions = await stripe.subscriptions.list({
    customer: existing.stripeCustomerId,
    status: "all",
    limit: 10,
  });

  console.log(
    `\nFound ${subscriptions.data.length} subscription(s) in Stripe:\n`,
  );

  for (const sub of subscriptions.data) {
    // In Stripe SDK v20+, period fields are on the item level
    const item = sub.items.data[0];
    const priceId = item?.price?.id;
    const periodStart = item?.current_period_start;
    const periodEnd = item?.current_period_end;
    console.log("━".repeat(50));
    console.log("  Subscription ID:      ", sub.id);
    console.log("  Status:               ", sub.status);
    console.log("  Cancel at Period End: ", sub.cancel_at_period_end);
    console.log(
      "  Cancel At:            ",
      sub.cancel_at ? new Date(sub.cancel_at * 1000).toISOString() : "(none)",
    );
    console.log("  Price ID:             ", priceId);
    console.log(
      "  Created:              ",
      sub.created ? new Date(sub.created * 1000).toISOString() : "(none)",
    );
    console.log(
      "  Period Start:         ",
      periodStart ? new Date(periodStart * 1000).toISOString() : "(none)",
    );
    console.log(
      "  Period End:           ",
      periodEnd ? new Date(periodEnd * 1000).toISOString() : "(none)",
    );
    console.log("━".repeat(50));
  }

  // Find the active subscription
  const activeSub = subscriptions.data.find(
    (s) => s.status === "active" || s.status === "trialing",
  );

  if (!activeSub) {
    console.log("\nNo active subscription found in Stripe.");
    process.exit(0);
  }

  const priceId = activeSub.items.data[0]?.price?.id;
  const tier = getTierFromPriceId(priceId || "");

  console.log(`\nUpdating local DB with active subscription...`);
  console.log(`  Subscription ID: ${activeSub.id}`);
  console.log(`  Price ID: ${priceId}`);
  console.log(`  Tier: ${tier}`);

  const updateData: Record<string, unknown> = {
    stripeSubscriptionId: activeSub.id,
    stripePriceId: priceId,
    tier: tier,
    status: activeSub.status,
    cancelAtPeriodEnd: activeSub.cancel_at_period_end,
    cancelAt: activeSub.cancel_at ? new Date(activeSub.cancel_at * 1000) : null,
    updatedAt: new Date(),
  };

  // In Stripe SDK v20+, period fields are on the item level
  const activeItem = activeSub.items.data[0];
  const activePeriodStart = activeItem?.current_period_start;
  const activePeriodEnd = activeItem?.current_period_end;

  if (activePeriodStart) {
    updateData.currentPeriodStart = new Date(activePeriodStart * 1000);
  }
  if (activePeriodEnd) {
    updateData.currentPeriodEnd = new Date(activePeriodEnd * 1000);
  }

  const [result] = await db
    .update(SubscriptionTable)
    .set(updateData)
    .where(eq(SubscriptionTable.userId, userId))
    .returning();

  console.log("\n✓ Subscription synced successfully!");
  console.log("━".repeat(50));
  console.log("  Tier:                  ", result.tier);
  console.log("  Status:                ", result.status);
  console.log("  Cancel at Period End:  ", result.cancelAtPeriodEnd);
  console.log("  Cancel At:             ", result.cancelAt);
  console.log("  Stripe Subscription ID:", result.stripeSubscriptionId);
  console.log("  Period End:            ", result.currentPeriodEnd);
  console.log("━".repeat(50));

  process.exit(0);
} catch (error: unknown) {
  const err = error as Error;
  console.error("Failed to sync subscription:", err.message);
  process.exit(1);
}
