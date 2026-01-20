import "server-only";
import { UserSessionUser } from "app-types/user";
import { z } from "zod";

import { getSession } from "auth/server";

export type ActionState =
  | {
      success?: boolean;
      message?: string;
      [key: string]: any;
    }
  | null
  | undefined;

type ValidatedActionFunction<S extends z.ZodType<any, any>, T> = (
  data: z.infer<S>,
  formData: FormData,
) => Promise<T>;

export function validatedAction<S extends z.ZodType<any, any>, T>(
  schema: S,
  action: ValidatedActionFunction<S, T>,
) {
  return async (_prevState: ActionState, formData: FormData) => {
    const result = schema.safeParse(Object.fromEntries(formData));
    if (!result.success) {
      return { error: result.error.issues[0].message };
    }

    return action(result.data, formData);
  };
}

type ValidatedActionWithUserFunction<S extends z.ZodType<any, any>, T> = (
  data: z.infer<S>,
  formData: FormData,
  user: UserSessionUser,
) => Promise<T>;

export function validatedActionWithUser<S extends z.ZodType<any, any>, T>(
  schema: S,
  action: ValidatedActionWithUserFunction<S, T>,
) {
  return async (_prevState: ActionState, formData: FormData) => {
    let session;
    try {
      session = await getSession();
    } catch {
      return {
        success: false,
        message: "User is not authenticated",
      } as T;
    }

    if (!session || !session.user) {
      return {
        success: false,
        message: "User is not authenticated",
      } as T;
    }

    const result = schema.safeParse(Object.fromEntries(formData));
    if (!result.success) {
      return {
        success: false,
        message: result.error.issues[0].message,
      } as T;
    }

    return action(result.data, formData, session.user);
  };
}
