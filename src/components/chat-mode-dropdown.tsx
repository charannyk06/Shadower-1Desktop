"use client";

import { appStore } from "@/app/store";
import {
  Shortcuts,
  getShortcutKeyList,
  isShortcutEvent,
} from "lib/keyboard-shortcuts";
import {
  Check,
  CheckIcon,
  Database,
  Infinity,
  ListTodo,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "ui/button";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "ui/dropdown-menu";

import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";
import { useShallow } from "zustand/shallow";

import { capitalizeFirstLetter, cn, createDebounce } from "lib/utils";

const debounce = createDebounce();

export const ChatModeDropdown = ({ disabled }: { disabled?: boolean }) => {
  const [chatMode, appStoreMutate] = appStore(
    useShallow((state) => [state.chatMode, state.mutate]),
  );
  const [open, setOpen] = useState(false);

  const [chatModeChangeInfo, setChatModeChangeInfo] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isShortcutEvent(e, Shortcuts.chatMode)) {
        e.preventDefault();
        e.stopPropagation();
        appStoreMutate(({ chatMode }) => {
          // Cycle through: regular -> agent -> rag -> regular
          const nextMode = chatMode === "regular" ? "agent" : chatMode === "agent" ? "rag" : "regular";
          return {
            chatMode: nextMode,
          };
        });
        setChatModeChangeInfo(true);
        debounce(() => {
          setChatModeChangeInfo(false);
        }, 1000);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [appStoreMutate]);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <div className="relative">
          <Tooltip open={chatModeChangeInfo}>
            <TooltipTrigger asChild>
              <span className="absolute inset-0 -z-10" />
            </TooltipTrigger>
            <TooltipContent className="flex items-center gap-2">
              {capitalizeFirstLetter(chatMode)}
              <CheckIcon className="size-2.5" />
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={"ghost"}
                size={"sm"}
                className={cn(
                  "rounded-full p-2! data-[state=open]:bg-input! hover:bg-input!",
                  (chatMode === "agent" || chatMode === "rag") && "text-primary",
                  open && "bg-input!",
                )}
                onClick={() => setOpen(true)}
              >
                {chatMode === "agent" ? <Infinity /> : chatMode === "rag" ? <Database /> : <ListTodo />}
              </Button>
            </TooltipTrigger>
            <TooltipContent className="flex items-center gap-2" side="top">
              Select chat mode
              <span className="text-muted-foreground ml-2">
                {getShortcutKeyList(Shortcuts.chatMode).join("")}
              </span>
            </TooltipContent>
          </Tooltip>
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top">
        <DropdownMenuLabel className="text-muted-foreground flex items-center gap-2">
          Select chat mode
          <DropdownMenuShortcut>
            <span className="text-xs text-muted-foreground bg-muted rounded-md px-2 py-0.5">
              {getShortcutKeyList(Shortcuts.chatMode).join("")}
            </span>
          </DropdownMenuShortcut>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            onClick={() => appStoreMutate({ chatMode: "agent" })}
          >
            <div className="flex flex-col gap-2 w-full">
              <div className="flex items-center gap-2">
                <Infinity />
                <span className="font-bold">Agent</span>
                {chatMode === "agent" && <Check className="ml-auto" />}
              </div>
              <p className="text-xs text-muted-foreground">
                Autonomous planning & execution with sub-agents
              </p>
            </div>
          </DropdownMenuItem>
          <div className="px-2 py-1">
            <DropdownMenuSeparator />
          </div>
          <DropdownMenuItem
            onClick={() => appStoreMutate({ chatMode: "regular" })}
          >
            <div className="flex flex-col gap-2 w-full">
              <div className="flex items-center gap-2">
                <ListTodo />
                <span className="font-bold">Chat</span>
                {chatMode === "regular" && <Check className="ml-auto" />}
              </div>
              <p className="text-xs text-muted-foreground">
                Standard chat with tool access
              </p>
            </div>
          </DropdownMenuItem>
          <div className="px-2 py-1">
            <DropdownMenuSeparator />
          </div>
          <DropdownMenuItem
            onClick={() => appStoreMutate({ chatMode: "rag" })}
          >
            <div className="flex flex-col gap-2 w-full">
              <div className="flex items-center gap-2">
                <Database />
                <span className="font-bold">RAG</span>
                {chatMode === "rag" && <Check className="ml-auto" />}
              </div>
              <p className="text-xs text-muted-foreground">
                Chat-only mode with memory context (no tools)
              </p>
            </div>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
