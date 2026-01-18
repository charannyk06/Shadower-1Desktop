/**
 * URL Validation and Security Utilities
 *
 * Provides comprehensive URL validation to prevent SSRF attacks,
 * access to internal networks, and other security issues.
 */

import { BrowserConfig } from "../config/browser-config";
import { AutomationErrorCode, Result, err, ok } from "./result";

/**
 * URL validation result with sanitized URL
 */
export interface ValidatedUrl {
  original: string;
  sanitized: string;
  hostname: string;
  protocol: string;
  isHttps: boolean;
}

/**
 * Check if an IP address is in a private/internal range
 */
function isPrivateIp(ip: string): boolean {
  // IPv4 private ranges
  const ipv4PrivateRanges = [
    /^10\./, // 10.0.0.0/8
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12
    /^192\.168\./, // 192.168.0.0/16
    /^127\./, // 127.0.0.0/8 (loopback)
    /^169\.254\./, // 169.254.0.0/16 (link-local)
    /^0\./, // 0.0.0.0/8
  ];

  // IPv6 private/special ranges
  const ipv6PrivatePatterns = [
    /^::1$/i, // loopback
    /^fe80:/i, // link-local
    /^fc00:/i, // unique local
    /^fd/i, // unique local
    /^::ffff:(?:10\.|172\.(?:1[6-9]|2[0-9]|3[0-1])\.|192\.168\.)/i, // IPv4-mapped private
  ];

  // Check IPv4
  for (const range of ipv4PrivateRanges) {
    if (range.test(ip)) {
      return true;
    }
  }

  // Check IPv6
  for (const pattern of ipv6PrivatePatterns) {
    if (pattern.test(ip)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if hostname resolves to a private IP
 * Note: This is a basic check. In production, you might want to do DNS resolution.
 */
function isPrivateHostname(hostname: string): boolean {
  const lowerHostname = hostname.toLowerCase();

  // Common internal hostnames
  const internalPatterns = [
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "::1",
    "[::1]",
    "*.local",
    "*.localhost",
    "*.internal",
    "*.lan",
    "*.home",
    "*.corp",
    "*.private",
  ];

  for (const pattern of internalPatterns) {
    if (pattern.startsWith("*.")) {
      const suffix = pattern.slice(1);
      if (lowerHostname.endsWith(suffix) || lowerHostname === suffix.slice(1)) {
        return true;
      }
    } else if (lowerHostname === pattern) {
      return true;
    }
  }

  // Check if it's an IP address in private range
  if (isPrivateIp(hostname)) {
    return true;
  }

  return false;
}

/**
 * Check if a scheme is blocked
 */
function isBlockedScheme(protocol: string): boolean {
  const scheme = protocol.replaceAll(":", "").toLowerCase();
  return BrowserConfig.security.blockedSchemes.includes(scheme);
}

/**
 * Check if a domain is in the blocklist
 */
function isBlockedDomain(hostname: string): boolean {
  const lowerHostname = hostname.toLowerCase();

  for (const blocked of BrowserConfig.security.blockedDomains) {
    const lowerBlocked = blocked.toLowerCase();

    // Exact match
    if (lowerHostname === lowerBlocked) {
      return true;
    }

    // Wildcard match (*.example.com)
    if (lowerBlocked.startsWith("*.")) {
      const suffix = lowerBlocked.slice(1);
      if (lowerHostname.endsWith(suffix)) {
        return true;
      }
    }

    // Subdomain match (block example.com also blocks sub.example.com)
    if (lowerHostname.endsWith(`.${lowerBlocked}`)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a domain is in the allowlist
 */
function isAllowedDomain(hostname: string): boolean {
  // If no allowlist is configured, all non-blocked domains are allowed
  if (BrowserConfig.security.allowedDomains.length === 0) {
    return true;
  }

  const lowerHostname = hostname.toLowerCase();

  for (const allowed of BrowserConfig.security.allowedDomains) {
    const lowerAllowed = allowed.toLowerCase();

    // Exact match
    if (lowerHostname === lowerAllowed) {
      return true;
    }

    // Wildcard match (*.example.com)
    if (lowerAllowed.startsWith("*.")) {
      const suffix = lowerAllowed.slice(1);
      if (lowerHostname.endsWith(suffix) || lowerHostname === suffix.slice(1)) {
        return true;
      }
    }

    // Subdomain match
    if (lowerHostname.endsWith(`.${lowerAllowed}`)) {
      return true;
    }
  }

  return false;
}

/**
 * Validate and sanitize a URL for browser navigation
 */
export function validateUrl(url: string): Result<ValidatedUrl> {
  // Trim whitespace
  const trimmedUrl = url.trim();

  // Check for empty URL
  if (!trimmedUrl) {
    return err(AutomationErrorCode.INVALID_URL, "URL cannot be empty");
  }

  // Check for overly long URLs
  if (trimmedUrl.length > 2048) {
    return err(
      AutomationErrorCode.INVALID_URL,
      "URL exceeds maximum length of 2048 characters",
    );
  }

  // Parse URL
  let parsedUrl: URL;
  try {
    // Handle URLs without protocol
    const urlWithProtocol = trimmedUrl.match(/^https?:\/\//i)
      ? trimmedUrl
      : `https://${trimmedUrl}`;

    parsedUrl = new URL(urlWithProtocol);
  } catch {
    return err(AutomationErrorCode.INVALID_URL, "Invalid URL format", {
      details: { url: trimmedUrl },
    });
  }

  // Check blocked schemes
  if (isBlockedScheme(parsedUrl.protocol)) {
    return err(
      AutomationErrorCode.BLOCKED_URL,
      `URL scheme '${parsedUrl.protocol}' is not allowed`,
      {
        details: { scheme: parsedUrl.protocol },
      },
    );
  }

  // Only allow http and https
  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    return err(
      AutomationErrorCode.BLOCKED_URL,
      `Only HTTP and HTTPS URLs are allowed`,
      {
        details: { scheme: parsedUrl.protocol },
      },
    );
  }

  // Check for private/internal hostnames
  if (isPrivateHostname(parsedUrl.hostname)) {
    return err(
      AutomationErrorCode.BLOCKED_URL,
      "Access to internal/private addresses is not allowed",
      {
        details: { hostname: parsedUrl.hostname },
      },
    );
  }

  // Check blocked domains
  if (isBlockedDomain(parsedUrl.hostname)) {
    return err(AutomationErrorCode.BLOCKED_URL, "This domain is blocked", {
      details: { hostname: parsedUrl.hostname },
    });
  }

  // In strict mode, check allowed domains
  if (
    BrowserConfig.security.strictMode &&
    !isAllowedDomain(parsedUrl.hostname)
  ) {
    return err(
      AutomationErrorCode.BLOCKED_URL,
      "This domain is not in the allowed list",
      {
        details: { hostname: parsedUrl.hostname },
      },
    );
  }

  // Check for username/password in URL (potential credential leak)
  if (parsedUrl.username || parsedUrl.password) {
    return err(
      AutomationErrorCode.INVALID_URL,
      "URLs with embedded credentials are not allowed",
    );
  }

  // Sanitize and normalize the URL
  const sanitizedUrl = parsedUrl.href;

  return ok({
    original: trimmedUrl,
    sanitized: sanitizedUrl,
    hostname: parsedUrl.hostname,
    protocol: parsedUrl.protocol,
    isHttps: parsedUrl.protocol === "https:",
  });
}

/**
 * Quick check if URL is likely safe (without full validation)
 */
export function isLikelySafeUrl(url: string): boolean {
  const result = validateUrl(url);
  return result.ok;
}

/**
 * Extract domain from URL for display purposes
 */
export function extractDomain(url: string): string {
  try {
    const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
    return parsed.hostname;
  } catch {
    return url;
  }
}

/**
 * Check if URL is HTTPS
 */
export function isHttps(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Sanitize URL for logging (remove sensitive query params)
 */
export function sanitizeUrlForLogging(url: string): string {
  try {
    const parsed = new URL(url);

    // List of sensitive query param patterns
    const sensitiveParams = [
      "token",
      "key",
      "api_key",
      "apikey",
      "secret",
      "password",
      "pass",
      "pwd",
      "auth",
      "access_token",
      "refresh_token",
      "session",
      "sid",
      "credential",
    ];

    for (const [key] of parsed.searchParams.entries()) {
      const lowerKey = key.toLowerCase();
      if (sensitiveParams.some((s) => lowerKey.includes(s))) {
        parsed.searchParams.set(key, "[REDACTED]");
      }
    }

    return parsed.href;
  } catch {
    return "[INVALID_URL]";
  }
}
