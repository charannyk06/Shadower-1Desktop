import { getEnabledTokenPacks } from "lib/billing/config";
import { stripe } from "lib/billing/stripe";
import { NextResponse } from "next/server";

/**
 * GET /api/billing/token-packs
 *
 * Returns the list of available token packs for purchase.
 * This allows the frontend to dynamically display token pack options
 * without hardcoding them.
 */
export async function GET() {
  try {
    // Check if billing is enabled
    if (!stripe.isEnabled()) {
      return NextResponse.json(
        { error: "Billing is not enabled", packs: [] },
        { status: 200 },
      );
    }

    const packs = getEnabledTokenPacks();

    // Transform to frontend-friendly format
    const tokenPacks = packs.map((pack) => ({
      id: pack.id,
      tokens: pack.tokens,
      price: pack.price, // in cents
      priceFormatted: `$${(pack.price / 100).toFixed(2)}`,
      pricePerMillion: pack.pricePerMillion,
      displayName:
        pack.displayName || `${(pack.tokens / 1000000).toFixed(1)}M Credits`,
      description: pack.description,
      popular: pack.popular || false,
    }));

    return NextResponse.json({
      packs: tokenPacks,
      billingEnabled: true,
    });
  } catch (error: unknown) {
    const err = error as Error;
    console.error("[TokenPacks API] Error:", err);
    return NextResponse.json(
      { error: err.message, packs: [] },
      { status: 500 },
    );
  }
}
