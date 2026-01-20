import SignUpPage from "@/components/auth/sign-up";
import { getAuthConfig } from "auth/config";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export default function SignUp() {
  const navigate = useNavigate();
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
      navigate({ to: "/sign-in" });
      return;
    }

    if (emailAndPasswordEnabled && enabledProviders.length === 0) {
      navigate({ to: "/sign-up/email" });
    }
  }, [
    isLoading,
    signUpEnabled,
    emailAndPasswordEnabled,
    enabledProviders.length,
    navigate,
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
