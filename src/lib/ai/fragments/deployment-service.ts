import { nanoid } from "nanoid";
import {
  fragmentRepository,
  fragmentSharesRepository,
} from "lib/db/repository";
import { localSandboxCostTracker } from "lib/billing/sandbox-cost-tracker";
import logger from "logger";

/**
 * Duration options for fragment deployment
 */
export type DeploymentDuration = "1h" | "6h" | "24h" | "7d";

/**
 * Parse duration string to milliseconds
 */
function parseDuration(duration: DeploymentDuration): number {
  switch (duration) {
    case "1h":
      return 60 * 60 * 1000; // 1 hour
    case "6h":
      return 6 * 60 * 60 * 1000; // 6 hours
    case "24h":
      return 24 * 60 * 60 * 1000; // 24 hours
    case "7d":
      return 7 * 24 * 60 * 60 * 1000; // 7 days
    default:
      return 24 * 60 * 60 * 1000; // Default to 24 hours
  }
}

/**
 * Deployment Service - One-click deployment for fragments
 * Handles local session management and shareable link creation
 */
export class DeploymentService {
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.NEXT_PUBLIC_BASE_URL ||
      "http://localhost:3000";
  }

  /**
   * Deploy a fragment and create a shareable link
   */
  async deployFragment(
    fragmentId: string,
    userId: string,
    duration: DeploymentDuration = "24h",
  ): Promise<{
    url: string;
    shareId: string;
    expiresAt: Date;
    previewUrl?: string;
  }> {
    logger.info(`[DEPLOY] Deploying fragment ${fragmentId} for ${duration}`);

    // Get fragment
    const fragment = await fragmentRepository.getById(fragmentId);
    if (!fragment) {
      throw new Error(`Fragment ${fragmentId} not found`);
    }

    // Verify ownership
    if (fragment.user_id !== userId) {
      throw new Error("Not authorized to deploy this fragment");
    }

    // Calculate expiration
    const durationMs = parseDuration(duration);
    const expiresAt = new Date(Date.now() + durationMs);

    // For local execution, no timeout extension needed
    // Local processes run on user's machine without cloud timeouts
    if (fragment.session_id) {
      logger.debug(
        `[DEPLOY] Local session ${fragment.session_id} - no timeout extension needed`,
      );
    }

    // Create shareable link
    const shareId = nanoid(12); // Short, URL-friendly ID

    await fragmentSharesRepository.create({
      fragmentId,
      userId,
      shareId,
      expiresAt,
    });

    // Update fragment status
    await fragmentRepository.update(fragmentId, {
      status: "deployed",
      deploymentUrl: `${this.baseUrl}/f/${shareId}`,
    });

    // Track usage locally (no cost for local execution)
    await localSandboxCostTracker.trackSession({
      userId,
      sessionId: fragment.session_id || `deploy-${fragmentId}`,
      template: fragment.template,
      durationMs,
      operationType: "execute" as const,
    });

    const url = `${this.baseUrl}/f/${shareId}`;

    logger.info(`[DEPLOY] ✅ Fragment deployed: ${url}`);

    return {
      url,
      shareId,
      expiresAt,
      previewUrl: fragment.preview_url,
    };
  }

  // Note: Local execution doesn't need timeout extension
  // Local processes run on user's machine without cloud-based limits

  /**
   * Get deployment status for a fragment
   */
  async getDeploymentStatus(fragmentId: string): Promise<{
    isDeployed: boolean;
    shares: Array<{
      shareId: string;
      url: string;
      expiresAt: Date | null;
      isActive: boolean;
      viewCount: number;
    }>;
  }> {
    const fragment = await fragmentRepository.getById(fragmentId);
    if (!fragment) {
      throw new Error(`Fragment ${fragmentId} not found`);
    }

    const shares = await fragmentSharesRepository.getByFragment(fragmentId);

    return {
      isDeployed: fragment.status === "deployed",
      shares: shares.map((share) => ({
        shareId: share.shareId,
        url: `${this.baseUrl}/f/${share.shareId}`,
        expiresAt: share.expiresAt,
        isActive: share.isActive,
        viewCount: share.viewCount,
      })),
    };
  }

  /**
   * Revoke a deployment share
   */
  async revokeShare(shareId: string, userId: string): Promise<void> {
    const share = await fragmentSharesRepository.getByShareId(shareId);
    if (!share) {
      throw new Error(`Share ${shareId} not found`);
    }

    if (share.userId !== userId) {
      throw new Error("Not authorized to revoke this share");
    }

    await fragmentSharesRepository.deactivate(shareId);
    logger.info(`[DEPLOY] Revoked share ${shareId}`);
  }

  /**
   * Get public fragment for viewing (no auth required)
   */
  async getPublicFragment(shareId: string): Promise<{
    fragment: {
      id: string;
      title: string;
      description: string;
      template: string;
      code: string;
      previewUrl?: string;
    };
    share: {
      expiresAt: Date | null;
      viewCount: number;
    };
  } | null> {
    const share = await fragmentSharesRepository.getByShareId(shareId);
    if (!share) {
      return null;
    }

    // Check if share is active and not expired
    if (!share.isActive) {
      return null;
    }

    if (share.expiresAt && share.expiresAt < new Date()) {
      return null;
    }

    const fragment = await fragmentRepository.getById(share.fragmentId);
    if (!fragment) {
      return null;
    }

    // Validate required fields exist
    if (!fragment.template || !fragment.code) {
      logger.warn(
        `[DEPLOY] Fragment ${share.fragmentId} missing required fields for public view`,
      );
      return null;
    }

    // Increment view count
    await fragmentSharesRepository.incrementViewCount(shareId);

    return {
      fragment: {
        id: fragment.id,
        title: fragment.title,
        description: fragment.description ?? "",
        template: fragment.template,
        code: fragment.code,
        previewUrl: fragment.preview_url,
      },
      share: {
        expiresAt: share.expiresAt ?? null,
        viewCount: share.viewCount + 1, // Include current view
      },
    };
  }
}

// Singleton instance
export const deploymentService = new DeploymentService();
