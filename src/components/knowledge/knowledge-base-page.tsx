"use client";

import { useState } from "react";
import { BrainIcon, FileTextIcon, PlusIcon } from "lucide-react";
import { Button } from "ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "ui/tabs";
import { MemoryList } from "./memory-list";
import { KnowledgeBaseList } from "./knowledge-base-list";
import { CreateKnowledgeBaseDialog } from "./create-knowledge-base-dialog";

interface KnowledgeBasePageProps {
  userId: string;
}

export function KnowledgeBasePage({ userId }: KnowledgeBasePageProps) {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  return (
    <div className="container mx-auto py-8 px-4 max-w-7xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <BrainIcon className="size-8" />
            Knowledge
          </h1>
          <p className="text-muted-foreground mt-2">
            Manage your assistant's memory and knowledge bases
          </p>
        </div>
        <Button onClick={() => setCreateDialogOpen(true)}>
          <PlusIcon className="size-4 mr-2" />
          Create Knowledge Base
        </Button>
      </div>

      <Tabs defaultValue="memories" className="w-full">
        <TabsList>
          <TabsTrigger value="memories">
            <BrainIcon className="size-4 mr-2" />
            Assistant Memory
          </TabsTrigger>
          <TabsTrigger value="knowledge-bases">
            <FileTextIcon className="size-4 mr-2" />
            Knowledge Bases
          </TabsTrigger>
        </TabsList>

        <TabsContent value="memories" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Assistant Memory</CardTitle>
              <CardDescription>
                View and manage the assistant's stored memories from your
                conversations
              </CardDescription>
            </CardHeader>
            <CardContent>
              <MemoryList userId={userId} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="knowledge-bases" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Knowledge Bases</CardTitle>
              <CardDescription>
                Create and manage knowledge bases for RAG retrieval
              </CardDescription>
            </CardHeader>
            <CardContent>
              <KnowledgeBaseList userId={userId} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <CreateKnowledgeBaseDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        userId={userId}
      />
    </div>
  );
}
