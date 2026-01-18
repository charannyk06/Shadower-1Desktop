import { getSession } from "auth/server";
import { NextResponse } from "next/server";
import { deletePoints } from "lib/vector-search/qdrant-service";
import { COLLECTIONS } from "lib/vector-search/qdrant-client";
import { getPoint } from "lib/vector-search/qdrant-service";
import logger from "logger";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/knowledge/memories/bulk
 * Bulk delete memories by IDs
 * Body: { ids: string[], role?: "user" | "assistant" }
 */
export async function DELETE(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { ids, role } = body as {
      ids: string[];
      role?: "user" | "assistant";
    };

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json(
        { error: "ids array is required and must not be empty" },
        { status: 400 },
      );
    }

    // Verify ownership and filter by role if specified
    const validIds: string[] = [];
    const errors: Array<{ id: string; error: string }> = [];

    for (const id of ids) {
      try {
        const point = await getPoint(COLLECTIONS.MESSAGES, id);

        if (!point) {
          errors.push({ id, error: "Memory not found" });
          continue;
        }

        // Check ownership
        if (point.payload?.userId !== session.user.id) {
          errors.push({ id, error: "Forbidden" });
          continue;
        }

        // Filter by role if specified
        if (role && point.payload?.role !== role) {
          // Skip this ID if role doesn't match
          continue;
        }

        validIds.push(id);
      } catch (error: any) {
        errors.push({ id, error: error.message || "Failed to verify memory" });
      }
    }

    if (validIds.length === 0) {
      return NextResponse.json(
        {
          success: false,
          deleted: 0,
          errors,
          message: "No valid memories to delete",
        },
        { status: 400 },
      );
    }

    // Delete valid memories
    try {
      await deletePoints(COLLECTIONS.MESSAGES, validIds);

      logger.info(
        `[Knowledge API] Bulk deleted ${validIds.length} memories for user ${session.user.id}`,
      );

      return NextResponse.json({
        success: true,
        deleted: validIds.length,
        totalRequested: ids.length,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (deleteError: any) {
      logger.error(
        "[Knowledge API] Failed to bulk delete memories:",
        deleteError,
      );
      return NextResponse.json(
        {
          success: false,
          deleted: 0,
          error: deleteError.message || "Failed to delete memories",
        },
        { status: 500 },
      );
    }
  } catch (error: any) {
    logger.error("[Knowledge API] Failed to bulk delete memories:", error);
    return NextResponse.json(
      { error: error.message || "Failed to bulk delete memories" },
      { status: 500 },
    );
  }
}
