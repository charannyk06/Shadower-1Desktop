import { NextRequest, NextResponse } from "next/server";
import { getSession } from "auth/server";
import { fragmentRepository } from "lib/db/repository";
import logger from "logger";

interface RouteContext {
  params: Promise<{ fragmentId: string }>;
}

/**
 * GET /api/fragments/[fragmentId] - Get a specific fragment
 */
export async function GET(_req: NextRequest, context: RouteContext) {
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

    return NextResponse.json({
      fragment: {
        id: fragment.id,
        title: fragment.title,
        description: fragment.description,
        template: fragment.template,
        code: fragment.code,
        filePath: fragment.file_path,
        port: fragment.port,
        sessionId: fragment.session_id,
        previewUrl: fragment.preview_url,
        deploymentUrl: fragment.deployment_url,
        status: fragment.status,
        errorMessage: fragment.error_message,
        createdAt: fragment.created_at.toISOString(),
        updatedAt: fragment.updated_at.toISOString(),
      },
    });
  } catch (error: unknown) {
    logger.error("[API] GET /api/fragments/[fragmentId] error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to get fragment";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

/**
 * DELETE /api/fragments/[fragmentId] - Delete a fragment
 */
export async function DELETE(_req: NextRequest, context: RouteContext) {
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

    await fragmentRepository.delete(fragmentId);

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    logger.error("[API] DELETE /api/fragments/[fragmentId] error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to delete fragment";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
