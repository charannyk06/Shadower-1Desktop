"use client";

import { AppHeader } from "@/components/layouts/app-header";
import { AppSidebar } from "@/components/layouts/app-sidebar";
import { SidebarProvider } from "ui/sidebar";

import { AppPopupProvider } from "@/components/layouts/app-popup-provider";
import { AuthGuard } from "@/components/auth/auth-guard";
import { authClient } from "@/lib/auth/client";
import { COOKIE_KEY_SIDEBAR_STATE } from "lib/const";
import { SWRConfigProvider } from "./swr-config";

import { useEffect, useState } from "react";

// Default user for when session is loading
const DEFAULT_USER = {
  id: "loading",
  email: "loading@shadower.app",
  name: "Loading...",
  image: null,
  emailVerified: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  preferences: null,
};

/**
 * Chat Layout with Authentication
 *
 * Protected layout that requires authentication.
 * Uses AuthGuard on client-side to redirect unauthenticated users.
 */
export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data: session } = authClient.useSession();
  const [isCollapsed, setIsCollapsed] = useState(true);

  // Read sidebar state from cookie on mount
  useEffect(() => {
    if (typeof document !== "undefined") {
      const cookies = document.cookie.split(";").reduce(
        (acc, cookie) => {
          const [key, value] = cookie.trim().split("=");
          acc[key] = value;
          return acc;
        },
        {} as Record<string, string>,
      );
      setIsCollapsed(cookies[COOKIE_KEY_SIDEBAR_STATE] !== "true");
    }
  }, []);

  // Use session user or default while loading
  const user = session?.user
    ? {
        ...session.user,
        createdAt: new Date(),
        updatedAt: new Date(),
        preferences: null,
      }
    : DEFAULT_USER;

  return (
    <AuthGuard>
      <SidebarProvider defaultOpen={!isCollapsed}>
        <SWRConfigProvider user={user}>
          <AppPopupProvider />
          <AppSidebar user={user} />
          <main className="relative bg-background w-full flex flex-col h-screen">
            <AppHeader />
            <div className="flex-1 overflow-y-auto">{children}</div>
          </main>
        </SWRConfigProvider>
      </SidebarProvider>
    </AuthGuard>
  );
}
