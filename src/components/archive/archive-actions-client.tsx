"use client";

import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { archiveApi } from "@/lib/electron/archive-api";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "ui/dialog";
import { Input } from "ui/input";
import { Label } from "ui/label";
import { Textarea } from "ui/textarea";

interface Archive {
  id: string;
  name: string;
  description: string | null;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
}

interface ArchiveActionsClientProps {
  archive: Archive;
}

export function ArchiveActionsClient({ archive }: ArchiveActionsClientProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editName, setEditName] = useState(archive.name);
  const [editDescription, setEditDescription] = useState(
    archive.description || "",
  );

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await archiveApi.delete(archive.id);
      toast.success(t("Archive.deleted"));
      navigate({ to: "/" });
    } catch (error) {
      console.error("[ArchiveActions] Error deleting archive:", error);
      toast.error(t("Archive.deleteError"));
    }
    setIsDeleting(false);
    setIsDeleteDialogOpen(false);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await archiveApi.update(archive.id, {
        name: editName,
        description: editDescription || null,
      });
      toast.success(t("Archive.updated"));
      // Refresh the page to show updated data
      window.location.reload();
    } catch (error) {
      console.error("[ArchiveActions] Error updating archive:", error);
      toast.error(t("Archive.updateError"));
    }
    setIsSaving(false);
    setIsEditDialogOpen(false);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setIsEditDialogOpen(true)}>
            <Pencil className="h-4 w-4 mr-2" />
            {t("Common.edit")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setIsDeleteDialogOpen(true)}
            className="text-destructive"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            {t("Common.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Archive.editArchive")}</DialogTitle>
            <DialogDescription>
              {t("Archive.editArchiveDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">{t("Common.name")}</Label>
              <Input
                id="name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder={t("Archive.namePlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">{t("Common.description")}</Label>
              <Textarea
                id="description"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder={t("Archive.descriptionPlaceholder")}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsEditDialogOpen(false)}
            >
              {t("Common.cancel")}
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving || !editName.trim()}
            >
              {isSaving ? t("Common.saving") : t("Common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Archive.deleteArchive")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("Archive.deleteArchiveConfirmation")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? t("Common.deleting") : t("Common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
