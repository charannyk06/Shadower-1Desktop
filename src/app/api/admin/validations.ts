import { z } from "zod";

import { BasicUserWithLastLogin } from "app-types/user";
import { ActionState } from "lib/action-utils";

// Role schema removed - roles/permissions have been removed from the app

export const UpdateUserBanStatusSchema = z.object({
  userId: z.uuid("Invalid user ID"),
  banned: z.enum(["true", "false"]).transform((value) => value === "true"),
  banReason: z.string().optional(),
});

export type UpdateUserBanStatusActionState = ActionState & {
  user?: BasicUserWithLastLogin | null;
};
