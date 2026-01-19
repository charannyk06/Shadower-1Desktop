import { getSession } from "auth/server";
import { chatRepository } from "lib/db/repository";
import logger from "logger";

export async function GET() {
  const session = await getSession();

  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const threads = await chatRepository.selectThreadsByUserId(session.user.id);
    return Response.json(threads);
  } catch (error: any) {
    // In Electron dev mode, database access fails - return empty array
    if (
      error?.isElectronMode ||
      error?.message?.includes("SQLite") ||
      error?.message?.includes("Electron")
    ) {
      logger.warn(
        "[Thread API] Electron mode detected, returning empty threads array",
      );
      return Response.json([]);
    }
    logger.error("Failed to fetch threads:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}
