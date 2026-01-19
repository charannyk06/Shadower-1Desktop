"use client";

import type { ReactNode } from "react";

export default function AdminLayout({ children }: { children: ReactNode }) {
  // All users have unrestricted access after roles/permissions removal
  return <>{children}</>;
}
