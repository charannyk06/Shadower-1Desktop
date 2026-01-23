"use client";

import { ShareableCard } from "@/components/shareable-card";
import { useMutateAgents } from "@/hooks/queries/use-agents";
import { agentApi, agentFetcher } from "@/lib/electron/agent-api";
import { AgentSummary } from "app-types/agent";
import { notify } from "lib/notify";
import { ArrowUpRight, Plus, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { safe } from "ts-safe";
import { BackgroundPaths } from "ui/background-paths";
import { Button } from "ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "ui/card";
import { handleErrorWithToast } from "ui/shared-toast";

interface AgentsListProps {
  initialMyAgents: AgentSummary[];
  systemAgents: AgentSummary[];
  userId: string;
}

export function AgentsList({
  initialMyAgents,
  systemAgents,
  userId: _userId,
}: AgentsListProps) {
  const { t } = useTranslation();
  const mutateAgents = useMutateAgents();
  const [deletingAgentLoading, setDeletingAgentLoading] = useState<
    string | null
  >(null);

  const { data: myAgents = initialMyAgents } = useSWR(
    "/api/agent?filters=mine",
    agentFetcher,
    {
      fallbackData: initialMyAgents,
    },
  );

  const deleteAgent = async (agentId: string) => {
    const ok = await notify.confirm({
      description: t("Agent.deleteConfirm"),
    });
    if (!ok) return;
    safe(() => setDeletingAgentLoading(agentId))
      .map(() => agentApi.delete(agentId))
      .ifOk(() => {
        mutateAgents({ id: agentId }, true);
        toast.success(t("Agent.deleted"));
      })
      .ifFail((e) => {
        handleErrorWithToast(e);
        toast.error(t("Common.error"));
      })
      .watch(() => setDeletingAgentLoading(null));
  };

  return (
    <div className="w-full flex flex-col gap-4 p-8">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold" data-testid="agents-title">
          {t("Layout.agents")}
        </h1>
        <Link to="/agent/$agentId" params={{ agentId: "new" }}>
          <Button variant="ghost" data-testid="create-agent-button">
            <Plus />
            {t("Agent.newAgent")}
          </Button>
        </Link>
      </div>

      {/* System Agents Section */}
      {systemAgents.length > 0 && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h2 className="text-lg font-semibold">System Agents</h2>
            <div className="flex-1 h-px bg-border" />
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {systemAgents.map((agent) => (
              <ShareableCard
                key={agent.id}
                type="agent"
                item={agent}
                isOwner={false}
                href={`/agent/${agent.id}`}
                hideActions
              />
            ))}
          </div>
        </div>
      )}

      {/* My Agents Section */}
      <div className="flex flex-col gap-4 mt-8">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">{t("Agent.myAgents")}</h2>
          <div className="flex-1 h-px bg-border" />
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Link to="/agent/$agentId" params={{ agentId: "new" }}>
            <Card
              className="relative bg-secondary overflow-hidden cursor-pointer hover:bg-input transition-colors h-[196px]"
              data-testid="create-agent-card"
            >
              <div className="absolute inset-0 w-full h-full opacity-50">
                <BackgroundPaths />
              </div>
              <CardHeader>
                <CardTitle>
                  <h1 className="text-lg font-bold">{t("Agent.newAgent")}</h1>
                </CardTitle>
                <CardDescription className="mt-2">
                  <p>{t("Layout.createYourOwnAgent")}</p>
                </CardDescription>
                <div className="mt-auto ml-auto flex-1">
                  <Button variant="ghost" size="lg">
                    {t("Common.create")}
                    <ArrowUpRight className="size-3.5" />
                  </Button>
                </div>
              </CardHeader>
            </Card>
          </Link>

          {myAgents.map((agent) => (
            <ShareableCard
              key={agent.id}
              type="agent"
              item={agent}
              href={`/agent/${agent.id}`}
              isDeleteLoading={deletingAgentLoading === agent.id}
              onDelete={deleteAgent}
            />
          ))}
        </div>

        {myAgents.length === 0 && (
          <Card className="col-span-full bg-transparent border-none">
            <CardHeader className="text-center py-12">
              <CardTitle>{t("Agent.noAgents")}</CardTitle>
              <CardDescription>{t("Agent.noAgentsDescription")}</CardDescription>
            </CardHeader>
          </Card>
        )}
      </div>
    </div>
  );
}
