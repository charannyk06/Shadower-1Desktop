export interface Invitation {
  id: string;
  email: string;
  token: string;
  invitedBy: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface InvitationWithInviter extends Invitation {
  inviterName: string;
  inviterEmail: string;
}

export interface InvitationListItem {
  id: string;
  email: string;
  inviterName: string | null;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export type InvitationStatus = "pending" | "accepted" | "expired" | "revoked";

export function getInvitationStatus(invitation: {
  acceptedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
}): InvitationStatus {
  if (invitation.acceptedAt) return "accepted";
  if (invitation.revokedAt) return "revoked";
  if (new Date() > new Date(invitation.expiresAt)) return "expired";
  return "pending";
}
