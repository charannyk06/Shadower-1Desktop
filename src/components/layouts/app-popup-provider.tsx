"use client";

import dynamic from "next/dynamic";

const KeyboardShortcutsPopup = dynamic(
  () =>
    import("@/components/keyboard-shortcuts-popup").then(
      (mod) => mod.KeyboardShortcutsPopup,
    ),
  {
    ssr: false,
  },
);

const ChatPreferencesPopup = dynamic(
  () =>
    import("@/components/chat-preferences-popup").then(
      (mod) => mod.ChatPreferencesPopup,
    ),
  {
    ssr: false,
  },
);

const ChatBotVoice = dynamic(
  () => import("@/components/chat-bot-voice").then((mod) => mod.ChatBotVoice),
  {
    ssr: false,
  },
);

const ChatBotTemporary = dynamic(
  () =>
    import("@/components/chat-bot-temporary").then(
      (mod) => mod.ChatBotTemporary,
    ),
  {
    ssr: false,
  },
);

const McpCustomizationPopup = dynamic(
  () =>
    import("@/components/mcp-customization-popup").then(
      (mod) => mod.McpCustomizationPopup,
    ),
  {
    ssr: false,
  },
);

const UserSettingsPopup = dynamic(
  () =>
    import("@/components/user/user-detail/user-settings-popup").then(
      (mod) => mod.UserSettingsPopup,
    ),
  {
    ssr: false,
  },
);

const ReferralPopup = dynamic(
  () =>
    import("@/components/referral/referral-popup").then(
      (mod) => mod.ReferralPopup,
    ),
  {
    ssr: false,
  },
);

const ReferralContent = dynamic(
  () =>
    import("@/components/referral/referral-content").then(
      (mod) => mod.ReferralContent,
    ),
  {
    ssr: false,
  },
);

const BillingPopup = dynamic(
  () =>
    import("@/components/billing/billing-popup").then(
      (mod) => mod.BillingPopup,
    ),
  {
    ssr: false,
  },
);

const BillingDashboard = dynamic(
  () =>
    import("@/components/billing/billing-dashboard").then(
      (mod) => mod.BillingDashboard,
    ),
  {
    ssr: false,
  },
);

const KnowledgePopup = dynamic(
  () =>
    import("@/components/knowledge/knowledge-popup").then(
      (mod) => mod.KnowledgePopup,
    ),
  {
    ssr: false,
  },
);

const KnowledgeContent = dynamic(
  () =>
    import("@/components/knowledge/knowledge-content").then(
      (mod) => mod.KnowledgeContent,
    ),
  {
    ssr: false,
  },
);

export function AppPopupProvider({
  userSettingsComponent,
}: {
  userSettingsComponent: React.ReactNode;
}) {
  return (
    <>
      <KeyboardShortcutsPopup />
      <ChatPreferencesPopup />
      <UserSettingsPopup userSettingsComponent={userSettingsComponent} />
      <ReferralPopup referralComponent={<ReferralContent />} />
      <BillingPopup billingComponent={<BillingDashboard />} />
      <KnowledgePopup knowledgeComponent={<KnowledgeContent />} />
      <ChatBotVoice />
      <ChatBotTemporary />
      <McpCustomizationPopup />
    </>
  );
}
