"use server";

import { eq } from "drizzle-orm";
import logger from "logger";
import {
  validatedActionWithAdminPermission,
  validatedActionWithUserManagePermission,
} from "lib/action-utils";
import {
  GeneratedImageResult,
  generateImageWithNanoBanana,
  generateImageWithOpenAI,
  generateImageWithXAI,
} from "lib/ai/image/generate-image";
import { sqliteDb as db } from "lib/db/sqlite/db.sqlite";
import {
  UserTable,
  SessionTable,
  AccountTable,
} from "lib/db/sqlite/schema.sqlite";
import { getUser, updateUserDetails } from "lib/user/server";
import { getTranslations } from "next-intl/server";
import {
  DeleteUserActionState,
  DeleteUserSchema,
  UpdateUserActionState,
  UpdateUserDetailsSchema,
  UpdateUserPasswordActionState,
  UpdateUserPasswordSchema,
} from "./validations";

/**
 * Electron-Only User Actions
 *
 * Authentication is handled via Electron IPC.
 * These actions work with the local SQLite database.
 */

export const updateUserImageAction = validatedActionWithUserManagePermission(
  UpdateUserDetailsSchema.pick({ userId: true, image: true }),
  async (
    data,
    userId,
    _userSession,
    isOwnResource,
  ): Promise<UpdateUserActionState> => {
    const t = await getTranslations("User.Profile.common");

    try {
      const { image } = data;

      // Update user details in database
      await updateUserDetails(userId, undefined, undefined, image);

      const user = await getUser(userId);
      if (!user) {
        return {
          success: false,
          message: t("userNotFound"),
        };
      }

      return {
        success: true,
        message: "Profile photo updated successfully",
        user,
        currentUserUpdated: isOwnResource,
      };
    } catch (error) {
      logger.error("Failed to update user image:", error);
      return {
        success: false,
        message: "Failed to update profile photo",
      };
    }
  },
);

export const updateUserDetailsAction = validatedActionWithUserManagePermission(
  UpdateUserDetailsSchema,
  async (
    data,
    userId,
    userSession,
    isOwnResource,
    _formData,
  ): Promise<UpdateUserActionState> => {
    const t = await getTranslations("User.Profile.common");

    try {
      const { name, email, image } = data;
      const user = await getUser(userId);
      if (!user) {
        return {
          success: false,
          message: t("userNotFound"),
        };
      }

      const isDifferentEmail = email && email !== userSession.user.email;
      const isDifferentName = name && name !== userSession.user.name;
      const isDifferentImage = image && image !== userSession.user.image;

      // Update user details in database
      await updateUserDetails(userId, name, email, image);

      if (isDifferentEmail) user.email = email;
      if (isDifferentName) user.name = name;
      if (isDifferentImage) user.image = image;

      return {
        success: true,
        message: t("userDetailsUpdatedSuccessfully"),
        user,
        currentUserUpdated: isOwnResource,
      };
    } catch (error) {
      logger.error("Failed to update user details:", error);
      return {
        success: false,
        message: t("failedToUpdateUserDetails"),
      };
    }
  },
);

export const deleteUserAction = validatedActionWithAdminPermission(
  DeleteUserSchema,
  async (data, _formData, _userSession): Promise<DeleteUserActionState> => {
    const t = await getTranslations("Admin.UserDelete");
    const { userId } = data;
    try {
      // Delete user sessions first
      await db.delete(SessionTable).where(eq(SessionTable.userId, userId));
      // Delete user accounts
      await db.delete(AccountTable).where(eq(AccountTable.userId, userId));
      // Delete the user
      await db.delete(UserTable).where(eq(UserTable.id, userId));
    } catch (error) {
      console.error("Failed to delete user:", error);
      return {
        success: false,
        message: t("failedToDeleteUser"),
      };
    }

    return {
      success: true,
      message: t("userDeletedSuccessfully"),
      redirect: "/admin",
    };
  },
);

export const updateUserPasswordAction = validatedActionWithUserManagePermission(
  UpdateUserPasswordSchema,
  async (
    _data,
    _userId,
    _userSession,
    _isOwnResource,
    _formData,
  ): Promise<UpdateUserPasswordActionState> => {
    const t = await getTranslations("User.Profile.common");

    // Password management not available in Electron mode
    return {
      success: false,
      message:
        t("passwordManagementNotAvailable") ||
        "Password management not available in Electron mode",
    };
  },
);

type ImageProvider = "openai" | "xai" | "google";

interface GenerateAvatarResult {
  success: boolean;
  base64?: string;
  mimeType?: string;
  error?: string;
}

/**
 * Server Action to generate avatar image using AI
 */
export async function generateAvatarImageAction(
  provider: ImageProvider,
  prompt: string,
): Promise<GenerateAvatarResult> {
  try {
    if (!prompt.trim()) {
      return {
        success: false,
        error: "Prompt is required",
      };
    }

    // Wrap user prompt with avatar-specific instructions
    const enhancedPrompt = `You are tasked with creating a professional profile picture for a user.

Requirements:
- Portrait style with centered face
- Clear, high-quality image suitable for profile/avatar use
- Friendly and approachable expression
- Professional yet personable appearance
- Clean background that doesn't distract from the subject
- Well-lit with good contrast

User's request:
"${prompt}"

Generate a profile picture that fulfills the user's request while maintaining the professional portrait quality requirements above.`;

    let response: GeneratedImageResult;

    switch (provider) {
      case "openai":
        response = await generateImageWithOpenAI({
          prompt: enhancedPrompt,
        });
        break;
      case "xai":
        response = await generateImageWithXAI({
          prompt: enhancedPrompt,
        });
        break;
      case "google":
        response = await generateImageWithNanoBanana({
          prompt: enhancedPrompt,
        });
        break;
      default:
        return {
          success: false,
          error: "Invalid provider",
        };
    }

    if (!response || response.images.length === 0) {
      return {
        success: false,
        error: "No image generated",
      };
    }

    const image = response.images[0];

    if (!image.base64) {
      return {
        success: false,
        error: "No image data received",
      };
    }

    return {
      success: true,
      base64: image.base64,
      mimeType: image.mimeType || "image/png",
    };
  } catch (error) {
    logger.error("Failed to generate avatar image:", error);
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to generate image",
    };
  }
}
