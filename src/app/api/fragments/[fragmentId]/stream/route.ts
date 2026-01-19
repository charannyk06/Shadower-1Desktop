import { NextRequest, NextResponse } from "next/server";
import { getSession } from "auth/server";
import { fragmentRepository } from "lib/db/repository";
import logger from "logger";

interface RouteContext {
  params: Promise<{ fragmentId: string }>;
}

/**
 * POST /api/fragments/[fragmentId]/stream - Start VNC streaming for a fragment
 *
 * Note: E2B cloud services have been removed for local-first architecture.
 * This endpoint returns the preview URL for web apps.
 * VNC streaming is not supported in local-first mode.
 */
export async function POST(_req: NextRequest, context: RouteContext) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { fragmentId } = await context.params;
    const fragment = await fragmentRepository.getById(fragmentId);

    if (!fragment) {
      return NextResponse.json(
        { error: "Fragment not found" },
        { status: 404 },
      );
    }

    // Verify ownership
    if (fragment.user_id !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // For local-first mode, VNC streaming is not supported
    // Return preview URL if available
    if (fragment.preview_url) {
      return NextResponse.json({
        success: true,
        streamUrl: fragment.preview_url,
        type: "preview",
        message:
          "Preview URL available (VNC streaming not supported in local-first mode)",
      });
    }

    return NextResponse.json(
      {
        error:
          "No preview available for this fragment. VNC streaming is not supported in local-first mode.",
      },
      { status: 404 },
    );
  } catch (error: unknown) {
    logger.error("[API] POST /api/fragments/[fragmentId]/stream error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to start stream";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
