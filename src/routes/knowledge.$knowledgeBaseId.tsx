import { KnowledgeBaseDetailPage } from "@/components/knowledge/knowledge-base-detail-page";
import { authClient } from "@/lib/auth/client";
import { useParams } from "@tanstack/react-router";

/**
 * Knowledge Base Detail Page
 * Shows documents in a knowledge base and allows uploading new ones.
 * Auth is handled by AuthGuard in the layout.
 */
export default function KnowledgeBaseDetailRoute() {
  const { data: session } = authClient.useSession();
  const { knowledgeBaseId } = useParams({ strict: false });

  if (!session?.user?.id || !knowledgeBaseId) {
    return null; // AuthGuard will handle redirect
  }

  return (
    <KnowledgeBaseDetailPage
      userId={session.user.id}
      knowledgeBaseId={knowledgeBaseId}
    />
  );
}
