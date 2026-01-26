/**
 * Hook for profile translations (i18n removed - returns English strings)
 *
 * @deprecated This hook is kept for compatibility but returns hardcoded English strings
 */
export function useProfileTranslations(_view?: "admin" | "user") {
  // Hardcoded English translations
  const translations: Record<string, string> = {
    you: "You",
    // Add more translations as needed
  };

  return {
    /** User translations - returns hardcoded English strings */
    t: (key: string, _options?: Record<string, unknown>) =>
      translations[key] || key,
    /** Common translations - returns hardcoded English strings */
    tCommon: (key: string, _options?: Record<string, unknown>) =>
      translations[key] || key,
  };
}
