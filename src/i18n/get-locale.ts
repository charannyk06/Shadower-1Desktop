import i18n from "@/lib/i18n";
import { COOKIE_KEY_LOCALE } from "lib/const";

const DEFAULT_LOCALE = "en";

/**
 * Get the current locale
 * In the Vite/Electron version, we use i18next's language detection
 */
export function getLocaleAction(): string {
  // Try to get from i18next
  if (i18n.language) {
    return i18n.language;
  }

  // Fallback to cookie
  if (typeof document !== "undefined") {
    const cookies = document.cookie.split(";").reduce(
      (acc, cookie) => {
        const [key, value] = cookie.trim().split("=");
        acc[key] = value;
        return acc;
      },
      {} as Record<string, string>,
    );

    if (cookies[COOKIE_KEY_LOCALE]) {
      return cookies[COOKIE_KEY_LOCALE];
    }
  }

  // Fallback to default
  return DEFAULT_LOCALE;
}

/**
 * Set the locale
 */
export function setLocaleAction(locale: string): void {
  // Update i18next
  i18n.changeLanguage(locale);

  // Update cookie for persistence
  if (typeof document !== "undefined") {
    document.cookie = `${COOKIE_KEY_LOCALE}=${locale}; path=/; max-age=31536000`;
  }
}
