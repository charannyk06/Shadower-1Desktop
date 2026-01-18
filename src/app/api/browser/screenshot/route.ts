import { and, eq } from "drizzle-orm";
import { getBrowserbaseService } from "lib/ai/browser/browserbase-service";
import { validateSession } from "lib/api/auth-helpers";
import { pgDb as db } from "lib/db/pg/db.pg";
import { BrowserSessionTable } from "lib/db/pg/schema.pg";
import { checkBrowserScreenshotRateLimit } from "lib/middleware/rate-limit";
import {
  deleteSessionQuerySchema,
  formatValidationError,
  screenshotRequestSchema,
  validateInput,
} from "lib/validation/browser-schemas";
import { nanoid } from "nanoid";

/**
 * POST /api/browser/screenshot - Take a screenshot of a browser session
 */
export async function POST(req: Request) {
  try {
    const auth = await validateSession();
    if (!auth.success) return auth.response;

    // Check rate limit
    const rateLimitCheck = await checkBrowserScreenshotRateLimit(auth.userId);
    if (!rateLimitCheck.ok) {
      const headers = new Headers({ "Content-Type": "application/json" });
      if (rateLimitCheck.error.details?.retryAfter) {
        headers.set(
          "Retry-After",
          String(rateLimitCheck.error.details.retryAfter),
        );
      }
      return new Response(
        JSON.stringify({
          success: false,
          error: rateLimitCheck.error.message,
          code: rateLimitCheck.error.code,
          retryAfter: rateLimitCheck.error.details?.retryAfter,
        }),
        { status: 429, headers },
      );
    }

    const body = await req.json();

    // Validate input
    const validation = validateInput(screenshotRequestSchema, body);
    if (!validation.success) {
      return Response.json(formatValidationError(validation.error), {
        status: 400,
      });
    }

    const { sessionId, saveToHistory = true } = validation.data;

    // Verify ownership and get session
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

    // Take screenshot via Browserbase
    const browserService = getBrowserbaseService();
    const screenshotResult = await browserService.screenshot(sessionId);

    // Handle Result type - check for success (Result uses 'ok' property)
    if (!screenshotResult.ok) {
      return Response.json(
        { success: false, error: screenshotResult.error.message },
        { status: 500 },
      );
    }

    const screenshot = screenshotResult.value;

    // Optionally save to session history
    if (saveToHistory) {
      const screenshotEntry = {
        id: nanoid(),
        timestamp: new Date().toISOString(),
        url: session.currentUrl || undefined,
        // For now, store as base64 thumbnail (could be uploaded to storage later)
        thumbnail: screenshot.base64.substring(0, 1000), // Truncated for storage
      };

      const existingScreenshots = (session.screenshots as any[]) || [];
      const updatedScreenshots = [
        ...existingScreenshots,
        screenshotEntry,
      ].slice(-20); // Keep last 20

      await db
        .update(BrowserSessionTable)
        .set({
          screenshots: updatedScreenshots,
        })
        .where(eq(BrowserSessionTable.id, session.id));
    }

    return Response.json({
      success: true,
      screenshot: {
        data: screenshot.base64,
        format: screenshot.format,
        width: screenshot.width,
        height: screenshot.height,
        mimeType: `image/${screenshot.format}`,
        timestamp: new Date().toISOString(),
        url: session.currentUrl,
      },
    });
  } catch (error: any) {
    console.error("Browser screenshot error:", error);
    return Response.json(
      { success: false, error: error.message },
      { status: 500 },
    );
  }
}

/**
 * GET /api/browser/screenshot - Get screenshot history for a session
 */
export async function GET(req: Request) {
  try {
    const auth = await validateSession();
    if (!auth.success) return auth.response;

    const { searchParams } = new URL(req.url);

    // Validate query params
    const queryParams = {
      sessionId: searchParams.get("sessionId") || "",
    };
    const validation = validateInput(deleteSessionQuerySchema, queryParams);
    if (!validation.success) {
      return Response.json(formatValidationError(validation.error), {
        status: 400,
      });
    }

    const { sessionId } = validation.data;

    // Verify ownership and get session
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

    return Response.json({
      success: true,
      screenshots: sessions[0].screenshots || [],
    });
  } catch (error: any) {
    console.error("Browser screenshot history error:", error);
    return Response.json(
      { success: false, error: error.message },
      { status: 500 },
    );
  }
}
