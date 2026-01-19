"use server";

import {
  CreateInvitationActionState,
  ResendInvitationActionState,
  RevokeInvitationActionState,
} from "./invitation-validations";

// Local-first mode: Invitations are not supported
// This app is for single-user local use

export const createInvitationAction = async (
  _prevState: unknown,
  _formData: FormData,
): Promise<CreateInvitationActionState> => {
  return {
    success: false,
    message:
      "Invitations are not available in local-first mode. This is a single-user desktop application.",
  };
};

export const revokeInvitationAction = async (
  _prevState: unknown,
  _formData: FormData,
): Promise<RevokeInvitationActionState> => {
  return {
    success: false,
    message: "Invitations are not available in local-first mode.",
  };
};

export const resendInvitationAction = async (
  _prevState: unknown,
  _formData: FormData,
): Promise<ResendInvitationActionState> => {
  return {
    success: false,
    message: "Invitations are not available in local-first mode.",
  };
};
