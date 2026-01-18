import "load-env";
import { eq } from "drizzle-orm";
import { pgDb as db } from "../src/lib/db/pg/db.pg";
import { UserTable } from "../src/lib/db/pg/schema.pg";

async function promoteToAdmin() {
  const email = process.argv[2] || "admin@example.com";

  const result = await db
    .update(UserTable)
    .set({ role: "admin" })
    .where(eq(UserTable.email, email))
    .returning();

  if (result.length > 0) {
    console.log(`Successfully promoted ${email} to admin role`);
    console.log(`User ID: ${result[0].id}`);
  } else {
    console.log(`User with email ${email} not found`);
  }

  process.exit(0);
}

promoteToAdmin().catch(console.error);
