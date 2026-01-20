import { z } from "zod";

import { BasicUserWithLastLogin } from "app-types/user";
import { ActionState } from "lib/action-utils";
import { passwordSchema } from "lib/validations/password";

// Role schema removed - roles/permissions have been removed from the app

export const UpdateUserPasswordError = {
  PASSWORD_MISMATCH: "Passwords do not match",
  CURRENT_PASSWORD_REQUIRED: "Current password is required",
} as const;

export type UpdateUserPasswordError =
  (typeof UpdateUserPasswordError)[keyof typeof UpdateUserPasswordError];

export const UpdateUserDetailsSchema = z.object({
  userId: z.uuid("Invalid user ID").optional(),
  name: z.string().min(1, "Name is required").max(100, "Name is too long"),
  email: z.email("Invalid email address").optional(),
  image: z.string().optional(),
});

export const UpdateUserPasswordSchema = z
  .object({
    userId: z.string().uuid("Invalid user ID"),
    isCurrentUser: z.boolean(),
    newPassword: passwordSchema,
    confirmPassword: passwordSchema,
    currentPassword: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.newPassword !== data.confirmPassword) {
      ctx.addIssue({
        code: "custom",
        message: UpdateUserPasswordError.PASSWORD_MISMATCH,
      });
    }
    if (data.isCurrentUser && !data.currentPassword) {
      ctx.addIssue({
        code: "custom",
        message: UpdateUserPasswordError.CURRENT_PASSWORD_REQUIRED,
      });
    }
  });

export type UpdateUserActionState = ActionState & {
  user?: BasicUserWithLastLogin | null;
  currentUserUpdated?: boolean;
};

export type UpdateUserPasswordActionState = ActionState & {
  error?: UpdateUserPasswordError;
};
