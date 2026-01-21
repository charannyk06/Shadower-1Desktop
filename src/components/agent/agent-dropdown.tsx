"use client";
import { appStore } from "@/app/store";
import { AgentSummary } from "app-types/agent";
import { authClient } from "auth/client";
import { generateUUID } from "lib/utils";
import { MicIcon, PencilLine } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { type PropsWithChildren, useState } from "react";
import { Command, CommandGroup, CommandItem, CommandList } from "ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "ui/popover";

type Props = PropsWithChildren<{
  agent: AgentSummary;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "end" | "center";
}>;

export function AgentDropdown({ agent, children, side, align }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { data: session } = authClient.useSession();
  const isOwner = session?.user?.id === agent.userId;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="p-0 w-[220px]" side={side} align={align}>
        <Command>
          <CommandList>
            <CommandGroup>
              <CommandItem className="cursor-pointer p-0">
                <div
                  className="flex items-center gap-2 w-full px-2 py-1 rounded"
                  onClick={() => {
                    appStore.setState((state) => ({
                      voiceChat: {
                        ...state.voiceChat,
                        isOpen: true,
                        threadId: generateUUID(),
                        agentId: agent.id,
                      },
                    }));
                  }}
                >
                  <MicIcon className="text-foreground" />
                  <span>{t("Chat.VoiceChat.title")}</span>
                </div>
              </CommandItem>
              {isOwner && (
                <CommandItem className="cursor-pointer p-0">
                  <Link
                    to={`/agent/${agent.id}`}
                    className="flex items-center gap-2 w-full px-2 py-1 rounded"
                  >
                    <PencilLine className="text-foreground" />
                    {t("Common.edit")}
                  </Link>
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
