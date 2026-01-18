import { USER_ROLES } from "app-types/roles";

export const getUserAvatar = (user: { image?: string | null }): string => {
  return user.image || "";
};

export const getIsUserAdmin = (user?: { role?: string | null }): boolean => {
  return user?.role?.split(",").includes(USER_ROLES.ADMIN) || false;
};
