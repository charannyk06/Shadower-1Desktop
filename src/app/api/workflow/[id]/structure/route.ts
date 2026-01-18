import { getSession } from "auth/server";
import { workflowRepository } from "lib/db/repository";

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getSession();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }
  const hasAccess = await workflowRepository.checkAccess(id, session.user.id);
  if (!hasAccess) {
    return new Response("Unauthorized", { status: 401 });
  }
  const workflow = await workflowRepository.selectStructureById(id);
  return Response.json(workflow);
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
  } catch (error) {
    console.error("[Structure API] Error saving structure:", error);
    return Response.json(
      {
        error: String(error),
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
