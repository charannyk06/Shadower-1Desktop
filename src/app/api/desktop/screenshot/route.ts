import { getE2BDesktopService } from "lib/ai/sandbox/e2b-desktop-service";
import { validateSession } from "lib/api/auth-helpers";
import { getSessionForThread } from "lib/middleware/session-quota";

/**
 * GET /api/desktop/screenshot - Get a screenshot of the desktop sandbox
 * Used by DesktopPreview component for live polling
 */
export async function GET(req: Request) {
  try {
    const auth = await validateSession();
    if (!auth.success) return auth.response;

    const { searchParams } = new URL(req.url);
    const sandboxId = searchParams.get("sandboxId");
    const threadId = searchParams.get("threadId");

    // Need either sandboxId or threadId to find the session
    if (!sandboxId && !threadId) {
      return Response.json(
        { success: false, error: "sandboxId or threadId is required" },
        { status: 400 },
      );
    }

    let targetSandboxId = sandboxId;

    // If only threadId provided, look up the sandbox
    if (!targetSandboxId && threadId) {
      const session = await getSessionForThread(threadId, "e2b-desktop");
      if (!session) {
        return Response.json(
          {
            success: false,
            error: "No active desktop session for this thread",
          },
          { status: 404 },
        );
      }
      targetSandboxId = session.sessionId;
    }

    if (!targetSandboxId) {
      return Response.json(
        { success: false, error: "Could not determine sandbox ID" },
        { status: 400 },
      );
    }

    const service = getE2BDesktopService();

    if (!service.isConfigured()) {
      return Response.json(
        { success: false, error: "E2B is not configured" },
        { status: 503 },
      );
    }

    try {
      const result = await service.screenshot(targetSandboxId);

      return Response.json({
        success: true,
        screenshot: `data:image/png;base64,${result.base64}`,
        width: result.width,
        height: result.height,
        format: result.format,
        sandboxId: targetSandboxId,
        timestamp: new Date().toISOString(),
      });
    } catch (screenshotError: any) {
      // Session might have expired or been closed
      console.error("[Desktop Screenshot] Error:", screenshotError);
      return Response.json(
        {
          success: false,
          error: screenshotError.message || "Failed to take screenshot",
          code: "SCREENSHOT_FAILED",
        },
        { status: 500 },
      );
    }
  } catch (error: any) {
    console.error("[Desktop Screenshot] Unexpected error:", error);
    return Response.json(
      { success: false, error: error.message },
      { status: 500 },
    );
  }
}

/**
 * POST /api/desktop/screenshot - Take a screenshot and optionally save it
 */
export async function POST(req: Request) {
  try {
    const auth = await validateSession();
    if (!auth.success) return auth.response;

    const body = await req.json();
    const { sandboxId, threadId } = body;

    if (!sandboxId && !threadId) {
      return Response.json(
        { success: false, error: "sandboxId or threadId is required" },
        { status: 400 },
      );
    }

    let targetSandboxId = sandboxId;

    // If only threadId provided, look up the sandbox
    if (!targetSandboxId && threadId) {
      const session = await getSessionForThread(threadId, "e2b-desktop");
      if (!session) {
        return Response.json(
          {
            success: false,
            error: "No active desktop session for this thread",
          },
          { status: 404 },
        );
      }
      targetSandboxId = session.sessionId;
    }

    if (!targetSandboxId) {
      return Response.json(
        { success: false, error: "Could not determine sandbox ID" },
        { status: 400 },
      );
    }

    const service = getE2BDesktopService();

    if (!service.isConfigured()) {
      return Response.json(
        { success: false, error: "E2B is not configured" },
        { status: 503 },
      );
    }

    const result = await service.screenshot(targetSandboxId);

    return Response.json({
      success: true,
      screenshot: `data:image/png;base64,${result.base64}`,
      width: result.width,
      height: result.height,
      format: result.format,
      sandboxId: targetSandboxId,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("[Desktop Screenshot POST] Error:", error);
    return Response.json(
      { success: false, error: error.message },
      { status: 500 },
    );
  }
}
