"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { BrainIcon, FileTextIcon, PlusIcon } from "lucide-react";
import { Button } from "ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "ui/card";
import { AnimatedTabs } from "ui/animated-tabs";
import { MemoryList } from "./memory-list";
import { KnowledgeBaseList } from "./knowledge-base-list";
import { CreateKnowledgeBaseDialog } from "./create-knowledge-base-dialog";
import { authClient } from "lib/auth/client";

const KNOWLEDGE_TABS = [
  {
    id: "memories",
    label: "Assistant Memory",
    icon: <BrainIcon className="size-4" />,
  },
  {
    id: "knowledge-bases",
    label: "Knowledge Bases",
    icon: <FileTextIcon className="size-4" />,
  },
] as const;

type TabId = (typeof KNOWLEDGE_TABS)[number]["id"];

export function KnowledgeContent() {
  const t = useTranslations();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = authClient.useSession();

  // Sync tab state with URL
  const tabFromUrl = (searchParams.get("tab") as TabId) || "memories";
  const [activeTab, setActiveTab] = useState<TabId>(tabFromUrl);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Update activeTab when URL changes
  useEffect(() => {
    const urlTab = (searchParams.get("tab") as TabId) || "memories";
    if (urlTab !== activeTab) {
      setActiveTab(urlTab);
    }
  }, [searchParams, activeTab]);

  const handleTabChange = useCallback(
    (tab: TabId) => {
      setActiveTab(tab);
      // Update URL with tab param, preserving other params
      const params = new URLSearchParams(searchParams.toString());
      if (tab !== "memories") {
        params.set("tab", tab);
      } else {
        params.delete("tab");
      }
      // Reset page when switching tabs
      params.delete("page");
      params.delete("search");
      params.delete("role");
      const queryString = params.toString();
      router.push(queryString ? `?${queryString}` : window.location.pathname);
    },
    [router, searchParams],
  );

  const handleKnowledgeBaseCreated = useCallback(() => {
    // Trigger refresh of knowledge base list
    setRefreshKey((prev) => prev + 1);
    // Switch to knowledge bases tab to show the new KB
    handleTabChange("knowledge-bases");
  }, [handleTabChange]);

  if (!session?.user?.id) {
    return null;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BrainIcon className="size-6" />
            {t("Knowledge.title")}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {t("Knowledge.description")}
          </p>
        </div>
        <Button onClick={() => setCreateDialogOpen(true)}>
          <PlusIcon className="size-4 mr-2" />
          {t("Knowledge.createKnowledgeBase")}
        </Button>
      </div>

      {/* Animated Tabs */}
      <AnimatedTabs
        tabs={KNOWLEDGE_TABS.map((tab) => ({
          id: tab.id,
          label: tab.label,
          icon: tab.icon,
        }))}
        activeTab={activeTab}
        onTabChange={(tab) => handleTabChange(tab as TabId)}
      />

      {/* Tab Content */}
      <div className="space-y-4">
        {activeTab === "memories" && (
          <Card>
            <CardHeader>
              <CardTitle>{t("Knowledge.assistantMemory")}</CardTitle>
              <CardDescription>
                {t("Knowledge.assistantMemoryDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <MemoryList userId={session.user.id} />
            </CardContent>
          </Card>
        )}

        {activeTab === "knowledge-bases" && (
          <Card>
            <CardHeader>
              <CardTitle>{t("Knowledge.knowledgeBases")}</CardTitle>
              <CardDescription>
                {t("Knowledge.knowledgeBasesDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <KnowledgeBaseList key={refreshKey} userId={session.user.id} />
            </CardContent>
          </Card>
        )}
      </div>

      <CreateKnowledgeBaseDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        userId={session.user.id}
        onCreated={handleKnowledgeBaseCreated}
      />
    </div>
  );
}
