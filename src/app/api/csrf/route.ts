import { getOrCreateCsrfToken } from "lib/csrf";

/**
 * GET /api/csrf
 * Returns a CSRF token for use in subsequent POST requests.
 * The token is also set as an httpOnly cookie for server-side validation.
 */
export async function GET() {
  try {
    const token = await getOrCreateCsrfToken();

    return Response.json({
      csrfToken: token,
    });
  } catch (error: unknown) {
    console.error("[CSRF] Failed to generate token:", error);
    return Response.json(
      { error: "Failed to generate CSRF token" },
      { status: 500 },
    );
  }
}
