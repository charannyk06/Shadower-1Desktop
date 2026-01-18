#!/usr/bin/env tsx
/**
 * Re-index all messages to local Qdrant
 * Run: pnpm tsx scripts/reindex-messages.ts
 */

import { config } from "dotenv";

// Load environment variables FIRST
config();

import { pgDb } from "lib/db/pg/db.pg";
import { ChatMessageTable, ChatThreadTable } from "lib/db/pg/schema.pg";
import { indexContent } from "lib/vector-search/vector-search-service";
import { eq } from "drizzle-orm";

async function main() {
  console.log("🚀 Re-indexing messages to local Qdrant...\n");

  if (!process.env.QDRANT_URL) {
    console.error("❌ QDRANT_URL not set in .env");
    process.exit(1);
  }

  try {
    // Get all threads with their user IDs
    const threads = await pgDb
      .select({
        id: ChatThreadTable.id,
        userId: ChatThreadTable.userId,
      })
      .from(ChatThreadTable)
      .where(eq(ChatThreadTable.userId, ChatThreadTable.userId)); // Just get all

    console.log(`Found ${threads.length} threads\n`);

    let totalIndexed = 0;
    let totalErrors = 0;

    for (const thread of threads) {
      if (!thread.userId) {
        console.log(`⚠ Skipping thread ${thread.id} (no userId)`);
        continue;
      }

      try {
        // Get all messages for this thread
        const messages = await pgDb
          .select()
          .from(ChatMessageTable)
          .where(eq(ChatMessageTable.threadId, thread.id));

        if (messages.length === 0) continue;

        // Prepare messages for indexing
        const itemsToIndex = messages
          .map((message) => {
            const textParts = (message.parts as any[])
              .filter((part: any) => part.type === "text")
              .map((part: any) => part.text)
              .join(" ");

            return {
              id: message.id,
              content: textParts || "",
              payload: {
                userId: thread.userId,
                messageId: message.id,
                threadId: message.threadId,
                role: message.role,
                createdAt: message.createdAt.toISOString(),
              },
            };
          })
          .filter((item) => item.content.trim().length > 0);

        if (itemsToIndex.length > 0) {
          console.log(
            `  Indexing ${itemsToIndex.length} messages from thread ${thread.id.slice(0, 8)}...`,
          );
          await indexContent("messages", itemsToIndex, {
            userId: thread.userId,
          });
          totalIndexed += itemsToIndex.length;
        }
      } catch (error) {
        console.error(`  ❌ Failed to index thread ${thread.id}:`, error);
        totalErrors++;
      }
    }

    console.log(`\n✅ Re-indexing complete!`);
    console.log(`   Indexed: ${totalIndexed} messages`);
    console.log(`   Errors: ${totalErrors}`);
  } catch (error) {
    console.error("❌ Fatal error:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
