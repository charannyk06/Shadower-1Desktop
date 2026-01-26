"use client";

import {
  passwordRegexPattern,
  passwordRequirementsText,
} from "lib/validations/password";
import { FormEvent, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
  AlertDialogHeader,
} from "ui/alert-dialog";
import { Button } from "ui/button";
import { Input } from "ui/input";

export function UpdateUserPasswordDialog({
  children,
  userId,
  currentUserId,
  onReset,
  disabled,
}: {
  children: React.ReactNode;
  userId: string;
  currentUserId: string;
  onReset?: () => void;
  disabled?: boolean;
  view?: "admin" | "user";
}) {
  const [showResetPasswordDialog, setShowResetPasswordDialog] = useState(false);
  const [errorMessage, setErrorMessage] = useState<null | string>(null);
  const [isPending, setIsPending] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const isCurrentUser = userId === currentUserId;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (newPassword !== confirmPassword) {
      setErrorMessage("Passwords do not match");
      return;
    }

    setIsPending(true);
    try {
      // In desktop mode, password update would need to be implemented via IPC
      // For now, show a message that this feature is not available
      toast.info("Password update is not available in desktop mode.");
      setShowResetPasswordDialog(false);
      onReset?.();
    } catch (_error) {
      const errorMsg = "Failed to update password";
      setErrorMessage(errorMsg);
      toast.error(errorMsg);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <AlertDialog
      open={showResetPasswordDialog}
      onOpenChange={(open) => {
        setShowResetPasswordDialog(open);
        if (!open) {
          setErrorMessage(null);
          setCurrentPassword("");
          setNewPassword("");
          setConfirmPassword("");
        }
      }}
    >
      <AlertDialogTrigger asChild disabled={disabled}>
        {children}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Update Password</AlertDialogTitle>
          <AlertDialogDescription>Change user password</AlertDialogDescription>
        </AlertDialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 my-4">
            {isCurrentUser && (
              <Input
                type="password"
                name="currentPassword"
                data-testid="current-password-input"
                placeholder="Current password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            )}
            <Input
              type="password"
              name="newPassword"
              data-testid="new-password-input"
              placeholder="New password"
              pattern={passwordRegexPattern}
              minLength={8}
              maxLength={20}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              onFocus={() => setErrorMessage(null)}
              className={errorMessage ? "border-red-500" : ""}
              title={passwordRequirementsText}
            />
            <Input
              type="password"
              name="confirmPassword"
              data-testid="confirm-password-input"
              placeholder="Confirm password"
              pattern={passwordRegexPattern}
              minLength={8}
              maxLength={20}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              onFocus={() => setErrorMessage(null)}
              className={errorMessage ? "border-red-500" : ""}
              title={passwordRequirementsText}
            />
            {errorMessage && (
              <p className="text-red-500 text-sm">{errorMessage}</p>
            )}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => setShowResetPasswordDialog(false)}
              disabled={isPending}
              type="button"
            >
              Cancel
            </AlertDialogCancel>
            <Button
              type="submit"
              disabled={isPending}
              data-testid="update-password-submit-button"
            >
              Update Password
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
