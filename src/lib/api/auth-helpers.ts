import { getSession } from "auth/server";

/**
 * Result type for authentication validation
 */
export type AuthValidationResult =
  | { success: true; userId: string }
  | { success: false; response: Response };

/**
 * Validates user session and returns userId or error response
 * Reduces duplication across API routes
 */
export async function validateSession(): Promise<AuthValidationResult> {
  const session = await getSession();
  if (!session?.user?.id) {
    return {
      success: false,
      response: new Response("Unauthorized", { status: 401 }),
    };
  }
  return { success: true, userId: session.user.id };
}

/**
 * Validates session and returns JSON error response
 */
export async function validateSessionJson(): Promise<AuthValidationResult> {
  const session = await getSession();
  if (!session?.user?.id) {
    return {
      success: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { success: true, userId: session.user.id };
}
