"use client";

import { useState } from "react";
import { TrashIcon, XIcon, UserIcon, BotIcon } from "lucide-react";
import { Button } from "ui/button";
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
import { toast } from "sonner";
import { cn } from "lib/utils";

interface BulkActionToolbarProps {
  selectedIds: Set<string>;
  selectedMemories: Array<{ id: string; role?: "user" | "assistant" }>;
  onDelete: (ids: string[]) => Promise<void>;
  onDeleteByRole: (role: "user" | "assistant", ids: string[]) => Promise<void>;
  onClearSelection: () => void;
  className?: string;
}

export function BulkActionToolbar({
  selectedIds,
  selectedMemories,
  onDelete,
  onDeleteByRole,
  onClearSelection,
  className,
}: BulkActionToolbarProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteRoleDialogOpen, setDeleteRoleDialogOpen] = useState<
    "user" | "assistant" | null
  >(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const selectedCount = selectedIds.size;
  const userCount = selectedMemories.filter((m) => m.role === "user").length;
  const assistantCount = selectedMemories.filter(
    (m) => m.role === "assistant",
  ).length;

  const handleDeleteAll = async () => {
    setIsDeleting(true);
    try {
      await onDelete(Array.from(selectedIds));
      setDeleteDialogOpen(false);
      onClearSelection();
      toast.success(`Successfully deleted ${selectedCount} memories`);
    } catch (error: any) {
      toast.error(
        error.message || `Failed to delete ${selectedCount} memories`,
      );
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteByRole = async (role: "user" | "assistant") => {
    const roleIds = selectedMemories
      .filter((m) => m.role === role)
      .map((m) => m.id);
    const count = roleIds.length;

    setIsDeleting(true);
    try {
      await onDeleteByRole(role, roleIds);
      setDeleteRoleDialogOpen(null);
      onClearSelection();
      toast.success(`Successfully deleted ${count} memories`);
    } catch (error: any) {
      toast.error(error.message || `Failed to delete ${count} memories`);
    } finally {
      setIsDeleting(false);
    }
  };

  if (selectedCount === 0) return null;

  return (
    <>
      <div
        className={cn(
          "fixed bottom-4 left-1/2 -translate-x-1/2 z-50",
          "bg-card border border-border rounded-lg shadow-lg",
          "px-4 py-3 flex items-center gap-3",
          "animate-in slide-in-from-bottom-4",
          className,
        )}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">
            {selectedCount} {selectedCount === 1 ? "item" : "items"} selected
          </span>
          {userCount > 0 && assistantCount > 0 && (
            <span className="text-xs text-muted-foreground">
              ({userCount} user, {assistantCount} assistant)
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 border-l border-border pl-3">
          {userCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteRoleDialogOpen("user")}
              disabled={isDeleting}
              className="h-8"
            >
              <UserIcon className="size-3 mr-1" />
              Delete User ({userCount})
            </Button>
          )}
          {assistantCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteRoleDialogOpen("assistant")}
              disabled={isDeleting}
              className="h-8"
            >
              <BotIcon className="size-3 mr-1" />
              Delete Assistant ({assistantCount})
            </Button>
          )}
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setDeleteDialogOpen(true)}
            disabled={isDeleting}
            className="h-8"
          >
            <TrashIcon className="size-3 mr-1" />
            Delete All ({selectedCount})
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearSelection}
            disabled={isDeleting}
            className="h-8"
          >
            <XIcon className="size-3" />
          </Button>
        </div>
      </div>

      {/* Delete All Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Selected Memories?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {selectedCount}{" "}
              {selectedCount === 1 ? "memory" : "memories"}? This action cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteAll}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete by Role Confirmation Dialog */}
      {deleteRoleDialogOpen && (
        <AlertDialog
          open={!!deleteRoleDialogOpen}
          onOpenChange={(open) => !open && setDeleteRoleDialogOpen(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Delete {deleteRoleDialogOpen === "user" ? "User" : "Assistant"}{" "}
                Memories?
              </AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete{" "}
                {deleteRoleDialogOpen === "user" ? userCount : assistantCount}{" "}
                {deleteRoleDialogOpen === "user" ? "user" : "assistant"}{" "}
                {deleteRoleDialogOpen === "user" && userCount === 1
                  ? "memory"
                  : "memories"}
                ? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDeleting}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => handleDeleteByRole(deleteRoleDialogOpen!)}
                disabled={isDeleting}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {isDeleting ? "Deleting..." : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}
