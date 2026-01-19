import { ArchiveCreateSchema } from "app-types/archive";
import { getSession } from "auth/server";
import { archiveRepository } from "lib/db/repository";
import logger from "logger";
import { z } from "zod";

export async function GET() {
  const session = await getSession();

  if (!session?.user.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const archives = await archiveRepository.getArchivesByUserId(
      session.user.id,
    );
    return Response.json(archives);
  } catch (error: any) {
    // In Electron dev mode, database access fails - return empty array
    if (
      error?.isElectronMode ||
      error?.message?.includes("SQLite") ||
      error?.message?.includes("Electron")
    ) {
      logger.warn(
        "[Archive API] Electron mode detected, returning empty archives array",
      );
      return Response.json([]);
    }
    logger.error("Failed to fetch archives:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await getSession();

  if (!session?.user.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const body = await request.json();
    const data = ArchiveCreateSchema.parse(body);

    const archive = await archiveRepository.createArchive({
      name: data.name,
      description: data.description || null,
      userId: session.user.id,
    });

    return Response.json(archive);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: "Invalid input", details: error.message },
        { status: 400 },
      );
    }

    console.error("Failed to create archive:", error);
    return Response.json({ message: "Internal Server Error" }, { status: 500 });
  }
}
