import logger from "lib/logger";
import { NextRequest } from "next/server";

/**
 * POST /api/log
 *
 * Server-side logging endpoint for client-side events.
 * Allows client components to send logs that appear in Vercel logs.
 */
export async function POST(req: NextRequest) {
  try {
    const { level, message, data } = await req.json();
    const logLevel = level || "info";

    if (logLevel === "error") {
      logger.error(`[Client] ${message}`, data);
    } else if (logLevel === "warn") {
      logger.warn(`[Client] ${message}`, data);
    } else if (logLevel === "debug") {
      logger.debug(`[Client] ${message}`, data);
    } else {
      logger.info(`[Client] ${message}`, data);
    }

    return Response.json({ success: true });
  } catch (error) {
    logger.error("[Log API] Failed to process log request:", error);
    return Response.json({ error: "Failed to log" }, { status: 400 });
  }
}
