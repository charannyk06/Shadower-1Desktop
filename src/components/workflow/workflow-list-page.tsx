"use client";
import { EditWorkflowPopup } from "@/components/workflow/edit-workflow-popup";

import { ArrowUpRight, MousePointer2 } from "lucide-react";

import { ShareableCard } from "@/components/shareable-card";
import { WorkflowGreeting } from "@/components/workflow/workflow-greeting";
import { WorkflowSummary } from "app-types/workflow";
import {
  workflowApi,
  workflowFetcher,
  getCurrentUserId,
  isElectronMode,
} from "lib/electron/workflow-api";
import { notify } from "lib/notify";
import { useTranslation } from "react-i18next";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import useSWR, { mutate } from "swr";
import { BackgroundPaths } from "ui/background-paths";
import { Button } from "ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "ui/card";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "ui/dialog";
import { Skeleton } from "ui/skeleton";

export default function WorkflowListPage() {
  const { t } = useTranslation();
  // In Electron mode, user ID loading is handled internally by workflow API
  const [isUserIdLoading, setIsUserIdLoading] = useState(isElectronMode());

  useEffect(() => {
    // Initialize user ID loading state for Electron mode
    if (isElectronMode()) {
      getCurrentUserId().finally(() => setIsUserIdLoading(false));
    }
  }, []);

  const [isDeleteLoading, setIsDeleteLoading] = useState(false);

  const { data: workflows, isLoading: isWorkflowsLoading } = useSWR<
    WorkflowSummary[]
  >("/api/workflow", workflowFetcher, {
    fallbackData: [],
  });

  // Combined loading state - wait for both user ID and workflows
  const isLoading = isWorkflowsLoading || isUserIdLoading;

  // In single-user mode, all workflows belong to the user
  const myWorkflows = workflows || [];

  const deleteWorkflow = async (workflowId: string) => {
    const ok = await notify.confirm({
      description: t("Workflow.deleteConfirm"),
    });
    if (!ok) return;

    try {
      setIsDeleteLoading(true);
      await workflowApi.delete(workflowId);

      mutate("/api/workflow");
      toast.success(t("Workflow.deleted"));
    } catch (_error) {
      toast.error(t("Common.error"));
    } finally {
      setIsDeleteLoading(false);
    }
  };

  return (
    <div className="w-full flex flex-col gap-4 p-8">
      <div className="flex flex-row gap-2 items-center">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant={"ghost"} className="relative group">
              {t("Workflow.whatIsWorkflow")}
              <div className="absolute left-0 -top-1.5 opacity-100 group-hover:opacity-0 transition-opacity duration-300">
                <MousePointer2 className="rotate-180 text-blue-500 fill-blue-500 size-3 wiggle" />
              </div>
            </Button>
          </DialogTrigger>
          <DialogContent className="md:max-w-3xl!">
            <DialogTitle className="sr-only">workflow greeting</DialogTitle>
            <WorkflowGreeting />
          </DialogContent>
        </Dialog>
      </div>

      {/* My Workflows Section */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">{t("Workflow.myWorkflows")}</h2>
          <div className="flex-1 h-px bg-border" />
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <EditWorkflowPopup>
            <Card className="relative bg-secondary overflow-hidden w-full hover:bg-input transition-colors h-[196px] cursor-pointer">
              <div className="absolute inset-0 w-full h-full opacity-50">
                <BackgroundPaths />
              </div>
              <CardHeader>
                <CardTitle>
                  <h1 className="text-lg font-bold">
                    {t("Workflow.createWorkflow")}
                  </h1>
                </CardTitle>
                <CardDescription className="mt-2">
                  <p className="">{t("Workflow.createWorkflowDescription")}</p>
                </CardDescription>
                <div className="mt-auto ml-auto flex-1">
                  <Button variant="ghost" size="lg">
                    {t("Common.create")}
                    <ArrowUpRight className="size-3.5" />
                  </Button>
                </div>
              </CardHeader>
            </Card>
          </EditWorkflowPopup>
          {isLoading
            ? Array(6)
                .fill(null)
                .map((_, index) => (
                  <Skeleton key={index} className="w-full h-[196px]" />
                ))
            : myWorkflows?.map((workflow) => (
                <ShareableCard
                  key={workflow.id}
                  type="workflow"
                  item={workflow}
                  href={`/workflow/${workflow.id}`}
                  onDelete={deleteWorkflow}
                  isDeleteLoading={isDeleteLoading}
                  isOwner={true}
                />
              ))}
        </div>
      </div>

      {/* Empty state */}
      {myWorkflows.length === 0 && !isLoading && (
        <Card className="col-span-full bg-transparent border-none">
          <CardHeader className="text-center py-12">
            <CardTitle>{t("Workflow.noWorkflows")}</CardTitle>
            <CardDescription>
              {t("Workflow.noWorkflowsDescription")}
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}
