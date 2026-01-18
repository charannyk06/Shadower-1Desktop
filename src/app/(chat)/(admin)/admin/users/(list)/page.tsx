import { AdminUsersTabs } from "@/components/admin/admin-users-tabs";
import { requireAdminPermission } from "auth/permissions";
import { getAdminInvitations } from "lib/admin/invitation-server";
import {
  ADMIN_USER_LIST_LIMIT,
  DEFAULT_SORT_BY,
  DEFAULT_SORT_DIRECTION,
} from "lib/admin/server";
import { getAdminUsers } from "lib/admin/server";
import { getSession } from "lib/auth/server";

export const dynamic = "force-dynamic";
import { redirect, unauthorized } from "next/navigation";

interface PageProps {
  searchParams: Promise<{
    page?: string;
    limit?: string;
    query?: string;
    sortBy?: string;
    sortDirection?: "asc" | "desc";
  }>;
}

export default async function UserListPage({ searchParams }: PageProps) {
  // Redirect before rendering the page if the user is not an admin

  try {
    await requireAdminPermission();
  } catch (_error) {
    unauthorized();
  }
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const params = await searchParams;
  const page = Number.parseInt(params.page ?? "1", 10);
  const limit = Number.parseInt(
    params.limit ?? ADMIN_USER_LIST_LIMIT.toString(),
    10,
  );
  const offset = (page - 1) * limit;
  const sortBy = params.sortBy ?? DEFAULT_SORT_BY;
  const sortDirection = params.sortDirection ?? DEFAULT_SORT_DIRECTION;

  // Fetch users and invitations in parallel
  const [usersResult, invitationsResult] = await Promise.all([
    getAdminUsers({
      searchValue: params.query,
      searchField: "email",
      searchOperator: "contains",
      limit,
      offset,
      sortBy,
      sortDirection,
    }),
    getAdminInvitations({ limit: 50 }),
  ]);

  return (
    <AdminUsersTabs
      users={usersResult.users}
      currentUserId={session.user.id}
      usersTotal={usersResult.total}
      page={page}
      limit={limit}
      query={params.query}
      sortBy={sortBy}
      sortDirection={sortDirection}
      invitations={invitationsResult.invitations}
    />
  );
}
