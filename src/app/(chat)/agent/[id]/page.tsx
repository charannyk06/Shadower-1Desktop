import EditAgent from "@/components/agent/edit-agent";
import { getSession } from "auth/server";
import {
  getSystemAgent,
  isSystemAgent,
  systemAgentToSummary,
} from "lib/ai/agents/system-agents";
import { agentRepository } from "lib/db/repository";
import { notFound, redirect } from "next/navigation";

export default async function AgentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();

  if (!session?.user.id) {
    redirect("/sign-in");
  }

  // For new agents, pass no initial data
  if (id === "new") {
    return <EditAgent userId={session.user.id} />;
  }

  // Handle system agents (not stored in database)
  if (isSystemAgent(id)) {
    const systemAgent = getSystemAgent(id);
    if (!systemAgent) {
      notFound();
    }

    // Convert system agent to the format expected by EditAgent
    const agentSummary = systemAgentToSummary(systemAgent);
    const agent = {
      ...agentSummary,
      instructions: {
        role: systemAgent.role,
        systemPrompt: systemAgent.systemPrompt,
        tools: systemAgent.defaultTools,
      },
    };

    // System agents are read-only for all users
    return (
      <EditAgent
        key={id}
        initialAgent={agent}
        userId={session.user.id}
        isOwner={false}
        hasEditAccess={false}
        isBookmarked={false}
        isSystemAgent={true}
      />
    );
  }

  // Fetch the agent data on the server (regular user agents)
  const agent = await agentRepository.selectAgentById(id, session.user.id);

  if (!agent) {
    notFound();
  }

  const isOwner = agent.userId === session.user.id;
  const hasEditAccess = isOwner || agent.visibility === "public";

  return (
    <EditAgent
      key={id}
      initialAgent={agent}
      userId={session.user.id}
      isOwner={isOwner}
      hasEditAccess={hasEditAccess}
      isBookmarked={agent.isBookmarked || false}
    />
  );
}
