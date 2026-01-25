"use client";
import { SidebarMenuButton, useSidebar } from "ui/sidebar";
import { SidebarMenu, SidebarMenuItem } from "ui/sidebar";
import { SidebarGroupContent } from "ui/sidebar";
import { Tooltip } from "ui/tooltip";

import { Shortcuts, getShortcutKeyList } from "lib/keyboard-shortcuts";
import { BrainIcon, Box } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "@tanstack/react-router";
import { MCPIcon } from "ui/mcp-icon";
import { SidebarGroup } from "ui/sidebar";
import { WriteIcon } from "ui/write-icon";

export function AppSidebarMenus() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { setOpenMobile } = useSidebar();

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          <Tooltip>
            <SidebarMenuItem className="mb-1">
              <Link
                to="/"
                onClick={(e) => {
                  e.preventDefault();
                  setOpenMobile(false);
                  navigate({
                    to: `/`,
                    search: { new: Date.now() },
                  });
                }}
              >
                <SidebarMenuButton className="flex font-semibold group/new-chat bg-input/20 border border-border/40">
                  <WriteIcon className="size-4" />
                  {t("Layout.newChat")}
                  <div className="flex items-center gap-1 text-xs font-medium ml-auto opacity-0 group-hover/new-chat:opacity-100 transition-opacity">
                    {getShortcutKeyList(Shortcuts.openNewChat).map((key) => (
                      <span
                        key={key}
                        className="border w-5 h-5 flex items-center justify-center bg-accent rounded"
                      >
                        {key}
                      </span>
                    ))}
                  </div>
                </SidebarMenuButton>
              </Link>
            </SidebarMenuItem>
          </Tooltip>
        </SidebarMenu>
        <SidebarMenu>
          <Tooltip>
            <SidebarMenuItem>
              <Link to="/mcp">
                <SidebarMenuButton className="font-semibold">
                  <MCPIcon className="size-4 fill-accent-foreground" />
                  {t("Layout.mcpConfiguration")}
                </SidebarMenuButton>
              </Link>
            </SidebarMenuItem>
          </Tooltip>
        </SidebarMenu>
        <SidebarMenu>
          <Tooltip>
            <SidebarMenuItem>
              <Link to="/models">
                <SidebarMenuButton className="font-semibold">
                  <Box className="size-4" />
                  {t("Layout.models")}
                </SidebarMenuButton>
              </Link>
            </SidebarMenuItem>
          </Tooltip>
        </SidebarMenu>
        <SidebarMenu>
          <Tooltip>
            <SidebarMenuItem>
              <Link to="/knowledge">
                <SidebarMenuButton className="font-semibold">
                  <BrainIcon className="size-4" />
                  {t("Layout.allKnowledge")}
                </SidebarMenuButton>
              </Link>
            </SidebarMenuItem>
          </Tooltip>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
