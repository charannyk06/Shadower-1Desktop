import { I18nextProvider } from "react-i18next";
import i18n from "@/lib/i18n";

interface RootLayoutProps {
  children: React.ReactNode;
}

/**
 * Root Layout
 *
 * Provides global context providers that wrap the entire app.
 * Theme and Toast providers are in main.tsx.
 */
export default function RootLayout({ children }: RootLayoutProps) {
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
