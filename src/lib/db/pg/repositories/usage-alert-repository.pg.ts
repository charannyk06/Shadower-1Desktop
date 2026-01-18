import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { pgDb as db } from "../db.pg";
import { UsageAlertTable } from "../schema.pg";

export type AlertType = "approaching_80" | "approaching_100" | "exceeded";
export type LimitType = "monthly" | "weekly" | "daily_expensive";

export interface CreateAlertParams {
  userId: string;
  alertType: AlertType;
  limitType: LimitType;
  threshold: number;
  currentUsage: number;
  usageLimit: number;
  periodStart: Date;
  periodEnd: Date;
}

export interface UsageAlert {
  id: string;
  userId: string;
  alertType: AlertType;
  limitType: LimitType;
  threshold: string;
  currentUsage: string;
  usageLimit: string;
  emailSent: boolean;
  emailSentAt: Date | null;
  acknowledgedAt: Date | null;
  periodStart: Date;
  periodEnd: Date;
  createdAt: Date;
}

class UsageAlertRepository {
  /**
   * Create an alert if one doesn't already exist for this user/type/period
   * Returns the alert if created, null if already exists
   */
  async createIfNotExists(
    params: CreateAlertParams,
  ): Promise<UsageAlert | null> {
    try {
      const result = await db
        .insert(UsageAlertTable)
        .values({
          userId: params.userId,
          alertType: params.alertType,
          limitType: params.limitType,
          threshold: params.threshold.toString(),
          currentUsage: params.currentUsage.toString(),
          usageLimit: params.usageLimit.toString(),
          periodStart: params.periodStart,
          periodEnd: params.periodEnd,
        })
        .onConflictDoNothing({
          target: [
            UsageAlertTable.userId,
            UsageAlertTable.alertType,
            UsageAlertTable.limitType,
            UsageAlertTable.periodStart,
          ],
        })
        .returning();

      if (result.length === 0) {
        // Alert already exists for this period
        return null;
      }

      console.log(
        `[UsageAlert] Created ${params.alertType} alert for user ${params.userId} (${params.limitType})`,
      );

      return result[0] as UsageAlert;
    } catch (error) {
      console.error("[UsageAlert] Failed to create alert:", error);
      throw error;
    }
  }

  /**
   * Get all unacknowledged alerts for a user
   */
  async getUnacknowledgedByUser(userId: string): Promise<UsageAlert[]> {
    const result = await db
      .select()
      .from(UsageAlertTable)
      .where(
        and(
          eq(UsageAlertTable.userId, userId),
          isNull(UsageAlertTable.acknowledgedAt),
        ),
      )
      .orderBy(desc(UsageAlertTable.createdAt));

    return result as UsageAlert[];
  }

  /**
   * Get alerts that need email notifications
   */
  async getUnemailedAlerts(limit: number = 100): Promise<UsageAlert[]> {
    const result = await db
      .select()
      .from(UsageAlertTable)
      .where(eq(UsageAlertTable.emailSent, false))
      .orderBy(UsageAlertTable.createdAt)
      .limit(limit);

    return result as UsageAlert[];
  }

  /**
   * Mark an alert as email sent
   */
  async markEmailSent(alertId: string): Promise<boolean> {
    try {
      const result = await db
        .update(UsageAlertTable)
        .set({
          emailSent: true,
          emailSentAt: new Date(),
        })
        .where(eq(UsageAlertTable.id, alertId))
        .returning({ id: UsageAlertTable.id });

      return result.length > 0;
    } catch (error) {
      console.error(
        `[UsageAlert] Failed to mark email sent for ${alertId}:`,
        error,
      );
      return false;
    }
  }

  /**
   * Acknowledge (dismiss) an alert
   */
  async acknowledge(alertId: string, userId: string): Promise<boolean> {
    try {
      const result = await db
        .update(UsageAlertTable)
        .set({
          acknowledgedAt: new Date(),
        })
        .where(
          and(
            eq(UsageAlertTable.id, alertId),
            eq(UsageAlertTable.userId, userId),
          ),
        )
        .returning({ id: UsageAlertTable.id });

      if (result.length > 0) {
        console.log(
          `[UsageAlert] User ${userId} acknowledged alert ${alertId}`,
        );
        return true;
      }
      return false;
    } catch (error) {
      console.error(
        `[UsageAlert] Failed to acknowledge alert ${alertId}:`,
        error,
      );
      return false;
    }
  }

  /**
   * Acknowledge all alerts for a user
   */
  async acknowledgeAll(userId: string): Promise<number> {
    try {
      const result = await db
        .update(UsageAlertTable)
        .set({
          acknowledgedAt: new Date(),
        })
        .where(
          and(
            eq(UsageAlertTable.userId, userId),
            isNull(UsageAlertTable.acknowledgedAt),
          ),
        )
        .returning({ id: UsageAlertTable.id });

      if (result.length > 0) {
        console.log(
          `[UsageAlert] User ${userId} acknowledged ${result.length} alerts`,
        );
      }
      return result.length;
    } catch (error) {
      console.error(
        `[UsageAlert] Failed to acknowledge all alerts for ${userId}:`,
        error,
      );
      return 0;
    }
  }

  /**
   * Get alert by ID
   */
  async getById(alertId: string): Promise<UsageAlert | null> {
    const result = await db
      .select()
      .from(UsageAlertTable)
      .where(eq(UsageAlertTable.id, alertId))
      .limit(1);

    return (result[0] as UsageAlert) || null;
  }

  /**
   * Get active alerts count for a user (unacknowledged)
   */
  async getActiveCount(userId: string): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(UsageAlertTable)
      .where(
        and(
          eq(UsageAlertTable.userId, userId),
          isNull(UsageAlertTable.acknowledgedAt),
        ),
      )
      .orderBy(desc(UsageAlertTable.createdAt));

    return Number(result[0]?.count || 0);
  }

  /**
   * Check if a specific alert type exists for the current period
   */
  async existsForPeriod(
    userId: string,
    alertType: AlertType,
    limitType: LimitType,
    periodStart: Date,
  ): Promise<boolean> {
    const result = await db
      .select({ id: UsageAlertTable.id })
      .from(UsageAlertTable)
      .where(
        and(
          eq(UsageAlertTable.userId, userId),
          eq(UsageAlertTable.alertType, alertType),
          eq(UsageAlertTable.limitType, limitType),
          eq(UsageAlertTable.periodStart, periodStart),
        ),
      )
      .limit(1);

    return result.length > 0;
  }

  /**
   * Delete old acknowledged alerts (cleanup)
   * Keeps alerts for the last 90 days
   */
  async cleanupOldAlerts(): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 90);

    try {
      const result = await db
        .delete(UsageAlertTable)
        .where(
          and(
            sql`${UsageAlertTable.acknowledgedAt} IS NOT NULL`,
            sql`${UsageAlertTable.createdAt} < ${cutoffDate}`,
          ),
        )
        .returning({ id: UsageAlertTable.id });

      if (result.length > 0) {
        console.log(`[UsageAlert] Cleaned up ${result.length} old alerts`);
      }
      return result.length;
    } catch (error) {
      console.error("[UsageAlert] Failed to cleanup old alerts:", error);
      return 0;
    }
  }
}

export const pgUsageAlertRepository = new UsageAlertRepository();
