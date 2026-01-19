#!/usr/bin/env tsx
/**
 * Script to seed test users using Better Auth's APIs
 * Creates test users with proper password hashing via Better Auth
 *
 * Usage:
 *   pnpm test:e2e:seed
 */

import { config } from "dotenv";

import { TEST_USERS } from "../tests/constants/test-users";

// Load environment variables FIRST
if (process.env.CI) {
  config({ path: ".env.test" });
} else {
  config();
}

import { auth } from "auth/auth-instance";
import { eq, like } from "drizzle-orm";
import { sqliteDb as db } from "lib/db/sqlite/db.sqlite";
import {
  ChatMessageTable,
  ChatThreadTable,
  UserTable,
} from "lib/db/sqlite/schema.sqlite";

// Helper function to get user by email
async function getUserByEmail(email: string) {
  const [user] = await db
    .select()
    .from(UserTable)
    .where(eq(UserTable.email, email));
  return user || null;
}

async function clearExistingTestUsers() {
  console.log("🧹 Clearing existing test users...");

  try {
    // Clean up ALL test users with reliable patterns
    const testEmailPatterns = [
      "%@test-seed.local%", // Our main seeded test domain
      "%playwright%", // Dynamically created playwright users
      "%@example.com%", // General test signup users
      "%testuser%@testuser.com%", // Legacy test users
      "%testuser%@gmail.com%", // Legacy test users
    ];

    // First, get all test user IDs
    const testUsers: { id: string }[] = [];
    for (const pattern of testEmailPatterns) {
      const users = await db
        .select({ id: UserTable.id })
        .from(UserTable)
        .where(like(UserTable.email, pattern));
      testUsers.push(...users);
    }

    // Also get legacy test users by exact email match
    const legacyTestEmails = [
      "admin@testuser.com",
      "editor@testuser.com",
      "user@testuser.com",
    ];

    for (let i = 4; i <= 21; i++) {
      legacyTestEmails.push(`testuser${i}@testuser.com`);
      legacyTestEmails.push(`testuser${i}@gmail.com`);
    }

    for (const email of legacyTestEmails) {
      const users = await db
        .select({ id: UserTable.id })
        .from(UserTable)
        .where(eq(UserTable.email, email));
      testUsers.push(...users);
    }

    if (testUsers.length > 0) {
      const userIds = testUsers.map((u) => u.id);
      console.log(`Found ${userIds.length} test users to clean up`);

      // Delete in dependency order
      console.log("Deleting chat messages...");
      // Messages reference threads, not users directly
      if (userIds.length > 0) {
        for (const userId of userIds) {
          const threads = await db
            .select({ id: ChatThreadTable.id })
            .from(ChatThreadTable)
            .where(eq(ChatThreadTable.userId, userId));
          const threadIds = threads.map((t) => t.id);
          for (const threadId of threadIds) {
            await db
              .delete(ChatMessageTable)
              .where(eq(ChatMessageTable.threadId, threadId));
          }
        }
      }

      console.log("Deleting chat threads...");
      for (const userId of userIds) {
        await db
          .delete(ChatThreadTable)
          .where(eq(ChatThreadTable.userId, userId));
      }

      // Now delete the users
      console.log("Deleting users...");
      for (const pattern of testEmailPatterns) {
        await db.delete(UserTable).where(like(UserTable.email, pattern));
      }
      for (const email of legacyTestEmails) {
        await db.delete(UserTable).where(eq(UserTable.email, email));
      }
    }
  } catch (error) {
    console.log(
      "Note: Error during cleanup (may be expected if tables are empty):",
      error,
    );
  }
}

async function createUserWithBetterAuth(userData: {
  email: string;
  password: string;
  name: string;
  banned?: boolean;
  banReason?: string;
}) {
  try {
    // First, check if user already exists
    const existingUser = await getUserByEmail(userData.email);

    let user;
    if (existingUser) {
      console.log(
        `  User ${userData.email} already exists, using existing user (ID: ${existingUser.id})`,
      );
      user = existingUser;
    } else {
      // Use Better Auth's signUp API to create user with proper password hashing
      const result = await auth.api.signUpEmail({
        body: {
          email: userData.email,
          password: userData.password,
          name: userData.name,
        },
        headers: new Headers({
          "content-type": "application/json",
        }),
      });

      if (!result.user) {
        throw new Error("User creation failed");
      }

      user = result.user;
      console.log(`  Created new user ${userData.email} (ID: ${user.id})`);
    }

    // Ban user if needed - do this via direct database update since we don't have admin auth
    if (userData.banned && userData.banReason) {
      try {
        await db
          .update(UserTable)
          .set({
            banned: true,
            banReason: userData.banReason,
            banExpires: null, // Permanent ban for testing
          })
          .where(eq(UserTable.id, user.id));
      } catch (error) {
        console.warn(`Could not ban user ${userData.email}:`, error);
      }
    }

    return user;
  } catch (error) {
    console.error(`Failed to create user ${userData.email}:`, error);

    // Try to get existing user as fallback
    try {
      const existingUser = await getUserByEmail(userData.email);
      if (existingUser) {
        console.log(
          `  Found existing user ${userData.email} after error, using existing user (ID: ${existingUser.id})`,
        );
        return existingUser;
      }
    } catch (fallbackError) {
      console.warn(
        `Could not retrieve existing user ${userData.email}:`,
        fallbackError,
      );
    }

    return null;
  }
}

async function seedTestUsers() {
  console.log("🌱 Starting test user seeding using Better Auth APIs...");

  try {
    // Clear existing test users first
    await clearExistingTestUsers();
    console.log("✅ Existing test users cleared");

    console.log("👤 Creating main test users...");

    // 1. Admin User (now just a regular user - roles removed)
    const adminUser = await createUserWithBetterAuth({
      email: TEST_USERS.admin.email,
      password: TEST_USERS.admin.password,
      name: TEST_USERS.admin.name,
    });
    console.log("✅ Created admin user:", adminUser?.id);

    // 2. Editor User (now just a regular user - roles removed)
    const editorUser = await createUserWithBetterAuth({
      email: TEST_USERS.editor.email,
      password: TEST_USERS.editor.password,
      name: TEST_USERS.editor.name,
    });
    console.log("✅ Created editor user:", editorUser?.id);

    // 3. Editor2 User (now just a regular user - roles removed)
    const editor2User = await createUserWithBetterAuth({
      email: TEST_USERS.editor2.email,
      password: TEST_USERS.editor2.password,
      name: TEST_USERS.editor2.name,
    });
    console.log("✅ Created editor2 user:", editor2User?.id);

    // 4. Regular User
    const regularUser = await createUserWithBetterAuth({
      email: TEST_USERS.regular.email,
      password: TEST_USERS.regular.password,
      name: TEST_USERS.regular.name,
    });
    console.log("✅ Created regular user:", regularUser?.id);

    // 5. Create additional test users
    console.log("👥 Creating additional test users...");
    let createdCount = 4;

    for (let i = 4; i <= 21; i++) {
      try {
        const isBanned = i === 21;
        const email = `testuser${i}@test-seed.local`;

        await createUserWithBetterAuth({
          email,
          password: `TestPass${i}!`,
          name: `Test User ${i}`,
          banned: isBanned,
          banReason: isBanned ? "Test ban for E2E testing" : undefined,
        });
        createdCount++;
        console.log(`✅ Created user ${i}`);
      } catch (_error) {
        console.warn(`⚠️ Failed to create user ${i}, continuing...`);
      }
    }

    // 6. Seed some basic message/model data for stats testing
    console.log("📊 Creating sample AI usage data for stats testing...");
    const userIdsForSampleData = [
      adminUser?.id,
      editorUser?.id,
      editor2User?.id,
      regularUser?.id,
    ].filter(Boolean) as string[];
    if (userIdsForSampleData.length > 0) {
      await seedSampleUsageData(userIdsForSampleData);
    } else {
      console.warn("⚠️ No valid user IDs found for sample data creation");
    }

    console.log(
      `\n✅ Test data seeded successfully! Created ${createdCount} users with sample usage data.`,
    );

    console.log("\n🔑 Test Credentials:");
    console.log(
      `  Admin: ${TEST_USERS.admin.email} / ${TEST_USERS.admin.password}`,
    );
    console.log(
      `  Editor: ${TEST_USERS.editor.email} / ${TEST_USERS.editor.password}`,
    );
    console.log(
      `  Editor2: ${TEST_USERS.editor2.email} / ${TEST_USERS.editor2.password}`,
    );
    console.log(
      `  Regular: ${TEST_USERS.regular.email} / ${TEST_USERS.regular.password}`,
    );
    console.log(`  Others: testuser{4-21}@test-seed.local / TestPass{n}!`);

    console.log("\n📁 Auth Files Will Be Created:");
    console.log(`  - tests/.auth/${TEST_USERS.admin.authFile} (admin user)`);
    console.log(`  - tests/.auth/${TEST_USERS.editor.authFile} (editor user)`);
    console.log(
      `  - tests/.auth/${TEST_USERS.editor2.authFile} (editor2 user)`,
    );
    console.log(
      `  - tests/.auth/${TEST_USERS.regular.authFile} (regular user)`,
    );
  } catch (error) {
    console.error("❌ Error seeding test users:", error);
    throw error;
  }
}

async function seedSampleUsageData(userIds: string[]) {
  try {
    for (const userId of userIds) {
      if (!userId) {
        console.warn("⚠️ Skipping sample data creation for undefined user ID");
        continue;
      }

      // Create sample threads and messages for user (should have stats)
      const thread = await db
        .insert(ChatThreadTable)
        .values({
          userId: userId,
          title: `Test AI Conversation ${userId}`,
        })
        .returning();

      if (thread[0]) {
        // Create sample messages with token usage
        const timestamp = Date.now();
        // Type assertion needed for Drizzle ORM batch insert with union types
        await db.insert(ChatMessageTable).values([
          {
            id: `${userId}-msg-1-${timestamp}`,
            threadId: thread[0].id,
            role: "user" as const,
            parts: [{ type: "text", text: "Test user message" }],
          },
          {
            id: `${userId}-msg-2-${timestamp}`,
            threadId: thread[0].id,
            role: "assistant" as const,
            parts: [{ type: "text", text: "Test assistant response" }],
            metadata: {
              chatModel: { provider: "openai", model: "gpt-4o" },
              usage: {
                totalTokens: Math.floor(Math.random() * 100) + 100,
                inputTokens: Math.floor(Math.random() * 100) + 50,
                outputTokens: Math.floor(Math.random() * 100) + 50,
              },
            },
          },
          {
            id: `${userId}-msg-3-${timestamp}`,
            threadId: thread[0].id,
            role: "assistant" as const,
            parts: [{ type: "text", text: "Another test response" }],
            metadata: {
              chatModel: {
                provider: "anthropic",
                model: "claude-3-5-sonnet-20241022",
              },
              usage: {
                totalTokens: Math.floor(Math.random() * 100) + 100,
                inputTokens: Math.floor(Math.random() * 100) + 50,
                outputTokens: Math.floor(Math.random() * 100) + 50,
              },
            },
          },
        ] as any);
      }
    }

    console.log(`✅ Created sample usage data for admin user`);

    // Editor user has no messages (should show empty state)
    console.log(
      `✅ Editor user left without usage data for empty state testing`,
    );
  } catch (error) {
    console.warn("⚠️ Failed to seed usage data:", error);
  }
}

// Run the seeding if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  seedTestUsers()
    .then(async () => {
      console.log("🎉 Seeding completed!");
      process.exit(0);
    })
    .catch(async (error) => {
      console.error("💥 Seeding failed:", error);
      process.exit(1);
    });
}
