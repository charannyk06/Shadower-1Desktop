import { NextRequest, NextResponse } from "next/server";
import { getSession } from "auth/server";
import {
  deploymentService,
  type DeploymentDuration,
} from "lib/ai/fragments/deployment-service";
import logger from "logger";

interface RouteContext {
  params: Promise<{ fragmentId: string }>;
}

/**
 * POST /api/fragments/[fragmentId]/deploy - Deploy a fragment
 */
export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { fragmentId } = await context.params;
    const body = await req.json().catch(() => ({}));
    const duration = (body.duration as DeploymentDuration) || "24h";

    // Validate duration
    if (!["1h", "6h", "24h", "7d"].includes(duration)) {
      return NextResponse.json(
        { error: "Invalid duration. Must be: 1h, 6h, 24h, or 7d" },
        { status: 400 },
      );
    }

    const result = await deploymentService.deployFragment(
      fragmentId,
      session.user.id,
      duration,
    );

    return NextResponse.json({
      success: true,
      url: result.url,
      shareId: result.shareId,
      expiresAt: result.expiresAt.toISOString(),
      previewUrl: result.previewUrl,
    });
  } catch (error: unknown) {
    logger.error("[API] POST /api/fragments/[fragmentId]/deploy error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to deploy fragment";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

/**
 * GET /api/fragments/[fragmentId]/deploy - Get deployment status
 */
export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { fragmentId } = await context.params;

    const status = await deploymentService.getDeploymentStatus(fragmentId);

    return NextResponse.json(status);
  } catch (error: unknown) {
    logger.error("[API] GET /api/fragments/[fragmentId]/deploy error:", error);
    const errorMessage =
      error instanceof Error
        ? error.message
        : "Failed to get deployment status";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
