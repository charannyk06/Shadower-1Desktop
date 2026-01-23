"use client";

import { lazy, Suspense } from "react";

const KeyboardShortcutsPopup = lazy(() =>
  import("@/components/keyboard-shortcuts-popup").then((mod) => ({
    default: mod.KeyboardShortcutsPopup,
  })),
);

const ChatPreferencesPopup = lazy(() =>
  import("@/components/chat-preferences-popup").then((mod) => ({
    default: mod.ChatPreferencesPopup,
  })),
);

const ChatBotVoice = lazy(() =>
  import("@/components/chat-bot-voice").then((mod) => ({
    default: mod.ChatBotVoice,
  })),
);

const McpCustomizationPopup = lazy(() =>
  import("@/components/mcp-customization-popup").then((mod) => ({
    default: mod.McpCustomizationPopup,
  })),
);

const KnowledgePopup = lazy(() =>
  import("@/components/knowledge/knowledge-popup").then((mod) => ({
    default: mod.KnowledgePopup,
  })),
);

const KnowledgeContent = lazy(() =>
  import("@/components/knowledge/knowledge-content").then((mod) => ({
    default: mod.KnowledgeContent,
  })),
);

export function AppPopupProvider() {
  return (
    <Suspense fallback={null}>
      <KeyboardShortcutsPopup />
      <ChatPreferencesPopup />
      <Suspense fallback={null}>
        <KnowledgePopup
          knowledgeComponent={
            <Suspense fallback={null}>
              <KnowledgeContent />
            </Suspense>
          }
        />
      </Suspense>
      <ChatBotVoice />
      <McpCustomizationPopup />
    </Suspense>
  );
}
