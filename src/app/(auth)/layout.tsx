"use client";

import { AnimatedLogo } from "@/components/layouts/animated-logo";
import { useTranslations } from "next-intl";
import { BackgroundPaths } from "ui/background-paths";
import { FlipWords } from "ui/flip-words";

// Constants for logo sizes - improves maintainability
const DESKTOP_LOGO_SIZE = 80;
const MOBILE_LOGO_SIZE = 64;

interface AuthLayoutProps {
  readonly children: React.ReactNode;
}

export default function AuthLayout({ children }: AuthLayoutProps) {
  const t = useTranslations("Auth.Intro");
  return (
    <main className="relative w-full flex flex-col h-screen">
      <div className="flex-1">
        <div className="flex min-h-screen w-full">
          <div className="hidden lg:flex lg:w-1/2 bg-muted border-r flex-col p-18 relative">
            <div className="absolute inset-0 w-full h-full">
              <BackgroundPaths />
            </div>
            <h1 className="text-4xl font-bold flex items-center gap-4 animate-in fade-in duration-1000">
              <AnimatedLogo
                width={DESKTOP_LOGO_SIZE}
                height={DESKTOP_LOGO_SIZE}
              />
              <span>Shadower</span>
            </h1>
            <div className="flex-1" />
            <FlipWords
              words={[t("description")]}
              className=" mb-4 text-muted-foreground"
            />
          </div>

          <div className="w-full lg:w-1/2 p-6 relative flex flex-col">
            {/* Mobile logo and text */}
            <div className="lg:hidden mb-6 pt-4 flex justify-center">
              <h1 className="text-3xl sm:text-4xl font-bold flex items-center gap-3">
                <AnimatedLogo
                  width={MOBILE_LOGO_SIZE}
                  height={MOBILE_LOGO_SIZE}
                  className="sm:w-20 sm:h-20"
                />
                <span>Shadower</span>
              </h1>
            </div>
            <div className="flex-1 flex items-center justify-center min-h-0">
              {children}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
