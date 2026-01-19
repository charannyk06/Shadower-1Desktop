import { NextResponse } from "next/server";

/**
 * GET /api/models/keys
 * Get all API keys (without actual values, only metadata)
 */
export async function GET() {
  try {
    // Check if running in Electron
    const isElectron = typeof window !== "undefined" && window.electronAPI;

    if (isElectron) {
      const keys = await window.electronAPI.models.getApiKeys();
      return NextResponse.json({
        success: true,
        keys,
      });
    }

    // Non-Electron: return empty (keys are stored in Electron only)
    return NextResponse.json({
      success: true,
      keys: [],
      message: "API key management requires Electron environment",
    });
  } catch (error) {
    console.error("[API] Error getting API keys:", error);
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
 * POST /api/models/keys
 * Save an API key
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { providerId, apiKey, validate } = body as {
      providerId: string;
      apiKey: string;
      validate?: boolean;
    };

    if (!providerId || !apiKey) {
      return NextResponse.json(
        {
          success: false,
          error: "Provider ID and API key are required",
        },
        { status: 400 },
      );
    }

    // Check if running in Electron
    const isElectron = typeof window !== "undefined" && window.electronAPI;

    if (isElectron) {
      const result = await window.electronAPI.models.saveApiKey({
        providerId,
        apiKey,
        validate,
      });

      return NextResponse.json(result);
    }

    // Non-Electron: return error
    return NextResponse.json(
      {
        success: false,
        error: "API key management requires Electron environment",
      },
      { status: 400 },
    );
  } catch (error) {
    console.error("[API] Error saving API key:", error);
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
 * DELETE /api/models/keys
 * Delete an API key
 */
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const providerId = searchParams.get("providerId");

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
      const result = await window.electronAPI.models.deleteApiKey(providerId);
      return NextResponse.json(result);
    }

    // Non-Electron: return error
    return NextResponse.json(
      {
        success: false,
        error: "API key management requires Electron environment",
      },
      { status: 400 },
    );
  } catch (error) {
    console.error("[API] Error deleting API key:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
