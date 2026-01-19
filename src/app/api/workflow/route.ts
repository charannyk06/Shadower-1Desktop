import { getSession } from "auth/server";
import { workflowRepository } from "lib/db/repository";
import logger from "logger";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return Response.json([]);
  }

  try {
    const workflows = await workflowRepository.selectAll(session.user.id);
    return Response.json(workflows);
  } catch (error: any) {
    // In Electron dev mode, database access fails - return empty array
    if (
      error?.isElectronMode ||
      error?.message?.includes("SQLite") ||
      error?.message?.includes("Electron")
    ) {
      logger.warn(
        "[Workflow API] Electron mode detected, returning empty workflows array",
      );
      return Response.json([]);
    }
    logger.error("Failed to fetch workflows:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}

export async function POST(request: Request) {
  const {
    name,
    description,
    icon,
    id,
    isPublished,
    visibility,
    noGenerateInputNode,
  } = await request.json();

  const session = await getSession();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  // All authenticated users can create/edit workflows (roles/permissions removed)
  if (id) {
    // Editing existing workflow - check access
    const hasAccess = await workflowRepository.checkAccess(
      id,
      session.user.id,
      false,
    );
    if (!hasAccess) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  const workflow = await workflowRepository.save(
    {
      name,
      description,
      id,
      isPublished,
      visibility,
      icon,
      userId: session.user.id,
    },
    noGenerateInputNode,
  );

  return Response.json(workflow);
}
