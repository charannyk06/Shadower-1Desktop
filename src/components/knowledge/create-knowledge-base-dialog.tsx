"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
  DrawerPortal,
} from "ui/drawer";
import { Button } from "ui/button";
import { Input } from "ui/input";
import { Label } from "ui/label";
import { Textarea } from "ui/textarea";
import { toast } from "sonner";

interface CreateKnowledgeBaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  onCreated?: () => void;
}

export function CreateKnowledgeBaseDialog({
  open,
  onOpenChange,
  userId: _userId,
  onCreated,
}: CreateKnowledgeBaseDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) {
      toast.error(t("Knowledge.nameRequired"));
      return;
    }

    setCreating(true);
    try {
      // Get current user ID
      const user = await window.electronAPI.auth.getCurrentUser();
      const userId = user?.id || "local-user";

      // Create the knowledge base via IPC
      const result = await window.electronAPI.knowledge.createBase({
        name: name.trim(),
        description: description.trim() || undefined,
        userId,
      });

      if (!result.knowledgeBase) {
        throw new Error(result.error || "Failed to create knowledge base");
      }

      toast.success(t("Knowledge.knowledgeBaseCreated"));

      onOpenChange(false);

      // Reset form
      setName("");
      setDescription("");

      onCreated?.();
    } catch (error: any) {
      toast.error(error.message || t("Knowledge.failedToCreateKnowledgeBase"));
      console.error("Failed to create knowledge base:", error);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Drawer handleOnly open={open} onOpenChange={onOpenChange} direction="top">
      <DrawerPortal>
        <DrawerContent
          style={{ userSelect: "text" }}
          className="!max-h-[100vh] !h-full w-full !border-none !rounded-none !mb-0 flex flex-col bg-card overflow-hidden p-4 md:p-6"
        >
          <div className="flex items-center justify-between mb-4">
            <div>
              <DrawerTitle className="text-2xl font-bold">
                {t("Knowledge.createKnowledgeBase")}
              </DrawerTitle>
              <DrawerDescription className="mt-1">
                {t("Knowledge.createKnowledgeBaseDescription")}
              </DrawerDescription>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onOpenChange(false)}
            >
              <X />
            </Button>
          </div>
          <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
            <div className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="name">{t("Knowledge.name")}</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("Knowledge.namePlaceholder")}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">
                  {t("Knowledge.description")}
                </Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t("Knowledge.descriptionPlaceholder")}
                  rows={3}
                />
              </div>

              <p className="text-sm text-muted-foreground">
                {t("Knowledge.addDocumentsAfterCreate") || "After creating the knowledge base, you can add documents using the upload button on the detail page."}
              </p>
            </div>
            <div className="flex items-center justify-end gap-3 pt-6 border-t mt-6">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t("Common.cancel")}
              </Button>
              <Button
                onClick={handleCreate}
                disabled={creating || !name.trim()}
              >
                {creating ? t("Common.creating") : t("Common.create")}
              </Button>
            </div>
          </div>
        </DrawerContent>
      </DrawerPortal>
    </Drawer>
  );
}
