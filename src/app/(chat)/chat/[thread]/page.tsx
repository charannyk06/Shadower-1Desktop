import { selectThreadWithMessagesAction } from "@/app/api/chat/actions";
import ChatBot from "@/components/chat-bot";

import { ChatMessage, ChatThread } from "app-types/chat";
import logger from "logger";
import { RedirectType, redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const fetchThread = async (
  threadId: string,
): Promise<(ChatThread & { messages: ChatMessage[] }) | null> => {
  try {
    return await selectThreadWithMessagesAction(threadId);
  } catch (error) {
    // Check if this is a Next.js redirect error - if so, re-throw it
    if (
      error &&
      typeof error === "object" &&
      "digest" in error &&
      typeof error.digest === "string" &&
      error.digest.includes("NEXT_REDIRECT")
    ) {
      throw error;
    }
    logger.error("Error fetching thread:", error);
    return null;
  }
};

export default async function Page({
  params,
}: { params: Promise<{ thread: string }> }) {
  try {
    const { thread: threadId } = await params;

    if (!threadId) {
      logger.error("Thread ID is missing");
      redirect("/", RedirectType.replace);
    }

    const thread = await fetchThread(threadId);

    if (!thread) {
      logger.warn("Thread not found or unauthorized:", threadId);
      redirect("/", RedirectType.replace);
    }

    return <ChatBot threadId={threadId} initialMessages={thread.messages} />;
  } catch (error) {
    // Re-throw Next.js redirect errors - they should not be caught
    if (
      error &&
      typeof error === "object" &&
      "digest" in error &&
      typeof error.digest === "string" &&
      error.digest.includes("NEXT_REDIRECT")
    ) {
      throw error;
    }
    // Log and redirect for other errors
    logger.error("Error in chat thread page:", error);
    redirect("/", RedirectType.replace);
  }
}
