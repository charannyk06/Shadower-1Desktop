import { Sandbox } from "@e2b/code-interpreter";
import { NextResponse } from "next/server";
import logger from "logger";

/**
 * Debug endpoint to manually test E2B API calls
 * GET /api/debug/e2b-test?template=nextjs-developer
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const template = searchParams.get("template") || "nextjs-developer";
  const apiKey = process.env.E2B_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "E2B_API_KEY not configured" },
      { status: 500 },
    );
  }

  try {
    logger.info(
      `[E2B_TEST] Attempting to create sandbox with template: ${template}`,
    );

    const startTime = Date.now();
    const sandbox = await Sandbox.create(template, {
      apiKey,
      timeoutMs: 30000, // 30 seconds for test
      // Removed secure: false to match working E2BSandboxService approach
    });

    const duration = Date.now() - startTime;

    logger.info(
      `[E2B_TEST] Successfully created sandbox ${sandbox.sandboxId} in ${duration}ms`,
    );

    // Clean up immediately
    try {
      await sandbox.kill();
      logger.info(`[E2B_TEST] Cleaned up sandbox ${sandbox.sandboxId}`);
    } catch (cleanupError) {
      logger.warn(`[E2B_TEST] Failed to cleanup sandbox:`, cleanupError);
    }

    return NextResponse.json({
      success: true,
      sandboxId: sandbox.sandboxId,
      template,
      durationMs: duration,
      message: "E2B API is working correctly",
    });
  } catch (error: any) {
    logger.error(`[E2B_TEST] Failed to create sandbox:`, {
      error: error?.message || String(error),
      errorType: error?.constructor?.name,
      errorCode: error?.code,
      errorStatus: error?.status,
      errorResponse: error?.response,
      stack: error?.stack,
      template,
    });

    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Unknown error",
        errorType: error?.constructor?.name,
        errorCode: error?.code,
        errorStatus: error?.status,
        errorDetails: error?.response || error?.body || undefined,
        template,
        suggestion: error?.message?.includes("API usage limits")
          ? "Check your E2B dashboard budget settings: https://e2b.dev/dashboard/charannyan/budget"
          : "Check E2B API status and your API key configuration",
      },
      { status: 500 },
    );
  }
}
