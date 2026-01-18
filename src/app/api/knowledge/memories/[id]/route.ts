import { getSession } from "auth/server";
import { NextResponse } from "next/server";
import {
  getPoint,
  upsertPoints,
  deletePoints,
} from "lib/vector-search/qdrant-service";
import { COLLECTIONS } from "lib/vector-search/qdrant-client";
import { generateTextEmbedding } from "lib/ai/embeddings/embedding-service";
import logger from "logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/knowledge/memories/[id]
 * Get a specific memory by ID
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const point = await getPoint(COLLECTIONS.MESSAGES, id);

    if (!point) {
      return NextResponse.json({ error: "Memory not found" }, { status: 404 });
    }

    // Check ownership
    if (point.payload?.userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json({
      id: String(point.id),
      content: String(point.payload?.content || ""),
      role: String(point.payload?.role || "user"),
      threadId: point.payload?.threadId as string | undefined,
      messageId: point.payload?.messageId as string | undefined,
      createdAt: point.payload?.createdAt as string | undefined,
      userId: point.payload?.userId as string | undefined,
    });
  } catch (error: any) {
    logger.error("[Knowledge API] Failed to get memory:", error);
    return NextResponse.json(
      { error: error.message || "Failed to get memory" },
      { status: 500 },
    );
  }
}

/**
 * PUT /api/knowledge/memories/[id]
 * Update a memory (re-index with new content)
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { content } = body;

    if (!content || typeof content !== "string") {
      return NextResponse.json(
        { error: "Content is required" },
        { status: 400 },
      );
    }

    // Get existing point to preserve metadata
    const existingPoint = await getPoint(COLLECTIONS.MESSAGES, id);

    if (!existingPoint) {
      return NextResponse.json({ error: "Memory not found" }, { status: 404 });
    }

    // Check ownership
    if (existingPoint.payload?.userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Generate new embedding for updated content
    const embedding = await generateTextEmbedding(content);

    // Update point with new content and embedding
    await upsertPoints(
      COLLECTIONS.MESSAGES,
      [
        {
          id: id,
          vector: embedding,
          payload: {
            ...existingPoint.payload,
            content,
            updatedAt: new Date().toISOString(),
          },
        },
      ],
      { wait: true },
    );

    return NextResponse.json({
      id: id,
      content,
      success: true,
    });
  } catch (error: any) {
    logger.error("[Knowledge API] Failed to update memory:", error);
    return NextResponse.json(
      { error: error.message || "Failed to update memory" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/knowledge/memories/[id]
 * Delete a memory
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    // Get existing point to check ownership
    const existingPoint = await getPoint(COLLECTIONS.MESSAGES, id);

    if (!existingPoint) {
      return NextResponse.json({ error: "Memory not found" }, { status: 404 });
    }

    // Check ownership
    if (existingPoint.payload?.userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Delete from Qdrant
    await deletePoints(COLLECTIONS.MESSAGES, [id]);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    logger.error("[Knowledge API] Failed to delete memory:", error);
    return NextResponse.json(
      { error: error.message || "Failed to delete memory" },
      { status: 500 },
    );
  }
}
