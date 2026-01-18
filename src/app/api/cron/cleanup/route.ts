/**
 * Cron job for cleaning up stale sessions and resources
 *
 * This route is called by Vercel Cron to perform periodic cleanup tasks:
 * - Expire stale browser sessions
 * - Clean up rate limit memory store
 * - Remove orphaned sandbox contexts
 *
 * Security: Vercel Cron jobs include an Authorization header with CRON_SECRET
 */

import { validateCronAuth } from "@/lib/cron/auth";
import { and, eq, lt } from "drizzle-orm";
import { getBrowserbaseService } from "lib/ai/browser/browserbase-service";
import { pgDb as db } from "lib/db/pg/db.pg";
import {
  BrowserSessionTable,
  ThreadSandboxContextTable,
} from "lib/db/pg/schema.pg";
import { cleanupMemoryStore } from "lib/middleware/rate-limit";
import { NextRequest } from "next/server";

// Session timeout - sessions older than this are considered stale
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const SANDBOX_CONTEXT_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CleanupResults {
  expiredSessions: number;
  cleanedSandboxContexts: number;
  cleanedStagehandCache: number;
  memoryStoreCleanup: boolean;
  errors: string[];
}

/** Expire stale browser sessions */
async function cleanupBrowserSessions(): Promise<number> {
  const staleThreshold = new Date(Date.now() - SESSION_TIMEOUT_MS);
  const expiredSessions = await db
    .update(BrowserSessionTable)
    .set({ status: "expired", closedAt: new Date() })
    .where(
      and(
        eq(BrowserSessionTable.status, "active"),
        lt(BrowserSessionTable.createdAt, staleThreshold),
      ),
    )
    .returning({ id: BrowserSessionTable.id });
  return expiredSessions.length;
}

/** Clean up old sandbox contexts */
async function cleanupSandboxContexts(): Promise<number> {
  const sandboxThreshold = new Date(Date.now() - SANDBOX_CONTEXT_TIMEOUT_MS);
  const deletedContexts = await db
    .delete(ThreadSandboxContextTable)
    .where(lt(ThreadSandboxContextTable.lastAccessedAt, sandboxThreshold))
    .returning({ id: ThreadSandboxContextTable.id });
  return deletedContexts.length;
}

/** Clean up stale Stagehand instances */
async function cleanupStagehandCache(): Promise<number> {
  const browserService = getBrowserbaseService();
  return browserService.cleanupStaleSessions();
}

/** Run a cleanup task and capture errors */
async function runCleanupTask<T>(
  taskName: string,
  task: () => Promise<T>,
  errors: string[],
): Promise<T | null> {
  try {
    return await task();
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    errors.push(`${taskName}: ${errorMessage}`);
    return null;
  }
}

export async function GET(req: NextRequest) {
  const authError = validateCronAuth(req, "Cleanup");
  if (authError) return authError;

  try {
    const results: CleanupResults = {
      expiredSessions: 0,
      cleanedSandboxContexts: 0,
      cleanedStagehandCache: 0,
      memoryStoreCleanup: false,
      errors: [],
    };

    // Run cleanup tasks
    results.expiredSessions =
      (await runCleanupTask(
        "Browser session cleanup",
        cleanupBrowserSessions,
        results.errors,
      )) ?? 0;

    results.cleanedSandboxContexts =
      (await runCleanupTask(
        "Sandbox context cleanup",
        cleanupSandboxContexts,
        results.errors,
      )) ?? 0;

    results.cleanedStagehandCache =
      (await runCleanupTask(
        "Stagehand cache cleanup",
        cleanupStagehandCache,
        results.errors,
      )) ?? 0;

    // Sync cleanup for memory store
    try {
      cleanupMemoryStore();
      results.memoryStoreCleanup = true;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      results.errors.push(`Memory store cleanup: ${errorMessage}`);
    }

    const success = results.errors.length === 0;
    console.log("[Cron] Cleanup completed:", results);

    return Response.json(
      {
        success,
        message: success
          ? "Cleanup completed successfully"
          : "Cleanup completed with errors",
        results,
        timestamp: new Date().toISOString(),
      },
      { status: success ? 200 : 207 },
    );
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error("[Cron] Cleanup failed:", error);
    return Response.json(
      {
        success: false,
        error: errorMessage,
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}
