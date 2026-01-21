"use client";

import { userFetcher } from "@/lib/electron/user-api";
import { BasicUser } from "app-types/user";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { useMemo } from "react";
import useSWR from "swr";
import { FlipWords } from "ui/flip-words";

function getGreetingByTime() {
  const hour = new Date().getHours();
  if (hour < 12) return "goodMorning";
  if (hour < 18) return "goodAfternoon";
  return "goodEvening";
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
  const { t } = useTranslation();

  // Debug: log user data to understand what's being returned
  console.log(
    "[ChatGreeting] user data:",
    JSON.stringify(user),
    "isLoading:",
    isLoading,
  );

  const word = useMemo(() => {
    // Get the user's name, with fallback
    const userName = user?.name?.trim();
    console.log("[ChatGreeting] computed userName:", userName);

    // If no name or still loading, show greetings without name
    if (!userName) {
      const genericWords = [
        t("Chat.Greeting.letMeKnowWhenYoureReadyToBegin"),
        t("Chat.Greeting.whatAreYourThoughtsToday"),
        t("Chat.Greeting.whereWouldYouLikeToStart"),
      ];
      return genericWords[Math.floor(Math.random() * genericWords.length)];
    }

    const words = [
      t("Chat.Greeting." + getGreetingByTime(), { name: userName }),
      t("Chat.Greeting.niceToSeeYouAgain", { name: userName }),
      t("Chat.Greeting.whatAreYouWorkingOnToday", { name: userName }),
      t("Chat.Greeting.letMeKnowWhenYoureReadyToBegin"),
      t("Chat.Greeting.whatAreYourThoughtsToday"),
      t("Chat.Greeting.whereWouldYouLikeToStart"),
      t("Chat.Greeting.whatAreYouThinking", { name: userName }),
    ];
    return words[Math.floor(Math.random() * words.length)];
  }, [user?.name, t, isLoading]);

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
