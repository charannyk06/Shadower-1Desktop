import "load-env";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "");

const subscriptionId = process.argv[2] || "sub_1Sme9xLvSUcVy8b36LxAFVvJ";

console.log(`\nFetching subscription directly: ${subscriptionId}\n`);

try {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);

  // In Stripe SDK v20+, period fields are on the item level
  const item = subscription.items.data[0];
  const periodStart = item?.current_period_start;
  const periodEnd = item?.current_period_end;

  console.log("━".repeat(60));
  console.log("  Subscription ID:       ", subscription.id);
  console.log("  Status:                ", subscription.status);
  console.log("  Cancel at Period End:  ", subscription.cancel_at_period_end);
  console.log(
    "  Cancel At:             ",
    subscription.cancel_at
      ? new Date(subscription.cancel_at * 1000).toISOString()
      : "(none)",
  );
  console.log(
    "  Canceled At:           ",
    subscription.canceled_at
      ? new Date(subscription.canceled_at * 1000).toISOString()
      : "(none)",
  );
  console.log(
    "  Current Period Start:  ",
    periodStart ? new Date(periodStart * 1000).toISOString() : "(none)",
  );
  console.log(
    "  Current Period End:    ",
    periodEnd ? new Date(periodEnd * 1000).toISOString() : "(none)",
  );
  console.log("  Customer:              ", subscription.customer);
  console.log("━".repeat(60));

  // Full object for debugging
  console.log("\nFull subscription object keys:", Object.keys(subscription));
  console.log(
    "\nRaw cancel_at_period_end value:",
    JSON.stringify(subscription.cancel_at_period_end),
  );
} catch (error: unknown) {
  const err = error as Error;
  console.error("Error:", err.message);
}

process.exit(0);
