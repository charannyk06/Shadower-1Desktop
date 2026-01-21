import i18n from "i18next";
import { initReactI18next } from "react-i18next";

// Import all message files
import en from "../../messages/en.json";
import es from "../../messages/es.json";
import fr from "../../messages/fr.json";
import ja from "../../messages/ja.json";
import ko from "../../messages/ko.json";
import no from "../../messages/no.json";
import zh from "../../messages/zh.json";

// Flatten nested translation keys for react-i18next compatibility
// next-intl uses "Auth.Intro.description" format, i18next expects the same with interpolation
const resources = {
  en: { translation: en },
  es: { translation: es },
  fr: { translation: fr },
  ja: { translation: ja },
  ko: { translation: ko },
  no: { translation: no },
  zh: { translation: zh },
};

// Get saved language from localStorage or default to 'en'
const getSavedLanguage = (): string => {
  if (typeof window !== "undefined") {
    return localStorage.getItem("app-language") || "en";
  }
  return "en";
};

i18n.use(initReactI18next).init({
  resources,
  lng: getSavedLanguage(),
  fallbackLng: "en",
  debug: import.meta.env.DEV,
  interpolation: {
    escapeValue: false, // React already escapes
    // Use single curly braces {name} instead of default {{name}}
    prefix: "{",
    suffix: "}",
  },
  // Support nested keys like "Auth.Intro.description"
  keySeparator: ".",
  nsSeparator: false as const,
  // Return key if translation is missing
  returnNull: false,
  returnEmptyString: false,
  // Handle missing interpolation values - replace with empty string
  missingInterpolationHandler: (text, value) => {
    console.warn(`[i18n] Missing interpolation value: ${value} in "${text}"`);
    return "";
  },
});

// Helper to change language
export const changeLanguage = (lng: string) => {
  i18n.changeLanguage(lng);
  if (typeof window !== "undefined") {
    localStorage.setItem("app-language", lng);
  }
};

// Export supported languages
export const supportedLanguages = [
  { code: "en", name: "English" },
  { code: "es", name: "Español" },
  { code: "fr", name: "Français" },
  { code: "ja", name: "日本語" },
  { code: "ko", name: "한국어" },
  { code: "no", name: "Norsk" },
  { code: "zh", name: "中文" },
];

export default i18n;
