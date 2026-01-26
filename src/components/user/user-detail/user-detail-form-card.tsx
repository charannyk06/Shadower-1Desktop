"use client";

import { userApi } from "@/lib/electron/user-api";
import { BasicUserWithLastLogin } from "app-types/user";
import { format } from "date-fns";
import { getUserAvatar } from "lib/user/utils";
import { User } from "lucide-react";
import { FormEvent, useState } from "react";
import { toast } from "sonner";
import { Badge } from "ui/badge";
import { Button } from "ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "ui/card";
import { Input } from "ui/input";
import { Label } from "ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";
import { UserAvatarUpload } from "./user-avatar-upload";

interface UserDetailFormCardProps {
  user: BasicUserWithLastLogin;
  currentUserId: string;
  userAccountInfo?: {
    hasPassword: boolean;
    oauthProviders: string[];
  };
  onUserDetailsUpdate?: (user: Partial<BasicUserWithLastLogin>) => void;
  view?: "admin" | "user";
}

export function UserDetailFormCard({
  user,
  currentUserId,
  userAccountInfo,
  onUserDetailsUpdate,
}: UserDetailFormCardProps) {
  const [currentUser, setCurrentUser] = useState(user);
  const [name, setName] = useState(user.name || "");
  const [isPending, setIsPending] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Required");
      return;
    }

    setIsPending(true);
    try {
      await userApi.updateProfile({ name: name.trim() });
      const updatedUser = { ...currentUser, name: name.trim() };
      toast.success("Updated successfully");
      setCurrentUser(updatedUser);
      onUserDetailsUpdate?.(updatedUser);
    } catch (error) {
      console.error("Failed to update user details:", error);
      toast.error("Failed to update");
    } finally {
      setIsPending(false);
    }
  };

  const handleImageUpdate = async (imageUrl: string) => {
    try {
      await userApi.updateProfile({ image: imageUrl });
      const updatedUser = { ...currentUser, image: imageUrl };
      setCurrentUser(updatedUser);
      onUserDetailsUpdate?.(updatedUser);
      toast.success("Profile photo updated successfully");
    } catch (error) {
      console.error("Failed to update image:", error);
      toast.error("Failed to update profile photo");
    }
  };

  return (
    <Card className="transition-all duration-200 hover:shadow-md">
      <CardHeader className="pb-4">
        <CardTitle className="text-xl font-semibold flex items-center gap-2">
          <User className="h-5 w-5 text-primary" />
          User Details
          {user.id === currentUserId && (
            <Badge variant="outline" className="text-xs ml-auto">
              You
            </Badge>
          )}
        </CardTitle>
        <CardDescription>Update your profile information</CardDescription>
      </CardHeader>

      <CardContent className="h-full">
        <form
          onSubmit={handleSubmit}
          className="space-y-6 h-full flex flex-col"
        >
          {/* Avatar Upload Section */}
          <div className="flex items-center justify-center gap-4 my-4">
            <UserAvatarUpload
              currentImageUrl={getUserAvatar(currentUser)}
              userName={currentUser.name}
              onImageUpdate={handleImageUpdate}
              disabled={isPending}
            />
          </div>

          {/* Form Fields */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                name="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                disabled={isPending}
                data-testid="user-name-input"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className={
                      !!userAccountInfo?.oauthProviders?.length
                        ? "cursor-not-allowed"
                        : ""
                    }
                  >
                    <Input
                      id="email"
                      name="email"
                      type="email"
                      value={currentUser.email || ""}
                      disabled
                      data-testid="user-email-input"
                    />
                  </span>
                </TooltipTrigger>
                {!!userAccountInfo?.oauthProviders?.length && (
                  <TooltipContent>
                    Email cannot be modified when using SSO
                  </TooltipContent>
                )}
              </Tooltip>
            </div>
          </div>

          {/* Account Information */}
          <div className="grid gap-4 sm:grid-cols-2 pt-4 border-t">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-muted-foreground">
                Joined
              </Label>
              <p className="text-sm font-medium" data-testid="user-created-at">
                {currentUser.createdAt
                  ? format(new Date(currentUser.createdAt), "PPP")
                  : "-"}
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium text-muted-foreground">
                Last Updated
              </Label>
              <p className="text-sm font-medium" data-testid="user-updated-at">
                {currentUser.updatedAt
                  ? format(new Date(currentUser.updatedAt), "PPP")
                  : "-"}
              </p>
            </div>
          </div>

          {/* Save Button */}
          <div className="mt-4">
            <Button
              type="submit"
              className="w-full"
              data-testid="save-changes-button"
              disabled={isPending}
            >
              {isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
