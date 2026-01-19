"use server";

import { BasicUser } from "app-types/user";
import { ActionState } from "lib/action-utils";
import { userRepository } from "lib/db/repository";
import { hash } from "bcrypt-ts";
import { randomUUID } from "crypto";

/**
 * Electron Auth Actions
 *
 * Server-side actions for authentication in Electron mode.
 * These use the SQLite database directly.
 */

export async function existsByEmailAction(email: string) {
  try {
    const exists = await userRepository.existsByEmail(email);
    return exists;
  } catch {
    return false;
  }
}

type SignUpActionResponse = ActionState & {
  user?: BasicUser;
};

export async function signUpAction(data: {
  email: string;
  name: string;
  password: string;
}): Promise<SignUpActionResponse> {
  try {
    // Check if email already exists
    const exists = await userRepository.existsByEmail(data.email);
    if (exists) {
      return {
        success: false,
        message: "Email already exists",
      };
    }

    // Hash the password
    const hashedPassword = await hash(data.password, 10);

    // Create the user
    const user = await userRepository.create({
      id: randomUUID(),
      email: data.email,
      name: data.name,
      password: hashedPassword,
      image: null,
    });

    if (!user) {
      return {
        success: false,
        message: "Failed to create user",
      };
    }

    return {
      success: true,
      message: "Account created successfully. Please sign in.",
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
        image: user.image,
        createdAt: user.createdAt ?? new Date(),
        updatedAt: user.updatedAt ?? new Date(),
      },
    };
  } catch (error) {
    console.error("[SignUpAction] Error:", error);
    return {
      success: false,
      message: error instanceof Error ? error.message : "Sign up failed",
    };
  }
}
