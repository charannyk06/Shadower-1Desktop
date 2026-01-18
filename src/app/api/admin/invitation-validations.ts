import { USER_ROLES, UserRoleNames } from "app-types/roles";
import { ActionState } from "lib/action-utils";
import { z } from "zod";

export const CreateInvitationSchema = z.object({
  email: z.string().email("Invalid email address"),
  role: z.enum(
    Object.values(USER_ROLES) as [UserRoleNames, ...UserRoleNames[]],
  ),
});

export const RevokeInvitationSchema = z.object({
  invitationId: z.uuid("Invalid invitation ID"),
});

export const ResendInvitationSchema = z.object({
  invitationId: z.uuid("Invalid invitation ID"),
});

export type CreateInvitationActionState = ActionState & {
  invitation?: {
    id: string;
    email: string;
    inviteLink: string;
  };
};

export type RevokeInvitationActionState = ActionState;

export type ResendInvitationActionState = ActionState & {
  invitation?: {
    id: string;
    email: string;
    inviteLink: string;
  };
};
