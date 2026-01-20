"use client";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Sidebar, SidebarContent, SidebarFooter } from "ui/sidebar";

import { AppSidebarAgents } from "./app-sidebar-agents";
import { AppSidebarMenus } from "./app-sidebar-menus";
import { AppSidebarThreads } from "./app-sidebar-threads";
import { SidebarHeaderShared } from "./sidebar-header";

import { BasicUser } from "app-types/user";
import { Shortcuts, isShortcutEvent } from "lib/keyboard-shortcuts";
import { AppSidebarUser } from "./app-sidebar-user";

export function AppSidebar({
  user,
}: {
  user?: BasicUser;
}) {
  const navigate = useNavigate();

  // Handle new chat shortcut (specific to main app)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isShortcutEvent(e, Shortcuts.openNewChat)) {
        e.preventDefault();
        navigate({ to: "/" });
        // Note: TanStack Router doesn't have a refresh equivalent,
        // typically you'd use query invalidation or manual refetch
        window.location.reload();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate]);

  return (
    <Sidebar
      collapsible="offcanvas"
      className="border-r border-sidebar-border/80"
    >
      <SidebarHeaderShared
        title="Shadower"
        href="/"
        enableShortcuts={true}
        onLinkClick={() => {
          navigate({ to: "/" });
          // Note: TanStack Router doesn't have a refresh equivalent,
          // typically you'd use query invalidation or manual refetch
          window.location.reload();
        }}
      />

      <SidebarContent className="mt-2 overflow-hidden relative">
        <div className="flex flex-col overflow-y-auto">
          <AppSidebarMenus />
          <AppSidebarAgents />
          <AppSidebarThreads />
        </div>
      </SidebarContent>
      <SidebarFooter className="flex flex-col items-stretch space-y-2">
        <AppSidebarUser user={user} />
      </SidebarFooter>
    </Sidebar>
  );
}
