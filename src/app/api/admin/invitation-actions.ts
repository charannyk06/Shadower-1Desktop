"use server";

import { UserRoleNames, userRolesInfo } from "app-types/roles";
import { validatedActionWithAdminPermission } from "lib/action-utils";
import { invitationRepository, userRepository } from "lib/db/repository";
import { sendInvitationEmail } from "lib/email/resend";
import { getTranslations } from "next-intl/server";
import {
  CreateInvitationActionState,
  CreateInvitationSchema,
  ResendInvitationActionState,
  ResendInvitationSchema,
  RevokeInvitationActionState,
  RevokeInvitationSchema,
} from "./invitation-validations";

const INVITATION_EXPIRY_DAYS = 7;

function generateInviteLink(token: string): string {
  const baseUrl =
    process.env.BETTER_AUTH_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    "http://localhost:3000";
  return `${baseUrl}/accept-invite/${token}`;
}

export const createInvitationAction = validatedActionWithAdminPermission(
  CreateInvitationSchema,
  async (
    data,
    _formData,
    userSession,
  ): Promise<CreateInvitationActionState> => {
    const t = await getTranslations("Admin.Invitations");
    const { email, role } = data;

    // Check if email already has a user account
    const existingUser = await userRepository.existsByEmail(email);
    if (existingUser) {
      return {
        success: false,
        message: t("emailAlreadyRegistered"),
      };
    }

    // Check if pending invitation exists
    const existingInvitation = await invitationRepository.getByEmail(email);
    if (existingInvitation) {
      return {
        success: false,
        message: t("pendingInvitationExists"),
      };
    }

    // Generate token and expiry
    const token = crypto.randomUUID();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + INVITATION_EXPIRY_DAYS);

    // Create invitation
    const invitation = await invitationRepository.create({
      email,
      token,
      role,
      invitedBy: userSession.user.id,
      expiresAt,
    });

    const inviteLink = generateInviteLink(token);

    // Send email via Resend
    try {
      await sendInvitationEmail({
        to: email,
        inviterName: userSession.user.name || "Admin",
        role: userRolesInfo[role].label,
        inviteLink,
        expiresInDays: INVITATION_EXPIRY_DAYS,
      });
    } catch (error) {
      console.error("Failed to send invitation email:", error);
      // Still return success - admin can copy the link manually
    }

    return {
      success: true,
      message: t("invitationCreated"),
      invitation: {
        id: invitation.id,
        email: invitation.email,
        inviteLink,
      },
    };
  },
);

export const revokeInvitationAction = validatedActionWithAdminPermission(
  RevokeInvitationSchema,
  async (
    data,
    _formData,
    _userSession,
  ): Promise<RevokeInvitationActionState> => {
    const t = await getTranslations("Admin.Invitations");
    const { invitationId } = data;

    await invitationRepository.revoke(invitationId);

    return {
      success: true,
      message: t("invitationRevoked"),
    };
  },
);

export const resendInvitationAction = validatedActionWithAdminPermission(
  ResendInvitationSchema,
  async (
    data,
    _formData,
    userSession,
  ): Promise<ResendInvitationActionState> => {
    const t = await getTranslations("Admin.Invitations");
    const { invitationId } = data;

    // Get existing invitation
    const existingInvitation = await invitationRepository.getById(invitationId);
    if (!existingInvitation) {
      return {
        success: false,
        message: t("invitationNotFound"),
      };
    }

    // Generate new token and expiry
    const newToken = crypto.randomUUID();
    const newExpiresAt = new Date();
    newExpiresAt.setDate(newExpiresAt.getDate() + INVITATION_EXPIRY_DAYS);

    const invitation = await invitationRepository.updateToken(
      invitationId,
      newToken,
      newExpiresAt,
    );

    if (!invitation) {
      return {
        success: false,
        message: t("invitationNotFound"),
      };
    }

    const inviteLink = generateInviteLink(newToken);

    // Resend email
    try {
      await sendInvitationEmail({
        to: invitation.email,
        inviterName: userSession.user.name || "Admin",
        role:
          userRolesInfo[invitation.role as UserRoleNames]?.label ||
          invitation.role,
        inviteLink,
        expiresInDays: INVITATION_EXPIRY_DAYS,
      });
    } catch (error) {
      console.error("Failed to resend invitation email:", error);
    }

    return {
      success: true,
      message: t("invitationResent"),
      invitation: {
        id: invitation.id,
        email: invitation.email,
        inviteLink,
      },
    };
  },
);
