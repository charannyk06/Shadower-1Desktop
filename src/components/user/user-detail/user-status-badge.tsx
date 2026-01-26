"use client";

import { BasicUserWithLastLogin } from "app-types/user";
import { Badge } from "ui/badge";

export function UserStatusBadge({
  user: _user,
}: {
  user: BasicUserWithLastLogin;
  onStatusChange?: (user: BasicUserWithLastLogin) => void;
  currentUserId?: string;
  disabled?: boolean;
  showClickable?: boolean;
  view?: "admin" | "user";
}) {
  // In desktop mode, always show active status (no ban functionality)
  return (
    <Badge variant="secondary" data-testid="status-badge-active">
      Active
    </Badge>
  );
}
