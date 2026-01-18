import { and, desc, eq, sql } from "drizzle-orm";
import type {
  Referral,
  ReferralStats,
  ReferralStatus,
  ReferralWithUsers,
} from "lib/referral/types";
import { pgDb as db } from "../db.pg";
import { ReferralTable, UserTable } from "../schema.pg";

export interface ReferralRepository {
  /**
   * Create a new referral record
   */
  create(data: {
    referrerId: string;
    refereeId: string;
    referralCode: string;
  }): Promise<Referral>;

  /**
   * Get a referral by ID
   */
  getById(id: string): Promise<Referral | null>;

  /**
   * Get pending referral for a referee (user who signed up with code)
   */
  getPendingByReferee(refereeId: string): Promise<Referral | null>;

  /**
   * Get all referrals by referrer ID
   */
  getByReferrerId(referrerId: string): Promise<ReferralWithUsers[]>;

  /**
   * Get referral by referee ID
   */
  getByRefereeId(refereeId: string): Promise<Referral | null>;

  /**
   * Mark a referral as completed and record bonuses
   */
  complete(
    id: string,
    referrerBonus: number,
    refereeBonus: number,
  ): Promise<boolean>;

  /**
   * Mark a referral as expired
   */
  expire(id: string): Promise<boolean>;

  /**
   * Get referral statistics for a user
   */
  getStats(userId: string): Promise<ReferralStats>;

  /**
   * Check if a user has already been referred
   */
  hasBeenReferred(userId: string): Promise<boolean>;

  /**
   * Get expired referrals that need to be processed
   */
  getExpiredReferrals(expirationDays: number): Promise<Referral[]>;
}

export const pgReferralRepository: ReferralRepository = {
  async create(data) {
    const [result] = await db
      .insert(ReferralTable)
      .values({
        referrerId: data.referrerId,
        refereeId: data.refereeId,
        referralCode: data.referralCode,
        status: "pending",
      })
      .returning();

    return {
      ...result,
      status: result.status as ReferralStatus,
    };
  },

  async getById(id: string) {
    const [result] = await db
      .select()
      .from(ReferralTable)
      .where(eq(ReferralTable.id, id));

    if (!result) return null;

    return {
      ...result,
      status: result.status as ReferralStatus,
    };
  },

  async getPendingByReferee(refereeId: string) {
    const [result] = await db
      .select()
      .from(ReferralTable)
      .where(
        and(
          eq(ReferralTable.refereeId, refereeId),
          eq(ReferralTable.status, "pending"),
        ),
      );

    if (!result) return null;

    return {
      ...result,
      status: result.status as ReferralStatus,
    };
  },

  async getByReferrerId(referrerId: string) {
    const results = await db
      .select({
        id: ReferralTable.id,
        referrerId: ReferralTable.referrerId,
        refereeId: ReferralTable.refereeId,
        referralCode: ReferralTable.referralCode,
        status: ReferralTable.status,
        referrerBonus: ReferralTable.referrerBonus,
        refereeBonus: ReferralTable.refereeBonus,
        completedAt: ReferralTable.completedAt,
        createdAt: ReferralTable.createdAt,
        refereeName: UserTable.name,
        refereeEmail: UserTable.email,
      })
      .from(ReferralTable)
      .leftJoin(UserTable, eq(ReferralTable.refereeId, UserTable.id))
      .where(eq(ReferralTable.referrerId, referrerId))
      .orderBy(desc(ReferralTable.createdAt));

    return results.map((r) => ({
      id: r.id,
      referrerId: r.referrerId,
      refereeId: r.refereeId,
      referralCode: r.referralCode,
      status: r.status as ReferralStatus,
      referrerBonus: r.referrerBonus,
      refereeBonus: r.refereeBonus,
      completedAt: r.completedAt,
      createdAt: r.createdAt,
      referee: r.refereeName
        ? {
            id: r.refereeId,
            name: r.refereeName,
            email: r.refereeEmail || "",
          }
        : undefined,
    }));
  },

  async getByRefereeId(refereeId: string) {
    const [result] = await db
      .select()
      .from(ReferralTable)
      .where(eq(ReferralTable.refereeId, refereeId));

    if (!result) return null;

    return {
      ...result,
      status: result.status as ReferralStatus,
    };
  },

  async complete(id: string, referrerBonus: number, refereeBonus: number) {
    const result = await db
      .update(ReferralTable)
      .set({
        status: "completed",
        referrerBonus: referrerBonus.toString(),
        refereeBonus: refereeBonus.toString(),
        completedAt: new Date(),
      })
      .where(and(eq(ReferralTable.id, id), eq(ReferralTable.status, "pending")))
      .returning({ id: ReferralTable.id });

    return result.length > 0;
  },

  async expire(id: string) {
    const result = await db
      .update(ReferralTable)
      .set({
        status: "expired",
      })
      .where(and(eq(ReferralTable.id, id), eq(ReferralTable.status, "pending")))
      .returning({ id: ReferralTable.id });

    return result.length > 0;
  },

  async getStats(userId: string) {
    // Get counts by status
    const results = await db
      .select({
        status: ReferralTable.status,
        count: sql<number>`count(*)`,
        totalBonus: sql<string>`COALESCE(SUM(${ReferralTable.referrerBonus}::numeric), 0)`,
      })
      .from(ReferralTable)
      .where(eq(ReferralTable.referrerId, userId))
      .groupBy(ReferralTable.status);

    let totalReferrals = 0;
    let completedReferrals = 0;
    let pendingReferrals = 0;
    let totalBonusEarned = 0;

    for (const row of results) {
      const count = Number(row.count);
      totalReferrals += count;

      if (row.status === "completed") {
        completedReferrals = count;
        totalBonusEarned = Number(row.totalBonus);
      } else if (row.status === "pending") {
        pendingReferrals = count;
      }
    }

    return {
      totalReferrals,
      completedReferrals,
      pendingReferrals,
      totalBonusEarned,
    };
  },

  async hasBeenReferred(userId: string) {
    const [result] = await db
      .select({ id: ReferralTable.id })
      .from(ReferralTable)
      .where(eq(ReferralTable.refereeId, userId))
      .limit(1);

    return !!result;
  },

  async getExpiredReferrals(expirationDays: number) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - expirationDays);

    const results = await db
      .select()
      .from(ReferralTable)
      .where(
        and(
          eq(ReferralTable.status, "pending"),
          sql`${ReferralTable.createdAt} < ${cutoffDate}`,
        ),
      );

    return results.map((r) => ({
      ...r,
      status: r.status as ReferralStatus,
    }));
  },
};
