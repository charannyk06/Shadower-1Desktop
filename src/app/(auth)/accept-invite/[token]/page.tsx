import { AcceptInviteForm } from "@/components/auth/accept-invite-form";
import { InvalidInvitation } from "@/components/auth/invalid-invitation";
import { getInvitationStatus } from "app-types/invitation";
import { invitationRepository } from "lib/db/repository";

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function AcceptInvitePage({ params }: PageProps) {
  const { token } = await params;

  const invitation = await invitationRepository.getByToken(token);

  if (!invitation) {
    return <InvalidInvitation reason="notFound" />;
  }

  const status = getInvitationStatus(invitation);

  if (status !== "pending") {
    return <InvalidInvitation reason={status} />;
  }

  // Role label removed - all users have the same permissions
  return (
    <AcceptInviteForm
      token={token}
      email={invitation.email}
      inviterName={invitation.inviterName}
    />
  );
}
