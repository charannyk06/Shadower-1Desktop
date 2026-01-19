"use server";

import { eq } from "drizzle-orm";
import { validatedActionWithAdminPermission } from "lib/action-utils";
import { sqliteDb as db } from "lib/db/sqlite/db.sqlite";
import { UserTable } from "lib/db/sqlite/schema.sqlite";
import logger from "lib/logger";
import { getUser } from "lib/user/server";
import { getTranslations } from "next-intl/server";
import {
  UpdateUserBanStatusActionState,
  UpdateUserBanStatusSchema,
} from "./validations";

// Note: updateUserRolesAction has been removed as roles/permissions are no longer used

export const updateUserBanStatusAction = validatedActionWithAdminPermission(
  UpdateUserBanStatusSchema,
  async (
    data,
    _formData,
    userSession,
  ): Promise<UpdateUserBanStatusActionState> => {
    const tCommon = await getTranslations("User.Profile.common");
    const { userId, banned, banReason } = data;

    if (userSession.user.id === userId) {
      return {
        success: false,
        message: tCommon("cannotBanUnbanYourself"),
      };
    }
    try {
      if (!banned) {
        // Ban user via direct database update
        await db
          .update(UserTable)
          .set({
            banned: true,
            banReason:
              banReason ||
              (await getTranslations("User.Profile.common"))("bannedByAdmin"),
          })
          .where(eq(UserTable.id, userId));
      } else {
        // Unban user via direct database update
        await db
          .update(UserTable)
          .set({
            banned: false,
            banReason: null,
            banExpires: null,
          })
          .where(eq(UserTable.id, userId));
      }
      const user = await getUser(userId);
      if (!user) {
        return {
          success: false,
          message: tCommon("userNotFound"),
        };
      }
      return {
        success: true,
        message: user.banned
          ? tCommon("userBannedSuccessfully")
          : tCommon("userUnbannedSuccessfully"),
        user,
      };
    } catch (error) {
      logger.error(error);
      return {
        success: false,
        message: tCommon("failedToUpdateUserStatus"),
        error: error instanceof Error ? error.message : tCommon("unknownError"),
      };
    }
  },
);
