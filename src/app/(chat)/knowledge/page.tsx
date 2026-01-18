import { KnowledgeBasePage } from "@/components/knowledge/knowledge-base-page";
import { getSession } from "auth/server";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function KnowledgePage() {
  const session = await getSession();
  if (!session) {
    redirect("/sign-in");
  }

  return <KnowledgeBasePage userId={session.user.id} />;
}
