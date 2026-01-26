"use client";

import { BasicUserWithLastLogin } from "app-types/user";
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "ui/alert-dialog";
import { Button } from "ui/button";
import { Input } from "ui/input";

export function UserDeleteDialog({
  user,
  children,
}: {
  user: BasicUserWithLastLogin;
  children?: React.ReactNode;
  view?: "admin" | "user";
}) {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [confirmName, setConfirmName] = useState("");

  const handleDelete = () => {
    // In desktop mode, account deletion is not available
    toast.error("Account deletion is not available in desktop mode.");
    setShowDeleteDialog(false);
  };

  return (
    <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
      {children && <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            Delete User
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-4">
              <p>Are you sure you want to delete {user.name}?</p>

              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                <p className="text-sm font-medium text-destructive mb-2">
                  This action will permanently:
                </p>
                <ul className="text-sm text-destructive/90 space-y-1">
                  <li>• Delete all user data</li>
                  <li>• Remove all files</li>
                  <li>• Revoke all access</li>
                  <li>• This cannot be undone</li>
                </ul>
              </div>

              <div>
                <p className="text-sm font-medium text-destructive mb-2">
                  Type &quot;{user.name}&quot; to confirm
                </p>
                <Input
                  placeholder={`Type "${user.name}" to confirm`}
                  value={confirmName}
                  onChange={(e) => setConfirmName(e.target.value)}
                  className="border-destructive/30 focus:border-destructive"
                />
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            onClick={() => {
              setShowDeleteDialog(false);
              setConfirmName("");
            }}
          >
            Cancel
          </AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={confirmName !== user.name}
            onClick={handleDelete}
          >
            Delete User
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
