import { getSession } from "auth/server";
import { workflowRepository } from "lib/db/repository";
import logger from "logger";

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getSession();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const hasAccess = await workflowRepository.checkAccess(id, session.user.id);
    if (!hasAccess) {
      return new Response("Unauthorized", { status: 401 });
    }
    const workflow = await workflowRepository.selectStructureById(id);
    return Response.json(workflow);
  } catch (error: any) {
    // In Electron dev mode, database access fails
    if (
      error?.isElectronMode ||
      error?.message?.includes("SQLite") ||
      error?.message?.includes("Electron")
    ) {
      logger.warn(
        "[Workflow Structure API] Electron mode detected, returning null",
      );
      return Response.json(null, { status: 503 });
    }
    logger.error("Failed to fetch workflow structure:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { nodes, edges, deleteNodes, deleteEdges } = await request.json();
    const { id } = await params;
    const session = await getSession();
    if (!session) {
      return new Response("Unauthorized", { status: 401 });
    }

    const hasAccess = await workflowRepository.checkAccess(
      id,
      session.user.id,
      false,
    );
    if (!hasAccess) {
      return new Response("Unauthorized", { status: 401 });
    }

    await workflowRepository.saveStructure({
      workflowId: id,
      nodes: (nodes || []).map((v: any) => ({
        ...v,
        workflowId: id,
      })),
      edges: (edges || []).map((v: any) => ({
        ...v,
        workflowId: id,
      })),
      deleteNodes: deleteNodes || [],
      deleteEdges: deleteEdges || [],
    });

    return Response.json({ success: true });
  } catch (error: any) {
    // In Electron dev mode, database access fails
    if (
      error?.isElectronMode ||
      error?.message?.includes("SQLite") ||
      error?.message?.includes("Electron")
    ) {
      logger.warn(
        "[Workflow Structure API] Electron mode detected, workflow operations not available",
      );
      return Response.json(
        {
          error: "Workflow operations are not available in Electron dev mode",
        },
        { status: 503 },
      );
    }
    logger.error("[Structure API] Error saving structure:", error);
    return Response.json(
      {
        error: String(error),
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
