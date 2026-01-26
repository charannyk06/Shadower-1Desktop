"use client";

import {
  Shortcuts,
  getShortcutKeyList,
  isShortcutEvent,
} from "lib/keyboard-shortcuts";

import { appStore } from "@/app/store";
import { useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "ui/dialog";
import { useShallow } from "zustand/shallow";

// Keyboard shortcut descriptions
const shortcutDescriptions: Record<string, string> = {
  toggleSidebar: "Toggle Sidebar",
  toggleVoiceChat: "Toggle Voice Chat",
  newChat: "New Chat",
  focusInput: "Focus Input",
  openChatPreferences: "Open Chat Preferences",
  openShortcutsPopup: "Open Shortcuts",
};

export function KeyboardShortcutsPopup() {
  const [openShortcutsPopup, appStoreMutate] = appStore(
    useShallow((state) => [state.openShortcutsPopup, state.mutate]),
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isShortcutEvent(e, Shortcuts.openShortcutsPopup)) {
        e.preventDefault();
        e.stopPropagation();
        appStoreMutate((prev) => ({
          openShortcutsPopup: !prev.openShortcutsPopup,
        }));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [appStoreMutate]);

  return (
    <Dialog
      open={openShortcutsPopup}
      onOpenChange={() =>
        appStoreMutate({ openShortcutsPopup: !openShortcutsPopup })
      }
    >
      <DialogContent className="md:max-w-3xl">
        <DialogTitle>Keyboard Shortcuts</DialogTitle>
        <DialogDescription />
        <div className="grid grid-cols-2 gap-5">
          {Object.entries(Shortcuts).map(([key, shortcut]) => (
            <div
              key={key}
              className="flex items-center gap-2 w-full text-sm px-2"
            >
              <p>
                {shortcutDescriptions[shortcut.description ?? ""] ||
                  shortcut.description}
              </p>
              <div className="flex-1" />
              {getShortcutKeyList(shortcut).map((k) => {
                return (
                  <div
                    key={k}
                    className="p-1.5 text-xs border min-w-8 min-h-8 flex items-center justify-center rounded-md bg-muted"
                  >
                    <span>{k}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
