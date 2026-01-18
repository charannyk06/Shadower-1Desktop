import { NextRequest, NextResponse } from "next/server";

/**
 * Proxy endpoint to fetch content from URLs (bypasses CORS for blob storage)
 * Used by theater mode preview to fetch HTML/PDF content
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");

  if (!url) {
    return NextResponse.json(
      { error: "Missing url parameter" },
      { status: 400 },
    );
  }

  // Only allow fetching from trusted domains
  const allowedDomains = [
    "public.blob.vercel-storage.com",
    "blob.vercel-storage.com",
  ];

  try {
    const parsedUrl = new URL(url);
    const isAllowed = allowedDomains.some((domain) =>
      parsedUrl.hostname.endsWith(domain),
    );

    if (!isAllowed) {
      return NextResponse.json(
        { error: "URL domain not allowed" },
        { status: 403 },
      );
    }

    const response = await fetch(url);

    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to fetch: ${response.statusText}` },
        { status: response.status },
      );
    }

    const contentType =
      response.headers.get("content-type") || "application/octet-stream";

    // For text content (HTML, SVG, etc.), return as text
    if (
      contentType.includes("text/") ||
      contentType.includes("application/xhtml")
    ) {
      const text = await response.text();
      return new NextResponse(text, {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    // For binary content (PDF, images, etc.), return as blob
    const blob = await response.blob();
    return new NextResponse(blob, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error) {
    console.error("Proxy fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch content" },
      { status: 500 },
    );
  }
}
