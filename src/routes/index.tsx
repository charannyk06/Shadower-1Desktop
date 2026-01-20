import ChatBot from "@/components/chat-bot";
import { generateUUID } from "@/lib/utils";
import { useMemo } from "react";

/**
 * Home Page - Chat Interface
 *
 * Note: Auth is handled by AuthGuard in the layout.
 * No server-side session check needed in Electron mode.
 */
export default function HomePage() {
  // Generate a stable thread ID for this page load
  const id = useMemo(() => generateUUID(), []);

  return <ChatBot initialMessages={[]} threadId={id} key={id} />;
}
