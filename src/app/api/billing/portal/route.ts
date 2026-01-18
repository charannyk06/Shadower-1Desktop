import { getSession } from "lib/auth/server";
import { createBillingPortalSession, stripe } from "lib/billing/stripe";
import { csrfErrorResponse, validateCsrfRequest } from "lib/csrf";
import { subscriptionRepository } from "lib/db/repository";

export async function POST(req: Request) {
  try {
    // SECURITY: Validate CSRF token
    const csrfValid = await validateCsrfRequest(req);
    if (!csrfValid) {
      console.warn("[Portal] CSRF validation failed");
      return csrfErrorResponse();
    }

    const session = await getSession();
    if (!session?.user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!stripe.isEnabled()) {
      return Response.json(
        { error: "Billing is not enabled" },
        { status: 400 },
      );
    }

    const subscription = await subscriptionRepository.getByUserId(
      session.user.id,
    );

    if (!subscription?.stripeCustomerId) {
      return Response.json(
        { error: "No billing account found" },
        { status: 400 },
      );
    }

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

    // Use returnUrl from request body if provided, otherwise default to home
    // SECURITY: Validate returnUrl is from same origin to prevent open redirect
    let returnUrl = `${baseUrl}/`;
    try {
      const body = await req.json();
      if (body.returnUrl && typeof body.returnUrl === "string") {
        const providedUrl = new URL(body.returnUrl);
        const baseUrlParsed = new URL(baseUrl);
        // Only allow same-origin URLs
        if (providedUrl.origin === baseUrlParsed.origin) {
          returnUrl = body.returnUrl;
        } else {
          console.warn(
            "[Portal] Rejected cross-origin returnUrl:",
            body.returnUrl,
          );
        }
      }
    } catch {
      // No body, invalid JSON, or invalid URL - use default
    }

    const portalSession = await createBillingPortalSession({
      customerId: subscription.stripeCustomerId,
      returnUrl,
    });

    if (!portalSession) {
      return Response.json(
        { error: "Failed to create portal session" },
        { status: 500 },
      );
    }

    return Response.json({ url: portalSession.url });
  } catch (error: unknown) {
    const err = error as Error;
    console.error("Portal API Error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
