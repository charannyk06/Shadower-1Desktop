import "server-only";

import { InvitationListItem } from "app-types/invitation";
import { getSession } from "lib/auth/server";
import { invitationRepository } from "lib/db/repository";

export interface GetInvitationsResult {
  invitations: InvitationListItem[];
  total: number;
}

/**
 * Get all invitations (requires authentication)
 */
export async function getAdminInvitations(options?: {
  limit?: number;
  offset?: number;
}): Promise<GetInvitationsResult> {
  // All authenticated users have access (roles/permissions removed)
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error("Unauthorized: Authentication required");
  }

  const result = await invitationRepository.getPendingInvitations(options);

  return result;
}
