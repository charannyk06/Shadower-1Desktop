/**
 * Collabora WOPI Access Token Management
 *
 * Generates and validates JWT tokens for WOPI file access.
 * These tokens are passed to Collabora and used to authenticate
 * requests back to our WOPI endpoints.
 */

import { JWTPayload, SignJWT, jwtVerify } from "jose";
import { WopiAccessTokenPayload } from "./types";

// Secret key for signing tokens - must be set in environment
const getSecret = () => {
  const secret = process.env.WOPI_SECRET;
  if (!secret) {
    throw new Error("WOPI_SECRET environment variable is required");
  }
  return new TextEncoder().encode(secret);
};

// Token expiration time (8 hours)
const TOKEN_EXPIRATION = 8 * 60 * 60; // seconds

/**
 * Generate a WOPI access token for a file
 */
export async function generateWopiAccessToken(
  fileId: string,
  odisId: string,
  threadId: string,
  canWrite: boolean = true,
): Promise<{ token: string; ttl: number }> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + TOKEN_EXPIRATION;

  const token = await new SignJWT({
    fileId,
    odisId,
    threadId,
    canWrite,
  } as WopiAccessTokenPayload & JWTPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(getSecret());

  return {
    token,
    ttl: TOKEN_EXPIRATION * 1000, // milliseconds for Collabora
  };
}

/**
 * Validate and decode a WOPI access token
 */
export async function validateWopiAccessToken(
  token: string,
): Promise<WopiAccessTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());

    // Validate required fields
    if (
      typeof payload.fileId !== "string" ||
      typeof payload.odisId !== "string" ||
      typeof payload.threadId !== "string" ||
      typeof payload.canWrite !== "boolean"
    ) {
      console.error("Invalid WOPI token payload structure");
      return null;
    }

    return {
      fileId: payload.fileId,
      odisId: payload.odisId,
      threadId: payload.threadId,
      canWrite: payload.canWrite,
      exp: payload.exp as number,
      iat: payload.iat as number,
    };
  } catch (error) {
    console.error("Failed to validate WOPI access token:", error);
    return null;
  }
}

/**
 * Extract access token from request
 * Collabora sends it as query parameter or header
 */
export function extractAccessToken(request: Request): string | null {
  // Try query parameter first (standard WOPI)
  const url = new URL(request.url);
  const queryToken = url.searchParams.get("access_token");
  if (queryToken) {
    return queryToken;
  }

  // Try Authorization header
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  // Try various WOPI header formats (different Collabora versions use different names)
  const wopiHeaders = [
    "X-WOPI-Access-Token",
    "X-WOPI-AccessToken",
    "X-Wopi-Access-Token",
    "x-wopi-access-token",
  ];
  for (const header of wopiHeaders) {
    const wopiToken = request.headers.get(header);
    if (wopiToken) {
      return wopiToken;
    }
  }

  return null;
}

/**
 * Middleware helper to validate WOPI requests
 */
export async function validateWopiRequest(
  request: Request,
): Promise<
  | { valid: true; payload: WopiAccessTokenPayload }
  | { valid: false; error: string }
> {
  const token = extractAccessToken(request);

  if (!token) {
    return { valid: false, error: "Missing access token" };
  }

  const payload = await validateWopiAccessToken(token);

  if (!payload) {
    return { valid: false, error: "Invalid or expired access token" };
  }

  return { valid: true, payload };
}
