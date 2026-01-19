"use client";

import { AdminUsersTabs } from "@/components/admin/admin-users-tabs";
import { authClient } from "@/lib/auth/client";
import { useSearchParams } from "next/navigation";

const ADMIN_USER_LIST_LIMIT = 20;
const DEFAULT_SORT_BY = "createdAt";
const DEFAULT_SORT_DIRECTION = "desc";

/**
 * Admin Users List Page
 * Auth is handled by AuthGuard in the layout.
 *
 * Note: In Electron mode, user list is fetched client-side via IPC
 */
export default function UserListPage() {
  const { data: session } = authClient.useSession();
  const searchParams = useSearchParams();

  if (!session?.user?.id) {
    return null; // AuthGuard will handle redirect
  }

  const page = Number.parseInt(searchParams.get("page") ?? "1", 10);
  const limit = Number.parseInt(
    searchParams.get("limit") ?? ADMIN_USER_LIST_LIMIT.toString(),
    10,
  );
  const query = searchParams.get("query") || undefined;
  const sortBy = searchParams.get("sortBy") ?? DEFAULT_SORT_BY;
  const sortDirection =
    (searchParams.get("sortDirection") as "asc" | "desc") ??
    DEFAULT_SORT_DIRECTION;

  // In Electron mode, AdminUsersTabs will fetch users via IPC
  return (
    <AdminUsersTabs
      users={[]}
      currentUserId={session.user.id}
      usersTotal={0}
      page={page}
      limit={limit}
      query={query}
      sortBy={sortBy}
      sortDirection={sortDirection}
    />
  );
}
