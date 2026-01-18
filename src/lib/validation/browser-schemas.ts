/**
 * Input Validation Schemas for Browser API Routes
 *
 * Using Zod for runtime validation to prevent:
 * - Injection attacks
 * - Malformed inputs
 * - Type confusion
 */

import { z } from "zod";

/**
 * UUID v4 pattern for session IDs
 */
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Browserbase session ID pattern (alphanumeric with dashes)
 */
const browserbaseSessionIdPattern = /^[a-zA-Z0-9-_]{10,64}$/;

/**
 * Valid URL pattern (strict)
 */
const urlPattern = /^https?:\/\/.+/;

/**
 * Proxy server schema
 */
const proxySchema = z
  .object({
    server: z
      .string()
      .min(1)
      .max(256)
      .regex(
        /^(https?:\/\/|socks5:\/\/)?[\w.-]+(:\d+)?$/,
        "Invalid proxy server format",
      ),
    username: z.string().max(128).optional(),
    password: z.string().max(256).optional(),
  })
  .strict();

/**
 * Viewport schema with reasonable bounds
 */
const viewportSchema = z
  .object({
    width: z.number().int().min(320).max(3840),
    height: z.number().int().min(240).max(2160),
  })
  .strict();

/**
 * POST /api/browser/session - Create session request
 */
export const createSessionSchema = z
  .object({
    threadId: z
      .string()
      .regex(uuidPattern, "Invalid thread ID format")
      .optional(),
    stealth: z.boolean().optional().default(false),
    proxy: proxySchema.optional(),
    viewport: viewportSchema.optional(),
  })
  .strict();

export type CreateSessionInput = z.infer<typeof createSessionSchema>;

/**
 * GET /api/browser/session query params
 */
export const getSessionQuerySchema = z.object({
  sessionId: z
    .string()
    .regex(browserbaseSessionIdPattern, "Invalid session ID format")
    .optional(),
  threadId: z
    .string()
    .regex(uuidPattern, "Invalid thread ID format")
    .optional(),
});

export type GetSessionQueryInput = z.infer<typeof getSessionQuerySchema>;

/**
 * DELETE /api/browser/session query params
 */
export const deleteSessionQuerySchema = z.object({
  sessionId: z
    .string()
    .min(1)
    .regex(browserbaseSessionIdPattern, "Invalid session ID format"),
});

export type DeleteSessionQueryInput = z.infer<typeof deleteSessionQuerySchema>;

/**
 * PATCH /api/browser/session - Update session request
 */
export const updateSessionSchema = z
  .object({
    sessionId: z
      .string()
      .regex(browserbaseSessionIdPattern, "Invalid session ID format"),
    currentUrl: z
      .string()
      .regex(urlPattern, "Invalid URL format")
      .max(2048)
      .optional(),
    status: z.enum(["active", "closed", "error", "expired"]).optional(),
  })
  .strict();

export type UpdateSessionInput = z.infer<typeof updateSessionSchema>;

/**
 * POST /api/browser/screenshot - Screenshot request
 */
export const screenshotRequestSchema = z
  .object({
    sessionId: z
      .string()
      .regex(browserbaseSessionIdPattern, "Invalid session ID format"),
    saveToHistory: z.boolean().optional().default(false),
    format: z.enum(["png", "jpeg"]).optional().default("png"),
    quality: z.number().int().min(1).max(100).optional(),
  })
  .strict();

export type ScreenshotRequestInput = z.infer<typeof screenshotRequestSchema>;

/**
 * GET /api/browser/stream query params
 */
export const streamQuerySchema = z.object({
  sessionId: z
    .string()
    .regex(browserbaseSessionIdPattern, "Invalid session ID format"),
  interval: z
    .string()
    .optional()
    .default("1000")
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().min(500).max(10000)),
});

export type StreamQueryInput = z.infer<typeof streamQuerySchema>;

/**
 * Browser action schemas for Stagehand operations
 */
export const browserActionSchema = z
  .object({
    sessionId: z
      .string()
      .regex(browserbaseSessionIdPattern, "Invalid session ID format"),
    action: z.string().min(1).max(1024), // Natural language action
    timeout: z.number().int().min(1000).max(60000).optional(),
  })
  .strict();

export type BrowserActionInput = z.infer<typeof browserActionSchema>;

/**
 * Browser navigation schema
 */
export const browserNavigateSchema = z
  .object({
    sessionId: z
      .string()
      .regex(browserbaseSessionIdPattern, "Invalid session ID format"),
    url: z.string().regex(urlPattern, "Invalid URL format").max(2048),
    waitUntil: z
      .enum(["load", "domcontentloaded", "networkidle0", "networkidle2"])
      .optional()
      .default("domcontentloaded"),
    timeout: z.number().int().min(1000).max(60000).optional(),
  })
  .strict();

export type BrowserNavigateInput = z.infer<typeof browserNavigateSchema>;

/**
 * Browser extract schema for structured data extraction
 */
export const browserExtractSchema = z
  .object({
    sessionId: z
      .string()
      .regex(browserbaseSessionIdPattern, "Invalid session ID format"),
    instruction: z.string().min(1).max(2048),
    schema: z.record(z.string(), z.unknown()).optional(), // JSON schema for extraction
  })
  .strict();

export type BrowserExtractInput = z.infer<typeof browserExtractSchema>;

/**
 * Validation error response helper
 */
export function formatValidationError(error: z.ZodError): {
  success: false;
  error: string;
  code: string;
  details: Array<{ path: string; message: string }>;
} {
  return {
    success: false,
    error: "Validation failed",
    code: "VALIDATION_ERROR",
    details: error.issues.map((e) => ({
      path: e.path.join("."),
      message: e.message,
    })),
  };
}

/**
 * Safe parse helper that returns a structured result
 */
export function validateInput<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
): { success: true; data: T } | { success: false; error: z.ZodError } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}
