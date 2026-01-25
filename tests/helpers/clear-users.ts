import { sqliteDb as db } from "../../src/lib/db/sqlite/db.sqlite";
import {
  AccountTable,
  AgentTable,
  ChatMessageTable,
  ChatThreadTable,
  McpServerTable,
  SessionTable,
  UserTable,
  VerificationTable,
} from "../../src/lib/db/sqlite/schema.sqlite";

/**
 * Clear all users from the database for first-user testing
 * WARNING: Only use in test environment!
 */
export async function clearAllUsers() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Cannot clear users in production!");
  }

  console.log("🧹 Clearing all users for first-user testing...");

  // Clear in order of dependencies (most dependent first)
  // 1. Clear chat messages (depends on threads)
  await db.delete(ChatMessageTable);

  // 4. Clear chat threads (depends on users)
  await db.delete(ChatThreadTable);

  // 5. Clear agents (depends on users)
  await db.delete(AgentTable);

  // 7. Clear MCP servers (depends on users)
  await db.delete(McpServerTable);

  // 8. Clear sessions (depends on users)
  await db.delete(SessionTable);

  // 9. Clear accounts (depends on users)
  await db.delete(AccountTable);

  // 10. Clear verifications (depends on users)
  await db.delete(VerificationTable);

  // 11. Finally clear users
  await db.delete(UserTable);

  console.log("✅ All users and related data cleared");
}

/**
 * Check if any users exist in the database
 */
export async function getUserCount(): Promise<number> {
  const users = await db.select().from(UserTable);
  return users.length;
}
