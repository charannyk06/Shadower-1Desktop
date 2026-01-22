import { KnowledgeBasePage } from "@/components/knowledge/knowledge-base-page";
import { authClient } from "@/lib/auth/client";

/**
 * Knowledge Page
 * Auth is handled by AuthGuard in the layout.
 */
export default function KnowledgePage() {
  const { data: session } = authClient.useSession();

  if (!session?.user?.id) {
    return null; // AuthGuard will handle redirect
  }

  return <KnowledgeBasePage userId={session.user.id} />;
}
