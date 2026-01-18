import { and, eq } from "drizzle-orm";
import { getBrowserbaseService } from "lib/ai/browser/browserbase-service";
import { validateSession } from "lib/api/auth-helpers";
import { pgDb as db } from "lib/db/pg/db.pg";
import { BrowserSessionTable } from "lib/db/pg/schema.pg";
import {
  deleteSessionQuerySchema,
  formatValidationError,
  streamQuerySchema,
  validateInput,
} from "lib/validation/browser-schemas";

/**
 * GET /api/browser/stream - Stream live screenshots from a browser session
 * Uses Server-Sent Events (SSE) to push updates to the client
 */
export async function GET(req: Request) {
  try {
    const auth = await validateSession();
    if (!auth.success) return auth.response;

    const { searchParams } = new URL(req.url);

    // Validate query params
    const queryParams = {
      sessionId: searchParams.get("sessionId") || "",
      interval: searchParams.get("interval") || "1000",
    };
    const validation = validateInput(streamQuerySchema, queryParams);
    if (!validation.success) {
      return Response.json(formatValidationError(validation.error), {
        status: 400,
      });
    }

    const { sessionId, interval: intervalMs } = validation.data;

    // Verify ownership
    const sessions = await db
      .select()
      .from(BrowserSessionTable)
      .where(
        and(
          eq(BrowserSessionTable.sessionId, sessionId),
          eq(BrowserSessionTable.userId, auth.userId),
        ),
      )
      .limit(1);

    if (sessions.length === 0) {
      return Response.json(
        { success: false, error: "Session not found" },
        { status: 404 },
      );
    }

    const session = sessions[0];

    if (session.status !== "active") {
      return Response.json(
        { success: false, error: "Session is not active" },
        { status: 400 },
      );
    }

    // Create SSE stream
    const encoder = new TextEncoder();
    let isActive = true;

    const stream = new ReadableStream({
      async start(controller) {
        const browserService = getBrowserbaseService();

        // Send initial connection event
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "connected", sessionId })}\n\n`,
          ),
        );

        // Poll for screenshots at the specified interval
        const pollScreenshots = async () => {
          while (isActive) {
            try {
              // Check if session is still active
              const currentSessions = await db
                .select()
                .from(BrowserSessionTable)
                .where(eq(BrowserSessionTable.sessionId, sessionId))
                .limit(1);

              if (
                currentSessions.length === 0 ||
                currentSessions[0].status !== "active"
              ) {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ type: "session_closed" })}\n\n`,
                  ),
                );
                isActive = false;
                controller.close();
                return;
              }

              // Take screenshot
              const screenshotResult =
                await browserService.screenshot(sessionId);
              const currentUrl = currentSessions[0].currentUrl;

              if (!screenshotResult.ok) {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: "error",
                      message: screenshotResult.error.message,
                    })}\n\n`,
                  ),
                );
                // Slow down on error
                await new Promise((resolve) => setTimeout(resolve, 5000));
                continue;
              }

              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: "screenshot",
                    data: screenshotResult.value.base64,
                    url: currentUrl,
                    timestamp: new Date().toISOString(),
                  })}\n\n`,
                ),
              );

              // Wait for next interval
              await new Promise((resolve) => setTimeout(resolve, intervalMs));
            } catch (error: unknown) {
              const errorMessage =
                error instanceof Error ? error.message : "Unknown error";
              console.error("Stream screenshot error:", error);
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: "error",
                    message: errorMessage,
                  })}\n\n`,
                ),
              );

              // On error, slow down polling
              await new Promise((resolve) => setTimeout(resolve, 5000));
            }
          }
        };

        // Start polling
        pollScreenshots();
      },

      cancel() {
        isActive = false;
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error("Browser stream error:", error);
    return Response.json(
      { success: false, error: errorMessage },
      { status: 500 },
    );
  }
}

/**
 * POST /api/browser/stream - Alternative endpoint to get a single frame
 * Useful for manual refresh or when SSE is not available
 */
export async function POST(req: Request) {
  try {
    const auth = await validateSession();
    if (!auth.success) return auth.response;

    const body = await req.json();

    // Validate input
    const validation = validateInput(deleteSessionQuerySchema, body);
    if (!validation.success) {
      return Response.json(formatValidationError(validation.error), {
        status: 400,
      });
    }

    const { sessionId } = validation.data;

    // Verify ownership
    const sessions = await db
      .select()
      .from(BrowserSessionTable)
      .where(
        and(
          eq(BrowserSessionTable.sessionId, sessionId),
          eq(BrowserSessionTable.userId, auth.userId),
        ),
      )
      .limit(1);

    if (sessions.length === 0) {
      return Response.json(
        { success: false, error: "Session not found" },
        { status: 404 },
      );
    }

    const session = sessions[0];

    if (session.status !== "active") {
      return Response.json(
        { success: false, error: "Session is not active" },
        { status: 400 },
      );
    }

    // Get single frame
    const browserService = getBrowserbaseService();
    const screenshotResult = await browserService.screenshot(sessionId);

    if (!screenshotResult.ok) {
      return Response.json(
        { success: false, error: screenshotResult.error.message },
        { status: 500 },
      );
    }

    return Response.json({
      success: true,
      frame: {
        data: screenshotResult.value.base64,
        url: session.currentUrl,
        timestamp: new Date().toISOString(),
        replayUrl: session.replayUrl,
      },
    });
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error("Browser frame error:", error);
    return Response.json(
      { success: false, error: errorMessage },
      { status: 500 },
    );
  }
}
