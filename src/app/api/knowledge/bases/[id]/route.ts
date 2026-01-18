import { getSession } from "auth/server";
import { NextResponse } from "next/server";
import {
  deletePointsByFilter,
  scrollPoints,
} from "lib/vector-search/qdrant-service";
import { COLLECTIONS } from "lib/vector-search/qdrant-client";
import { pgVectorIndexRepository } from "lib/db/pg/repositories/vector-index-repository.pg";
import logger from "logger";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/knowledge/bases/[id]
 * Delete a knowledge base and all its associated points
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
    const knowledgeBaseId = id;

    if (!knowledgeBaseId || typeof knowledgeBaseId !== "string") {
      return NextResponse.json(
        { error: "Invalid knowledge base ID" },
        { status: 400 },
      );
    }

    // Verify ownership by checking if at least one point exists with this knowledgeBaseId and userId
    const ownershipCheck = await scrollPoints(COLLECTIONS.KNOWLEDGE_BASE, {
      limit: 1,
      filter: {
        must: [
          { key: "knowledgeBaseId", match: { value: knowledgeBaseId } },
          { key: "userId", match: { value: session.user.id } },
        ],
      },
      withPayload: false,
      withVector: false,
    });

    if (ownershipCheck.points.length === 0) {
      // Check if knowledge base exists at all (for better error message)
      const existenceCheck = await scrollPoints(COLLECTIONS.KNOWLEDGE_BASE, {
        limit: 1,
        filter: {
          must: [{ key: "knowledgeBaseId", match: { value: knowledgeBaseId } }],
        },
        withPayload: false,
        withVector: false,
      });

      if (existenceCheck.points.length === 0) {
        return NextResponse.json(
          { error: "Knowledge base not found" },
          { status: 404 },
        );
      }

      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Delete all Qdrant points with matching knowledgeBaseId and userId
    await deletePointsByFilter(COLLECTIONS.KNOWLEDGE_BASE, {
      must: [
        { key: "knowledgeBaseId", match: { value: knowledgeBaseId } },
        { key: "userId", match: { value: session.user.id } },
      ],
    });

    // Delete PostgreSQL vector_index entries
    try {
      await pgVectorIndexRepository.deleteByEntity(
        "knowledge",
        knowledgeBaseId,
      );
      logger.info(
        `[Knowledge API] Deleted PostgreSQL entries for knowledge base ${knowledgeBaseId}`,
      );
    } catch (pgError: any) {
      // Log but don't fail - Qdrant deletion is the primary operation
      logger.warn(
        `[Knowledge API] Failed to delete PostgreSQL entries for knowledge base ${knowledgeBaseId}:`,
        pgError,
      );
    }

    logger.info(
      `[Knowledge API] Deleted knowledge base ${knowledgeBaseId} for user ${session.user.id}`,
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    logger.error("[Knowledge API] Failed to delete knowledge base:", error);
    return NextResponse.json(
      { error: error.message || "Failed to delete knowledge base" },
      { status: 500 },
    );
  }
}
