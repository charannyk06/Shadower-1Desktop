import { useEffect, useState } from "react";
import { useParams, useNavigate } from "@tanstack/react-router";
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
export default function ChatThreadPage() {
  const params = useParams({ strict: false });
  const navigate = useNavigate();
  const threadId = params.threadId;
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
          navigate({ to: "/" });
          return;
        }

        setMessages(thread.messages || []);
      } catch (error) {
        console.error("[ChatThreadPage] Error loading thread:", error);
        navigate({ to: "/" });
      }
      setIsLoading(false);
    };

    loadThread();
  }, [threadId, session?.user?.id, navigate]);

  if (!session?.user?.id) {
    return null; // AuthGuard will handle redirect
  }

  if (!threadId) {
    navigate({ to: "/" });
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
