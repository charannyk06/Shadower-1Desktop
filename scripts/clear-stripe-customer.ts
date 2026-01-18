import "load-env";
import { eq } from "drizzle-orm";
import { pgDb as db } from "lib/db/pg/db.pg";
import { SubscriptionTable } from "lib/db/pg/schema.pg";

const userId = process.argv[2];

if (!userId) {
  console.error("Usage: npx tsx scripts/clear-stripe-customer.ts <userId>");
  process.exit(1);
}

console.log(`Clearing Stripe customer ID for user: ${userId}`);

try {
  const [result] = await db
    .update(SubscriptionTable)
    .set({
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      updatedAt: new Date(),
    })
    .where(eq(SubscriptionTable.userId, userId))
    .returning();

  if (!result) {
    console.error("User subscription not found!");
    process.exit(1);
  }

  console.log(
    "Stripe customer ID cleared! A new test-mode customer will be created on next checkout.",
  );
  process.exit(0);
} catch (error: unknown) {
  const err = error as Error;
  console.error("Failed:", err.message);
  process.exit(1);
}
