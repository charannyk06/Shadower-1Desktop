"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { authClient } from "@/lib/auth/client";

interface AuthGuardProps {
  children: React.ReactNode;
}

/**
 * Auth Guard Component
 *
 * Protects routes by checking authentication status.
 * Redirects to sign-in or registration based on first-launch status.
 */
export function AuthGuard({ children }: AuthGuardProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const hasCheckedAuth = useRef(false);

  useEffect(() => {
    // Only check auth once on mount
    if (hasCheckedAuth.current) {
      return;
    }
    hasCheckedAuth.current = true;

    const checkAuth = async () => {
      try {
        // Check if user is authenticated
        const session = await authClient.validateSession();

        if (session) {
          setIsAuthenticated(true);
          setIsLoading(false);
          return;
        }

        // Not authenticated - check if first launch
        const isFirst = await authClient.isFirstLaunch();

        if (isFirst) {
          // First time user - redirect to registration
          router.replace("/sign-up");
        } else {
          // Returning user - redirect to sign-in
          router.replace("/sign-in");
        }
      } catch (error) {
        console.error("[AuthGuard] Error checking auth:", error);
        // On error, try to redirect to registration
        router.replace("/sign-up");
      }
    };

    checkAuth();
  }, [router]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null; // Will redirect
  }

  return <>{children}</>;
}
