import { useTranslations } from "next-intl";

/**
 * Hook for profile translations
 *
 * @returns Translation functions for user profile
 */
export function useProfileTranslations() {
  const t = useTranslations("User.Profile.user");
  const tCommon = useTranslations("User.Profile.common");

  return {
    /** User translations */
    t,
    /** Common translations */
    tCommon,
  };
}
