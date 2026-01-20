"use server";

import logger from "logger";
import { validatedActionWithUser } from "lib/action-utils";
import {
  GeneratedImageResult,
  generateImageWithNanoBanana,
  generateImageWithOpenAI,
  generateImageWithXAI,
} from "lib/ai/image/generate-image";
import { getUser, updateUserDetails } from "lib/user/server";
import { getTranslations } from "next-intl/server";
import {
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

export const updateUserImageAction = validatedActionWithUser(
  UpdateUserDetailsSchema.pick({ userId: true, image: true }),
  async (data, _formData, user): Promise<UpdateUserActionState> => {
    const t = await getTranslations("User.Profile.common");

    try {
      const { image } = data;
      const userId = user.id;

      // Update user details in database
      await updateUserDetails(userId, undefined, undefined, image);

      const updatedUser = await getUser(userId);
      if (!updatedUser) {
        return {
          success: false,
          message: t("userNotFound"),
        };
      }

      return {
        success: true,
        message: "Profile photo updated successfully",
        user: updatedUser,
        currentUserUpdated: true,
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

export const updateUserDetailsAction = validatedActionWithUser(
  UpdateUserDetailsSchema,
  async (data, _formData, sessionUser): Promise<UpdateUserActionState> => {
    const t = await getTranslations("User.Profile.common");

    try {
      const { name, email, image } = data;
      const userId = sessionUser.id;
      const currentUser = await getUser(userId);
      if (!currentUser) {
        return {
          success: false,
          message: t("userNotFound"),
        };
      }

      const isDifferentEmail = email && email !== sessionUser.email;
      const isDifferentName = name && name !== sessionUser.name;
      const isDifferentImage = image && image !== sessionUser.image;

      // Update user details in database
      await updateUserDetails(userId, name, email, image);

      if (isDifferentEmail) currentUser.email = email;
      if (isDifferentName) currentUser.name = name;
      if (isDifferentImage) currentUser.image = image;

      return {
        success: true,
        message: t("userDetailsUpdatedSuccessfully"),
        user: currentUser,
        currentUserUpdated: true,
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

export const updateUserPasswordAction = validatedActionWithUser(
  UpdateUserPasswordSchema,
  async (_data, _formData, _user): Promise<UpdateUserPasswordActionState> => {
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
