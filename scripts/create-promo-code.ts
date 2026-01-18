import "load-env";
import { pgDb as db } from "lib/db/pg/db.pg";
import { PromoCodeTable } from "lib/db/pg/schema.pg";

const code = process.argv[2] || "FREE2M";
const description = process.argv[3] || "One-time free 2M token pack";

console.log(`Creating promo code: ${code}`);

try {
  const [result] = await db
    .insert(PromoCodeTable)
    .values({
      code: code.toUpperCase(),
      description,
      discountType: "fixed_amount",
      discountValue: "1499", // 2M token pack price in cents ($14.99)
      appliesTo: "token_pack",
      maxRedemptions: "1",
      maxPerUser: "1",
      isActive: true,
    })
    .returning();

  console.log("Promo code created successfully!");
  console.log("Details:", {
    id: result.id,
    code: result.code,
    discountType: result.discountType,
    discountValue: `$${(Number(result.discountValue) / 100).toFixed(2)}`,
    appliesTo: result.appliesTo,
    maxRedemptions: result.maxRedemptions,
  });

  process.exit(0);
} catch (error: unknown) {
  const err = error as Error & { code?: string };
  if (err.code === "23505") {
    console.error(`Promo code "${code}" already exists!`);
  } else {
    console.error("Failed to create promo code:", err.message);
  }
  process.exit(1);
}
