import { ActionState } from "lib/action-utils";
import { z } from "zod";

export const CreateInvitationSchema = z.object({
  email: z.string().email("Invalid email address"),
  // Role removed - all users have the same permissions now
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
