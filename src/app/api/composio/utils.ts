import { getComposioClientForUser, isComposioEnabled } from "lib/ai/composio";
import { ComposioClient } from "lib/ai/composio/composio-client";
import { getCurrentUser } from "lib/auth/permissions";

type ComposioRouteResult =
  | { success: true; client: ComposioClient; userId: string }
  | { success: false; response: Response };

type ComposioRouteOptions = {
  requireEnabled?: boolean;
  errorOnDisabled?: boolean;
  requireAdmin?: boolean;
};

/**
 * Shared auth and client initialization for Composio API routes
 * Returns either an authenticated client or an error response
 */
export async function getComposioRouteContext(
  options?: ComposioRouteOptions,
): Promise<ComposioRouteResult> {
  const {
    requireEnabled = true,
    errorOnDisabled = false,
    requireAdmin = false,
  } = options || {};

  const currentUser = await getCurrentUser();

  if (!currentUser?.id) {
    return {
      success: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  if (requireAdmin && currentUser.role !== "admin") {
    return {
      success: false,
      response: Response.json(
        { error: "Admin access required" },
        { status: 403 },
      ),
    };
  }

  if (requireEnabled && !isComposioEnabled()) {
    return {
      success: false,
      response: errorOnDisabled
        ? Response.json(
            { error: "App integrations are not enabled" },
            { status: 400 },
          )
        : Response.json({ items: [], enabled: false }),
    };
  }

  const client = getComposioClientForUser(currentUser.id);
  if (!client) {
    return {
      success: false,
      response: errorOnDisabled
        ? Response.json(
            { error: "Could not create Composio client" },
            { status: 500 },
          )
        : Response.json({ items: [], enabled: true }),
    };
  }

  return { success: true, client, userId: currentUser.id };
}
