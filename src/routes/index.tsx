import ChatBot from "@/components/chat-bot";
import { generateUUID } from "@/lib/utils";
import { useSearch } from "@tanstack/react-router";
import { useMemo } from "react";

/**
 * Home Page - Chat Interface
 *
 * Note: Auth is handled by AuthGuard in the layout.
 * No server-side session check needed in Electron mode.
 */
export default function HomePage() {
  // Use search param to trigger new chat creation
  // When "New Chat" is clicked, the `new` param changes, causing ID regeneration
  const { new: newChatTrigger } = useSearch({ strict: false });

  // Generate a new thread ID when the page mounts or when newChatTrigger changes
  const id = useMemo(() => generateUUID(), [newChatTrigger]);

  return <ChatBot initialMessages={[]} threadId={id} key={id} />;
}
