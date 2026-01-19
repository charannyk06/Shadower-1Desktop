import { AgentsList } from "@/components/agent/agents-list";
import { getSystemAgentSummaries } from "@/lib/ai/agents/system-agents";
import { getSession } from "auth/server";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const session = await getSession();

  if (!session?.user.id) {
    notFound();
  }

  // In Electron mode, database access is handled via IPC in the client component
  // Don't fetch agents on the server - let the client component handle it via API route
  // This avoids the SQLite database access error in Electron dev mode
  const myAgents: any[] = [];
  const sharedAgents: any[] = [];

  // Get system agents (these don't require database access)
  const systemAgents = getSystemAgentSummaries();

  return (
    <AgentsList
      initialMyAgents={myAgents}
      initialSharedAgents={sharedAgents}
      systemAgents={systemAgents}
      userId={session.user.id}
    />
  );
}
