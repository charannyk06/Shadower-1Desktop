import { and, desc, eq } from "drizzle-orm";
import { getBrowserbaseService } from "lib/ai/browser/browserbase-service";
import { BrowserSessionOptions } from "lib/ai/browser/types";
import { validateSession } from "lib/api/auth-helpers";
import { pgDb as db } from "lib/db/pg/db.pg";
import { BrowserSessionTable } from "lib/db/pg/schema.pg";
import { checkBrowserSessionRateLimit } from "lib/middleware/rate-limit";
import { AutomationErrorCode } from "lib/utils/result";
import {
  createSessionSchema,
  deleteSessionQuerySchema,
  formatValidationError,
  getSessionQuerySchema,
  updateSessionSchema,
  validateInput,
} from "lib/validation/browser-schemas";

/**
 * POST /api/browser/session - Create a new browser session
 */
export async function POST(req: Request) {
  try {
    const auth = await validateSession();
    if (!auth.success) return auth.response;

    // Check rate limit first (faster check)
    const rateLimitCheck = await checkBrowserSessionRateLimit(auth.userId);
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

    // Note: Session quota is now checked transactionally within browserService.createSession()
    // This prevents race conditions where multiple requests pass quota check simultaneously

    const body = await req.json();

    // Validate input
    const validation = validateInput(createSessionSchema, body);
    if (!validation.success) {
      return Response.json(formatValidationError(validation.error), {
        status: 400,
      });
    }

    const { threadId, stealth = false, proxy, viewport } = validation.data;

    const browserService = getBrowserbaseService();

    // Create session options with userId
    const options: BrowserSessionOptions = {
      userId: auth.userId,
      threadId,
      stealth,
      proxy,
      viewport,
    };

    // Create session via Browserbase (methods now return Result type)
    const sessionResult = stealth
      ? await browserService.createStealthSession(auth.userId, threadId)
      : await browserService.createSession(options);

    // Handle Result type - check for quota exceeded vs other errors
    if (!sessionResult.ok) {
      const isQuotaError =
        sessionResult.error.code === AutomationErrorCode.SESSION_LIMIT_EXCEEDED;
      return Response.json(
        {
          success: false,
          error: sessionResult.error.message,
          code: sessionResult.error.code,
          details: sessionResult.error.details,
        },
        { status: isQuotaError ? 429 : 500 },
      );
    }

    const session = sessionResult.value;

    // Session is already stored in database by the service, just return the result
    return Response.json({
      success: true,
      session: {
        id: session.id,
        sessionId: session.sessionId,
        status: "active",
        replayUrl: session.replayUrl,
        provider: "browserbase",
      },
    });
  } catch (error: any) {
    console.error("Browser session creation error:", error);
    return Response.json(
      { success: false, error: error.message },
      { status: 500 },
    );
  }
}

/**
 * GET /api/browser/session - Get active sessions or specific session
 */
export async function GET(req: Request) {
  try {
    const auth = await validateSession();
    if (!auth.success) return auth.response;

    const { searchParams } = new URL(req.url);

    // Validate query params
    const queryParams = {
      sessionId: searchParams.get("sessionId") || undefined,
      threadId: searchParams.get("threadId") || undefined,
    };
    const validation = validateInput(getSessionQuerySchema, queryParams);
    if (!validation.success) {
      return Response.json(formatValidationError(validation.error), {
        status: 400,
      });
    }

    const { sessionId, threadId } = validation.data;

    if (sessionId) {
      // Get specific session
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

      return Response.json({ success: true, session: sessions[0] });
    }

    // Get all active sessions or sessions for a thread
    const conditions = [
      eq(BrowserSessionTable.userId, auth.userId),
      eq(BrowserSessionTable.status, "active"),
    ];

    if (threadId) {
      conditions.push(eq(BrowserSessionTable.threadId, threadId));
    }

    const sessions = await db
      .select()
      .from(BrowserSessionTable)
      .where(and(...conditions))
      .orderBy(desc(BrowserSessionTable.createdAt))
      .limit(10);

    return Response.json({ success: true, sessions });
  } catch (error: any) {
    console.error("Browser session fetch error:", error);
    return Response.json(
      { success: false, error: error.message },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/browser/session - Close a browser session
 */
export async function DELETE(req: Request) {
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

    // Close session via Browserbase
    const browserService = getBrowserbaseService();
    const closeResult = await browserService.closeSession(sessionId);

    if (!closeResult.ok) {
      return Response.json(
        { success: false, error: closeResult.error.message },
        { status: 500 },
      );
    }

    // Session is updated in database by the service, just return success
    return Response.json({ success: true, message: "Session closed" });
  } catch (error: any) {
    console.error("Browser session close error:", error);
    return Response.json(
      { success: false, error: error.message },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/browser/session - Update session (e.g., current URL)
 */
export async function PATCH(req: Request) {
  try {
    const auth = await validateSession();
    if (!auth.success) return auth.response;

    const body = await req.json();

    // Validate input
    const validation = validateInput(updateSessionSchema, body);
    if (!validation.success) {
      return Response.json(formatValidationError(validation.error), {
        status: 400,
      });
    }

    const { sessionId, currentUrl, status } = validation.data;

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

    // Build update object
    const updates: Partial<typeof BrowserSessionTable.$inferInsert> = {};
    if (currentUrl) updates.currentUrl = currentUrl;
    if (status) updates.status = status;
    if (status === "closed") updates.closedAt = new Date();

    // Update database
    const [updated] = await db
      .update(BrowserSessionTable)
      .set(updates)
      .where(eq(BrowserSessionTable.sessionId, sessionId))
      .returning();

    return Response.json({ success: true, session: updated });
  } catch (error: any) {
    console.error("Browser session update error:", error);
    return Response.json(
      { success: false, error: error.message },
      { status: 500 },
    );
  }
}
