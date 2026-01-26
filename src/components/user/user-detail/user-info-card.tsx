"use client";

import { userApi } from "@/lib/electron/user-api";
import { BasicUserWithLastLogin } from "app-types/user";
import { format } from "date-fns";
import { getUserAvatar } from "lib/user/utils";
import { Check, Edit3, Mail, User, X } from "lucide-react";
import { FormEvent, useState } from "react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "ui/avatar";
import { Badge } from "ui/badge";
import { Button } from "ui/button";
import { Card, CardContent } from "ui/card";
import { Input } from "ui/input";
import { Label } from "ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";

interface UserInfoCardProps {
  user: BasicUserWithLastLogin;
  currentUserId: string;
  userAccountInfo?: {
    hasPassword: boolean;
    oauthProviders: string[];
  };
  onUserDetailsUpdate: (user: Partial<BasicUserWithLastLogin>) => void;
  view?: "admin" | "user";
}

export function UserInfoCard({
  user,
  currentUserId,
  userAccountInfo,
  onUserDetailsUpdate,
}: UserInfoCardProps) {
  const [editingField, setEditingField] = useState<"name" | "email" | null>(
    null,
  );
  const [editValue, setEditValue] = useState("");
  const [isPending, setIsPending] = useState(false);

  const handleStartEdit = (field: "name" | "email", value: string) => {
    setEditingField(field);
    setEditValue(value);
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingField || !editValue.trim()) return;

    setIsPending(true);
    try {
      if (editingField === "name") {
        await userApi.updateProfile({ name: editValue.trim() });
        onUserDetailsUpdate({ name: editValue.trim() });
      }
      toast.success("Updated successfully");
      setEditingField(null);
    } catch (error) {
      console.error("Failed to update:", error);
      toast.error("Failed to update");
    } finally {
      setIsPending(false);
    }
  };

  const renderInlineEditField = (
    fieldType: "name" | "email",
    value: string,
    icon: React.ReactNode,
    disabled?: boolean,
  ) => {
    const isEditing = editingField === fieldType;
    const canEdit = !disabled && !isPending && fieldType === "name"; // Only name is editable

    if (isEditing) {
      return (
        <div className="rounded-md px-2 py-1 -mx-2 bg-muted/20">
          <form
            onSubmit={handleSave}
            className="flex items-center gap-2 w-full"
          >
            <div className="flex items-center gap-2 flex-1 min-w-0">
              {icon}
              <Input
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                required
                disabled={isPending}
                className={`h-8 border-0 bg-background shadow-none focus-visible:ring-1 px-2 ${fieldType === "name" ? "text-lg font-semibold" : "text-base"}`}
                autoFocus
                data-testid={`${fieldType}-edit-input`}
              />
            </div>
            <div className="flex gap-1 flex-shrink-0">
              <Button
                type="submit"
                size="sm"
                className="h-6 w-6 p-0"
                disabled={isPending}
                data-testid={`save-${fieldType}-button`}
              >
                <Check className="h-3 w-3" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setEditingField(null)}
                className="h-6 w-6 p-0 hover:bg-background"
                data-testid={`cancel-${fieldType}-button`}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          </form>
        </div>
      );
    }

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={`group/field flex items-center gap-2 rounded-md px-2 py-1 -mx-2 transition-colors ${canEdit ? "hover:bg-muted/50 cursor-pointer" : ""}`}
            onClick={
              canEdit ? () => handleStartEdit(fieldType, value) : undefined
            }
          >
            {icon}
            <span
              className={`${fieldType === "name" ? "text-2xl font-bold" : "text-muted-foreground"} flex-1`}
              data-testid={`user-${fieldType}`}
            >
              {value}
            </span>
            {canEdit && (
              <Edit3
                className="h-3 w-3 text-muted-foreground group-hover/field:text-foreground transition-colors"
                data-testid={`edit-${fieldType}-button`}
              />
            )}
          </div>
        </TooltipTrigger>
        {canEdit && <TooltipContent>Click to edit</TooltipContent>}
      </Tooltip>
    );
  };

  return (
    <Card className="transition-all duration-200 hover:shadow-md">
      <CardContent className="space-y-6 pt-6">
        {/* Avatar and Basic Info */}
        <div className="flex items-start gap-4">
          <Avatar className="h-20 w-20 ring-2 ring-border">
            <AvatarImage src={getUserAvatar(user)} />
            <AvatarFallback className="text-lg font-semibold">
              {user.name?.slice(0, 2).toUpperCase() || "U"}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1 space-y-3">
            {/* Name Field */}
            <div className="flex items-center gap-2">
              {renderInlineEditField(
                "name",
                user.name || "",
                <User className="h-4 w-4 text-blue-600" />,
              )}
              {user.id === currentUserId && (
                <Badge variant="outline" className="text-xs ml-2">
                  You
                </Badge>
              )}
            </div>

            {/* Email Field */}
            <div className="flex items-center gap-2">
              {renderInlineEditField(
                "email",
                user.email || "",
                <Mail className="h-4 w-4 text-green-600" />,
                true, // Email not editable in desktop mode
              )}
            </div>

            {!!userAccountInfo?.oauthProviders?.length && (
              <div className="flex items-center gap-2 px-2 -mx-2">
                <Mail className="h-3 w-3 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">
                  Email cannot be modified when signed in with OAuth
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Account Information */}
        <div className="grid gap-4 sm:grid-cols-2 pt-4 border-t">
          <div className="space-y-2">
            <Label className="text-sm font-medium text-muted-foreground">
              Joined
            </Label>
            <p className="text-sm font-medium" data-testid="user-created-at">
              {user.createdAt ? format(new Date(user.createdAt), "PPP") : "-"}
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium text-muted-foreground">
              Last Updated
            </Label>
            <p className="text-sm font-medium" data-testid="user-updated-at">
              {user.updatedAt ? format(new Date(user.updatedAt), "PPP") : "-"}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
