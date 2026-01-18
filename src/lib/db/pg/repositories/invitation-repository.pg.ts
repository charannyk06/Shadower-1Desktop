import {
  InvitationListItem,
  InvitationWithInviter,
} from "app-types/invitation";
import { UserRoleNames } from "app-types/roles";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { pgDb as db } from "../db.pg";
import { UserInvitationTable, UserTable } from "../schema.pg";

export interface CreateInvitationData {
  email: string;
  token: string;
  role: UserRoleNames;
  invitedBy: string;
  expiresAt: Date;
}

export const pgInvitationRepository = {
  create: async (data: CreateInvitationData) => {
    const [result] = await db
      .insert(UserInvitationTable)
      .values(data)
      .returning();
    return result;
  },

  getByToken: async (token: string): Promise<InvitationWithInviter | null> => {
    const [result] = await db
      .select({
        id: UserInvitationTable.id,
        email: UserInvitationTable.email,
        token: UserInvitationTable.token,
        role: UserInvitationTable.role,
        invitedBy: UserInvitationTable.invitedBy,
        inviterName: UserTable.name,
        inviterEmail: UserTable.email,
        expiresAt: UserInvitationTable.expiresAt,
        acceptedAt: UserInvitationTable.acceptedAt,
        revokedAt: UserInvitationTable.revokedAt,
        createdAt: UserInvitationTable.createdAt,
      })
      .from(UserInvitationTable)
      .leftJoin(UserTable, eq(UserInvitationTable.invitedBy, UserTable.id))
      .where(eq(UserInvitationTable.token, token));

    if (!result) return null;

    return {
      ...result,
      role: result.role as UserRoleNames,
      inviterName: result.inviterName || "Unknown",
      inviterEmail: result.inviterEmail || "",
    };
  },

  getByEmail: async (email: string) => {
    const [result] = await db
      .select()
      .from(UserInvitationTable)
      .where(
        and(
          eq(UserInvitationTable.email, email),
          isNull(UserInvitationTable.acceptedAt),
          isNull(UserInvitationTable.revokedAt),
        ),
      );
    return result || null;
  },

  getById: async (id: string) => {
    const [result] = await db
      .select()
      .from(UserInvitationTable)
      .where(eq(UserInvitationTable.id, id));
    return result || null;
  },

  getPendingInvitations: async (options?: {
    limit?: number;
    offset?: number;
  }): Promise<{ invitations: InvitationListItem[]; total: number }> => {
    const { limit = 20, offset = 0 } = options || {};

    const invitations = await db
      .select({
        id: UserInvitationTable.id,
        email: UserInvitationTable.email,
        role: UserInvitationTable.role,
        inviterName: UserTable.name,
        expiresAt: UserInvitationTable.expiresAt,
        acceptedAt: UserInvitationTable.acceptedAt,
        revokedAt: UserInvitationTable.revokedAt,
        createdAt: UserInvitationTable.createdAt,
      })
      .from(UserInvitationTable)
      .leftJoin(UserTable, eq(UserInvitationTable.invitedBy, UserTable.id))
      .orderBy(desc(UserInvitationTable.createdAt))
      .limit(limit)
      .offset(offset);

    const [totalResult] = await db
      .select({ count: count() })
      .from(UserInvitationTable);

    return {
      invitations,
      total: totalResult?.count || 0,
    };
  },

  markAsAccepted: async (token: string) => {
    await db
      .update(UserInvitationTable)
      .set({ acceptedAt: new Date() })
      .where(eq(UserInvitationTable.token, token));
  },

  revoke: async (id: string) => {
    await db
      .update(UserInvitationTable)
      .set({ revokedAt: new Date() })
      .where(eq(UserInvitationTable.id, id));
  },

  updateToken: async (id: string, newToken: string, newExpiresAt: Date) => {
    const [result] = await db
      .update(UserInvitationTable)
      .set({ token: newToken, expiresAt: newExpiresAt })
      .where(eq(UserInvitationTable.id, id))
      .returning();
    return result;
  },
};
