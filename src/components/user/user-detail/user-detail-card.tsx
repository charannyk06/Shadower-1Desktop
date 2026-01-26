"use client";

import { BasicUserWithLastLogin } from "app-types/user";
import { getUserAvatar } from "lib/user/utils";
import { Avatar } from "ui/avatar";
import { AvatarImage } from "ui/avatar";
import { AvatarFallback } from "ui/avatar";
import { Badge } from "ui/badge";
import { Card, CardHeader } from "ui/card";
import { CardTitle } from "ui/card";
import { CardDescription } from "ui/card";

export function UserDetailCard({
  user,
  currentUserId,
}: {
  user: BasicUserWithLastLogin;
  currentUserId: string;
}) {
  return (
    <Card data-testid="user-detail-card">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16 rounded-full">
              <AvatarImage src={getUserAvatar(user)} />
              <AvatarFallback>
                {user.name.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="text-2xl" data-testid="user-name">
                  {user.name}
                </CardTitle>
                {user.id === currentUserId && (
                  <Badge
                    variant="outline"
                    className="text-xs"
                    data-testid="current-user-badge"
                  >
                    You
                  </Badge>
                )}
              </div>
              <CardDescription data-testid="user-email">
                {user.email}
              </CardDescription>
              {/* User banned status */}
              {(user as BasicUserWithLastLogin & { banned?: boolean })
                .banned && (
                <Badge variant="destructive" className="mt-1">
                  Banned
                </Badge>
              )}
            </div>
          </div>
        </div>
      </CardHeader>
    </Card>
  );
}
