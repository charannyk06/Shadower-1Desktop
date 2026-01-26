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
  return <>{children}</>;
}
