import { BasicUser } from "app-types/user";
import { useMemo } from "react";
import { SWRConfig, SWRConfiguration } from "swr";

interface SWRConfigProviderProps {
  children: React.ReactNode;
  user?: BasicUser;
}

export function SWRConfigProvider({ children, user }: SWRConfigProviderProps) {
  const config = useMemo<SWRConfiguration>(() => {
    return {
      focusThrottleInterval: 30000,
      dedupingInterval: 2000,
      errorRetryCount: 1,
      fallback: {
        "/api/user/details": user,
      },
    };
  }, [user]);

  return <SWRConfig value={config}>{children}</SWRConfig>;
}
