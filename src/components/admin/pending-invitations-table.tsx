"use client";

import {
  resendInvitationAction,
  revokeInvitationAction,
} from "@/app/api/admin/invitation-actions";
import {
  ResendInvitationActionState,
  RevokeInvitationActionState,
} from "@/app/api/admin/invitation-validations";
import { InvitationListItem, getInvitationStatus } from "app-types/invitation";
import { UserRoleNames, userRolesInfo } from "app-types/roles";
import { formatDistanceToNow } from "date-fns";
import { Check, Copy, RefreshCw, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import Form from "next/form";
import { useActionState, useState } from "react";
import { toast } from "sonner";
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
import { Badge } from "ui/badge";
import { Button } from "ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "ui/table";

interface PendingInvitationsTableProps {
  readonly invitations: readonly InvitationListItem[];
}

export function PendingInvitationsTable({
  invitations,
}: PendingInvitationsTableProps) {
  const t = useTranslations("Admin.Invitations");
  const tCommon = useTranslations("Common");
  const [revokeDialogOpen, setRevokeDialogOpen] = useState(false);
  const [selectedInvitationId, setSelectedInvitationId] = useState<
    string | null
  >(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  const [_, revokeFormAction, isRevoking] = useActionState<
    RevokeInvitationActionState,
    FormData
  >(async (_prevState, formData) => {
    const result = await revokeInvitationAction({}, formData);
    if (result?.success) {
      toast.success(result.message);
      setRevokeDialogOpen(false);
      // Refresh the page to show updated data
      window.location.reload();
    } else {
      toast.error(result?.message || "Failed to revoke invitation");
    }
    return result;
  }, {});

  const [__, resendFormAction, isResending] = useActionState<
    ResendInvitationActionState,
    FormData
  >(async (_prevState, formData) => {
    const result = await resendInvitationAction({}, formData);
    if (result?.success && result.invitation) {
      setInviteLink(result.invitation.inviteLink);
      toast.success(result.message);
    } else {
      toast.error(result?.message || "Failed to resend invitation");
    }
    return result;
  }, {});

  const handleCopyNewLink = async () => {
    if (inviteLink) {
      await navigator.clipboard.writeText(inviteLink);
      toast.success(t("linkCopied"));
      setInviteLink(null);
    }
  };

  const getStatusBadge = (invitation: InvitationListItem) => {
    const status = getInvitationStatus(invitation);

    const variants: Record<
      string,
      "default" | "secondary" | "destructive" | "outline"
    > = {
      pending: "default",
      accepted: "secondary",
      expired: "destructive",
      revoked: "outline",
    };

    return (
      <Badge variant={variants[status] || "default"}>
        {t(`status.${status}`)}
      </Badge>
    );
  };

  const getExpiryText = (invitation: InvitationListItem) => {
    const status = getInvitationStatus(invitation);
    if (status !== "pending") return "-";

    const expiresAt = new Date(invitation.expiresAt);
    const now = new Date();

    if (expiresAt < now) {
      return t("status.expired");
    }

    return formatDistanceToNow(expiresAt, { addSuffix: true });
  };

  if (invitations.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p>{t("noPendingInvitations")}</p>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-lg border bg-card w-full overflow-x-auto">
        <Table data-testid="invitations-table" className="w-full">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="font-semibold">
                {t("emailAddress")}
              </TableHead>
              <TableHead className="font-semibold">{t("role")}</TableHead>
              <TableHead className="font-semibold">{t("status")}</TableHead>
              <TableHead className="font-semibold">{t("invitedBy")}</TableHead>
              <TableHead className="font-semibold">{t("expires")}</TableHead>
              <TableHead className="font-semibold text-right">
                {t("actions")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invitations.map((invitation) => {
              const status = getInvitationStatus(invitation);
              const isPending = status === "pending";
              const roleInfo =
                userRolesInfo[invitation.role as UserRoleNames] || null;

              return (
                <TableRow
                  key={invitation.id}
                  className="group"
                  data-testid={`invitation-row-${invitation.id}`}
                >
                  <TableCell className="font-medium">
                    {invitation.email}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {roleInfo?.label || invitation.role}
                    </Badge>
                  </TableCell>
                  <TableCell>{getStatusBadge(invitation)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {invitation.inviterName || "Unknown"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {getExpiryText(invitation)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      {isPending && (
                        <>
                          <Form action={resendFormAction}>
                            <input
                              type="hidden"
                              name="invitationId"
                              value={invitation.id}
                            />
                            <Button
                              type="submit"
                              variant="ghost"
                              size="sm"
                              disabled={isResending}
                              title={t("resend")}
                              data-testid={`resend-invitation-${invitation.id}`}
                            >
                              <RefreshCw
                                className={`h-4 w-4 ${isResending ? "animate-spin" : ""}`}
                              />
                            </Button>
                          </Form>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSelectedInvitationId(invitation.id);
                              setRevokeDialogOpen(true);
                            }}
                            title={t("revoke")}
                            data-testid={`revoke-invitation-${invitation.id}`}
                          >
                            <XCircle className="h-4 w-4 text-destructive" />
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Copy new link dialog */}
      <AlertDialog
        open={!!inviteLink}
        onOpenChange={(open) => !open && setInviteLink(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Check className="h-5 w-5 text-green-500" />
              {t("invitationResent")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("shareLink", { email: "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-center gap-2 py-4">
            <input
              type="text"
              value={inviteLink || ""}
              readOnly
              className="flex-1 text-sm font-mono p-2 border rounded bg-muted"
            />
            <Button variant="outline" size="icon" onClick={handleCopyNewLink}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setInviteLink(null)}>
              {tCommon("done")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Revoke confirmation dialog */}
      <AlertDialog open={revokeDialogOpen} onOpenChange={setRevokeDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("revoke")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("revokeConfirmation")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRevoking}>
              {tCommon("cancel")}
            </AlertDialogCancel>
            <Form action={revokeFormAction}>
              <input
                type="hidden"
                name="invitationId"
                value={selectedInvitationId || ""}
              />
              <AlertDialogAction
                type="submit"
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={isRevoking}
              >
                {t("revoke")}
              </AlertDialogAction>
            </Form>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
