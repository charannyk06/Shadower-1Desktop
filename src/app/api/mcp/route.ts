import { getSession } from "auth/server";
import logger from "logger";
import { McpServerTable } from "lib/db/sqlite/schema.sqlite";
import { NextResponse } from "next/server";
import { saveMcpClientAction } from "./actions";

/**
 * MCP Route - Electron-Only
 *
 * Handles MCP server connections for the local user.
 */

export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // All authenticated users can create MCP connections (roles/permissions removed)

  const json = (await request.json()) as typeof McpServerTable.$inferInsert;

  try {
    const result = await saveMcpClientAction(json);

    return NextResponse.json({ success: true, id: result.client.getInfo().id });
  } catch (error: any) {
    logger.error("Failed to save MCP client", { error });
    return NextResponse.json(
      { message: error.message || "Failed to save MCP client" },
      { status: 500 },
    );
  }
}
