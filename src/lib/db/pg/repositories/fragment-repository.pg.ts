import { and, desc, eq, sql } from "drizzle-orm";
import { pgDb as db } from "../db.pg";
import {
  FragmentsTable,
  FragmentExecutionsTable,
  E2BUsageTable,
  FragmentSharesTable,
} from "../schema.pg";
import type {
  Fragment,
  FragmentStatus,
  FragmentTemplateId,
} from "@/types/fragment";

/**
 * Fragment Repository - CRUD operations for fragments
 * Handles all database operations for the fragment-based micro-app system
 */
export class FragmentRepository {
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
    sandboxId?: string;
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
        sandboxId: data.sandboxId,
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

    return results.map(this.mapToFragment);
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

    return results.map(this.mapToFragment);
  }

  /**
   * Update fragment
   */
  async update(
    id: string,
    data: Partial<{
      code: string;
      sandboxId: string;
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
    if (data.sandboxId !== undefined) updateData.sandboxId = data.sandboxId;
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
    sandboxId: string;
    template: string;
    stdout?: string;
    stderr?: string;
    runtimeError?: string;
    previewUrl?: string;
    executionTimeMs?: number;
  }): Promise<void> {
    await db.insert(FragmentExecutionsTable).values({
      fragmentId: data.fragmentId,
      sandboxId: data.sandboxId,
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
      sandbox_id: row.sandboxId || undefined,
      port: row.port || undefined,
      preview_url: row.previewUrl || undefined,
      deployment_url: row.deploymentUrl || undefined,
      status: row.status as FragmentStatus,
      error_message: row.errorMessage || undefined,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
    };
  }
}

/**
 * E2B Usage Repository - Track sandbox usage for billing
 */
export class E2BUsageRepository {
  /**
   * Record sandbox usage
   */
  async recordUsage(data: {
    userId: string;
    sessionId: string;
    template?: string;
    durationMs: number;
    operationType?: "create" | "edit" | "execute" | "deploy";
  }): Promise<void> {
    // Calculate credits: 1 credit per minute, minimum 1 credit
    const creditsUsed = Math.max(1, Math.ceil(data.durationMs / 60000));
    // Calculate cost: $0.001 per credit
    const costUsd = (creditsUsed * 0.001).toFixed(6);

    await db.insert(E2BUsageTable).values({
      userId: data.userId,
      sessionId: data.sessionId,
      template: data.template,
      durationMs: data.durationMs,
      creditsUsed: creditsUsed.toString(),
      costUsd,
      operationType: data.operationType,
    });
  }

  /**
   * Get daily usage for a user
   */
  async getDailyUsage(userId: string): Promise<number> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const result = await db
      .select({
        totalCredits: sql<string>`COALESCE(SUM(${E2BUsageTable.creditsUsed}::numeric), 0)`,
      })
      .from(E2BUsageTable)
      .where(
        and(
          eq(E2BUsageTable.userId, userId),
          sql`${E2BUsageTable.createdAt} >= ${startOfDay}`,
        ),
      );

    return parseFloat(result[0]?.totalCredits || "0");
  }

  /**
   * Get monthly usage for a user
   */
  async getMonthlyUsage(userId: string): Promise<number> {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const result = await db
      .select({
        totalCredits: sql<string>`COALESCE(SUM(${E2BUsageTable.creditsUsed}::numeric), 0)`,
      })
      .from(E2BUsageTable)
      .where(
        and(
          eq(E2BUsageTable.userId, userId),
          sql`${E2BUsageTable.createdAt} >= ${startOfMonth}`,
        ),
      );

    return parseFloat(result[0]?.totalCredits || "0");
  }

  /**
   * Get usage history for a user
   */
  async getUsageHistory(
    userId: string,
    limit: number = 100,
  ): Promise<
    Array<{
      id: string;
      sessionId: string;
      template: string | null;
      durationMs: number;
      creditsUsed: string;
      costUsd: string;
      operationType: string | null;
      createdAt: Date;
    }>
  > {
    return await db
      .select()
      .from(E2BUsageTable)
      .where(eq(E2BUsageTable.userId, userId))
      .orderBy(desc(E2BUsageTable.createdAt))
      .limit(limit);
  }
}

/**
 * Fragment Shares Repository - Manage shared fragment links
 */
export class FragmentSharesRepository {
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
    createdAt: Date;
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
      createdAt: Date;
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
export const fragmentRepository = new FragmentRepository();
export const e2bUsageRepository = new E2BUsageRepository();
export const fragmentSharesRepository = new FragmentSharesRepository();
