import { NextRequest, NextResponse } from "next/server";
import { getSession } from "lib/auth/server";

/**
 * Electron-Only Auth Route Handler
 *
 * All auth operations are handled by Electron IPC.
 * This route always returns a success response for compatibility.
 */

// Create local user session response
const createLocalUserResponse = async () => {
  const session = await getSession();

  return {
    data: {
      user: session?.user || {
        id: "local-user",
        email: "local@shadower.app",
        name: "Local User",
        image: null,
        emailVerified: true,
        role: "admin",
      },
      session: session?.session || {
        id: "local-session",
        expiresAt: new Date(
          Date.now() + 365 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        token: "local-token",
        userId: "local-user",
      },
    },
  };
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ all?: string[] }> },
) {
  // Await params but we don't need to use the path
  await params;

  // For any auth endpoint, return current session
  const response = await createLocalUserResponse();
  return NextResponse.json(response);
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ all?: string[] }> },
) {
  // Await params but we don't need to use the path
  await params;

  // For any auth endpoint, return success
  const response = await createLocalUserResponse();
  return NextResponse.json({
    ...response,
    error: null,
  });
}
