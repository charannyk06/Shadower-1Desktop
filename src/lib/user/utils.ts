export const getUserAvatar = (user: { image?: string | null }): string => {
  return user.image || "";
};

// Removed getIsUserAdmin - roles/permissions have been removed
// All authenticated users have unrestricted access
