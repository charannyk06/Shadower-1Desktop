#!/usr/bin/env tsx
/**
 * Script to add a user as admin
 *
 * Usage:
 *   pnpm tsx scripts/add-admin-user.ts <email> <password> [name]
 *
 * Example:
 *   pnpm tsx scripts/add-admin-user.ts charannyan@gmail.com Arjhunvjj6 "Charannyan"
 */

import "load-env";
import { USER_ROLES } from "app-types/roles";
import { auth } from "auth/auth-instance";
import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { pgDb as db } from "../src/lib/db/pg/db.pg";
import { UserTable } from "../src/lib/db/pg/schema.pg";

const email = process.argv[2];
const password = process.argv[3];
const name = process.argv[4] || email.split("@")[0];

if (!email || !password) {
  console.error(
    "Usage: pnpm tsx scripts/add-admin-user.ts <email> <password> [name]",
  );
  console.error(
    "Example: pnpm tsx scripts/add-admin-user.ts charannyan@gmail.com Arjhunvjj6",
  );
  process.exit(1);
}

async function addAdminUser() {
  try {
    console.log(`Creating admin user: ${email}...`);

    // Check if user already exists
    const [existingUser] = await db
      .select()
      .from(UserTable)
      .where(eq(UserTable.email, email));

    let user;
    if (existingUser) {
      console.log(`User ${email} already exists (ID: ${existingUser.id})`);
      user = existingUser;
    } else {
      // Use Better Auth's signUp API to create user with proper password hashing
      const result = await auth.api.signUpEmail({
        body: {
          email,
          password,
          name,
        },
        headers: new Headers({
          "content-type": "application/json",
        }),
      });

      if (!result.user) {
        throw new Error("User creation failed");
      }

      user = result.user;
      console.log(`✅ Created new user ${email} (ID: ${user.id})`);
    }

    // Update role to admin
    const [currentUser] = await db
      .select()
      .from(UserTable)
      .where(sql`id = ${user.id}`);

    if (currentUser) {
      if (currentUser.role !== USER_ROLES.ADMIN) {
        await db
          .update(UserTable)
          .set({ role: USER_ROLES.ADMIN })
          .where(eq(UserTable.id, user.id));
        console.log(`✅ Updated role to admin for ${email}`);
      } else {
        console.log(`✅ User ${email} already has admin role`);
      }
    }

    console.log(`\n✅ Success! User ${email} is now an admin.`);
    console.log(`   User ID: ${user.id}`);
    console.log(`   Role: ${USER_ROLES.ADMIN}`);
  } catch (error) {
    console.error("❌ Failed to create admin user:", error);
    process.exit(1);
  }
}

addAdminUser().catch(console.error);
