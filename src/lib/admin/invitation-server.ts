import "server-only";

import { InvitationListItem } from "app-types/invitation";
import { requireAdminPermission } from "lib/auth/permissions";
import { invitationRepository } from "lib/db/repository";

export interface GetInvitationsResult {
  invitations: InvitationListItem[];
  total: number;
}

/**
 * Get all invitations (admin only)
 */
export async function getAdminInvitations(options?: {
  limit?: number;
  offset?: number;
}): Promise<GetInvitationsResult> {
  await requireAdminPermission("list invitations");

  const result = await invitationRepository.getPendingInvitations(options);

  return result;
}
