import type { ReactNode } from "react";

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  // All users have unrestricted access after roles/permissions removal
  return <>{children}</>;
}
