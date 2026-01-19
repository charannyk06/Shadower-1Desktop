"use client";

import { useProfileTranslations } from "@/hooks/use-profile-translations";
import { BasicUserWithLastLogin } from "app-types/user";
import { AlertTriangle, Lock, Shield, Trash2 } from "lucide-react";
import { Button } from "ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "ui/card";
import { Label } from "ui/label";
import { UserDeleteDialog } from "./user-delete-dialog";
import { UserStatusBadge } from "./user-status-badge";
import { UpdateUserPasswordDialog } from "./user-update-password-dialog";

interface UserAccessCardProps {
  user: BasicUserWithLastLogin;
  currentUserId: string;
  userAccountInfo?: {
    hasPassword: boolean;
    oauthProviders: string[];
  };
  onUserDetailsUpdate: (user: Partial<BasicUserWithLastLogin>) => void;
  view?: "admin" | "user";
  disabled?: boolean;
}

export function UserAccessCard({
  user,
  currentUserId,
  userAccountInfo,
  onUserDetailsUpdate,
  view,
  disabled = false,
}: UserAccessCardProps) {
  const { t, tCommon } = useProfileTranslations(view);

  const handleUserUpdate = (updatedUser: Partial<BasicUserWithLastLogin>) => {
    onUserDetailsUpdate(updatedUser);
  };

  return (
    <Card className="transition-all duration-200 hover:shadow-md">
      <CardHeader className="pb-4">
        <CardTitle className="text-xl font-semibold flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          {tCommon("accessAndAccount")}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {t("accessCardDescription")}
        </p>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Account Status Section */}
        <div className="space-y-3">
          <Label className="text-sm font-medium flex items-center gap-2">
            <Shield className="h-4 w-4" />
            {t("accountStatus")}
          </Label>

          <div className="rounded-lg border bg-muted/30 p-3">
            <UserStatusBadge
              user={user}
              onStatusChange={handleUserUpdate}
              currentUserId={currentUserId}
              disabled={disabled}
              showClickable={view === "admin"}
              view={view}
            />
            {user.banned && (
              <p className="text-xs text-muted-foreground mt-2">
                {t("userBannedDescription")}
              </p>
            )}
          </div>
        </div>

        {/* Password Section */}
        <div className="space-y-3">
          <Label className="text-sm font-medium flex items-center gap-2">
            <Lock className="h-4 w-4" />
            {tCommon("security")}
          </Label>

          <div className="rounded-lg border bg-muted/30 p-3">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  {tCommon("passwordManagement")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {userAccountInfo?.hasPassword
                    ? t("userHasPassword")
                    : t("userOAuthOnly")}
                </p>
              </div>

              <UpdateUserPasswordDialog
                userId={user.id}
                view={view}
                currentUserId={currentUserId}
              >
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={disabled || !userAccountInfo?.hasPassword}
                  className="h-8 text-xs"
                  data-testid="update-password-button"
                >
                  <Lock className="w-3 h-3 mr-1" />
                  {t("updatePassword")}
                </Button>
              </UpdateUserPasswordDialog>
            </div>
          </div>
        </div>

        {/* Danger Zone Section */}
        {view === "admin" && user.id !== currentUserId && (
          <div className="space-y-3 pt-4 border-t">
            <Label className="text-sm font-medium flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4" />
              {tCommon("dangerZone")}
            </Label>

            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-destructive">
                    {t("deleteUser")}
                  </p>
                  <p className="text-xs text-destructive/80">
                    {t("deleteUserPermanently")}
                  </p>
                </div>

                <UserDeleteDialog user={user} view={view}>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-8 text-xs"
                    data-testid="delete-user-button"
                  >
                    <Trash2 className="w-3 h-3 mr-1" />
                    {t("deleteUser")}
                  </Button>
                </UserDeleteDialog>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
