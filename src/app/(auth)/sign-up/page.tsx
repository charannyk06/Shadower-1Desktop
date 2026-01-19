"use client";

import SignUpPage from "@/components/auth/sign-up";
import { getAuthConfig } from "auth/config";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth/client";

export default function SignUp() {
  const router = useRouter();
  const [isFirstUser, setIsFirstUser] = useState(true);
  const [isLoading, setIsLoading] = useState(true);

  const {
    emailAndPasswordEnabled,
    socialAuthenticationProviders,
    signUpEnabled,
  } = getAuthConfig();

  const enabledProviders = (
    Object.keys(
      socialAuthenticationProviders,
    ) as (keyof typeof socialAuthenticationProviders)[]
  ).filter((key) => socialAuthenticationProviders[key]);

  useEffect(() => {
    const checkFirstUser = async () => {
      try {
        // In Electron, check if this is first launch via IPC
        if (window.electronAPI?.auth?.isFirstLaunch) {
          const firstLaunch = await window.electronAPI.auth.isFirstLaunch();
          setIsFirstUser(firstLaunch);
        }
      } catch (error) {
        console.error("[SignUp] Error checking first user:", error);
        setIsFirstUser(true); // Assume first user on error
      }
      setIsLoading(false);
    };

    checkFirstUser();
  }, []);

  useEffect(() => {
    if (isLoading) return;

    if (!signUpEnabled) {
      router.replace("/sign-in");
      return;
    }

    if (emailAndPasswordEnabled && enabledProviders.length === 0) {
      router.replace("/sign-up/email");
    }
  }, [
    isLoading,
    signUpEnabled,
    emailAndPasswordEnabled,
    enabledProviders.length,
    router,
  ]);

  if (isLoading) {
    return null;
  }

  return (
    <SignUpPage
      isFirstUser={isFirstUser}
      emailAndPasswordEnabled={emailAndPasswordEnabled}
      socialAuthenticationProviders={enabledProviders}
    />
  );
}
