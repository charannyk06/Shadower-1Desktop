import { NextResponse } from "next/server";
import { PROVIDER_REGISTRY, type ProviderId } from "app-types/models";

/**
 * GET /api/models/providers
 * Get all available provider configurations
 */
export async function GET() {
  try {
    // Check if running in Electron
    const isElectron = typeof window !== "undefined" && window.electronAPI;

    if (isElectron) {
      // In Electron, get from IPC
      const providers = await window.electronAPI.models.getProviders();
      return NextResponse.json({
        success: true,
        providers,
      });
    }

    // Return static provider registry for non-Electron environments
    const providers = Object.entries(PROVIDER_REGISTRY).map(([_id, info]) => ({
      ...info,
      status: "disconnected" as const,
      enabled: false,
    }));

    return NextResponse.json({
      success: true,
      providers,
    });
  } catch (error) {
    console.error("[API] Error getting providers:", error);
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
 * POST /api/models/providers
 * Save a provider configuration
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { id, name, providerId, type, baseUrl, authType, enabled, metadata } =
      body as {
        id?: string;
        name: string;
        providerId: ProviderId;
        type: "cloud" | "local";
        baseUrl?: string;
        authType: "api-key" | "oauth" | "none";
        enabled?: boolean;
        metadata?: Record<string, unknown>;
      };

    // Validate required fields
    if (!name || !providerId || !type) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing required fields: name, providerId, type",
        },
        { status: 400 },
      );
    }

    // Check if running in Electron
    const isElectron = typeof window !== "undefined" && window.electronAPI;

    if (isElectron) {
      const provider = await window.electronAPI.models.saveProvider({
        id,
        name,
        providerId,
        type,
        baseUrl,
        authType,
        enabled,
        metadata,
      });

      return NextResponse.json({
        success: true,
        provider,
      });
    }

    // Non-Electron: return error (should use Electron IPC)
    return NextResponse.json(
      {
        success: false,
        error: "Provider configuration requires Electron environment",
      },
      { status: 400 },
    );
  } catch (error) {
    console.error("[API] Error saving provider:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
