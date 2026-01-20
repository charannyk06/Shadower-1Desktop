import EmailSignUp from "@/components/auth/email-sign-up";
import { useEffect, useState } from "react";

export default function EmailSignUpPage() {
  const [isFirstUser, setIsFirstUser] = useState(true);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const checkFirstUser = async () => {
      try {
        // In Electron, check if this is first launch via IPC
        if (window.electronAPI?.auth?.isFirstLaunch) {
          const firstLaunch = await window.electronAPI.auth.isFirstLaunch();
          setIsFirstUser(firstLaunch);
        }
      } catch (error) {
        console.error("[EmailSignUp] Error checking first user:", error);
        setIsFirstUser(true); // Assume first user on error
      }
      setIsLoading(false);
    };

    checkFirstUser();
  }, []);

  if (isLoading) {
    return null;
  }

  return <EmailSignUp isFirstUser={isFirstUser} />;
}
