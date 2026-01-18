import { NextRequest, NextResponse } from "next/server";
import { getSession } from "auth/server";
import { fragmentRepository } from "lib/db/repository";
import { E2BDesktopService } from "lib/ai/sandbox/e2b-desktop-service";
import logger from "logger";

interface RouteContext {
  params: Promise<{ fragmentId: string }>;
}

/**
 * POST /api/fragments/[fragmentId]/stream - Start VNC streaming for a fragment
 *
 * Note: Currently, fragments use code-interpreter sandboxes which don't support VNC streaming.
 * This endpoint is prepared for future desktop sandbox support. For now, it returns
 * the preview URL for web apps.
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

    // Check if fragment has a sandbox ID (for future desktop sandbox support)
    if (fragment.sandbox_id) {
      // Try to get VNC stream if this is a desktop sandbox
      // For now, fragments use code-interpreter sandboxes, so this will fail gracefully
      try {
        const desktopService = E2BDesktopService.getInstance();
        const streamInfo = await desktopService.startStream(
          fragment.sandbox_id,
          {
            requireAuth: true,
          },
        );

        logger.info(
          `[FRAGMENT_STREAM] Started VNC stream for fragment ${fragmentId}`,
        );

        return NextResponse.json({
          success: true,
          streamUrl: streamInfo.url,
          authKey: streamInfo.authKey,
          type: "vnc",
        });
      } catch (_error) {
        // Not a desktop sandbox - fall through to preview URL
        logger.debug(
          `[FRAGMENT_STREAM] Fragment ${fragmentId} doesn't support VNC, using preview URL`,
        );
      }
    }

    // For code-interpreter sandboxes (current implementation), return preview URL
    if (fragment.preview_url) {
      return NextResponse.json({
        success: true,
        streamUrl: fragment.preview_url,
        type: "preview",
        message:
          "Preview URL available (VNC streaming not supported for code-interpreter sandboxes)",
      });
    }

    return NextResponse.json(
      { error: "No preview or stream available for this fragment" },
      { status: 404 },
    );
  } catch (error: unknown) {
    logger.error("[API] POST /api/fragments/[fragmentId]/stream error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to start stream";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
