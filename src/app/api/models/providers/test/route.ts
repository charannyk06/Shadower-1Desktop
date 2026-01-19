import { NextResponse } from "next/server";

/**
 * POST /api/models/providers/test
 * Test a provider connection
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { providerId, baseUrl, apiKey } = body as {
      providerId: string;
      baseUrl?: string;
      apiKey?: string;
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
      const result = await window.electronAPI.models.testProvider({
        providerId,
        baseUrl,
        apiKey,
      });

      return NextResponse.json(result);
    }

    // For non-Electron, do basic validation
    // This would be used in web environments with server-side API key storage
    const isLocal = ["ollama", "lmstudio", "custom-local"].includes(providerId);

    if (isLocal) {
      const testUrl =
        baseUrl ||
        (providerId === "ollama"
          ? "http://localhost:11434/api/tags"
          : "http://localhost:1234/v1/models");

      try {
        const response = await fetch(testUrl, {
          signal: AbortSignal.timeout(5000),
        });

        if (response.ok) {
          return NextResponse.json({
            success: true,
            message: `${providerId} is available`,
          });
        }

        return NextResponse.json({
          success: false,
          error: `${providerId} returned status ${response.status}`,
        });
      } catch (fetchError) {
        return NextResponse.json({
          success: false,
          error: `Cannot connect to ${providerId}: ${fetchError instanceof Error ? fetchError.message : "Unknown error"}`,
        });
      }
    }

    // Cloud provider - require API key
    if (!apiKey) {
      return NextResponse.json({
        success: false,
        error: "API key is required for cloud providers",
      });
    }

    // Test API key format
    const patterns: Record<string, RegExp> = {
      openai: /^sk-[a-zA-Z0-9-_]{20,}$/,
      anthropic: /^sk-ant-[a-zA-Z0-9-_]{20,}$/,
      groq: /^gsk_[a-zA-Z0-9]{20,}$/,
      openRouter: /^sk-or-[a-zA-Z0-9-_]{20,}$/,
    };

    const pattern = patterns[providerId];
    if (pattern && !pattern.test(apiKey)) {
      return NextResponse.json({
        success: false,
        error: `Invalid API key format for ${providerId}`,
      });
    }

    return NextResponse.json({
      success: true,
      message: "API key format is valid (connection test requires Electron)",
    });
  } catch (error) {
    console.error("[API] Error testing provider:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
