import { NextRequest, NextResponse } from "next/server";
import { getSession } from "auth/server";
import { fragmentRepository } from "lib/db/repository";
import logger from "logger";

/**
 * GET /api/fragments - List user's fragments
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const threadId = searchParams.get("threadId");
    const limit = parseInt(searchParams.get("limit") || "50", 10);

    let fragments;

    if (threadId) {
      fragments = await fragmentRepository.getByThread(threadId);
    } else {
      fragments = await fragmentRepository.getByUser(session.user.id, limit);
    }

    return NextResponse.json({
      fragments: fragments.map((f) => ({
        id: f.id,
        title: f.title,
        description: f.description,
        template: f.template,
        status: f.status,
        previewUrl: f.preview_url,
        deploymentUrl: f.deployment_url,
        createdAt: f.created_at.toISOString(),
        updatedAt: f.updated_at.toISOString(),
      })),
    });
  } catch (error: unknown) {
    logger.error("[API] GET /api/fragments error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to list fragments";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
