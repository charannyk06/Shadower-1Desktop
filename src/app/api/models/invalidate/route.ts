import { NextResponse } from "next/server";
import { invalidateModelCache } from "lib/ai/dynamic-models/model-service";
import type { ProviderName } from "lib/ai/dynamic-models/types";

/**
 * POST /api/models/invalidate
 * Invalidate model cache for a specific provider or all providers
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { providerId } = body as { providerId?: string };

    // Validate provider if specified
    const validProviders: ProviderName[] = [
      "openai",
      "anthropic",
      "google",
      "xai",
      "groq",
      "openRouter",
      "ollama",
      "lmstudio",
      "cerebras",
    ];

    if (providerId && !validProviders.includes(providerId as ProviderName)) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid provider: ${providerId}`,
        },
        { status: 400 },
      );
    }

    // Invalidate cache
    await invalidateModelCache(providerId as ProviderName | undefined);

    return NextResponse.json({
      success: true,
      message: providerId
        ? `Cache invalidated for ${providerId}`
        : "All model caches invalidated",
    });
  } catch (error) {
    console.error("[API] Error invalidating cache:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
