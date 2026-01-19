import { desc, eq, sql } from "drizzle-orm";
import { sqliteDb as db } from "../db.sqlite";
import {
  FragmentsTable,
  FragmentExecutionsTable,
  FragmentSharesTable,
} from "../schema.sqlite";
import type {
  Fragment,
  FragmentStatus,
  FragmentTemplateId,
} from "@/types/fragment";

/**
 * Fragment Repository - CRUD operations for fragments
 * Handles all database operations for the fragment-based micro-app system
 */
export class SqliteFragmentRepository {
  /**
   * Create a new fragment
   */
  async create(data: {
    threadId: string;
    userId: string;
    template: FragmentTemplateId;
    title: string;
    description: string;
    code: string;
    filePath: string;
    port?: number;
    sessionId?: string;
    previewUrl?: string;
  }): Promise<Fragment> {
    const [fragment] = await db
      .insert(FragmentsTable)
      .values({
        threadId: data.threadId,
        userId: data.userId,
        template: data.template,
        title: data.title,
        description: data.description,
        code: data.code,
        filePath: data.filePath,
        port: data.port,
        sessionId: data.sessionId,
        previewUrl: data.previewUrl,
        status: "draft",
      })
      .returning();

    return this.mapToFragment(fragment);
  }

  /**
   * Get fragment by ID
   */
  async getById(id: string): Promise<Fragment | null> {
    const [fragment] = await db
      .select()
      .from(FragmentsTable)
      .where(eq(FragmentsTable.id, id))
      .limit(1);

    return fragment ? this.mapToFragment(fragment) : null;
  }

  /**
   * Get all fragments for a thread
   */
  async getByThread(threadId: string): Promise<Fragment[]> {
    const results = await db
      .select()
      .from(FragmentsTable)
      .where(eq(FragmentsTable.threadId, threadId))
      .orderBy(desc(FragmentsTable.createdAt));

    return results.map((r) => this.mapToFragment(r));
  }

  /**
   * Get all fragments for a user
   */
  async getByUser(userId: string, limit: number = 50): Promise<Fragment[]> {
    const results = await db
      .select()
      .from(FragmentsTable)
      .where(eq(FragmentsTable.userId, userId))
      .orderBy(desc(FragmentsTable.createdAt))
      .limit(limit);

    return results.map((r) => this.mapToFragment(r));
  }

  /**
   * Update fragment
   */
  async update(
    id: string,
    data: Partial<{
      code: string;
      sessionId: string;
      previewUrl: string;
      deploymentUrl: string;
      status: FragmentStatus;
      errorMessage: string;
    }>,
  ): Promise<Fragment | null> {
    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (data.code !== undefined) updateData.code = data.code;
    if (data.sessionId !== undefined) updateData.sessionId = data.sessionId;
    if (data.previewUrl !== undefined) updateData.previewUrl = data.previewUrl;
    if (data.deploymentUrl !== undefined)
      updateData.deploymentUrl = data.deploymentUrl;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.errorMessage !== undefined)
      updateData.errorMessage = data.errorMessage;

    const [updated] = await db
      .update(FragmentsTable)
      .set(updateData)
      .where(eq(FragmentsTable.id, id))
      .returning();

    return updated ? this.mapToFragment(updated) : null;
  }

  /**
   * Delete fragment
   */
  async delete(id: string): Promise<boolean> {
    const result = await db
      .delete(FragmentsTable)
      .where(eq(FragmentsTable.id, id));

    return !!result;
  }

  /**
   * Record fragment execution
   */
  async recordExecution(data: {
    fragmentId: string;
    sessionId: string;
    template: string;
    stdout?: string;
    stderr?: string;
    runtimeError?: string;
    previewUrl?: string;
    executionTimeMs?: number;
  }): Promise<void> {
    await db.insert(FragmentExecutionsTable).values({
      fragmentId: data.fragmentId,
      sessionId: data.sessionId,
      template: data.template,
      stdout: data.stdout,
      stderr: data.stderr,
      runtimeError: data.runtimeError,
      previewUrl: data.previewUrl,
      executionTimeMs: data.executionTimeMs,
    });
  }

  /**
   * Get execution history for a fragment
   */
  async getExecutionHistory(fragmentId: string, limit: number = 10) {
    return await db
      .select()
      .from(FragmentExecutionsTable)
      .where(eq(FragmentExecutionsTable.fragmentId, fragmentId))
      .orderBy(desc(FragmentExecutionsTable.createdAt))
      .limit(limit);
  }

  /**
   * Map database row to Fragment interface
   */
  private mapToFragment(row: typeof FragmentsTable.$inferSelect): Fragment {
    return {
      id: row.id,
      thread_id: row.threadId,
      user_id: row.userId,
      template: row.template as FragmentTemplateId,
      title: row.title,
      description: row.description || "",
      code: row.code,
      file_path: row.filePath,
      session_id: row.sessionId || undefined,
      port: row.port || undefined,
      preview_url: row.previewUrl || undefined,
      deployment_url: row.deploymentUrl || undefined,
      status: row.status as FragmentStatus,
      error_message: row.errorMessage || undefined,
      created_at: row.createdAt ?? new Date(),
      updated_at: row.updatedAt ?? new Date(),
    };
  }
}

/**
 * Local Execution Repository - Track local execution for analytics (free, no billing)
 * Local execution runs on the user's machine, so there's no cost to track.
 * This is just for usage analytics.
 */
export class SqliteLocalExecutionRepository {
  /**
   * Record local execution (no-op, local execution is free)
   * Kept for interface compatibility
   */
  async recordExecution(_data: {
    userId: string;
    threadId?: string;
    executionMs: number;
    language?: string;
  }): Promise<void> {
    // Local execution is free - runs on user's machine
    // No database tracking needed for billing purposes
  }

  /**
   * Get daily execution count for a user (returns 0 - no tracking needed)
   */
  async getDailyExecutions(_userId: string): Promise<number> {
    return 0;
  }

  /**
   * Get monthly execution count for a user (returns 0 - no tracking needed)
   */
  async getMonthlyExecutions(_userId: string): Promise<number> {
    return 0;
  }

  /**
   * Get execution history (returns empty - no tracking needed)
   */
  async getExecutionHistory(
    _userId: string,
    _limit: number = 100,
  ): Promise<Array<never>> {
    return [];
  }
}

/**
 * Fragment Shares Repository - Manage shared fragment links
 */
export class SqliteFragmentSharesRepository {
  /**
   * Create a share link for a fragment
   */
  async create(data: {
    fragmentId: string;
    userId: string;
    shareId: string;
    expiresAt?: Date;
  }): Promise<{ shareId: string; expiresAt: Date | null }> {
    const [share] = await db
      .insert(FragmentSharesTable)
      .values({
        fragmentId: data.fragmentId,
        userId: data.userId,
        shareId: data.shareId,
        expiresAt: data.expiresAt,
        isActive: true,
      })
      .returning();

    return {
      shareId: share.shareId,
      expiresAt: share.expiresAt,
    };
  }

  /**
   * Get share by shareId
   */
  async getByShareId(shareId: string): Promise<{
    id: string;
    fragmentId: string;
    userId: string;
    shareId: string;
    expiresAt: Date | null;
    isActive: boolean;
    viewCount: number;
    lastViewedAt: Date | null;
    createdAt: Date | null;
  } | null> {
    const [share] = await db
      .select()
      .from(FragmentSharesTable)
      .where(eq(FragmentSharesTable.shareId, shareId))
      .limit(1);

    return share || null;
  }

  /**
   * Increment view count
   */
  async incrementViewCount(shareId: string): Promise<void> {
    await db
      .update(FragmentSharesTable)
      .set({
        viewCount: sql`${FragmentSharesTable.viewCount} + 1`,
        lastViewedAt: new Date(),
      })
      .where(eq(FragmentSharesTable.shareId, shareId));
  }

  /**
   * Deactivate a share
   */
  async deactivate(shareId: string): Promise<void> {
    await db
      .update(FragmentSharesTable)
      .set({ isActive: false })
      .where(eq(FragmentSharesTable.shareId, shareId));
  }

  /**
   * Get shares for a fragment
   */
  async getByFragment(fragmentId: string): Promise<
    Array<{
      id: string;
      shareId: string;
      expiresAt: Date | null;
      isActive: boolean;
      viewCount: number;
      createdAt: Date | null;
    }>
  > {
    return await db
      .select({
        id: FragmentSharesTable.id,
        shareId: FragmentSharesTable.shareId,
        expiresAt: FragmentSharesTable.expiresAt,
        isActive: FragmentSharesTable.isActive,
        viewCount: FragmentSharesTable.viewCount,
        createdAt: FragmentSharesTable.createdAt,
      })
      .from(FragmentSharesTable)
      .where(eq(FragmentSharesTable.fragmentId, fragmentId))
      .orderBy(desc(FragmentSharesTable.createdAt));
  }
}

// Singleton instances
export const sqliteFragmentRepository = new SqliteFragmentRepository();
export const sqliteLocalExecutionRepository =
  new SqliteLocalExecutionRepository();
export const sqliteFragmentSharesRepository =
  new SqliteFragmentSharesRepository();

// Legacy alias for backwards compatibility
export const sqliteE2bUsageRepository = sqliteLocalExecutionRepository;
