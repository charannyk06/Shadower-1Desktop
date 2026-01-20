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
  const { data: user } = useSWR<BasicUser>(`/api/user/details`, userFetcher, {
    revalidateOnMount: false,
  });
  const { t } = useTranslation();

  const word = useMemo(() => {
    if (!user?.name) return "";
    const words = [
      t("Chat.Greeting." + getGreetingByTime(), { name: user.name }),
      t("Chat.Greeting.niceToSeeYouAgain", { name: user.name }),
      t("Chat.Greeting.whatAreYouWorkingOnToday", { name: user.name }),
      t("Chat.Greeting.letMeKnowWhenYoureReadyToBegin"),
      t("Chat.Greeting.whatAreYourThoughtsToday"),
      t("Chat.Greeting.whereWouldYouLikeToStart"),
      t("Chat.Greeting.whatAreYouThinking", { name: user.name }),
    ];
    return words[Math.floor(Math.random() * words.length)];
  }, [user?.name]);

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
