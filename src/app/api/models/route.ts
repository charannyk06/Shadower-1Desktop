import { NextResponse } from "next/server";
import {
  getAllProviderModels,
  transformToAPIResponse,
  invalidateModelCache,
} from "lib/ai/dynamic-models";

/**
 * GET /api/models
 * Get all available models from all providers
 */
export async function GET() {
  try {
    const providerModels = await getAllProviderModels();
    const response = transformToAPIResponse(providerModels);

    return NextResponse.json({
      success: true,
      providers: response,
    });
  } catch (error) {
    console.error("[API] Error getting models:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

/**
 * POST /api/models
 * Refresh model cache
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { provider } = body as { provider?: string };

    // Invalidate cache
    await invalidateModelCache(provider as any);

    // Fetch fresh models
    const providerModels = await getAllProviderModels();
    const response = transformToAPIResponse(providerModels);

    return NextResponse.json({
      success: true,
      providers: response,
      message: provider
        ? `Cache invalidated for ${provider}`
        : "All caches invalidated",
    });
  } catch (error) {
    console.error("[API] Error refreshing models:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
