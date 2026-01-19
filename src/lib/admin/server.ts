import "server-only";

import { AdminUsersPaginated, AdminUsersQuery } from "app-types/admin";
import { getSession } from "lib/auth/server";

export const ADMIN_USER_LIST_LIMIT = 10;
export const DEFAULT_SORT_BY = "createdAt";
export const DEFAULT_SORT_DIRECTION = "desc";

/**
 * Require an authenticated session
 */
export async function requireAdminSession(): Promise<
  NonNullable<Awaited<ReturnType<typeof getSession>>>
> {
  const session = await getSession();

  if (!session) {
    throw new Error("Unauthorized: No session found");
  }

  return session;
}

/**
 * Get paginated users - stub for desktop single-user mode
 */
export async function getAdminUsers(
  _query?: AdminUsersQuery,
): Promise<AdminUsersPaginated> {
  const session = await getSession();

  // In desktop mode, return only the current user
  if (session?.user) {
    return {
      users: [
        {
          id: session.user.id,
          name: session.user.name || "User",
          email: session.user.email || "",
          createdAt: new Date(),
          updatedAt: new Date(),
          emailVerified: true,
          banned: false,
          banReason: null,
          banExpires: null,
          image: session.user.image || null,
          lastLogin: new Date(),
        },
      ],
      total: 1,
      limit: ADMIN_USER_LIST_LIMIT,
      offset: 0,
    };
  }

  return {
    users: [],
    total: 0,
    limit: ADMIN_USER_LIST_LIMIT,
    offset: 0,
  };
}
