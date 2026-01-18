import { AgentsList } from "@/components/agent/agents-list";
import { getSystemAgentSummaries } from "@/lib/ai/agents/system-agents";
import { getSession } from "auth/server";
import { agentRepository } from "lib/db/repository";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const session = await getSession();

  if (!session?.user.id) {
    notFound();
  }

  // Fetch agents data on the server
  const allAgents = await agentRepository.selectAgents(
    session.user.id,
    ["mine", "shared"],
    50,
  );

  // Separate into my agents and shared agents
  const myAgents = allAgents.filter(
    (agent) => agent.userId === session.user.id,
  );
  const sharedAgents = allAgents.filter(
    (agent) => agent.userId !== session.user.id,
  );

  // Get system agents
  const systemAgents = getSystemAgentSummaries();

  return (
    <AgentsList
      initialMyAgents={myAgents}
      initialSharedAgents={sharedAgents}
      systemAgents={systemAgents}
      userId={session.user.id}
      userRole={session.user.role}
    />
  );
}
