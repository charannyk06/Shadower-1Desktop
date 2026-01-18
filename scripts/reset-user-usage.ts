#!/usr/bin/env tsx
/**
 * Script to reset monthly credits usage for a specific user
 *
 * Usage:
 *   pnpm tsx scripts/reset-user-usage.ts <email>
 *
 * Example:
 *   pnpm tsx scripts/reset-user-usage.ts admin@test-seed.local
 */

import "load-env";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { getMonthBoundaries } from "../src/lib/billing/date-utils";
import { pgDb as db } from "../src/lib/db/pg/db.pg";
import {
  SubscriptionTable,
  UsageAlertTable,
  UsageEventTable,
  UserTable,
} from "../src/lib/db/pg/schema.pg";

async function resetUserUsage(email: string) {
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

  // Get current month boundaries
  const { start: monthStart, end: monthEnd } = getMonthBoundaries();
  console.log(
    `📅 Resetting usage for period: ${monthStart.toISOString()} to ${monthEnd.toISOString()}`,
  );

  // Count events before deletion
  const eventsBefore = await db
    .select({ count: sql<number>`count(*)` })
    .from(UsageEventTable)
    .where(
      and(
        eq(UsageEventTable.userId, user.id),
        gte(UsageEventTable.createdAt, monthStart),
        lte(UsageEventTable.createdAt, monthEnd),
      ),
    );
  const eventCount = Number(eventsBefore[0]?.count || 0);

  // Count alerts before deletion
  const alertsBefore = await db
    .select({ count: sql<number>`count(*)` })
    .from(UsageAlertTable)
    .where(
      and(
        eq(UsageAlertTable.userId, user.id),
        gte(UsageAlertTable.periodStart, monthStart),
        lte(UsageAlertTable.periodEnd, monthEnd),
      ),
    );
  const alertCount = Number(alertsBefore[0]?.count || 0);

  console.log(`📊 Found ${eventCount} usage events and ${alertCount} alerts`);

  if (eventCount === 0 && alertCount === 0) {
    console.log(`✅ No usage data to reset for this period`);
    return;
  }

  // Delete usage events
  if (eventCount > 0) {
    await db
      .delete(UsageEventTable)
      .where(
        and(
          eq(UsageEventTable.userId, user.id),
          gte(UsageEventTable.createdAt, monthStart),
          lte(UsageEventTable.createdAt, monthEnd),
        ),
      );
    console.log(`✅ Deleted ${eventCount} usage events`);
  }

  // Delete usage alerts
  if (alertCount > 0) {
    await db
      .delete(UsageAlertTable)
      .where(
        and(
          eq(UsageAlertTable.userId, user.id),
          gte(UsageAlertTable.periodStart, monthStart),
          lte(UsageAlertTable.periodEnd, monthEnd),
        ),
      );
    console.log(`✅ Deleted ${alertCount} usage alerts`);
  }

  // Reset purchasedTokensUsed (this tracks usage of purchased token packs)
  const [subscription] = await db
    .select()
    .from(SubscriptionTable)
    .where(eq(SubscriptionTable.userId, user.id))
    .limit(1);

  if (subscription) {
    const purchasedUsed = Number(subscription.purchasedTokensUsed || "0");
    if (purchasedUsed > 0) {
      await db
        .update(SubscriptionTable)
        .set({
          purchasedTokensUsed: "0",
          updatedAt: new Date(),
        })
        .where(eq(SubscriptionTable.userId, user.id));
      console.log(`✅ Reset purchasedTokensUsed from ${purchasedUsed} to 0`);
    } else {
      console.log(`ℹ️  No purchased tokens used to reset`);
    }
  }

  console.log(
    `\n🎉 Successfully reset monthly credits for ${user.name} (${email})`,
  );
  console.log(
    `\n📝 Note: You may need to refresh your browser to see the updated usage.`,
  );
}

// Main execution
const email = process.argv[2];

if (!email) {
  console.error("❌ Usage: pnpm tsx scripts/reset-user-usage.ts <email>");
  console.error(
    "   Example: pnpm tsx scripts/reset-user-usage.ts admin@test-seed.local",
  );
  process.exit(1);
}

resetUserUsage(email)
  .then(() => {
    console.log("\n✅ Done!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Error:", error);
    process.exit(1);
  });
