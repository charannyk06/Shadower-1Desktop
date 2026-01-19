import "server-only";

// Alert types for usage alerts (stub types for local-first mode)
export type AlertType = "approaching_80" | "approaching_100" | "exceeded";
export type LimitType =
  | "image_generation"
  | "local_execution"
  | "voice_minutes"
  | "mcp_tool_call"
  | "workflow_execution"
  | "monthly";

import {
  subscriptionRepository,
  usageAlertRepository,
  userRepository,
} from "lib/db/repository";
import { getMonthBoundaries } from "./date-utils";
import { type SubscriptionTier, TIER_LIMITS } from "./types";

interface AlertThreshold {
  type: AlertType;
  percentage: number;
}

const ALERT_THRESHOLDS: AlertThreshold[] = [
  { type: "approaching_80", percentage: 0.8 },
  { type: "approaching_100", percentage: 0.95 }, // Slightly below 100% to give warning
  { type: "exceeded", percentage: 1.0 },
];

interface UsageCheckResult {
  alertsCreated: number;
  alertTypes: AlertType[];
}

/**
 * Check a single limit type and create alerts if needed
 */
async function checkLimitAndAlert(
  userId: string,
  limitType: LimitType,
  currentUsage: number,
  usageLimit: number,
  periodStart: Date,
  periodEnd: Date,
): Promise<AlertType[]> {
  const alertsCreated: AlertType[] = [];
  const percentage = currentUsage / usageLimit;

  for (const threshold of ALERT_THRESHOLDS) {
    if (percentage >= threshold.percentage) {
      // Check if alert already exists
      const exists = await usageAlertRepository.existsForPeriod(
        userId,
        threshold.type,
        limitType,
        periodStart,
      );

      if (!exists) {
        const alert = await usageAlertRepository.createIfNotExists({
          userId,
          alertType: threshold.type,
          limitType,
          threshold: Math.round(threshold.percentage * 100),
          currentUsage: Math.round(currentUsage),
          usageLimit: Math.round(usageLimit),
          periodStart,
          periodEnd,
        });

        if (alert) {
          alertsCreated.push(threshold.type);
        }
      }
    }
  }

  return alertsCreated;
}

/**
 * Check and create alerts for a single user
 */
export async function checkAndCreateAlertsForUser(
  userId: string,
): Promise<UsageCheckResult> {
  const result: UsageCheckResult = {
    alertsCreated: 0,
    alertTypes: [],
  };

  try {
    // Get user's subscription and tier
    const subscription = await subscriptionRepository.getByUserId(userId);
    const tier = (subscription?.tier as SubscriptionTier) || "free";
    const limits = TIER_LIMITS[tier];

    // Get current month boundaries
    const { start: monthStart, end: monthEnd } = getMonthBoundaries();

    // Get usage summary for the current month
    const monthlyUsage = await subscriptionRepository.getUsageSummary(
      userId,
      monthStart,
      new Date(),
    );

    const monthlyCredits = monthlyUsage?.total_credits || 0;

    // Calculate effective limit (tier limit + purchased credits)
    const purchasedCredits = Number(subscription?.purchasedTokens || "0");
    const purchasedUsed = Number(subscription?.purchasedTokensUsed || "0");
    const purchasedRemaining = Math.max(0, purchasedCredits - purchasedUsed);
    const effectiveLimit = limits.monthlyCredits + purchasedRemaining;

    // Check monthly credits
    const monthlyAlerts = await checkLimitAndAlert(
      userId,
      "monthly",
      monthlyCredits,
      effectiveLimit,
      monthStart,
      monthEnd,
    );
    result.alertTypes.push(...monthlyAlerts);
    result.alertsCreated += monthlyAlerts.length;

    if (result.alertsCreated > 0) {
      console.log(
        `[UsageAlerts] Created ${result.alertsCreated} alerts for user ${userId}: ${result.alertTypes.join(", ")}`,
      );
    }
  } catch (error) {
    console.error(
      `[UsageAlerts] Error checking alerts for user ${userId}:`,
      error,
    );
  }

  return result;
}

/**
 * Check and create alerts for all active users
 * This should be run by a cron job
 */
export async function checkAndCreateAlertsForAllUsers(): Promise<{
  usersChecked: number;
  totalAlertsCreated: number;
  errors: number;
}> {
  const stats = {
    usersChecked: 0,
    totalAlertsCreated: 0,
    errors: 0,
  };

  try {
    // Get all users with active subscriptions or recent activity
    // For efficiency, we only check users who have some usage
    const activeUsers = await subscriptionRepository.getActiveUserIds();

    console.log(`[UsageAlerts] Checking ${activeUsers.length} active users`);

    for (const userId of activeUsers) {
      try {
        const result = await checkAndCreateAlertsForUser(userId);
        stats.usersChecked++;
        stats.totalAlertsCreated += result.alertsCreated;
      } catch (error) {
        stats.errors++;
        console.error(`[UsageAlerts] Failed to check user ${userId}:`, error);
      }
    }

    console.log(
      `[UsageAlerts] Completed: ${stats.usersChecked} users checked, ${stats.totalAlertsCreated} alerts created, ${stats.errors} errors`,
    );
  } catch (error) {
    console.error("[UsageAlerts] Failed to check alerts for all users:", error);
  }

  return stats;
}

/**
 * Get active (unacknowledged) alerts for a user
 */
export async function getActiveAlertsForUser(userId: string) {
  return usageAlertRepository.getUnacknowledgedByUser(userId);
}

/**
 * Get the count of active alerts for a user
 */
export async function getActiveAlertCount(userId: string): Promise<number> {
  return usageAlertRepository.getActiveCount(userId);
}

/**
 * Acknowledge (dismiss) an alert
 */
export async function acknowledgeAlert(
  alertId: string,
  userId: string,
): Promise<boolean> {
  return usageAlertRepository.acknowledge(alertId, userId);
}

/**
 * Acknowledge all alerts for a user
 */
export async function acknowledgeAllAlerts(userId: string): Promise<number> {
  return usageAlertRepository.acknowledgeAll(userId);
}

/**
 * Send email notifications for pending alerts
 * Returns the number of emails sent
 */
export async function sendPendingAlertEmails(): Promise<number> {
  let emailsSent = 0;

  try {
    const pendingAlerts = await usageAlertRepository.getUnemailedAlerts(50);

    if (pendingAlerts.length === 0) {
      return 0;
    }

    console.log(
      `[UsageAlerts] Processing ${pendingAlerts.length} pending email notifications`,
    );

    for (const alert of pendingAlerts) {
      try {
        // Get user email
        const user = await userRepository.getUserById(alert.userId);
        if (!user?.email) {
          // Mark as sent anyway to avoid retrying
          await usageAlertRepository.markEmailSent(alert.id);
          continue;
        }

        // Email sending is currently disabled - logging only
        // To enable email notifications, integrate an email service:
        // - SendGrid: await sendgrid.send({ to: user.email, ... })
        // - AWS SES: await ses.sendEmail({ Destination: { ToAddresses: [user.email] }, ... })
        // - Resend: await resend.emails.send({ to: user.email, ... })
        console.log(
          `[UsageAlerts] Email notification: ${alert.alertType} to ${user.email} for ${alert.limitType} usage (email sending not configured)`,
        );

        // Mark as sent
        await usageAlertRepository.markEmailSent(alert.id);
        emailsSent++;
      } catch (error) {
        console.error(
          `[UsageAlerts] Failed to send email for alert ${alert.id}:`,
          error,
        );
      }
    }

    console.log(`[UsageAlerts] Sent ${emailsSent} email notifications`);
  } catch (error) {
    console.error("[UsageAlerts] Failed to send pending alert emails:", error);
  }

  return emailsSent;
}

/**
 * Get alert summary for display
 */
export function getAlertSummary(
  alertType: AlertType,
  _limitType: LimitType,
  currentUsage: number,
  usageLimit: number,
): {
  title: string;
  message: string;
  severity: "warning" | "error";
} {
  const percentage = Math.round((currentUsage / usageLimit) * 100);

  switch (alertType) {
    case "approaching_80":
      return {
        title: "Usage Warning",
        message: `You've used ${percentage}% of your monthly credits. Consider upgrading for more capacity.`,
        severity: "warning",
      };
    case "approaching_100":
      return {
        title: "Usage Critical",
        message: `You've used ${percentage}% of your monthly credits. You're about to hit your limit.`,
        severity: "error",
      };
    case "exceeded":
      return {
        title: "Limit Reached",
        message: `You've reached your monthly credit limit. Upgrade to continue using premium features.`,
        severity: "error",
      };
    default:
      return {
        title: "Usage Alert",
        message: `You've used ${percentage}% of your monthly credits.`,
        severity: "warning",
      };
  }
}
