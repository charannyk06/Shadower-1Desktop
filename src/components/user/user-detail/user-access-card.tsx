"use client";

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
  const handleUserUpdate = (updatedUser: Partial<BasicUserWithLastLogin>) => {
    onUserDetailsUpdate(updatedUser);
  };

  return (
    <Card className="transition-all duration-200 hover:shadow-md">
      <CardHeader className="pb-4">
        <CardTitle className="text-xl font-semibold flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          Access & Account
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Manage account access and security settings
        </p>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Account Status Section */}
        <div className="space-y-3">
          <Label className="text-sm font-medium flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Account Status
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
          </div>
        </div>

        {/* Password Section */}
        <div className="space-y-3">
          <Label className="text-sm font-medium flex items-center gap-2">
            <Lock className="h-4 w-4" />
            Security
          </Label>

          <div className="rounded-lg border bg-muted/30 p-3">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium">Password Management</p>
                <p className="text-xs text-muted-foreground">
                  {userAccountInfo?.hasPassword
                    ? "Password is set"
                    : "OAuth only - no password set"}
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
                  Update Password
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
              Danger Zone
            </Label>

            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-destructive">
                    Delete User
                  </p>
                  <p className="text-xs text-destructive/80">
                    Permanently delete this user
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
                    Delete User
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
