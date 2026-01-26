"use client";

import { userFetcher } from "@/lib/electron/user-api";
import { BasicUser } from "app-types/user";
import { motion } from "framer-motion";
import { useMemo } from "react";
import useSWR from "swr";
import { FlipWords } from "ui/flip-words";

function getGreetingByTime(name: string) {
  const hour = new Date().getHours();
  if (hour < 12) return `Good morning, ${name}`;
  if (hour < 18) return `Good afternoon, ${name}`;
  return `Good evening, ${name}`;
}

export const ChatGreeting = () => {
  const { data: user, isLoading } = useSWR<BasicUser>(
    `/api/user/details`,
    userFetcher,
    {
      revalidateOnMount: true,
      revalidateOnFocus: false,
    },
  );

  const word = useMemo(() => {
    // Get the user's name, with fallback
    const userName = user?.name?.trim();

    // If no name or still loading, show greetings without name
    if (!userName) {
      const genericWords = [
        "Let me know when you're ready to begin.",
        "What are your thoughts today?",
        "Where would you like to start?",
      ];
      return genericWords[Math.floor(Math.random() * genericWords.length)];
    }

    const words = [
      getGreetingByTime(userName),
      `Nice to see you again, ${userName}`,
      `What are you working on today? ${userName}`,
      "Let me know when you're ready to begin.",
      "What are your thoughts today?",
      "Where would you like to start?",
      `What are you thinking? ${userName}`,
    ];
    return words[Math.floor(Math.random() * words.length)];
  }, [user?.name, isLoading]);

  return (
    <motion.div
      key="welcome"
      className="max-w-3xl mx-auto my-4 h-20"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ delay: 0.3 }}
    >
      <div className="rounded-xl p-6 flex flex-col gap-2 leading-relaxed text-center">
        <h1 className="text-2xl md:text-3xl">
          {word ? <FlipWords words={[word]} className="text-primary" /> : ""}
        </h1>
      </div>
    </motion.div>
  );
};
