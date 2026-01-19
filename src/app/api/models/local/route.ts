import { NextResponse } from "next/server";

/**
 * GET /api/models/local
 * Get all local models
 */
export async function GET() {
  try {
    // Check if running in Electron
    const isElectron = typeof window !== "undefined" && window.electronAPI;

    if (isElectron) {
      const models = await window.electronAPI.models.getLocalModels();
      return NextResponse.json({
        success: true,
        models,
      });
    }

    // Non-Electron: return empty
    return NextResponse.json({
      success: true,
      models: [],
      message: "Local model management requires Electron environment",
    });
  } catch (error) {
    console.error("[API] Error getting local models:", error);
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
 * POST /api/models/local
 * Refresh local models from provider
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { providerId, baseUrl } = body as {
      providerId: string;
      baseUrl?: string;
    };

    if (!providerId) {
      return NextResponse.json(
        {
          success: false,
          error: "Provider ID is required",
        },
        { status: 400 },
      );
    }

    // Check if running in Electron
    const isElectron = typeof window !== "undefined" && window.electronAPI;

    if (isElectron) {
      const result = await window.electronAPI.models.refreshLocalModels({
        providerId,
        baseUrl,
      });

      return NextResponse.json(result);
    }

    // Non-Electron: try to fetch directly
    const baseUrlToUse =
      baseUrl ||
      (providerId === "ollama"
        ? "http://localhost:11434"
        : "http://localhost:1234/v1");

    try {
      const modelsUrl =
        providerId === "ollama"
          ? `${baseUrlToUse}/api/tags`
          : `${baseUrlToUse}/models`;

      const response = await fetch(modelsUrl, {
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        return NextResponse.json({
          success: false,
          error: `Provider not available: ${response.status}`,
        });
      }

      const data = await response.json();

      // Ollama format
      if (data.models) {
        return NextResponse.json({
          success: true,
          models: data.models.map((m: any) => ({
            name: m.name || m.model,
            size: m.size,
            family: m.details?.family,
          })),
        });
      }

      // OpenAI format (LM Studio)
      if (data.data) {
        return NextResponse.json({
          success: true,
          models: data.data.map((m: any) => ({ name: m.id })),
        });
      }

      return NextResponse.json({
        success: true,
        models: [],
      });
    } catch (fetchError) {
      return NextResponse.json({
        success: false,
        error: `Cannot connect to ${providerId}: ${fetchError instanceof Error ? fetchError.message : "Unknown error"}`,
      });
    }
  } catch (error) {
    console.error("[API] Error refreshing local models:", error);
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
 * DELETE /api/models/local
 * Delete a local model
 */
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    const modelName = searchParams.get("modelName");
    const providerId = searchParams.get("providerId");

    if (!id && (!modelName || !providerId)) {
      return NextResponse.json(
        {
          success: false,
          error: "Either id or (modelName and providerId) is required",
        },
        { status: 400 },
      );
    }

    // Check if running in Electron
    const isElectron = typeof window !== "undefined" && window.electronAPI;

    if (isElectron) {
      const result = await window.electronAPI.models.deleteLocalModel({
        id: id || undefined,
        modelName: modelName || undefined,
        providerId: providerId || undefined,
      });

      return NextResponse.json(result);
    }

    // Non-Electron: return error
    return NextResponse.json(
      {
        success: false,
        error: "Local model management requires Electron environment",
      },
      { status: 400 },
    );
  } catch (error) {
    console.error("[API] Error deleting local model:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
