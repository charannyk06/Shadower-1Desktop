import { useEffect, useState } from "react";
import { useParams, useNavigate } from "@tanstack/react-router";
import EditAgent from "@/components/agent/edit-agent";
import { authClient } from "@/lib/auth/client";
import { agentApi } from "@/lib/electron/agent-api";
import {
  getSystemAgent,
  isSystemAgent,
  systemAgentToSummary,
} from "lib/ai/agents/system-agents";
import { Loader2 } from "lucide-react";

/**
 * Agent Edit/View Page
 * Auth is handled by AuthGuard in the layout.
 */
export default function AgentPage() {
  const params = useParams({ strict: false });
  const navigate = useNavigate();
  const id = params.agentId;
  const { data: session } = authClient.useSession();

  const [agent, setAgent] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!session?.user?.id || !id) return;

    const loadAgent = async () => {
      setIsLoading(true);

      // For new agents, no data needed
      if (id === "new") {
        setIsLoading(false);
        return;
      }

      // Handle system agents (not stored in database)
      if (isSystemAgent(id)) {
        const systemAgent = getSystemAgent(id);
        if (!systemAgent) {
          setNotFound(true);
          setIsLoading(false);
          return;
        }

        const agentSummary = systemAgentToSummary(systemAgent);
        setAgent({
          ...agentSummary,
          instructions: {
            role: systemAgent.role,
            systemPrompt: systemAgent.systemPrompt,
            tools: systemAgent.defaultTools,
          },
          isSystemAgent: true,
        });
        setIsLoading(false);
        return;
      }

      // Fetch regular agent via IPC
      try {
        const fetchedAgent = await agentApi.getById(id);
        if (!fetchedAgent) {
          setNotFound(true);
        } else {
          setAgent(fetchedAgent);
        }
      } catch (error) {
        console.error("[AgentPage] Error loading agent:", error);
        setNotFound(true);
      }
      setIsLoading(false);
    };

    loadAgent();
  }, [id, session?.user?.id]);

  if (!session?.user?.id) {
    return null; // AuthGuard will handle redirect
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (notFound) {
    navigate({ to: "/" });
    return null;
  }

  // New agent
  if (id === "new") {
    return <EditAgent userId={session.user.id} />;
  }

  // System agent
  if (agent?.isSystemAgent) {
    return (
      <EditAgent
        key={id}
        initialAgent={agent}
        userId={session.user.id}
        isSystemAgent={true}
      />
    );
  }

  // Regular agent - in single-user mode, user always owns their agents
  if (agent) {
    return (
      <EditAgent
        key={id}
        initialAgent={agent}
        userId={session.user.id}
      />
    );
  }

  return null;
}
