import "server-only";

import crypto from "node:crypto";
import { cookies } from "next/headers";

const CSRF_COOKIE_NAME = "csrf_token";
const CSRF_HEADER_NAME = "x-csrf-token";
const CSRF_TOKEN_LENGTH = 32; // 256 bits
const CSRF_TOKEN_EXPIRY = 60 * 60; // 1 hour in seconds

/**
 * Generate a cryptographically secure CSRF token
 */
export function generateCsrfToken(): string {
  return crypto.randomBytes(CSRF_TOKEN_LENGTH).toString("hex");
}

/**
 * Set the CSRF token cookie
 * Should be called when rendering pages that contain forms
 */
export async function setCsrfCookie(token?: string): Promise<string> {
  const cookieStore = await cookies();
  const csrfToken = token || generateCsrfToken();

  cookieStore.set(CSRF_COOKIE_NAME, csrfToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: CSRF_TOKEN_EXPIRY,
  });

  return csrfToken;
}

/**
 * Get the current CSRF token from the cookie
 */
export async function getCsrfToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(CSRF_COOKIE_NAME)?.value || null;
}

/**
 * Get or create a CSRF token
 * Returns existing token if valid, creates new one if not
 */
export async function getOrCreateCsrfToken(): Promise<string> {
  const existing = await getCsrfToken();
  if (existing) {
    return existing;
  }
  return setCsrfCookie();
}

/**
 * Validate CSRF token from request header against cookie
 * Uses timing-safe comparison to prevent timing attacks
 */
export async function validateCsrfToken(
  headerToken: string | null,
): Promise<boolean> {
  if (!headerToken) {
    return false;
  }

  const cookieToken = await getCsrfToken();
  if (!cookieToken) {
    return false;
  }

  // Use timing-safe comparison to prevent timing attacks
  try {
    const headerBuffer = Buffer.from(headerToken, "utf-8");
    const cookieBuffer = Buffer.from(cookieToken, "utf-8");

    // Buffers must be same length for timingSafeEqual
    if (headerBuffer.length !== cookieBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(headerBuffer, cookieBuffer);
  } catch {
    return false;
  }
}

/**
 * Extract CSRF token from request headers
 */
export function getCsrfTokenFromRequest(request: Request): string | null {
  return request.headers.get(CSRF_HEADER_NAME);
}

/**
 * Validate CSRF for a request
 * Returns true if valid, false otherwise
 */
export async function validateCsrfRequest(request: Request): Promise<boolean> {
  const headerToken = getCsrfTokenFromRequest(request);
  return validateCsrfToken(headerToken);
}

/**
 * Helper to create CSRF validation error response
 */
export function csrfErrorResponse(): Response {
  return Response.json(
    { error: "Invalid or missing CSRF token" },
    { status: 403 },
  );
}

export const csrf = {
  generate: generateCsrfToken,
  setCookie: setCsrfCookie,
  getToken: getCsrfToken,
  getOrCreate: getOrCreateCsrfToken,
  validate: validateCsrfToken,
  validateRequest: validateCsrfRequest,
  getFromRequest: getCsrfTokenFromRequest,
  errorResponse: csrfErrorResponse,
  HEADER_NAME: CSRF_HEADER_NAME,
  COOKIE_NAME: CSRF_COOKIE_NAME,
};
