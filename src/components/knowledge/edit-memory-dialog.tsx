"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "ui/dialog";
import { Button } from "ui/button";
import { Textarea } from "ui/textarea";
import { Label } from "ui/label";

interface Memory {
  id: string;
  content: string;
  role?: "user" | "assistant";
}

interface EditMemoryDialogProps {
  memory: Memory;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (id: string, content: string) => Promise<void>;
}

export function EditMemoryDialog({
  memory,
  open,
  onOpenChange,
  onSave,
}: EditMemoryDialogProps) {
  const t = useTranslations();
  const [content, setContent] = useState(memory.content);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!content.trim()) return;
    setSaving(true);
    try {
      await onSave(memory.id, content);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("Knowledge.editMemory")}</DialogTitle>
          <DialogDescription>
            {t("Knowledge.editMemoryDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="content">{t("Knowledge.content")}</Label>
            <Textarea
              id="content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={10}
              className="font-mono text-sm"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("Common.cancel")}
          </Button>
          <Button onClick={handleSave} disabled={saving || !content.trim()}>
            {saving ? t("Common.saving") : t("Common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
