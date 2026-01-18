"use client";

import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { cn } from "lib/utils";
import * as React from "react";

interface TabItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
}

interface AnimatedTabsProps {
  tabs: TabItem[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  className?: string;
}

interface AnimatedTabsContentProps {
  children: React.ReactNode;
  tabId: string;
  activeTab: string;
  className?: string;
  direction?: number;
}

interface AnimatedTabsContainerProps {
  children: React.ReactNode;
  className?: string;
}

// Slide variants for tab content
const slideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 30 : -30,
    opacity: 0,
    scale: 0.98,
  }),
  center: {
    x: 0,
    opacity: 1,
    scale: 1,
  },
  exit: (direction: number) => ({
    x: direction < 0 ? 30 : -30,
    opacity: 0,
    scale: 0.98,
  }),
};

// Stagger children variants for lists inside tabs
export const staggerContainerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.1,
    },
  },
};

export const staggerItemVariants = {
  hidden: { opacity: 0, y: 15, scale: 0.95 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      type: "spring" as const,
      stiffness: 300,
      damping: 24,
    },
  },
};

// Fade up variants for cards
export const fadeUpVariants = {
  hidden: { opacity: 0, y: 20 },
  show: {
    opacity: 1,
    y: 0,
    transition: {
      type: "spring" as const,
      stiffness: 260,
      damping: 20,
    },
  },
};

export function AnimatedTabs({
  tabs,
  activeTab,
  onTabChange,
  className,
}: Readonly<AnimatedTabsProps>) {
  return (
    <LayoutGroup>
      <div
        className={cn(
          "relative inline-flex h-11 items-center justify-center rounded-xl bg-muted/60 p-1 backdrop-blur-sm border border-border/50",
          className,
        )}
      >
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={cn(
                "relative z-10 inline-flex h-9 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground/80",
              )}
            >
              {isActive && (
                <motion.div
                  layoutId="activeTabIndicator"
                  className="absolute inset-0 rounded-lg bg-background shadow-sm border border-border/50"
                  style={{ zIndex: -1 }}
                  transition={{
                    type: "spring",
                    stiffness: 400,
                    damping: 30,
                  }}
                />
              )}
              {tab.icon && (
                <motion.span
                  initial={false}
                  animate={{
                    scale: isActive ? 1.05 : 1,
                  }}
                  transition={{ type: "spring", stiffness: 400, damping: 17 }}
                >
                  {tab.icon}
                </motion.span>
              )}
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </LayoutGroup>
  );
}

export function AnimatedTabsContainer({
  children,
  className,
}: Readonly<AnimatedTabsContainerProps>) {
  return (
    <div className={cn("relative overflow-hidden", className)}>{children}</div>
  );
}

export function AnimatedTabContent({
  children,
  tabId,
  activeTab,
  className,
  direction = 0,
}: Readonly<AnimatedTabsContentProps>) {
  const isActive = activeTab === tabId;

  return (
    <AnimatePresence mode="wait" custom={direction}>
      {isActive && (
        <motion.div
          key={tabId}
          custom={direction}
          variants={slideVariants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{
            x: { type: "spring", stiffness: 300, damping: 30 },
            opacity: { duration: 0.2 },
            scale: { duration: 0.2 },
          }}
          className={cn("w-full", className)}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Motion card wrapper for staggered animations
export const MotionCard = motion.div;

// Grid container with stagger effect
export function StaggeredGrid({
  children,
  className,
}: Readonly<{
  children: React.ReactNode;
  className?: string;
}>) {
  return (
    <motion.div
      variants={staggerContainerVariants}
      initial="hidden"
      animate="show"
      className={className}
    >
      {children}
    </motion.div>
  );
}

// Individual stagger item
export function StaggerItem({
  children,
  className,
}: Readonly<{
  children: React.ReactNode;
  className?: string;
}>) {
  return (
    <motion.div variants={staggerItemVariants} className={className}>
      {children}
    </motion.div>
  );
}

// Wrapper for page-level animations
export function PageTransition({
  children,
  className,
}: Readonly<{
  children: React.ReactNode;
  className?: string;
}>) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        type: "spring",
        stiffness: 260,
        damping: 20,
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
