import { type NextRequest, NextResponse } from "next/server";

/**
 * Electron-Only Proxy
 *
 * This proxy is simplified for Electron mode.
 * No session cookie checking needed - user is always authenticated.
 */

// Constants for static file extensions - improves maintainability
const STATIC_FILE_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".otf",
] as const;

const PING_PATH = "/ping";
const ADMIN_PATH = "/admin";
const ADMIN_REDIRECT_PATH = "/admin/users";
const HTTP_OK_STATUS = 200;

/**
 * Checks if the given pathname corresponds to a static file
 * @param pathname - The pathname to check
 * @returns True if the pathname ends with a static file extension
 */
function isStaticFile(pathname: string): boolean {
  const lowerPathname = pathname.toLowerCase();
  return STATIC_FILE_EXTENSIONS.some((ext) => lowerPathname.endsWith(ext));
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  /*
   * Playwright starts the dev server and requires a 200 status to
   * begin the tests, so this ensures that the tests can start
   */
  if (pathname.startsWith(PING_PATH)) {
    return new Response("pong", { status: HTTP_OK_STATUS });
  }

  // Allow static files from public folder (images, fonts, etc.)
  if (isStaticFile(pathname)) {
    return NextResponse.next();
  }

  if (pathname === ADMIN_PATH) {
    return NextResponse.redirect(new URL(ADMIN_REDIRECT_PATH, request.url));
  }

  // In Electron mode, user is always authenticated locally
  // No session cookie checking needed
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|api/auth|api/proxy|api/wopi|export|.*\\.png|.*\\.jpg|.*\\.jpeg|.*\\.gif|.*\\.svg|.*\\.webp|.*\\.ico|.*\\.woff|.*\\.woff2|.*\\.ttf|.*\\.eot|.*\\.otf).*)",
  ],
};
