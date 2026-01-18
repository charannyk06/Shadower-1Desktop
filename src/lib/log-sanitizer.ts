/**
 * Log sanitizer utility to prevent sensitive data from being logged.
 * Use this when logging objects that might contain sensitive information.
 */

// List of field names that should be redacted (case-insensitive partial match)
const SENSITIVE_FIELDS = [
  "email",
  "password",
  "token",
  "secret",
  "key",
  "auth",
  "credential",
  "stripe",
  "customerId",
  "customer_id",
  "cardNumber",
  "card_number",
  "cvv",
  "cvc",
  "expiry",
  "ssn",
  "socialSecurity",
  "social_security",
  "bankAccount",
  "bank_account",
  "routing",
  "apiKey",
  "api_key",
  "accessToken",
  "access_token",
  "refreshToken",
  "refresh_token",
  "privateKey",
  "private_key",
  "sessionId",
  "session_id",
  "cookie",
  "authorization",
];

// Fields that might be in snake_case or camelCase
const SENSITIVE_PATTERNS = SENSITIVE_FIELDS.map(
  (field) => new RegExp(field.replaceAll("_", "[_-]?"), "i"),
);

/**
 * Check if a field name is sensitive and should be redacted
 */
function isSensitiveField(fieldName: string): boolean {
  const lowerField = fieldName.toLowerCase();
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(lowerField));
}

/**
 * Sanitize an object for logging by redacting sensitive fields
 * @param obj - The object to sanitize
 * @param depth - Maximum recursion depth (default: 5)
 * @returns A new object with sensitive fields redacted
 */
export function sanitizeForLog<T extends Record<string, any>>(
  obj: T,
  depth: number = 5,
): Record<string, any> {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj !== "object") {
    return obj;
  }

  if (Array.isArray(obj)) {
    if (depth <= 0) return ["[TRUNCATED]"];
    return obj.map((item) =>
      typeof item === "object" ? sanitizeForLog(item, depth - 1) : item,
    );
  }

  if (depth <= 0) {
    return { "[TRUNCATED]": true };
  }

  const sanitized: Record<string, any> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (isSensitiveField(key)) {
      sanitized[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      sanitized[key] = sanitizeForLog(value, depth - 1);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Create a sanitized version of a user object for logging
 * Only includes safe fields
 */
export function sanitizeUser(user: {
  id?: string;
  email?: string;
  name?: string;
  [key: string]: any;
}): { userId?: string; name?: string } {
  return {
    userId: user.id,
    name: user.name,
  };
}

/**
 * Create a sanitized version of a subscription object for logging
 */
export function sanitizeSubscription(subscription: {
  id?: string;
  userId?: string;
  tier?: string;
  status?: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  [key: string]: any;
}): {
  subscriptionId?: string;
  userId?: string;
  tier?: string;
  status?: string;
} {
  return {
    subscriptionId: subscription.id,
    userId: subscription.userId,
    tier: subscription.tier,
    status: subscription.status,
  };
}

/**
 * Create a safe log message with sensitive data removed
 * Use this for structured logging
 */
export function safeLog(
  level: "log" | "warn" | "error" | "info" | "debug",
  message: string,
  data?: Record<string, any>,
): void {
  const sanitizedData = data ? sanitizeForLog(data) : undefined;

  if (sanitizedData) {
    console[level](message, sanitizedData);
  } else {
    console[level](message);
  }
}

export const logSanitizer = {
  sanitize: sanitizeForLog,
  sanitizeUser,
  sanitizeSubscription,
  safeLog,
  isSensitiveField,
};
