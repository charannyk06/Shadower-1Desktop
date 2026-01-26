import { useEffect, useState } from "react";
import { useParams, useNavigate } from "@tanstack/react-router";
import ChatBot from "@/components/chat-bot";
import { authClient } from "@/lib/auth/client";
import { threadApi } from "@/lib/electron/thread-api";
import { appStore } from "@/app/store";
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
  const { data: session, isPending: isSessionPending } =
    authClient.useSession();

  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadedThreadId, setLoadedThreadId] = useState<string | null>(null);

  useEffect(() => {
    // Wait for session to load
    if (isSessionPending) return;

    // If no user after session loads, AuthGuard handles redirect
    if (!session?.user?.id) {
      setIsLoading(false);
      return;
    }

    if (!threadId) {
      navigate({ to: "/" });
      return;
    }

    // Don't reload if we already loaded this thread
    if (loadedThreadId === threadId && messages !== null) {
      setIsLoading(false);
      return;
    }

    const loadThread = async () => {
      setIsLoading(true);
      setMessages(null);
      try {
        console.log("[ChatThreadPage] Loading thread:", threadId);
        const thread = await threadApi.getThreadWithMessages(threadId);

        if (!thread) {
          console.log("[ChatThreadPage] Thread not found, redirecting to home");
          navigate({ to: "/" });
          return;
        }

        console.log(
          "[ChatThreadPage] Thread loaded with",
          thread.messages?.length || 0,
          "messages, provider:",
          thread.provider,
          "model:",
          thread.model
        );

        // Restore the thread's model in the store when loading
        if (thread.provider && thread.model) {
          console.log("[ChatThreadPage] Restoring thread model:", thread.provider, thread.model);

          // Store the thread-specific model
          appStore.setState((state) => ({
            threadChatModels: {
              ...state.threadChatModels,
              [threadId]: {
                provider: thread.provider!,
                model: thread.model!,
              },
            },
          }));

          // Also set as the global chat model so the UI shows correctly
          appStore.setState({
            chatModel: {
              provider: thread.provider,
              model: thread.model,
            },
          });

          // If it's a coding agent, also sync the settings
          if (thread.provider === "coding-agents") {
            console.log("[ChatThreadPage] Syncing ACP agent settings");
            appStore.setState({
              toolChoice: "auto",
              chatMode: "agent",
            });
          }
        }

        setMessages(thread.messages || []);
        setLoadedThreadId(threadId);
      } catch (error) {
        console.error("[ChatThreadPage] Error loading thread:", error);
        navigate({ to: "/" });
      } finally {
        setIsLoading(false);
      }
    };

    loadThread();
  }, [threadId, session?.user?.id, isSessionPending, navigate, loadedThreadId, messages]);

  // Show loading while session is pending
  if (isSessionPending) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // AuthGuard handles redirect if no session
  if (!session?.user?.id) {
    return null;
  }

  if (!threadId) {
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
    return null;
  }

  return (
    <ChatBot
      threadId={threadId}
      initialMessages={messages}
      key={threadId}
    />
  );
}
