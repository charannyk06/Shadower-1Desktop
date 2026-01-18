import { z } from "zod";

// Password regex with bounded lookaheads to prevent ReDoS
// Uses {0,20} instead of * to limit backtracking since max length is 20
export const passwordRegexPattern =
  process.env.NEXT_PUBLIC_PASSWORD_REGEX_PATTERN ||
  String.raw`^(?=[\s\S]{0,20}[a-zA-Z])(?=[\s\S]{0,20}\d)[a-zA-Z\d!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]{8,20}$`;

export const passwordRequirementsText =
  process.env.NEXT_PUBLIC_PASSWORD_REQUIREMENTS_TEXT ||
  "Password must be 8-20 characters and contain at least one letter and one number.";

// Shared password validation schema
export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters long.")
  .max(20, "Password cannot exceed 20 characters.")
  .regex(new RegExp(passwordRegexPattern), passwordRequirementsText);
