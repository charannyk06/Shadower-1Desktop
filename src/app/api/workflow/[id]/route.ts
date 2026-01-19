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
    const workflow = await workflowRepository.selectById(id);
    return Response.json(workflow);
  } catch (error: any) {
    // In Electron dev mode, database access fails
    if (
      error?.isElectronMode ||
      error?.message?.includes("SQLite") ||
      error?.message?.includes("Electron")
    ) {
      logger.warn(
        "[Workflow API] Electron mode detected, workflow operations not available",
      );
      return Response.json(
        { error: "Workflow operations are not available in Electron dev mode" },
        { status: 503 },
      );
    }
    logger.error("Failed to fetch workflow:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { visibility, isPublished } = await request.json();

  const session = await getSession();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    // All authenticated users can edit workflows (roles/permissions removed)
    const hasAccess = await workflowRepository.checkAccess(
      id,
      session.user.id,
      false,
    );
    if (!hasAccess) {
      return new Response("Unauthorized", { status: 401 });
    }

    // Get existing workflow
    const existingWorkflow = await workflowRepository.selectById(id);
    if (!existingWorkflow) {
      return new Response("Workflow not found", { status: 404 });
    }

    // Update only the specified fields
    const updatedWorkflow = await workflowRepository.save({
      ...existingWorkflow,
      visibility: visibility ?? existingWorkflow.visibility,
      isPublished: isPublished ?? existingWorkflow.isPublished,
      updatedAt: new Date(),
    });

    return Response.json(updatedWorkflow);
  } catch (error: any) {
    // In Electron dev mode, database access fails
    if (
      error?.isElectronMode ||
      error?.message?.includes("SQLite") ||
      error?.message?.includes("Electron")
    ) {
      logger.warn(
        "[Workflow API] Electron mode detected, workflow operations not available",
      );
      return Response.json(
        { error: "Workflow operations are not available in Electron dev mode" },
        { status: 503 },
      );
    }
    logger.error("Failed to update workflow:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}

export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getSession();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    // All authenticated users can delete workflows (roles/permissions removed)
    const hasAccess = await workflowRepository.checkAccess(
      id,
      session.user.id,
      false,
    );
    if (!hasAccess) {
      return new Response("Unauthorized", { status: 401 });
    }
    await workflowRepository.delete(id);
    return Response.json({ message: "Workflow deleted" });
  } catch (error: any) {
    // In Electron dev mode, database access fails
    if (
      error?.isElectronMode ||
      error?.message?.includes("SQLite") ||
      error?.message?.includes("Electron")
    ) {
      logger.warn(
        "[Workflow API] Electron mode detected, workflow operations not available",
      );
      return Response.json(
        { error: "Workflow operations are not available in Electron dev mode" },
        { status: 503 },
      );
    }
    logger.error("Failed to delete workflow:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}
