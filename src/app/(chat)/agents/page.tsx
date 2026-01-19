"use client";

import { AgentsList } from "@/components/agent/agents-list";
import { getSystemAgentSummaries } from "@/lib/ai/agents/system-agents";
import { authClient } from "@/lib/auth/client";
import { Loader2 } from "lucide-react";

export default function AgentsPage() {
  const { data: session, isPending } = authClient.useSession();

  // Get system agents (these don't require database access)
  const systemAgents = getSystemAgentSummaries();

  if (isPending) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!session?.user?.id) {
    return null; // AuthGuard will handle redirect
  }

  // In Electron mode, database access is handled via IPC in the client component
  // Don't fetch agents on the server - let the client component handle it via IPC
  const myAgents: any[] = [];
  const sharedAgents: any[] = [];

  return (
    <AgentsList
      initialMyAgents={myAgents}
      initialSharedAgents={sharedAgents}
      systemAgents={systemAgents}
      userId={session.user.id}
    />
  );
}
