"use client";

import { createInvitationAction } from "@/app/api/admin/invitation-actions";
import { CreateInvitationActionState } from "@/app/api/admin/invitation-validations";
import { Check, Copy, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import Form from "next/form";
import { useActionState, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "ui/alert-dialog";
import { Button } from "ui/button";
import { Input } from "ui/input";
import { Label } from "ui/label";

export function InviteUserDialog({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const t = useTranslations("Admin.Invitations");
  const tCommon = useTranslations("Common");
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  const [state, formAction, isPending] = useActionState<
    CreateInvitationActionState,
    FormData
  >(async (_prevState, formData) => {
    const result = await createInvitationAction({}, formData);
    if (result?.success && result.invitation) {
      setInviteLink(result.invitation.inviteLink);
      toast.success(result.message);
    } else if (result?.message) {
      toast.error(result.message);
    }
    return result;
  }, {});

  const handleCopy = async () => {
    if (inviteLink) {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      toast.success(t("linkCopied"));
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleClose = () => {
    setOpen(false);
    // Reset state after dialog closes
    setTimeout(() => {
      setInviteLink(null);
      setCopied(false);
    }, 200);
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      handleClose();
    } else {
      setOpen(true);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      <AlertDialogContent className="max-w-md">
        {!inviteLink ? (
          <Form action={formAction}>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("inviteUser")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("inviteUserDescription")}
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="email">{t("emailAddress")}</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder={t("emailPlaceholder")}
                  required
                  disabled={isPending}
                  data-testid="invite-email-input"
                />
              </div>

              {/* Role selection removed - all users have the same permissions */}
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 pt-2">
              <AlertDialogCancel disabled={isPending} type="button">
                {tCommon("cancel")}
              </AlertDialogCancel>
              <Button
                type="submit"
                disabled={isPending}
                data-testid="send-invitation-button"
              >
                {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {t("sendInvitation")}
              </Button>
            </div>
          </Form>
        ) : (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <Check className="h-5 w-5 text-green-500" />
                {t("invitationCreated")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("shareLink", { email: state?.invitation?.email || "" })}
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className="py-4">
              <div className="flex items-center gap-2">
                <Input
                  value={inviteLink}
                  readOnly
                  className="flex-1 text-sm font-mono"
                  data-testid="invite-link-input"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleCopy}
                  data-testid="copy-invite-link-button"
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <p className="text-sm text-muted-foreground mt-3">
                {t("expiresIn", { days: 7 })}
              </p>
            </div>

            <div className="flex justify-end">
              <Button onClick={handleClose} data-testid="done-button">
                {tCommon("done")}
              </Button>
            </div>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
