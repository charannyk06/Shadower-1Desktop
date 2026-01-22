import { useTranslation } from "react-i18next";

/**
 * Hook for profile translations
 *
 * @returns Translation functions for user profile
 */
export function useProfileTranslations() {
  const { t } = useTranslation();

  return {
    /** User translations */
    t,
    /** Common translations */
    tCommon: t,
  };
}
