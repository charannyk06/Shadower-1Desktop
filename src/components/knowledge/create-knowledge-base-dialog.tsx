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
import logger from "logger";

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
  const [minChunkSize, setMinChunkSize] = useState("100");
  const [maxChunkSize, setMaxChunkSize] = useState("1024");
  const [overlap, setOverlap] = useState("200");
  const [files, setFiles] = useState<File[]>([]);
  const [creating, setCreating] = useState(false);

  const [isDragActive, setIsDragActive] = useState(false);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    setFiles((prev) => [...prev, ...selectedFiles]);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragActive(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragActive(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragActive(false);
    const droppedFiles = Array.from(e.dataTransfer.files);
    setFiles((prev) => [...prev, ...droppedFiles]);
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      toast.error(t("Knowledge.nameRequired"));
      return;
    }

    if (files.length === 0) {
      toast.error(t("Knowledge.filesRequired"));
      return;
    }

    setCreating(true);
    try {
      const formData = new FormData();
      formData.append("name", name);
      formData.append("description", description);
      formData.append("minChunkSize", minChunkSize);
      formData.append("maxChunkSize", maxChunkSize);
      formData.append("overlap", overlap);

      // Append all files
      files.forEach((file) => {
        formData.append("files", file);
      });

      const response = await fetch("/api/knowledge/bases", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const error = await response
          .json()
          .catch(() => ({ error: "Unknown error occurred" }));
        const errorMessage =
          error.error || `Failed to create knowledge base (${response.status})`;
        const lastError = error.lastError || error.details?.lastError;
        const fullErrorMessage = lastError
          ? `${errorMessage}\n\nDetails: ${lastError}`
          : errorMessage;

        logger.error("Knowledge base creation failed:", {
          status: response.status,
          error: errorMessage,
          lastError: lastError,
          details: error,
        });

        console.error("[Knowledge Base] Full error details:", error);
        console.error("[Knowledge Base] Last error:", lastError);

        throw new Error(fullErrorMessage);
      }

      const result = await response.json();
      toast.success(
        t("Knowledge.knowledgeBaseCreated") +
          ` (${result.totalIndexed} chunks indexed)`,
      );
      onOpenChange(false);

      // Reset form
      setName("");
      setDescription("");
      setFiles([]);

      // Trigger refresh callback instead of reloading page
      onCreated?.();
    } catch (error: any) {
      toast.error(error.message || t("Knowledge.failedToCreateKnowledgeBase"));
      console.error("Failed to create knowledge base:", error);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="top">
      <DrawerPortal>
        <DrawerContent
          style={{ userSelect: "text" }}
          className="max-h-[100vh]! w-full rounded-none flex flex-col overflow-hidden p-4 md:p-6"
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

              <div className="space-y-4">
                <h3 className="font-semibold">
                  {t("Knowledge.chunkingParameters")}
                </h3>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="minChunkSize">
                      {t("Knowledge.minChunkSize")}
                    </Label>
                    <Input
                      id="minChunkSize"
                      type="number"
                      value={minChunkSize}
                      onChange={(e) => setMinChunkSize(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="maxChunkSize">
                      {t("Knowledge.maxChunkSize")}
                    </Label>
                    <Input
                      id="maxChunkSize"
                      type="number"
                      value={maxChunkSize}
                      onChange={(e) => setMaxChunkSize(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="overlap">{t("Knowledge.overlap")}</Label>
                    <Input
                      id="overlap"
                      type="number"
                      value={overlap}
                      onChange={(e) => setOverlap(e.target.value)}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("Knowledge.chunkingNote")}
                </p>
              </div>

              <div className="space-y-2">
                <Label>{t("Knowledge.uploadDocuments")}</Label>
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => document.getElementById("file-input")?.click()}
                  className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                    isDragActive
                      ? "border-primary bg-primary/5"
                      : "border-muted-foreground/25 hover:border-muted-foreground/50"
                  }`}
                >
                  <input
                    id="file-input"
                    type="file"
                    multiple
                    accept=".pdf,.doc,.docx,.txt,.csv,.xls,.xlsx,.md,.ppt,.pptx,.html"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                  <p className="text-sm text-muted-foreground">
                    {isDragActive
                      ? t("Knowledge.dropFilesHere")
                      : t("Knowledge.dropFilesOrClick")}
                  </p>
                  <p className="text-xs text-muted-foreground mt-2">
                    {t("Knowledge.supportedFileTypes")}
                  </p>
                </div>
                {files.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {files.map((file, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between p-2 bg-muted rounded"
                      >
                        <span className="text-sm">{file.name}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            setFiles((prev) =>
                              prev.filter((_, i) => i !== index),
                            )
                          }
                        >
                          ×
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
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
