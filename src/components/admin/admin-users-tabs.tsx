"use client";

import { PendingInvitationsTable } from "@/components/admin/pending-invitations-table";
import { UsersTable } from "@/components/admin/users-table";
import { AdminUserListItem } from "app-types/admin";
import { InvitationListItem, getInvitationStatus } from "app-types/invitation";
import { useTranslations } from "next-intl";
import { Badge } from "ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "ui/tabs";

interface AdminUsersTabsProps {
  readonly users: readonly AdminUserListItem[];
  readonly currentUserId: string;
  readonly usersTotal: number;
  readonly page: number;
  readonly limit: number;
  readonly query?: string;
  readonly sortBy: string;
  readonly sortDirection: "asc" | "desc";
  readonly invitations: readonly InvitationListItem[];
}

export function AdminUsersTabs({
  users,
  currentUserId,
  usersTotal,
  page,
  limit,
  query,
  sortBy,
  sortDirection,
  invitations,
}: AdminUsersTabsProps) {
  const t = useTranslations("Admin");

  const pendingCount = invitations.filter((inv) => {
    const status = getInvitationStatus(inv);
    return status === "pending";
  }).length;

  return (
    <Tabs defaultValue="users" className="w-full space-y-4">
      <TabsList>
        <TabsTrigger value="users" data-testid="users-tab">
          {t("Users.title")}
        </TabsTrigger>
        <TabsTrigger value="invitations" data-testid="invitations-tab">
          {t("Invitations.title")}
          {pendingCount > 0 && (
            <Badge variant="secondary" className="ml-2">
              {pendingCount}
            </Badge>
          )}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="users">
        <UsersTable
          users={users}
          currentUserId={currentUserId}
          total={usersTotal}
          page={page}
          limit={limit}
          query={query}
          baseUrl="/admin/users"
          sortBy={sortBy}
          sortDirection={sortDirection}
        />
      </TabsContent>
      <TabsContent value="invitations">
        <PendingInvitationsTable invitations={invitations} />
      </TabsContent>
    </Tabs>
  );
}
