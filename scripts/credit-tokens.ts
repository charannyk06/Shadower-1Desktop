import "load-env";
import { eq } from "drizzle-orm";
import { pgDb as db } from "lib/db/pg/db.pg";
import { SubscriptionTable } from "lib/db/pg/schema.pg";

const userId = process.argv[2];
const tokenAmount = process.argv[3];

if (!userId || !tokenAmount) {
  console.error(
    "Usage: npx tsx scripts/credit-tokens.ts <userId> <tokenAmount>",
  );
  console.error("Example: npx tsx scripts/credit-tokens.ts abc-123 2000000");
  process.exit(1);
}

console.log(`Crediting ${tokenAmount} tokens to user: ${userId}`);

try {
  // Get current purchased tokens
  const [existing] = await db
    .select()
    .from(SubscriptionTable)
    .where(eq(SubscriptionTable.userId, userId));

  if (!existing) {
    console.error("User subscription not found!");
    process.exit(1);
  }

  const currentTokens = BigInt(existing.purchasedTokens || "0");
  const newTokens = currentTokens + BigInt(tokenAmount);

  const [result] = await db
    .update(SubscriptionTable)
    .set({
      purchasedTokens: newTokens.toString(),
      updatedAt: new Date(),
    })
    .where(eq(SubscriptionTable.userId, userId))
    .returning();

  console.log("Tokens credited successfully!");
  console.log("Details:", {
    userId: result.userId,
    previousTokens: currentTokens.toString(),
    addedTokens: tokenAmount,
    newTotal: result.purchasedTokens,
  });

  process.exit(0);
} catch (error: unknown) {
  const err = error as Error;
  console.error("Failed to credit tokens:", err.message);
  process.exit(1);
}
