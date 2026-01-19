"use client";

import { UsersTable } from "@/components/admin/users-table";
import { AdminUserListItem } from "app-types/admin";

interface AdminUsersTabsProps {
  readonly users: readonly AdminUserListItem[];
  readonly currentUserId: string;
  readonly usersTotal: number;
  readonly page: number;
  readonly limit: number;
  readonly query?: string;
  readonly sortBy: string;
  readonly sortDirection: "asc" | "desc";
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
}: AdminUsersTabsProps) {
  return (
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
  );
}
