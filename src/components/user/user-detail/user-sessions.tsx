"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "ui/card";

interface UserSessionsProps {
  userId: string;
  view?: "admin" | "user";
}

export function UserSessions(_props: UserSessionsProps) {
  // In desktop mode, sessions are managed locally
  return (
    <Card>
      <CardHeader>
        <CardTitle>Active Sessions</CardTitle>
        <CardDescription>View user sessions and access</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Session management is handled locally in desktop mode.
        </p>
      </CardContent>
    </Card>
  );
}
