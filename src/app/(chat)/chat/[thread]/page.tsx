"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import ChatBot from "@/components/chat-bot";
import { authClient } from "@/lib/auth/client";
import { threadApi } from "@/lib/electron/thread-api";
import { Loader2 } from "lucide-react";
import type { ChatMessage } from "app-types/chat";

/**
 * Chat Thread Page
 * Auth is handled by AuthGuard in the layout.
 * Thread data is fetched via IPC in Electron mode.
 */
export default function Page() {
  const params = useParams();
  const router = useRouter();
  const threadId = params.thread as string;
  const { data: session } = authClient.useSession();

  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!session?.user?.id || !threadId) return;

    const loadThread = async () => {
      setIsLoading(true);
      try {
        const thread = await threadApi.getThreadWithMessages(threadId);

        if (!thread) {
          // Thread not found or unauthorized
          router.replace("/");
          return;
        }

        setMessages(thread.messages || []);
      } catch (error) {
        console.error("[ChatThreadPage] Error loading thread:", error);
        router.replace("/");
      }
      setIsLoading(false);
    };

    loadThread();
  }, [threadId, session?.user?.id, router]);

  if (!session?.user?.id) {
    return null; // AuthGuard will handle redirect
  }

  if (!threadId) {
    router.replace("/");
    return null;
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (messages === null) {
    return null; // Loading or error - will redirect
  }

  return <ChatBot threadId={threadId} initialMessages={messages} />;
}
