import { removeMcpClientAction } from "@/app/api/mcp/actions";
import { getSession } from "auth/server";
import { mcpRepository } from "lib/db/repository";
import logger from "lib/logger";
import { NextRequest, NextResponse } from "next/server";

export async function DELETE(
  _request: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  const params = await props.params;

  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const mcpServer = await mcpRepository.selectById(params.id);
    if (!mcpServer) {
      return NextResponse.json(
        { error: "MCP server not found" },
        { status: 404 },
      );
    }
    // All authenticated users can manage MCP servers (roles/permissions removed)

    await removeMcpClientAction(params.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Failed to delete MCP server:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to delete MCP server",
      },
      {
        status:
          error instanceof Error && error.message.includes("permission")
            ? 403
            : 500,
      },
    );
  }
}
